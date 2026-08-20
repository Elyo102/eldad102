/* =====================================================================
 *  calendar-unified.js — לוח שנה אחד
 *  נטען אחרי app.js ודורס את פונקציות הלוח שבו.
 * =====================================================================
 *
 *  קודם היו שלושה לוחות:
 *    1. screen-calendar        (אייקון 📅)        — listMyEvents
 *    2. dash-calendar-card     (בתוך מסך הניהול)  — אותו מקור, רינדור כפול
 *    3. יומן אבטחות            (מודאל מסך מלא)    — listGuardEvents
 *
 *  אחרי הקובץ הזה יש אחד: screen-calendar, מאחורי אייקון 📅, ובו
 *  האבטחות והאירועים יחד.
 *
 *  שתי החלטות מרכזיות:
 *
 *  א. מערכת האבטחות לא נבנית מחדש. יש בה שיבוץ לפי חלוקת עומס, ייבוא
 *     מהסידור ודוח פיזור — עבודה שאין סיבה לזרוק. רק התצוגה שלה
 *     מתקפלת לתוך הלוח המשותף; היצירה והשיבוץ ממשיכים לרוץ דרך
 *     openGuardFormModal ו-openAssignModal הקיימות.
 *
 *  ב. הנתונים מגיעים משני מקורות ומאוחדים בצד הלקוח לצורה אחת. זה מה
 *     שמאפשר לוח אחד בלי מיגרציה של גיליון האבטחות.
 *
 *  התקנה: מוסיפים ב-index.html שורה אחת, אחרי app.js:
 *      <script src="calendar-unified.js"></script>
 *  לא מוחקים כלום — לא ב-app.js ולא ב-index.html.
 * ===================================================================== */

(function () {
  'use strict';

  // ── סוגי אירוע ──
  // "אבטחה" הוא הסוג שמחליף את הלוח הנפרד. שאר הסוגים מגיעים
  // מ-Calendar.gs. source קובע לאיזה API כל אירוע חוזר בעדכון/מחיקה.
  var TYPE_META = {
    'אבטחה':       { icon: '🛡️', color: '#0b6b3a' },
    'תרגיל':       { icon: '🎯', color: '#c1272d' },
    'הדרכה':       { icon: '📚', color: '#1860ad' },
    'סיור לימודי': { icon: '🎓', color: '#2e7d32' },
    'ישיבה':       { icon: '👥', color: '#5b6b7a' },
    'תורנות':      { icon: '🔧', color: '#8d6e63' },
    'אירוע חברתי': { icon: '🎉', color: '#d38b00' },
    'אחר':         { icon: '📌', color: '#6a4c93' }
  };

  var FILTERS = [
    { id: '',        label: 'הכל' },
    { id: 'mine',    label: 'שלי' },
    { id: 'אבטחה',   label: '🛡️ אבטחות' },
    { id: 'events',  label: '📅 אירועים' }
  ];

  var uni = {
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    events: [],
    filter: '',
    selectedDate: null,
    loading: false
  };

  // ── בלוח השנה של ליסה לא נוגעים ──
  // הכרטיס במסך הניהול הוא לוח השנה של ה-HR, והיא נכנסת ישירות אליו.
  // כל דריסה כאן מדלגת עליה ומפנה לפונקציה המקורית, כך שהמסך שלה
  // נשאר בדיוק כפי שהוא היום.
  var ORIG = {
    load:     loadCalendarEvents,
    grid:     renderCalendarGrid,
    gridInto: renderCalendarGridInto,
    dayList:  showCalendarDayEvents,
    addModal: openAddEventModal
  };

  function isLisa() {
    return state.isHr === true && state.isAdmin !== true;
  }

  function monthKeyOfDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function meta(type) {
    return TYPE_META[type] || TYPE_META['אחר'];
  }

  function dateKeyOf(iso) {
    if (!iso) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }

  function timeLabel(e) {
    if (e.startTime) return e.startTime + (e.endTime ? '-' + e.endTime : '');
    if (!e.startISO) return '';
    var d = new Date(e.startISO);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  // -------------------------------------------------------------------
  //  איסוף הנתונים משני המקורות
  // -------------------------------------------------------------------
  //  כישלון של מקור אחד לא מפיל את השני. אם גיליון האבטחות לא נגיש,
  //  עדיין רואים את שאר האירועים — לוח חלקי עדיף על מסך שגיאה.

  function loadUnified() {
    var monthKey = monthKeyOfDate(uni.month);
    uni.loading = true;
    renderAll();

    var jobs = [
      callApi('GET', 'listCalendarEvents', { code: state.code, monthKey: monthKey }, true)
        .then(function (r) { return normalizeCalendarEvents(r); })
        .catch(function () { return []; }),

      callApi('GET', 'listGuardEvents', { code: state.code, monthKey: monthKey }, true)
        .then(function (r) { return normalizeGuardEvents(r); })
        .catch(function () { return []; })
    ];

    return Promise.all(jobs).then(function (parts) {
      uni.events = parts[0].concat(parts[1]);
      uni.events.sort(function (a, b) {
        if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
        return String(a.dateKey + (a.startTime || '')).localeCompare(
               String(b.dateKey + (b.startTime || '')));
      });
      uni.loading = false;
      renderAll();
    });
  }

  function normalizeCalendarEvents(res) {
    return ((res && res.events) || []).map(function (e) {
      var m = meta(e.type || e.category);
      return {
        source: 'calendar',
        id: e.id,
        title: e.title,
        type: e.type || e.category || 'אחר',
        dateKey: e.dateKey || dateKeyOf(e.startISO || e.eventDate),
        startISO: e.startISO || e.eventDate,
        startTime: '',
        endTime: '',
        location: e.location || '',
        notes: e.notes || '',
        peopleNames: (e.assignedNames || []).join(', '),
        peopleCount: (e.assignedCodes || []).length,
        isMine: !!e.isMine,
        canEdit: !!e.canEdit,
        audienceLabel: e.audienceLabel || '',
        icon: e.icon || m.icon,
        color: e.color || m.color
      };
    });
  }

  // אירוע אבטחה מגיע במבנה אחר לגמרי (eventDate כטקסט, fighterCodes,
  // commanderName). כאן הוא מתורגם לאותה צורה כמו כל אירוע אחר.
  function normalizeGuardEvents(res) {
    var myCode = String(state.code || '').trim();
    return ((res && res.events) || []).map(function (e) {
      var codes = e.fighterCodes || [];
      var m = meta('אבטחה');
      return {
        source: 'guard',
        id: e.id,
        title: e.title,
        type: 'אבטחה',
        dateKey: dateKeyOf(e.eventDate),
        startISO: e.eventDate,
        startTime: e.startTime || '',
        endTime: e.endTime || '',
        location: e.location || '',
        notes: e.notes || '',
        commanderName: e.commanderName || '',
        commanderCode: e.teamCommanderCode || '',
        peopleNames: e.fighterNames || '',
        peopleCodes: codes,
        peopleCount: codes.length,
        isMine: codes.indexOf(myCode) !== -1,
        canEdit: state.isManager === true || state.isAdmin === true ||
                 (typeof myPerms !== 'undefined' && (myPerms || []).indexOf('guard_manager') !== -1),
        audienceLabel: '',
        icon: m.icon,
        color: m.color
      };
    });
  }

  function visibleEvents() {
    if (uni.filter === 'mine')   return uni.events.filter(function (e) { return e.isMine; });
    if (uni.filter === 'אבטחה')  return uni.events.filter(function (e) { return e.type === 'אבטחה'; });
    if (uni.filter === 'events') return uni.events.filter(function (e) { return e.type !== 'אבטחה'; });
    return uni.events;
  }

  // -------------------------------------------------------------------
  //  ציור
  // -------------------------------------------------------------------

  function renderAll() {
    renderFilterBar();
    renderGrid();
    if (uni.selectedDate) renderDayPanel(uni.selectedDate);
  }

  // סרגל הסינון לא קיים ב-index.html — נבנה כאן ומוזרק מעל הלוח.
  function renderFilterBar() {
    var grid = document.getElementById('calendar-grid');
    if (!grid) return;

    // תיקון סדר: ב-index.html שורת שמות הימים מופיעה אחרי הלוח ולא
    // מעליו. הזזה חד-פעמית, כי כותרת מתחת לטבלה פשוט לא קריאה.
    var names = document.getElementById('calendar-day-names');
    if (names && names.previousElementSibling !== null &&
        names.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_PRECEDING) {
      grid.parentNode.insertBefore(names, grid);
    }

    var bar = document.getElementById('uni-cal-filters');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'uni-cal-filters';
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px';
      grid.parentNode.insertBefore(bar, names || grid);
    }

    var counts = {
      '':       uni.events.length,
      'mine':   uni.events.filter(function (e) { return e.isMine; }).length,
      'אבטחה':  uni.events.filter(function (e) { return e.type === 'אבטחה'; }).length,
      'events': uni.events.filter(function (e) { return e.type !== 'אבטחה'; }).length
    };

    bar.innerHTML = FILTERS.map(function (f) {
      var on = uni.filter === f.id;
      return '<button type="button" class="uni-filter" data-f="' + f.id + '" ' +
        'style="border-radius:20px;padding:9px 15px;font-family:inherit;font-size:13.5px;' +
        'font-weight:700;cursor:pointer;white-space:nowrap;' +
        (on ? 'background:#C1272D;color:#fff;border:1.5px solid #C1272D'
            : 'background:#fff;color:#444;border:1.5px solid var(--border,#ddd)') + '">' +
        f.label + ' <span style="opacity:.7;font-weight:600">' + (counts[f.id] || 0) + '</span>' +
        '</button>';
    }).join('');

    bar.querySelectorAll('.uni-filter').forEach(function (b) {
      b.addEventListener('click', function () {
        uni.filter = b.dataset.f;
        renderAll();
      });
    });
  }

  function renderGrid() {
    var grid = document.getElementById('calendar-grid');
    if (!grid) return;

    var label = document.getElementById('calendar-month-label');
    if (label) label.textContent = HEBREW_MONTH_NAMES[uni.month.getMonth()] + ' ' + uni.month.getFullYear();

    var names = document.getElementById('calendar-day-names');
    if (names) names.innerHTML = HEBREW_DAY_NAMES.map(function (d) { return '<div>' + d + '</div>'; }).join('');

    if (uni.loading && uni.events.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;' +
        'color:var(--text-muted)">טוען את הלוח...</div>';
      return;
    }

    var list = visibleEvents();
    var y = uni.month.getFullYear();
    var mo = uni.month.getMonth();
    var startOffset = new Date(y, mo, 1).getDay();
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var todayKey = dateKeyOf(new Date().toISOString());

    grid.innerHTML = '';
    for (var i = 0; i < startOffset; i++) grid.appendChild(document.createElement('div'));

    for (var d = 1; d <= daysInMonth; d++) {
      var key = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var dayEvents = list.filter(function (e) { return e.dateKey === key; });
      var hasMine = dayEvents.some(function (e) { return e.isMine; });

      var cell = document.createElement('div');
      cell.dataset.date = key;
      cell.style.cssText =
        'min-height:82px;border-radius:9px;padding:5px;cursor:pointer;background:#fff;' +
        'display:flex;flex-direction:column;overflow:hidden;' +
        (key === uni.selectedDate ? 'box-shadow:0 0 0 3px rgba(193,39,45,.25);' : '') +
        (hasMine ? 'border:2px solid #C1272D;'
                 : (key === todayKey ? 'border:2px solid #1860ad;' : 'border:1px solid var(--border,#e4e4e4);'));

      var chips = dayEvents.slice(0, 3).map(function (e) {
        return '<div style="background:' + e.color + ';color:#fff;border-radius:4px;' +
          'padding:1px 4px;font-size:9.5px;font-weight:600;margin-bottom:2px;overflow:hidden;' +
          'text-overflow:ellipsis;white-space:nowrap">' + e.icon +
          (e.peopleCount === 0 && e.type === 'אבטחה' ? ' ⚠' : '') + '</div>';
      }).join('');

      cell.innerHTML =
        '<div style="font-size:19px;font-weight:800;text-align:center;line-height:1.1">' + d + '</div>' +
        '<div style="margin-top:3px">' + chips +
        (dayEvents.length > 3
          ? '<div style="font-size:9px;color:var(--text-muted);text-align:center">+' +
            (dayEvents.length - 3) + '</div>'
          : '') + '</div>';

      cell.addEventListener('click', function () {
        uni.selectedDate = this.dataset.date;
        renderGrid();
        renderDayPanel(this.dataset.date);
      });
      grid.appendChild(cell);
    }
  }

  function renderDayPanel(dateKey) {
    var panel = document.getElementById('calendar-day-events-list');
    if (!panel) return;

    var dayEvents = visibleEvents().filter(function (e) { return e.dateKey === dateKey; });

    var html = '<div class="stats-card-title" style="margin-bottom:8px">' +
      mpDateLabel(dateKey) + '</div>';

    if (dayEvents.length === 0) {
      html += '<div class="empty-state">אין אירועים ביום זה</div>';
    } else {
      html += dayEvents.map(function (e) {
        var noPeople = e.type === 'אבטחה' && e.peopleCount === 0;
        return '<div class="shift-card" style="flex-direction:column;align-items:stretch;' +
          'border-right:5px solid ' + (e.isMine ? '#C1272D' : e.color) + '">' +

          '<div style="font-weight:800;font-size:15.5px">' + e.icon + ' ' + escapeHtml(e.title) +
          (e.isMine ? ' <span style="font-size:11.5px;color:#C1272D">· אתה משובץ</span>' : '') +
          '</div>' +

          '<div style="font-size:13px;color:var(--text-muted);margin-top:3px">' +
          escapeHtml(e.type) +
          (timeLabel(e) ? ' · ' + escapeHtml(timeLabel(e)) : '') +
          (e.location ? ' · ' + escapeHtml(e.location) : '') +
          (e.audienceLabel ? ' · ' + escapeHtml(e.audienceLabel) : '') +
          '</div>' +

          (e.commanderName
            ? '<div style="font-size:13.5px;margin-top:6px"><b>מפקד צוות:</b> ' +
              escapeHtml(e.commanderName) + '</div>'
            : '') +

          (e.type === 'אבטחה' || e.peopleCount > 0
            ? '<div style="font-size:13.5px;margin-top:4px"><b>משובצים:</b> ' +
              (noPeople
                ? '<span style="color:var(--danger);font-weight:700">טרם שובצו</span>'
                : escapeHtml(e.peopleNames || (e.peopleCount + ' אנשים'))) + '</div>'
            : '') +

          (e.notes
            ? '<div style="font-size:12.5px;color:var(--text-muted);margin-top:4px">' +
              escapeHtml(e.notes) + '</div>'
            : '') +

          (e.canEdit
            ? '<div style="display:flex;gap:8px;margin-top:11px;flex-wrap:wrap">' +
              '<button class="tool-btn uni-assign" data-id="' + escapeHtml(e.id) +
              '" style="flex:1;padding:9px;font-weight:700">' +
              (e.source === 'guard' ? 'ערוך שיבוץ' : '🛡️ שבץ לאבטחה') + '</button>' +
              '<button class="tool-btn uni-del" data-id="' + escapeHtml(e.id) +
              '" data-src="' + e.source + '" style="width:auto;padding:9px 16px;' +
              'color:var(--danger)">מחק</button></div>'
            : '') +
          '</div>';
      }).join('');
    }

    html += '<button class="tool-btn uni-add-day" data-date="' + dateKey + '" ' +
      'style="width:100%;padding:11px;margin-top:8px">+ אירוע חדש לתאריך זה</button>';

    panel.innerHTML = html;

    panel.querySelectorAll('.uni-add-day').forEach(function (b) {
      b.addEventListener('click', function () { openTypePicker(b.dataset.date); });
    });

    panel.querySelectorAll('.uni-assign').forEach(function (b) {
      b.addEventListener('click', function () {
        var ev = uni.events.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (ev) openAssignToGuard(ev);
      });
    });

    panel.querySelectorAll('.uni-del').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('למחוק את האירוע?')) return;
        var action = b.dataset.src === 'guard' ? 'deleteGuardEvent' : 'deleteCalendarEvent';
        callApi('POST', action, { code: state.code, eventId: b.dataset.id })
          .then(function () { showToast('האירוע נמחק'); return loadUnified(); })
          .catch(function (err) { showToast(err.message || 'שגיאה במחיקה'); });
      });
    });
  }

  // מערכת האבטחות הקיימת קוראת מ-guardState. שמירה על סנכרון מאפשרת
  // להשתמש ב-openAssignModal וב-openGuardFormModal בלי לשכתב אותן.
  function syncGuardState() {
    if (typeof guardState === 'undefined') return;
    guardState.month = uni.month;
    guardState.events = uni.events
      .filter(function (e) { return e.source === 'guard'; })
      .map(function (e) {
        return {
          id: e.id, title: e.title, eventDate: e.dateKey, location: e.location,
          startTime: e.startTime, endTime: e.endTime, notes: e.notes,
          commanderName: e.commanderName, fighterNames: e.peopleNames,
          fighterCodes: new Array(e.peopleCount)
        };
      });
  }

  // -------------------------------------------------------------------
  //  שיבוץ לאבטחה מתוך אירוע בלוח
  // -------------------------------------------------------------------
  //  זו הזרימה המרכזית: בוחרים אירוע בלוח, מסמנים שמות מהרשימה, והוא
  //  מופיע לכל מי שנבחר תחת "האבטחות שלי".
  //
  //  השיבוץ נשמר כאירוע אבטחה (createGuardEvent) ולא כשדה על האירוע
  //  עצמו — כי "האבטחות שלי" ניזון מ-listMyGuardEvents. כך אירוע רגיל
  //  בלוח מקבל "בבואה" אחת במערכת האבטחות, ואירוע שכבר נולד כאבטחה
  //  פשוט מתעדכן במקום.
  //
  //  אין נקודת עדכון בשרת לאירוע אבטחה, ולכן עריכה = מחיקה ויצירה
  //  מחדש. זה בדיוק מה ש-openAssignModal המקורית עשתה.

  function findGuardMirror(ev) {
    if (ev.source === 'guard') return ev;
    var m = uni.events.filter(function (g) {
      return g.source === 'guard' && g.dateKey === ev.dateKey && g.title === ev.title;
    });
    return m.length > 0 ? m[0] : null;
  }

  function openAssignToGuard(ev) {
    var body = mpModal('uni-assign-modal', 'שיבוץ לאבטחה — ' + ev.title);
    body.innerHTML = '<div class="empty-state">טוען רשימת כבאים...</div>';

    var mirror = findGuardMirror(ev);
    var preselected = (mirror && mirror.peopleCodes) || [];

    Promise.all([
      callApi('GET', 'listSwapCandidates', { code: state.code }, true)
        .then(function (r) { return r.people || []; })
        .catch(function () { return []; }),

      // חלוקת העומס מוצגת לצד כל שם, כדי שהשיבוץ ייעשה לפי נתון ולא
      // לפי זיכרון. אם היא לא זמינה, הרשימה עדיין עובדת.
      callApi('GET', 'guardLoadReport', { code: state.code }, true)
        .then(function (r) {
          var map = {};
          (r.rows || []).forEach(function (x) { map[x.code] = x.count; });
          return map;
        })
        .catch(function () { return {}; })
    ]).then(function (parts) {
      var people = parts[0];
      var load = parts[1];

      if (people.length === 0) {
        body.innerHTML = '<div class="empty-state">לא הצלחתי לטעון את רשימת הכבאים</div>';
        return;
      }

      // מי שיצא הכי פחות מופיע ראשון
      var sorted = people.slice().sort(function (a, b) {
        return (load[a.code] || 0) - (load[b.code] || 0);
      });

      body.innerHTML =
        '<div style="font-size:13.5px;color:var(--text-muted);margin-bottom:10px;line-height:1.6">' +
        mpDateLabel(ev.dateKey) +
        (timeLabel(ev) ? ' · ' + escapeHtml(timeLabel(ev)) : '') +
        (ev.location ? ' · ' + escapeHtml(ev.location) : '') + '<br>' +
        'הרשימה ממוינת מהפחות למרובה. המספר הוא כמות האבטחות שכל אחד ' +
        'כבר יצא אליהן.</div>' +

        '<div style="display:flex;gap:8px;margin-bottom:10px">' +
        '<input id="uni-search" type="text" placeholder="חיפוש שם..." ' +
        'style="flex:1;padding:10px;font-size:15px;border:1px solid var(--border,#ccc);' +
        'border-radius:9px">' +
        '<button id="uni-clear-sel" class="tool-btn" style="width:auto;padding:10px 14px">נקה</button>' +
        '</div>' +

        '<div id="uni-people" style="max-height:48vh;overflow-y:auto;' +
        'border:1px solid var(--border,#ddd);border-radius:10px;padding:6px;margin-bottom:10px">' +
        sorted.map(function (p) {
          var n = load[p.code] || 0;
          var on = preselected.indexOf(p.code) !== -1;
          return '<label class="uni-person" data-name="' + escapeHtml(p.name) + '" ' +
            'style="display:flex;align-items:center;gap:10px;padding:11px 5px;cursor:pointer;' +
            'border-bottom:1px solid #f0f0f0">' +
            '<input type="checkbox" class="uni-cb" value="' + escapeHtml(p.code) + '" ' +
            (on ? 'checked ' : '') + 'style="width:19px;height:19px;cursor:pointer">' +
            '<span style="flex:1;font-size:15px">' + escapeHtml(p.name) +
            (p.team ? ' <span style="color:var(--text-muted);font-size:12.5px">· ' +
              escapeHtml(p.team) + '</span>' : '') + '</span>' +
            '<span style="font-size:14px;font-weight:800;color:' +
            (n === 0 ? '#C1272D' : 'var(--text-muted)') + '">' + n + '</span></label>';
        }).join('') + '</div>' +

        '<div id="uni-count" style="font-size:13.5px;font-weight:700;margin-bottom:10px"></div>' +
        '<div id="uni-assign-err" class="hidden" style="color:var(--danger);' +
        'font-size:13.5px;margin-bottom:8px"></div>' +
        '<button id="uni-assign-save" class="btn btn-primary" style="width:100%">' +
        'שמור שיבוץ</button>';

      function updateCount() {
        var n = body.querySelectorAll('.uni-cb:checked').length;
        var el = document.getElementById('uni-count');
        el.textContent = n === 0 ? 'לא נבחר אף אחד' : n + ' משובצים';
        el.style.color = n === 0 ? 'var(--text-muted)' : 'var(--success,#1D7A5C)';
      }
      body.addEventListener('change', updateCount);
      updateCount();

      document.getElementById('uni-search').addEventListener('input', function (e) {
        var q = e.target.value.trim();
        body.querySelectorAll('.uni-person').forEach(function (row) {
          row.style.display = (!q || row.dataset.name.indexOf(q) !== -1) ? '' : 'none';
        });
      });

      document.getElementById('uni-clear-sel').addEventListener('click', function () {
        body.querySelectorAll('.uni-cb').forEach(function (cb) { cb.checked = false; });
        updateCount();
      });

      document.getElementById('uni-assign-save').addEventListener('click', function () {
        var err = document.getElementById('uni-assign-err');
        err.classList.add('hidden');

        var codes = Array.prototype.slice
          .call(body.querySelectorAll('.uni-cb:checked'))
          .map(function (cb) { return cb.value; });

        if (codes.length === 0) {
          err.textContent = 'יש לסמן לפחות אדם אחד';
          err.classList.remove('hidden');
          return;
        }

        var params = {
          eventDate: ev.dateKey,
          title: ev.title,
          location: ev.location || '',
          startTime: ev.startTime || '',
          endTime: ev.endTime || '',
          teamCommanderCode: (mirror && mirror.commanderCode) || '',
          fighterCodes: codes,
          notes: ev.notes || ''
        };

        // ── עדכון במקום מחיקה ויצירה ──
        // הגרסה הקודמת מחקה את האירוע ואז יצרה אותו מחדש. אם היצירה
        // נכשלה באמצע, האירוע נעלם לתמיד. עכשיו זה עדכון שורה במקומה,
        // ואין רגע שבו האירוע לא קיים.
        const call = mirror
          ? callApi('POST', 'updateGuardEvent', {
              code: state.code, eventId: mirror.id, params: params
            })
          : callApi('POST', 'createGuardEvent', { code: state.code, params: params });

        call.then(function (r) {
            showToast(r.message || (codes.length + ' משובצים · יופיע להם תחת "האבטחות שלי"'));
            closeMpModal('uni-assign-modal');
            return loadUnified();
          })
          .catch(function (e2) {
            err.textContent = e2.message || 'שגיאה בשמירת השיבוץ';
            err.classList.remove('hidden');
          });
      });
    });
  }

  // -------------------------------------------------------------------
  //  יצירת אירוע
  // -------------------------------------------------------------------
  //  אבטחה נשלחת לטופס הייעודי הקיים (שיבוץ לוחמים, מפקד צוות, שעות
  //  יציאה וחזרה). כל שאר הסוגים עוברים בטופס הקצר כאן.

  function openTypePicker(presetDate) {
    var body = mpModal('uni-type-modal', 'אירוע חדש');
    var types = Object.keys(TYPE_META);

    body.innerHTML =
      '<div style="font-size:13.5px;color:var(--text-muted);margin-bottom:12px">' +
      'בחר/י את סוג האירוע. אבטחה נפתחת בטופס המלא, עם שיבוץ לוחמים ' +
      'ומפקד צוות.</div>' +
      types.map(function (t) {
        return '<button type="button" class="uni-type" data-t="' + escapeHtml(t) + '" ' +
          'style="width:100%;display:flex;align-items:center;gap:12px;padding:14px;' +
          'margin-bottom:8px;border:1px solid var(--border,#ddd);border-radius:12px;' +
          'background:#fff;font-family:inherit;font-size:15px;cursor:pointer;text-align:right">' +
          '<span style="font-size:21px">' + TYPE_META[t].icon + '</span>' +
          '<span style="flex:1">' + escapeHtml(t) + '</span></button>';
      }).join('');

    body.querySelectorAll('.uni-type').forEach(function (b) {
      b.addEventListener('click', function () {
        closeMpModal('uni-type-modal');
        var t = b.dataset.t;
        if (t === 'אבטחה') {
          syncGuardState();
          openGuardFormModal(presetDate || null);
        } else {
          openSimpleEventForm(t, presetDate);
        }
      });
    });
  }

  function openSimpleEventForm(type, presetDate) {
    var body = mpModal('uni-event-modal', TYPE_META[type].icon + ' ' + type);
    var st = 'width:100%;padding:11px;font-size:16px;border:1px solid var(--border,#ccc);' +
      'border-radius:9px;margin-bottom:12px';

    body.innerHTML =
      '<label class="field-label" style="display:block;margin-bottom:4px">כותרת</label>' +
      '<input id="uni-title" type="text" placeholder="לדוגמה: תרגיל חילוץ" style="' + st + '">' +

      '<div style="display:flex;gap:10px">' +
      '<div style="flex:1"><label class="field-label" style="display:block;margin-bottom:4px">תאריך</label>' +
      '<input id="uni-date" type="date" value="' + (presetDate || '') + '" style="' + st + '"></div>' +
      '<div style="flex:1"><label class="field-label" style="display:block;margin-bottom:4px">שעה</label>' +
      '<input id="uni-time" type="time" style="' + st + '"></div></div>' +

      '<label class="field-label" style="display:block;margin-bottom:4px">מיקום</label>' +
      '<input id="uni-loc" type="text" style="' + st + '">' +

      '<label class="field-label" style="display:block;margin-bottom:4px">מי רואה את האירוע</label>' +
      '<select id="uni-aud" style="' + st + '">' +
      '<option value="all">כל התחנה</option>' +
      '<option value="משמרת א">משמרת א׳ בלבד</option>' +
      '<option value="משמרת ב">משמרת ב׳ בלבד</option>' +
      '<option value="משמרת ג">משמרת ג׳ בלבד</option>' +
      '<option value="managers">צוות ניהול בלבד</option>' +
      '</select>' +

      '<label class="field-label" style="display:block;margin-bottom:6px">תזכורת מוקדמת</label>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px">' +
      [[1, 'יום לפני'], [7, 'שבוע לפני'], [30, 'חודש לפני']].map(function (o) {
        return '<label style="display:flex;align-items:center;gap:6px;font-size:14px">' +
          '<input type="checkbox" class="uni-rem" value="' + o[0] + '" ' +
          'style="width:18px;height:18px">' + o[1] + '</label>';
      }).join('') + '</div>' +

      '<label class="field-label" style="display:block;margin-bottom:4px">הערות</label>' +
      '<textarea id="uni-notes" rows="2" style="' + st + ';resize:vertical"></textarea>' +

      '<div id="uni-err" class="hidden" style="color:var(--danger);font-size:13.5px;' +
      'margin-bottom:8px"></div>' +
      '<button id="uni-save" class="btn btn-primary" style="width:100%">שמור אירוע</button>';

    // המשמרת של היוצר היא ברירת מחדל הגיונית יותר מ"כל התחנה" לראש
    // משמרת, אבל לא נכפית — אפשר לשנות.
    if (state.shiftTeam) {
      var sel = document.getElementById('uni-aud');
      if (sel) sel.value = state.shiftTeam;
    }

    document.getElementById('uni-save').addEventListener('click', function () {
      var err = document.getElementById('uni-err');
      err.classList.add('hidden');

      var title = document.getElementById('uni-title').value.trim();
      var date = document.getElementById('uni-date').value;
      var time = document.getElementById('uni-time').value || '09:00';

      if (!title || !date) {
        err.textContent = 'יש למלא כותרת ותאריך';
        err.classList.remove('hidden');
        return;
      }

      var reminders = Array.prototype.slice
        .call(document.querySelectorAll('.uni-rem:checked'))
        .map(function (cb) { return Number(cb.value); });

      callApi('POST', 'createCalendarEvent', {
        code: state.code,
        payload: {
          title: title,
          type: type,
          startISO: new Date(date + 'T' + time).toISOString(),
          location: document.getElementById('uni-loc').value.trim(),
          audience: document.getElementById('uni-aud').value,
          notes: document.getElementById('uni-notes').value.trim(),
          assignedCodes: [],
          reminderOffsets: reminders
        }
      }).then(function (r) {
        showToast(r.message || 'האירוע נוצר');
        closeMpModal('uni-event-modal');
        return loadUnified();
      }).catch(function (e) {
        err.textContent = e.message || 'שגיאה בשמירה';
        err.classList.remove('hidden');
      });
    });
  }

  // -------------------------------------------------------------------
  //  דריסת הפונקציות הישנות
  // -------------------------------------------------------------------

  // הלוח הישן ניזון מ-listMyEvents ומצייר לשני יעדים. שניהם מוחלפים —
  // אבל לא אצל ליסה, ששם הכל ממשיך לרוץ על המקורי.
  loadCalendarEvents = function () {
    return isLisa() ? ORIG.load.apply(null, arguments) : loadUnified();
  };
  renderCalendarGrid = function () {
    return isLisa() ? ORIG.grid.apply(null, arguments) : renderAll();
  };
  renderCalendarGridInto = function (prefix) {
    if (isLisa()) return ORIG.gridInto(prefix);
    renderAll();
  };
  showCalendarDayEvents = function (prefix, dateStr, dayEvents) {
    if (isLisa()) return ORIG.dayList(prefix, dateStr, dayEvents);
    uni.selectedDate = dateStr;
    renderDayPanel(dateStr);
  };
  openAddEventModal = function () {
    if (isLisa()) return ORIG.addModal();
    openTypePicker(uni.selectedDate || null);
  };

  // הלוח הנפרד של האבטחות מפנה עכשיו למסך היחיד במקום לפתוח מודאל.
  openGuardCalendarModal = function () {
    showScreen('screen-calendar');
    uni.filter = 'אבטחה';
    loadUnified();
  };
  drawGuardCalendar = function () { return loadUnified(); };

  // ── נטרול פונקציית השיבוץ ההרסנית ──
  // openAssignModal ב-app.js מוחקת את האירוע ואז יוצרת אותו מחדש.
  // היא עדיין נגישה מכמה מסלולים ישנים, ולכן היא מופנית כאן למודאל
  // הבטוח. בלי זה, מסלול אחד שנשכח היה מספיק כדי לאבד אירוע.
  if (typeof openAssignModal === 'function') {
    openAssignModal = function (eventId) {
      var ev = uni.events.filter(function (x) { return x.id === eventId; })[0];
      if (ev) {
        openAssignToGuard(ev);
      } else {
        showScreen('screen-calendar');
        loadUnified().then(function () {
          var found = uni.events.filter(function (x) { return x.id === eventId; })[0];
          if (found) openAssignToGuard(found);
          else showToast('האירוע לא נמצא בחודש המוצג');
        });
      }
    };
  }

  // ניווט החודשים: המאזינים ב-app.js משנים את calendarState, שכבר לא
  // בשימוש. מחליפים את הכפתורים בעותק נקי ומחברים מחדש.
  function rebindNav() {
    [['calendar-prev-month', -1], ['calendar-next-month', 1]].forEach(function (pair) {
      var old = document.getElementById(pair[0]);
      if (!old || old.dataset.uni === '1') return;
      var fresh = old.cloneNode(true);
      fresh.dataset.uni = '1';
      old.parentNode.replaceChild(fresh, old);
      fresh.addEventListener('click', function () {
        uni.month = new Date(uni.month.getFullYear(), uni.month.getMonth() + pair[1], 1);
        uni.selectedDate = null;
        var panel = document.getElementById('calendar-day-events-list');
        if (panel) panel.innerHTML = '';
        loadUnified();
      });
    });

    // בורר הקטגוריות הישן מוחלף בסרגל הצ'יפים — מוסתר, לא נמחק.
    var oldFilter = document.getElementById('calendar-category-filter');
    if (oldFilter) oldFilter.style.display = 'none';
  }

  // -------------------------------------------------------------------
  //  ניקוי הכפילויות בממשק
  // -------------------------------------------------------------------

  function tidyUp() {
    // ליסה: יוצאים מיד. הכרטיס במסך הניהול הוא לוח השנה שלה, והסתרתו
    // הייתה מרוקנת לה את המסך הראשי שאליה היא נכנסת ישירות.
    if (isLisa()) return;

    // 1. הלוח הכפול במסך הניהול מוסתר, ובמקומו כפתור שפותח את היחיד.
    //    מוסתר ולא נמחק — הקוד ב-app.js עדיין מפנה לאלמנטים שבתוכו,
    //    ומחיקה הייתה מפילה אותו.
    var dash = document.getElementById('dash-calendar-card');
    if (dash && dash.dataset.unified !== '1') {
      dash.dataset.unified = '1';
      dash.style.display = 'none';

      var open = document.createElement('button');
      open.className = 'btn btn-primary';
      open.style.cssText = 'margin-bottom:16px';
      open.innerHTML = '📅 פתח את לוח השנה';
      open.addEventListener('click', function () {
        showScreen('screen-calendar');
        uni.filter = '';
        loadUnified();
      });
      dash.parentNode.insertBefore(open, dash);
    }

    // 2. אייקון הלוח נפתח לכולם. קודם הוא הוסתר מלוחמים, ולכן הם ראו
    //    את האבטחות שלהם רק ברשימה נפרדת בלי הקשר של תאריך.
    var btn = document.getElementById('calendar-btn');
    if (btn) btn.classList.remove('hidden');
  }

  // enterApp מסתירה שוב את האייקון בכל כניסה, אז מריצים אחריה.
  var _enter = enterApp;
  enterApp = function () {
    _enter.apply(null, arguments);
    setTimeout(function () { tidyUp(); rebindNav(); }, 40);
  };

  var _show = showScreen;
  showScreen = function (id) {
    _show(id);
    setTimeout(function () { tidyUp(); rebindNav(); }, 30);
    if (id === 'screen-calendar' && state.code && !isLisa()) loadUnified();
  };

  // מחוון הגרסה מתעדכן מכאן ולא מ-app.js, כדי שלא יידרש שינוי ידני
  // בקובץ בן 4,000 שורות רק כדי לדעת איזו גרסה נטענה בפועל במכשיר.
  function stampVersion() {
    var el = document.getElementById('version-indicator');
    if (el) el.textContent = 'גרסה v76 · לוח שנה מאוחד';
  }

  document.addEventListener('DOMContentLoaded', function () {
    tidyUp(); rebindNav(); stampVersion();
  });
  tidyUp();
  rebindNav();
  stampVersion();
})();

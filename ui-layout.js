/* =====================================================================
 *  ui-layout.js — שלוש לשוניות בקצה ימין
 *  נטען אחרון, אחרי app.js ו-calendar-unified.js
 * =====================================================================
 *
 *  ── מה השתנה ──
 *  שני הסרגלים התחתונים המרחפים והפלוס הצף ירדו מהמסך. במקומם שלוש
 *  לשוניות צמודות לקצה ימין, כל אחת פותחת פאנל משלה:
 *
 *    פעולות        דיווח, החלפות, חופש, מסמכים, ניהול משמרת
 *    תיקוני דיווח  בדוק תקינות, חשב מחדש, נקה חודש
 *    קיצורי דרך    הקיצורים האישיים שהמשתמש בחר
 *
 *  ── למה הפרדה לשלוש ──
 *  פאנל אחד עם ארבע קבוצות דרש גלילה כדי להגיע ל"נקה חודש". הפרדה
 *  לפי כוונה - "אני רוצה לעשות משהו" מול "משהו לא נכון ואני מתקן" -
 *  נותנת לכל אחת מסלול של לחיצה אחת.
 *
 *  ── שלוש הערות טכניות ──
 *  1. הכפתורים בפאנל הם שליחים: לחיצה מפעילה את הכפתור המקורי שנשאר
 *     במקומו ב-DOM, רק מוסתר. אף מאזין אירועים לא הולך לאיבוד, וכפתור
 *     שיתווסף ל-app.js בעתיד יופיע כאן לבד.
 *  2. הסתרת הסרגלים דורשת סלקטור חזק מזה של app.js, שמשתמש ב-
 *     nav.bottom-tools:not(#shortcuts-bar) - מזהה בתוך :not נחשב
 *     לספציפיות של מזהה. לכן הכללים כאן מתחילים ב-html body.
 *  3. translate="no" - הדפדפן תרגם את הממשק לאנגלית והפך "רגיל"
 *     ל-REGULAR. זו לא הייתה תקלה בקוד אלא תרגום אוטומטי.
 *
 *  אם משהו נשבר: מחיקת שורת ה-script ב-index.html מחזירה את המצב
 *  הקודם. הקובץ לא נוגע בנתונים, רק בפריסה.
 * ===================================================================== */

(function () {
  'use strict';

  var BRAND = '#C1272D';
  var FIX = '#4A4A4A';
  var SHORT = '#1860AD';

  // ── הגדרת הלשוניות ──
  // הסדר כאן הוא הסדר על המסך, מלמטה למעלה.
  var TABS = [
    { id: 'actions', label: 'פעולות',       icon: 'ti-menu-2',  color: BRAND },
    { id: 'fixes',   label: 'תיקוני דיווח', icon: 'ti-tool',    color: FIX },
    { id: 'shorts',  label: 'קיצורי דרך',   icon: 'ti-star',    color: SHORT }
  ];

  var TAB_H = 96;
  var TAB_GAP = 8;
  var TAB_BOTTOM = 90;

  // -------------------------------------------------------------------
  //  סגנונות
  // -------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById('ds102-tabs-ui')) return;
    var st = document.createElement('style');
    st.id = 'ds102-tabs-ui';

    var css = [
      /* html body נדרש כדי לגבור על הכללים של app.js */
      'html body .fab, html body #add-shift-btn { display: none !important; }',
      'html body nav.bottom-tools:not(#shortcuts-bar) { display: none !important; }',
      'html body #shortcuts-bar { display: none !important; }',

      'html body .app-main { padding-bottom: 40px !important; }',
      'html body .app-header { padding-top: env(safe-area-inset-top, 0px) !important; }',

      '.ds-tab {',
      '  position: fixed; right: 0; z-index: 960;',
      '  width: 52px; height: ' + TAB_H + 'px;',
      '  border: none; border-radius: 15px 0 0 15px;',
      '  color: #fff; font-family: inherit; cursor: pointer;',
      '  display: flex; flex-direction: column;',
      '  align-items: center; justify-content: center; gap: 6px;',
      '  box-shadow: -3px 0 12px rgba(0,0,0,.2);',
      '  padding: 0; transition: opacity .2s ease;',
      '}',
      '.ds-tab i { font-size: 22px; line-height: 1; }',
      '.ds-tab .lbl {',
      '  font-size: 12px; font-weight: 600; line-height: 1.1;',
      '  writing-mode: vertical-rl; text-orientation: mixed;',
      '}',
      '.ds-tab:active { transform: scale(.94); }',
      '.ds-tabs-hidden .ds-tab { opacity: 0; pointer-events: none; }',

      '#ds-scrim2 {',
      '  position: fixed; inset: 0; z-index: 965;',
      '  background: rgba(0,0,0,.45);',
      '  opacity: 0; pointer-events: none; transition: opacity .26s ease;',
      '}',
      '#ds-scrim2.show { opacity: 1; pointer-events: auto; }',

      '#ds-sheet {',
      '  position: fixed; top: 0; right: 0; bottom: 0; z-index: 970;',
      '  width: min(340px, 88vw);',
      '  background: #fff; overflow-y: auto;',
      '  transform: translateX(102%);',
      '  transition: transform .32s cubic-bezier(.32,.72,0,1);',
      '  box-shadow: -6px 0 24px rgba(0,0,0,.18);',
      '  padding: calc(14px + env(safe-area-inset-top, 0px)) 14px calc(22px + env(safe-area-inset-bottom, 0px));',
      '}',
      '#ds-sheet.show { transform: translateX(0); }',

      '.ds-sheet-head {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  margin-bottom: 16px; gap: 10px;',
      '}',
      '.ds-sheet-head h3 { margin: 0; font-size: 18px; font-weight: 700; color: #222; }',
      '.ds-sheet-close {',
      '  width: 40px; height: 40px; border-radius: 12px; flex: none;',
      '  border: 1.5px solid var(--border, #ddd); background: #fff;',
      '  font-size: 20px; line-height: 1; cursor: pointer; color: #555;',
      '  font-family: inherit;',
      '}',

      '.ds-sec { font-size: 12.5px; font-weight: 700; color: #999; margin: 18px 2px 8px; }',
      '.ds-sec:first-of-type { margin-top: 0; }',

      '.ds-row {',
      '  width: 100%; display: flex; align-items: center; gap: 13px;',
      '  padding: 14px 15px; margin-bottom: 8px;',
      '  border: 1.5px solid var(--border, #e4e4e4); border-radius: 13px;',
      '  background: #fff; font-family: inherit; font-size: 15px;',
      '  font-weight: 600; color: #222; cursor: pointer; text-align: right;',
      '  min-height: 54px;',
      '}',
      '.ds-row i { font-size: 22px; color: #666; line-height: 1; flex: none; }',
      '.ds-row span { flex: 1; }',
      '.ds-row:active { transform: scale(.98); }',
      '.ds-row.primary i { color: ' + BRAND + '; }',
      '.ds-row.hot { background: #FFF0F0; border-color: ' + BRAND + '; }',
      '.ds-row.hot i { color: ' + BRAND + '; }',
      '.ds-row.danger { color: ' + BRAND + '; border-color: #F0C4C4; }',
      '.ds-row.danger i { color: ' + BRAND + '; }',

      '.ds-empty { font-size: 14px; color: #999; text-align: center; padding: 26px 10px; }',
      '.ds-note { font-size: 12.5px; color: #999; line-height: 1.6; margin: 14px 2px 0; }'
    ];

    st.textContent = css.join('\n');
    document.head.appendChild(st);
  }

  // -------------------------------------------------------------------
  //  שלד
  // -------------------------------------------------------------------

  var openTab = null;

  function buildShell() {
    if (document.getElementById('ds-sheet')) return;

    TABS.forEach(function (t, i) {
      var btn = document.createElement('button');
      btn.className = 'ds-tab';
      btn.id = 'ds-tab-' + t.id;
      btn.type = 'button';
      btn.setAttribute('translate', 'no');
      btn.setAttribute('aria-label', t.label);
      btn.style.background = t.color;
      btn.style.bottom = (TAB_BOTTOM + i * (TAB_H + TAB_GAP)) + 'px';
      btn.innerHTML = '<i class="ti ' + t.icon + '" aria-hidden="true"></i>' +
        '<span class="lbl"></span>';
      btn.querySelector('.lbl').textContent = t.label;
      btn.addEventListener('click', function () { openSheet(t.id); });
      document.body.appendChild(btn);
    });

    var scrim = document.createElement('div');
    scrim.id = 'ds-scrim2';
    scrim.addEventListener('click', closeSheet);
    document.body.appendChild(scrim);

    var sheet = document.createElement('div');
    sheet.id = 'ds-sheet';
    sheet.setAttribute('translate', 'no');
    document.body.appendChild(sheet);

    // החלקה ימינה סוגרת - התנועה הטבעית לפאנל שנפתח מימין
    var startX = null;
    sheet.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
    }, { passive: true });
    sheet.addEventListener('touchmove', function (e) {
      if (startX === null) return;
      var dx = e.touches[0].clientX - startX;
      if (dx > 0) sheet.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });
    sheet.addEventListener('touchend', function () {
      var m = /translateX\((\d+(?:\.\d+)?)px\)/.exec(sheet.style.transform || '');
      var dx = m ? parseFloat(m[1]) : 0;
      sheet.style.transform = '';
      if (dx > 80) closeSheet();
      startX = null;
    });
  }

  function openSheet(tabId) {
    buildShell();
    openTab = tabId;
    renderSheet(tabId);
    document.getElementById('ds-sheet').classList.add('show');
    document.getElementById('ds-scrim2').classList.add('show');
    document.body.classList.add('ds-tabs-hidden');
  }

  function closeSheet() {
    openTab = null;
    var sheet = document.getElementById('ds-sheet');
    var scrim = document.getElementById('ds-scrim2');
    if (sheet) sheet.classList.remove('show');
    if (scrim) scrim.classList.remove('show');
    document.body.classList.remove('ds-tabs-hidden');
  }

  // -------------------------------------------------------------------
  //  בניית שורות
  // -------------------------------------------------------------------

  var seen = {};

  function normLabel(raw) {
    return String(raw || '')
      .replace(/[^\u0590-\u05FFa-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function makeRow(label, icon, cls, onClick) {
    var key = normLabel(label);
    if (!key || seen[key]) return null;
    seen[key] = true;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ds-row' + (cls ? ' ' + cls : '');
    btn.innerHTML = '<i class="ti ' + (icon || 'ti-point') + '" aria-hidden="true"></i><span></span>';
    btn.querySelector('span').textContent = key;
    btn.addEventListener('click', function () {
      closeSheet();
      setTimeout(function () {
        try { onClick(); } catch (e) { showToast('הפעולה לא זמינה כרגע'); }
      }, 190);
    });
    return btn;
  }

  // הכפתור המקורי נשאר ב-DOM אך מוסתר; השליח מפעיל אותו
  function proxyRow(el, icon, cls) {
    if (!el) return null;
    return makeRow(normLabel(el.textContent), icon, cls, function () { el.click(); });
  }

  function addSection(sheet, title, rows) {
    var real = rows.filter(Boolean);
    if (real.length === 0) return 0;
    if (title) {
      var h = document.createElement('div');
      h.className = 'ds-sec';
      h.textContent = title;
      sheet.appendChild(h);
    }
    real.forEach(function (r) { sheet.appendChild(r); });
    return real.length;
  }

  // -------------------------------------------------------------------
  //  תוכן לכל לשונית
  // -------------------------------------------------------------------

  var FIX_BTN_IDS = ['check-issues-btn', 'recalc-btn', 'clear-month-btn'];

  var FIX_ICONS = {
    'check-issues-btn': 'ti-search',
    'recalc-btn': 'ti-refresh',
    'clear-month-btn': 'ti-eraser'
  };

  var PERSONAL_BTN_IDS = ['my-signature-btn', 'my-swaps-btn', 'my-guard-btn'];

  var PERSONAL_ICONS = {
    'my-signature-btn': 'ti-signature',
    'my-swaps-btn': 'ti-arrows-exchange',
    'my-guard-btn': 'ti-shield-half'
  };

  function renderSheet(tabId) {
    var sheet = document.getElementById('ds-sheet');
    if (!sheet) return;

    var def = TABS.filter(function (t) { return t.id === tabId; })[0];
    seen = {};

    sheet.innerHTML = '<div class="ds-sheet-head"><h3></h3>' +
      '<button type="button" class="ds-sheet-close" aria-label="סגירה">✕</button></div>';
    sheet.querySelector('h3').textContent = def ? def.label : 'פעולות';
    sheet.querySelector('.ds-sheet-close').addEventListener('click', closeSheet);

    if (tabId === 'actions') return renderActions(sheet);
    if (tabId === 'fixes') return renderFixes(sheet);
    if (tabId === 'shorts') return renderShorts(sheet);
  }

  function renderActions(sheet) {
    var mine = [];
    if (typeof DRAWER_MINE !== 'undefined') {
      DRAWER_MINE.forEach(function (a) {
        mine.push(makeRow(a.label, a.icon, a.primary ? 'primary' : '', a.run));
      });
    }
    // כפתורים אישיים שנוצרו דינמית בסרגל התחתון ואינם במגירה
    PERSONAL_BTN_IDS.forEach(function (id) {
      mine.push(proxyRow(document.getElementById(id), PERSONAL_ICONS[id]));
    });
    addSection(sheet, 'שלי', mine);

    var cmd = [];
    if (typeof DRAWER_COMMAND !== 'undefined') {
      DRAWER_COMMAND.forEach(function (a) {
        var allowed;
        if (typeof canDo === 'function') {
          if (a.id === 'cmdguard') allowed = canDo('guard');
          else if (a.id === 'urgent' || a.id === 'cmdmsg') allowed = canDo('manager') || canDo('hr');
          else allowed = canDo('manager');
        } else {
          allowed = (typeof state !== 'undefined' && state.isManager === true);
        }
        if (allowed) cmd.push(makeRow(a.label, a.icon, a.hot ? 'hot' : 'primary', a.run));
      });
    }
    addSection(sheet, 'ניהול משמרת', cmd);
  }

  function renderFixes(sheet) {
    var rows = [];
    FIX_BTN_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var danger = id === 'clear-month-btn';
      rows.push(proxyRow(el, FIX_ICONS[id], danger ? 'danger' : ''));
    });

    var count = addSection(sheet, null, rows);
    if (count === 0) {
      var empty = document.createElement('div');
      empty.className = 'ds-empty';
      empty.textContent = 'כלי התיקון זמינים רק במסך הדיווחים';
      sheet.appendChild(empty);
      return;
    }

    var note = document.createElement('div');
    note.className = 'ds-note';
    note.textContent = 'הכלים פועלים על החודש המוצג בלבד. ' +
      '"נקה חודש" מוחק את כל הדיווחים הלא מוגנים ואינו ניתן לביטול.';
    sheet.appendChild(note);
  }

  function renderShorts(sheet) {
    var rows = [];
    document.querySelectorAll('#shortcuts-bar .sc-chip:not(.sc-add)').forEach(function (el) {
      rows.push(proxyRow(el, 'ti-star'));
    });

    var count = addSection(sheet, null, rows);
    if (count === 0) {
      var empty = document.createElement('div');
      empty.className = 'ds-empty';
      empty.textContent = 'עדיין לא הוספת קיצורים';
      sheet.appendChild(empty);
    }

    var addChip = document.querySelector('#shortcuts-bar .sc-add');
    if (addChip) {
      var addRow = proxyRow(addChip, 'ti-plus');
      if (addRow) sheet.appendChild(addRow);
    }
  }

  // -------------------------------------------------------------------
  //  אתחול
  // -------------------------------------------------------------------

  function isVisible(id) {
    var el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden');
  }

  function boot() {
    injectStyles();
    buildShell();

    var loggedIn = !!(typeof state !== 'undefined' && state && state.code);
    var onAppScreen = isVisible('screen-app') || isVisible('screen-admin') ||
      isVisible('screen-calendar') || isVisible('screen-documents') ||
      isVisible('screen-shift-team') || isVisible('screen-team') ||
      isVisible('screen-procedures');

    // לשונית התיקונים רלוונטית רק במסך הדיווחים עצמו
    TABS.forEach(function (t) {
      var el = document.getElementById('ds-tab-' + t.id);
      if (!el) return;
      var show = loggedIn && onAppScreen;
      if (t.id === 'fixes') show = show && isVisible('screen-app');
      if (t.id === 'shorts') {
        show = show && !!document.querySelector('#shortcuts-bar .sc-chip');
      }
      el.style.display = show ? 'flex' : 'none';
    });

    reflowTabs();
  }

  // הלשוניות מוצגות ומוסתרות לפי מסך, ולכן המרווחים ביניהן מחושבים
  // מחדש - אחרת נשאר חור באמצע במקום שבו לשונית מוסתרת
  function reflowTabs() {
    var i = 0;
    TABS.forEach(function (t) {
      var el = document.getElementById('ds-tab-' + t.id);
      if (!el || el.style.display === 'none') return;
      el.style.bottom = (TAB_BOTTOM + i * (TAB_H + TAB_GAP)) + 'px';
      i++;
    });
  }

  if (typeof showScreen === 'function') {
    var _show = showScreen;
    showScreen = function (id) {
      _show(id);
      closeSheet();
      setTimeout(boot, 50);
    };
  }

  if (typeof enterApp === 'function') {
    var _enter = enterApp;
    enterApp = function () {
      _enter.apply(null, arguments);
      setTimeout(boot, 120);
    };
  }

  // סרגל הקיצורים נבנה מחדש בכל הוספה או הסרה
  if (window.MutationObserver) {
    document.addEventListener('DOMContentLoaded', function () {
      var bar = document.getElementById('shortcuts-bar');
      if (bar) new MutationObserver(function () { setTimeout(boot, 30); })
        .observe(bar, { childList: true });
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
  boot();
})();

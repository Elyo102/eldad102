/* =====================================================================
 *  ui-layout.js — פאנל פעולות אחד
 *  נטען אחרון, אחרי app.js ו-calendar-unified.js
 * =====================================================================
 *
 *  ── מה השתנה ──
 *  קודם היו על המסך שני סרגלים תחתונים מרחפים (כלים וקיצורים) וכפתור
 *  פלוס צף. הם תפסו שליש מהמסך, הסתירו את המשמרת האחרונה, ודרסו
 *  זה את זה. עכשיו יש לשונית אחת בקצה ימין; לחיצה פותחת פאנל עם כל
 *  הפעולות, מקובצות לפי נושא.
 *
 *  ── למה פאנל ולא סרגל ──
 *  סרגל קבוע משלם מחיר במקום כל הזמן, גם כשלא צריך אותו. פאנל משלם
 *  אותו רק ברגע שבו המשתמש באמת מחפש פעולה.
 *
 *  ── שלוש הערות טכניות ──
 *  1. הכפתורים בפאנל הם שליחים: לחיצה עליהם מפעילה את הכפתור המקורי
 *     שנשאר במקומו ב-DOM. כך אף מאזין אירועים לא הולך לאיבוד, ואם
 *     יתווספו כפתורים חדשים בעתיד הם יופיעו כאן לבד.
 *  2. סינון כפילויות לפי תווית - בשטח הופיעו "בדוק תקינות" פעמיים
 *     ו"אישור החלפות" פעמיים.
 *  3. translate="no" - הדפדפן תרגם את הממשק לאנגלית, וזה מה שהפך
 *     "רגיל" ל-REGULAR ו"בדוק תקינות" ל-VALIDATE. זו לא הייתה תקלה
 *     בקוד אלא תרגום אוטומטי של הדפדפן.
 *
 *  אם משהו נשבר: מחיקת שורת ה-script ב-index.html מחזירה את המצב
 *  הקודם. הקובץ לא נוגע בנתונים, רק בפריסה.
 * ===================================================================== */

(function () {
  'use strict';

  var BRAND = '#C1272D';

  // -------------------------------------------------------------------
  //  סגנונות
  // -------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById('ds102-panel-ui')) return;
    var st = document.createElement('style');
    st.id = 'ds102-panel-ui';
    st.textContent = [
      '.fab, #add-shift-btn { display: none !important; }',
      'nav.bottom-tools { display: none !important; }',

      '.app-main { padding-bottom: 90px !important; }',
      '.app-header { padding-top: env(safe-area-inset-top, 0px) !important; }',

      '#ds-panel-tab {',
      '  position: fixed; right: 0; bottom: 96px; z-index: 960;',
      '  width: 54px; height: 116px;',
      '  border: none; border-radius: 16px 0 0 16px;',
      '  background: ' + BRAND + '; color: #fff;',
      '  font-family: inherit; cursor: pointer;',
      '  display: flex; flex-direction: column;',
      '  align-items: center; justify-content: center; gap: 7px;',
      '  box-shadow: -3px 0 14px rgba(0,0,0,.22);',
      '  padding: 0;',
      '}',
      '#ds-panel-tab i { font-size: 25px; line-height: 1; }',
      '#ds-panel-tab .lbl {',
      '  font-size: 12.5px; font-weight: 600; line-height: 1.15;',
      '  writing-mode: vertical-rl; text-orientation: mixed;',
      '}',
      '#ds-panel-tab:active { transform: scale(.95); }',
      '#ds-panel-tab.is-open { opacity: 0; pointer-events: none; }',

      '#ds-panel-scrim {',
      '  position: fixed; inset: 0; z-index: 965;',
      '  background: rgba(0,0,0,.45);',
      '  opacity: 0; pointer-events: none; transition: opacity .28s ease;',
      '}',
      '#ds-panel-scrim.show { opacity: 1; pointer-events: auto; }',

      '#ds-panel {',
      '  position: fixed; top: 0; right: 0; bottom: 0; z-index: 970;',
      '  width: min(340px, 88vw);',
      '  background: #fff; overflow-y: auto;',
      '  transform: translateX(102%);',
      '  transition: transform .34s cubic-bezier(.32,.72,0,1);',
      '  box-shadow: -6px 0 26px rgba(0,0,0,.18);',
      '  padding: calc(14px + env(safe-area-inset-top, 0px)) 14px calc(20px + env(safe-area-inset-bottom, 0px));',
      '}',
      '#ds-panel.show { transform: translateX(0); }',

      '.ds-panel-head {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  margin-bottom: 16px;',
      '}',
      '.ds-panel-head h3 { margin: 0; font-size: 18px; font-weight: 700; color: #222; }',
      '.ds-panel-close {',
      '  width: 40px; height: 40px; border-radius: 12px;',
      '  border: 1.5px solid var(--border, #ddd); background: #fff;',
      '  font-size: 21px; line-height: 1; cursor: pointer; color: #555;',
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
      '.ds-row i { font-size: 23px; color: #666; line-height: 1; flex: none; }',
      '.ds-row span { flex: 1; }',
      '.ds-row:active { transform: scale(.98); }',
      '.ds-row.primary i { color: ' + BRAND + '; }',
      '.ds-row.hot { background: #FFF0F0; border-color: ' + BRAND + '; }',
      '.ds-row.hot i { color: ' + BRAND + '; }',
      '.ds-row.danger { color: ' + BRAND + '; }',
      '.ds-row.danger i { color: ' + BRAND + '; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  // -------------------------------------------------------------------
  //  שלד: לשונית, כיסוי, פאנל
  // -------------------------------------------------------------------

  var panelOpen = false;

  function buildShell() {
    if (document.getElementById('ds-panel')) return;

    var tab = document.createElement('button');
    tab.id = 'ds-panel-tab';
    tab.type = 'button';
    tab.setAttribute('aria-label', 'פתיחת תפריט פעולות');
    tab.setAttribute('translate', 'no');
    tab.innerHTML = '<i class="ti ti-menu-2" aria-hidden="true"></i>' +
      '<span class="lbl">פעולות</span>';
    tab.addEventListener('click', function () { togglePanel(true); });
    document.body.appendChild(tab);

    var scrim = document.createElement('div');
    scrim.id = 'ds-panel-scrim';
    scrim.addEventListener('click', function () { togglePanel(false); });
    document.body.appendChild(scrim);

    var panel = document.createElement('div');
    panel.id = 'ds-panel';
    panel.setAttribute('translate', 'no');
    document.body.appendChild(panel);

    // החלקה ימינה סוגרת - התנועה הטבעית לפאנל שנפתח מימין
    var startX = null;
    panel.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
    }, { passive: true });
    panel.addEventListener('touchmove', function (e) {
      if (startX === null) return;
      var dx = e.touches[0].clientX - startX;
      if (dx > 0) panel.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });
    panel.addEventListener('touchend', function () {
      var m = /translateX\((\d+(?:\.\d+)?)px\)/.exec(panel.style.transform || '');
      var dx = m ? parseFloat(m[1]) : 0;
      panel.style.transform = '';
      if (dx > 80) togglePanel(false);
      startX = null;
    });
  }

  function togglePanel(force) {
    buildShell();
    var panel = document.getElementById('ds-panel');
    var scrim = document.getElementById('ds-panel-scrim');
    var tab = document.getElementById('ds-panel-tab');
    if (!panel || !scrim || !tab) return;

    panelOpen = typeof force === 'boolean' ? force : !panelOpen;
    if (panelOpen) renderPanel();

    panel.classList.toggle('show', panelOpen);
    scrim.classList.toggle('show', panelOpen);
    tab.classList.toggle('is-open', panelOpen);
  }

  // -------------------------------------------------------------------
  //  תוכן הפאנל
  // -------------------------------------------------------------------
  //  שלושה מקורות: מגירת הפעולות של app.js, סרגל הכלים התחתון,
  //  וסרגל הקיצורים האישי. כולם מסוננים מכפילויות לפי תווית.

  var seenLabels = {};

  function normLabel(raw) {
    return String(raw || '')
      .replace(/[^\u0590-\u05FFa-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function makeRow(label, icon, cls, onClick) {
    var key = normLabel(label);
    if (!key || seenLabels[key]) return null;
    seenLabels[key] = true;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ds-row' + (cls ? ' ' + cls : '');
    btn.innerHTML = '<i class="ti ' + (icon || 'ti-point') + '" aria-hidden="true"></i>' +
      '<span></span>';
    btn.querySelector('span').textContent = key;
    btn.addEventListener('click', function () {
      togglePanel(false);
      setTimeout(function () {
        try { onClick(); } catch (e) { showToast('הפעולה לא זמינה כרגע'); }
      }, 200);
    });
    return btn;
  }

  function addSection(panel, title, rows) {
    var real = rows.filter(Boolean);
    if (real.length === 0) return;
    var h = document.createElement('div');
    h.className = 'ds-sec';
    h.textContent = title;
    panel.appendChild(h);
    real.forEach(function (r) { panel.appendChild(r); });
  }

  // הכפתור המקורי נשאר ב-DOM אך מוסתר. השליח בפאנל מפעיל אותו, וכך
  // כל המאזינים המקוריים ממשיכים לעבוד בלי שנגענו בהם.
  function proxyRow(el, icon, cls) {
    if (!el) return null;
    return makeRow(normLabel(el.textContent), icon, cls, function () { el.click(); });
  }

  var TOOL_ICONS = {
    'check-issues-btn': 'ti-search',
    'recalc-btn': 'ti-refresh',
    'clear-month-btn': 'ti-eraser',
    'my-signature-btn': 'ti-signature',
    'my-swaps-btn': 'ti-arrows-exchange',
    'my-guard-btn': 'ti-shield-half'
  };

  function renderPanel() {
    var panel = document.getElementById('ds-panel');
    if (!panel) return;

    seenLabels = {};
    panel.innerHTML =
      '<div class="ds-panel-head">' +
      '<h3>פעולות</h3>' +
      '<button type="button" class="ds-panel-close" aria-label="סגירה">✕</button>' +
      '</div>';

    panel.querySelector('.ds-panel-close')
      .addEventListener('click', function () { togglePanel(false); });

    // ── שלי ──
    var mine = [];
    if (typeof DRAWER_MINE !== 'undefined') {
      DRAWER_MINE.forEach(function (a) {
        mine.push(makeRow(a.label, a.icon, a.primary ? 'primary' : '', a.run));
      });
    }
    addSection(panel, 'שלי', mine);

    // ── ניהול משמרת ──
    var cmd = [];
    if (typeof DRAWER_COMMAND !== 'undefined') {
      DRAWER_COMMAND.forEach(function (a) {
        var allowed;
        if (typeof canDo === 'function') {
          if (a.id === 'cmdguard') allowed = canDo('guard');
          else if (a.id === 'urgent' || a.id === 'cmdmsg') allowed = canDo('manager') || canDo('hr');
          else allowed = canDo('manager');
        } else {
          allowed = state.isManager === true;
        }
        if (allowed) cmd.push(makeRow(a.label, a.icon, a.hot ? 'hot' : 'primary', a.run));
      });
    }
    addSection(panel, 'ניהול משמרת', cmd);

    // ── כלים ──
    var tools = [];
    document.querySelectorAll('nav.bottom-tools:not(#shortcuts-bar) .tool-btn').forEach(function (el) {
      var label = normLabel(el.textContent);
      var danger = el.classList.contains('tool-btn-danger') || label.indexOf('נקה') === 0;
      tools.push(proxyRow(el, TOOL_ICONS[el.id] || 'ti-tool', danger ? 'danger' : ''));
    });
    addSection(panel, 'כלים', tools);

    // ── קיצורים ──
    var shortcuts = [];
    document.querySelectorAll('#shortcuts-bar .sc-chip:not(.sc-add)').forEach(function (el) {
      shortcuts.push(proxyRow(el, 'ti-star'));
    });
    var addChip = document.querySelector('#shortcuts-bar .sc-add');
    if (addChip) shortcuts.push(proxyRow(addChip, 'ti-plus'));
    addSection(panel, 'קיצורים', shortcuts);
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

    // הלשונית רלוונטית רק אחרי כניסה, לא במסך הקוד האישי
    var tab = document.getElementById('ds-panel-tab');
    if (!tab) return;
    var loggedIn = !!(typeof state !== 'undefined' && state && state.code);
    var onAppScreen = isVisible('screen-app') || isVisible('screen-admin') ||
      isVisible('screen-calendar') || isVisible('screen-documents') ||
      isVisible('screen-shift-team') || isVisible('screen-team') ||
      isVisible('screen-procedures');
    tab.style.display = (loggedIn && onAppScreen) ? 'flex' : 'none';
  }

  if (typeof showScreen === 'function') {
    var _show = showScreen;
    showScreen = function (id) {
      _show(id);
      togglePanel(false);
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

  document.addEventListener('DOMContentLoaded', boot);
  boot();
})();

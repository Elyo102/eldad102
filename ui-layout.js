/* =====================================================================
 *  ui-layout.js — תיקוני פריסה
 *  נטען אחרון, אחרי app.js ו-calendar-unified.js
 * =====================================================================
 *
 *  שלוש בעיות שדווחו מהשטח, ושלושתן נובעות מאותו שורש: אלמנטים
 *  מרחפים שלא לוקחים בחשבון את התוכן שמתחתיהם ואת גבולות המסך.
 *
 *  1. הפלוס הצף דרס את "נקה חודש" — הוא היה עיגול ב-position:fixed
 *     מעל סרגל הכלים. עכשיו הוא משבצת בתוך הסרגל עם תווית קריאה.
 *
 *  2. המשמרת האחרונה נחתכה — לתוכן לא היה מרווח תחתון, אז הסרגלים
 *     המרחפים כיסו אותו. משיכה למטה חשפה אותו לרגע, ואז הוא קפץ
 *     חזרה. המרווח מחושב כאן דינמית מהגובה האמיתי של הסרגלים.
 *
 *  3. הכותרת נכנסה מתחת לשעון של האייפון — חסר env(safe-area-inset).
 *
 *  אם משהו כאן נשבר: מחיקת שורת ה-script ב-index.html מחזירה בדיוק
 *  את המצב הקודם. הקובץ לא נוגע בנתונים, רק בפריסה.
 * ===================================================================== */

(function () {
  'use strict';

  // -------------------------------------------------------------------
  //  סגנונות
  // -------------------------------------------------------------------

  function injectLayoutStyles() {
    if (document.getElementById('ds102-layout-fix')) return;
    var st = document.createElement('style');
    st.id = 'ds102-layout-fix';
    st.textContent = [
      /* הפלוס הצף יורד מהמסך - הוא הפך למשבצת בסרגל */
      '.fab, #add-shift-btn { display: none !important; }',

      /* משבצת הפעולה: אותו גודל כמו שאר המשבצות, בצבע המותג */
      '.ds-action-tile {',
      '  background: #C1272D !important;',
      '  border-color: #C1272D !important;',
      '  color: #fff !important;',
      '}',
      '.ds-action-tile i { color: #fff !important; }',

      /* מרווח תחתון - הערך עצמו נקבע דינמית ב-applyBottomPadding */
      '.app-main { padding-bottom: var(--ds-bottom-pad, 190px) !important; }',

      /* אזורים בטוחים: כותרת מתחת לשעון, סרגל מעל פס הבית */
      '.app-header { padding-top: env(safe-area-inset-top, 0px) !important; }',
      'nav.bottom-tools { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important; }',

      /* גיליונות תחתונים שנבנים דינמית (mpModal) */
      '.mp-fullscreen > div {',
      '  padding-top: calc(12px + env(safe-area-inset-top, 0px)) !important;',
      '  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important;',
      '}',

      /* כפתור סגירה רחב בתחתית גיליון תחתון - האגודל מגיע לשם */
      '.mp-bottom-close {',
      '  width: 100%; margin-top: 16px; padding: 15px;',
      '  border: 1.5px solid var(--border, #ddd); border-radius: 12px;',
      '  background: #fff; font-family: inherit; font-size: 15px;',
      '  font-weight: 600; color: #444; cursor: pointer;',
      '}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // -------------------------------------------------------------------
  //  משבצת הפעולה בסרגל
  // -------------------------------------------------------------------
  //  הפלוס הישן כבר לא פתח את טופס הדיווח אלא את מגירת הפעולות, ולכן
  //  אין סיבה שיישאר סימן בלי מילים. כמשבצת ראשונה בסרגל הוא אומר
  //  בדיוק מה הוא עושה.

  function installActionTile() {
    var tools = document.querySelector('nav.bottom-tools:not(#shortcuts-bar)');
    if (!tools || document.getElementById('ds-action-tile')) return;

    var btn = document.createElement('button');
    btn.id = 'ds-action-tile';
    btn.type = 'button';
    btn.className = 'tool-btn ds-action-tile';
    btn.innerHTML = '<i class="ti ti-plus" aria-hidden="true"></i>' +
      '<span class="ds-fallback" style="display:none">+</span>' +
      '<span>פעולה חדשה</span>';

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof toggleDrawer === 'function') toggleDrawer();
      else if (typeof openShiftModal === 'function') openShiftModal(null, null);
    });

    tools.insertBefore(btn, tools.firstChild);
  }

  // -------------------------------------------------------------------
  //  מרווח תחתון אמיתי
  // -------------------------------------------------------------------
  //  ערך קבוע לא היה עובד: סרגל הקיצורים מופיע רק אצל חלק מהמשתמשים,
  //  ומספר המשבצות משתנה לפי הרשאה. לכן הגובה נמדד בפועל.

  function applyBottomPadding() {
    var total = 0;
    document.querySelectorAll('nav.bottom-tools').forEach(function (nav) {
      if (nav.classList.contains('hidden')) return;
      var h = nav.offsetHeight;
      if (h > 0) total += h;
    });

    // 24 פיקסלים נשימה, כדי שהכרטיס האחרון לא ייצמד לקצה הסרגל
    var pad = total > 0 ? (total + 24) : 190;
    document.documentElement.style.setProperty('--ds-bottom-pad', pad + 'px');
  }

  // הסרגלים נבנים בשלבים: חלקם ב-HTML, חלקם אחרי כניסה, וסרגל
  // הקיצורים מצויר מחדש בכל הוספה. מדידה חד-פעמית הייתה מפספסת.
  function watchToolbars() {
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(applyBottomPadding);
      document.querySelectorAll('nav.bottom-tools').forEach(function (n) { ro.observe(n); });
    }

    var shortcuts = document.getElementById('shortcuts-bar');
    if (shortcuts && window.MutationObserver) {
      new MutationObserver(applyBottomPadding).observe(shortcuts, {
        childList: true, attributes: true, attributeFilter: ['class']
      });
    }

    window.addEventListener('resize', applyBottomPadding);
    window.addEventListener('orientationchange', function () {
      setTimeout(applyBottomPadding, 200);
    });
  }

  // -------------------------------------------------------------------
  //  כפתור סגירה בתחתית גיליונות תחתונים
  // -------------------------------------------------------------------
  //  ה-✕ יושב בפינה העליונה, ובמסך גבוה צריך למתוח את היד כדי להגיע
  //  אליו. כפתור רחב בתחתית פותר את זה בלי להסיר את הקיים.

  function addBottomClose(modalEl) {
    if (!modalEl || modalEl.dataset.bottomClose === '1') return;
    var body = modalEl.querySelector('.mp-body');
    if (!body) return;
    modalEl.dataset.bottomClose = '1';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mp-bottom-close';
    btn.textContent = 'סגור';
    btn.addEventListener('click', function () { modalEl.classList.add('hidden'); });
    body.parentNode.appendChild(btn);
  }

  function watchModals() {
    if (!window.MutationObserver) return;
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.querySelector && node.querySelector('.mp-body')) addBottomClose(node);
        });
      });
    }).observe(document.body, { childList: true });
  }

  // -------------------------------------------------------------------
  //  אתחול
  // -------------------------------------------------------------------

  function boot() {
    injectLayoutStyles();
    installActionTile();
    applyBottomPadding();
    if (typeof applyButtonIcons === 'function') applyButtonIcons();
  }

  // המסכים מתחלפים והסרגלים נבנים מחדש, אז מריצים גם אחרי כל מעבר
  if (typeof showScreen === 'function') {
    var _show = showScreen;
    showScreen = function (id) {
      _show(id);
      setTimeout(boot, 60);
    };
  }

  if (typeof enterApp === 'function') {
    var _enter = enterApp;
    enterApp = function () {
      _enter.apply(null, arguments);
      setTimeout(boot, 120);
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot();
    watchToolbars();
    watchModals();
  });

  boot();
  watchToolbars();
  watchModals();
})();

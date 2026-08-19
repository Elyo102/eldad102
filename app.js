/* =====================================================================
 *  app.js — "דוח נוכחות כבאים"
 *  חזית PWA שמדברת עם Apps Script Web App דרך fetch().
 * ===================================================================== */

// גרסה גלויה למסך הכניסה - מתעדכנת יחד עם CACHE_NAME ב-service-worker.js
// בכל פעם שמעדכנים אחד, מעדכנים גם את השני. זה נותן דרך מהירה לוודא
// בוודאות שהגרסה הנכונה נטענה בדפדפן, בלי צורך לחפש בתוך קבצים.
const APP_VERSION = 'v54';
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('version-indicator');
  if (el) el.textContent = 'גרסה ' + APP_VERSION;
});

// !!! זו הכתובת שקיבלנו מהמשתמש - כבר מולאה, אין צורך לשנות !!!
// עודכן ל-Web App של הפרויקט הפרטי החדש (הפרדה מגיליון "סידור עבודה" של ליסה)
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbykXHT-HBpsiBw_pvFBxc3IYdH90bpkQavQIliC980YLDBSRK47pirTxSOGaFXgFM0i/exec'
};

const DAY_NAMES = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

// סוגי יום שיש להם שעות קבועות (לא צריך שעת כניסה/יציאה)
const FIXED_HOUR_TYPES = new Set(['חופש', 'מחלה', 'מילואים', 'יטבתה']);

// צבע לכל סוג יום, לתצוגת הפירוט החודשי (כרטיס הסטטיסטיקה)
const DAY_TYPE_COLORS = {
  'רגיל': 'var(--c-regular)',
  'חופש': 'var(--c-vacation)',
  'מחלה': 'var(--c-sick)',
  'מילואים': 'var(--c-reserve)',
  'יטבתה': 'var(--c-yotvata)',
  'החלפה צרכי מערכת': 'var(--c-swap)',
  'המשך משמרת': 'var(--c-continued)',
  'משמרת מפוצלת': 'var(--c-split)',
  'קריאת פתע': '#c62828'
};
const DAY_TYPE_ORDER = ['רגיל', 'חופש', 'מחלה', 'מילואים', 'יטבתה', 'החלפה צרכי מערכת', 'המשך משמרת', 'משמרת מפוצלת', 'קריאת פתע'];

// צבעי המשמרות - זהים לצבעי הכתב האמיתיים בסידור החיצוני (אומת מול
// scanScheduleColors ב-16.8.2026): א=אדום/רמי חנן, ב=ירוק/רז בכור
// (+אלמקייס כסגן), ג=כחול/אייל טויטו.
const SHIFT_TEAM_BADGES = [
  { label: 'משמרת א', letter: 'א', color: '#980000' },
  { label: 'משמרת ב', letter: 'ב', color: '#38761d' },
  { label: 'משמרת ג', letter: 'ג', color: '#0000ff' }
];

// שעת כניסה נעולה (לא ניתנת לעריכה) עבור סוגי יום ספציפיים - כרגע רק
// "המשך משמרת" נעול על 07:00, בדיוק כמו שהשרת בכל מקרה כופה בפועל.
const LOCKED_START_TIME = { 'המשך משמרת': '07:00' };

// התחנות הקבועות שקיימות בסידור העבודה של אילת - זהות לתוויות
// השורה שבהן משתמש הסידור עצמו (ולכן גם למה שהמילוי האוטומטי כותב).
const KNOWN_STATIONS = ['ראשית', 'שחמון', 'תמנע', 'יטבתה'];

// ---------------------------------------------------------------------
// state
// ---------------------------------------------------------------------
const state = {
  code: null,
  name: null,
  currentMonth: null, // Date בתחילת החודש המוצג
  shifts: [],
  editingDateStr: null
};

// ---------------------------------------------------------------------
// עזרי DOM
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  ['screen-login', 'screen-register', 'screen-forgot', 'screen-app', 'screen-admin', 'screen-team', 'screen-documents', 'screen-procedures', 'screen-shift-team', 'screen-calendar'].forEach(s => {
    $(s).classList.toggle('hidden', s !== id);
  });
}

function showToast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function setLoading(on) {
  $('loading-overlay').classList.toggle('hidden', !on);
}

// ---------------------------------------------------------------------
// שכבת API
// ---------------------------------------------------------------------
async function apiGet(action, params = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  Object.keys(params).forEach(k => {
    if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
  });
  // מונע מהדפדפן להחזיר תשובה שמורה במטמון לבקשת GET זהה - בלי זה,
  // פעולות כמו "סמן כטופל" יכלו להיראות "לא עובדות" למרות שהשרת
  // בפועל עדכן נכון, כי הרענון שאחריהן קיבל תשובה ישנה מהמטמון.
  url.searchParams.set('_t', Date.now());
  const res = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
  if (!res.ok) {
    // 404 כמעט תמיד אומר שכתובת ה-API עצמה שגויה או שהפריסה הוחלפה,
    // ולא שהפעולה נכשלה. הודעה מפורשת חוסכת חיפוש מיותר.
    if (res.status === 404) {
      throw new Error('כתובת השרת לא נמצאה (404). ייתכן שנוצרה פריסה חדשה - יש לעדכן את API_URL.');
    }
    throw new Error('שגיאת שרת (' + res.status + ')');
  }
  return res.json();
}

async function apiPost(action, params = {}) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    // חשוב: text/plain ולא application/json - כדי למנוע preflight (OPTIONS)
    // ש-Apps Script לא יודע לטפל בו. השרת (Api.gs) מפרסר JSON בכל מקרה.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...params })
  });
  if (!res.ok) throw new Error('שגיאת שרת (' + res.status + ')');
  return res.json();
}

// silent=true מבצע את הקריאה בלי להדליק את שכבת הטעינה. זה מה
// שמשמש את רענוני הרקע - בלי זה העיגול המסתובב קופץ על כל המסך
// בכל מחזור רענון, גם כשהמשתמש לא ביקש שום דבר.
async function callApi(method, action, params, silent) {
  if (!silent) setLoading(true);
  try {
    const result = method === 'GET' ? await apiGet(action, params) : await apiPost(action, params);
    if (result && result.success === false) {
      throw new Error(result.error || result.message || 'שגיאה לא ידועה');
    }
    return result;
  } finally {
    if (!silent) setLoading(false);
  }
}

// ---------------------------------------------------------------------
// אחסון מקומי (זוכר התחברות בין פתיחות)
// ---------------------------------------------------------------------
function saveSession(code, name, isAdmin, isManager, shiftTeam, isHr) {
  localStorage.setItem('ds102_code', code);
  localStorage.setItem('ds102_name', name || '');
  localStorage.setItem('ds102_admin', isAdmin ? '1' : '');
  localStorage.setItem('ds102_manager', isManager ? '1' : '');
  localStorage.setItem('ds102_shift_team', shiftTeam || '');
  localStorage.setItem('ds102_hr', isHr ? '1' : '');
}
function loadSession() {
  return {
    code: localStorage.getItem('ds102_code'),
    name: localStorage.getItem('ds102_name'),
    isAdmin: localStorage.getItem('ds102_admin') === '1',
    isManager: localStorage.getItem('ds102_manager') === '1',
    shiftTeam: localStorage.getItem('ds102_shift_team') || '',
    isHr: localStorage.getItem('ds102_hr') === '1'
  };
}
function clearSession() {
  localStorage.removeItem('ds102_code');
  localStorage.removeItem('ds102_name');
}

// ---------------------------------------------------------------------
// זרימת התחברות
// ---------------------------------------------------------------------
async function tryAutoLogin() {
  const saved = loadSession();
  if (!saved.code) { showScreen('screen-login'); return; }
  try {
    const result = await callApi('GET', 'login', { code: saved.code });
    if (result.valid) {
      enterApp(result.code || saved.code, result.name || saved.name, result.isAdmin, result.isManager, result.shiftTeam, result.isHr);
    } else {
      clearSession();
      showScreen('screen-login');
    }
  } catch (err) {
    // אין אינטרנט/שגיאת שרת - עדיין ניכנס עם המידע השמור, ברוח offline-first
    if (saved.code) {
      enterApp(saved.code, saved.name, saved.isAdmin, saved.isManager, saved.shiftTeam, saved.isHr);
      showToast('לא הצלחתי לאמת מול השרת כרגע, עובד/ת במצב לא מקוון');
    } else {
      showScreen('screen-login');
    }
  }
}

function enterApp(code, name, isAdmin, isManager, shiftTeam, isHr) {
  state.code = code;
  state.name = name;
  state.isAdmin = !!isAdmin;
  state.isManager = !!isManager || state.isAdmin;
  state.shiftTeam = shiftTeam || '';
  state.isHr = !!isHr;
  saveSession(code, name, state.isAdmin, state.isManager, state.shiftTeam, state.isHr);
  $('user-name').textContent = name || 'שלום';
  $('admin-btn').classList.toggle('hidden', !state.isManager);
  $('team-btn').classList.toggle('hidden', !state.isManager);
  $('shift-team-btn').classList.toggle('hidden', !state.shiftTeam);
  $('calendar-btn').classList.toggle('hidden', !state.isManager);
  // HR לא מדווחת/מתקנת/מוחקת משמרות - אין לה בכלל לשונית משמרות
  // בגיליון, אז כל אזור החודש (ניווט, סך שעות, אישור דוח) לא רלוונטי.
  $('add-shift-btn').classList.toggle('hidden', state.isHr);
  document.querySelector('.bottom-tools').classList.toggle('hidden', state.isHr);
  $('month-section-hr-hidden').classList.toggle('hidden', state.isHr);
  const now = new Date();
  state.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  // בדיקה מפורשת - רק HR אמיתי (לא מנהל-על, לא ראש משמרת) מנותב ישר
  // למסך הניהול עם היומן. isHr חייב להיות true במפורש (לא רק truthy).
  const isTrulyHr = state.isHr === true && !state.isAdmin;
  if (isTrulyHr) {
    // HR נכנסת ישר למסך הניהול - שם היומן והבועות פרוסים ישירות,
    // בלי צורך ללחוץ על אייקון כלשהו קודם.
    showScreen('screen-admin');
    Promise.allSettled([loadAdminUsers(), loadOpenAlerts(), loadCalendarEvents(), loadPersonalAlerts()]);
  } else {
    showScreen('screen-app');
    // הצגה מיידית מהמטמון המקומי, לפני שהשרת בכלל ענה. המשתמש רואה
    // את החודש שלו מיד, והנתונים מתעדכנים ברקע כשהתשובה מגיעה.
    renderMonthFromCache();
    loadBootstrap();
  }

  flushOfflineQueue();
  renderShortcutsBar();
  startPersonalAlertsPolling();
}

// רענון אוטומטי כל 90 שניות, אבל רק כשהמסך באמת פעיל. אם האפליקציה
// ברקע או המסך כבוי - מדלגים, כדי לא לשרוף מכסת קריאות לשרת על
// משתמש שלא מסתכל. בחזרה למסך - רענון מיידי, בלי להמתין למחזור הבא,
// כך שהתחושה מהירה יותר מרענון קבוע ולא איטית יותר.
let personalAlertsPollInterval = null;
let visibilityListenerAttached = false;

function startPersonalAlertsPolling() {
  if (personalAlertsPollInterval) clearInterval(personalAlertsPollInterval);

  personalAlertsPollInterval = setInterval(() => {
    if (document.hidden) return;
    loadPersonalAlerts();
    refreshMissedPunchUi();
  }, 90000);

  // רישום פעם אחת בלבד. בלי השמירה הזו כל התחברות מחדש הייתה מוסיפה
  // מאזין נוסף, וכל חזרה למסך הייתה מייצרת קריאות כפולות.
  if (!visibilityListenerAttached) {
    visibilityListenerAttached = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.code) {
        loadPersonalAlerts();
        refreshMissedPunchUi();
      }
    });
  }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('login-code').value.trim();
  $('login-error').classList.add('hidden');
  if (!code) return;
  try {
    const result = await callApi('GET', 'login', { code });
    if (result.valid) {
      enterApp(result.code || code, result.name, result.isAdmin, result.isManager, result.shiftTeam, result.isHr);
    } else {
      $('login-error').textContent = 'קוד לא תקין';
      $('login-error').classList.remove('hidden');
    }
  } catch (err) {
    $('login-error').textContent = err.message || 'שגיאה בהתחברות';
    $('login-error').classList.remove('hidden');
  }
});

$('go-register').addEventListener('click', () => showScreen('screen-register'));
$('go-forgot').addEventListener('click', () => showScreen('screen-forgot'));

$('go-admin-login').addEventListener('click', () => {
  $('admin-login-error').classList.add('hidden');
  $('admin-login-code').value = '';
  $('admin-login-modal').classList.remove('hidden');
});
$('close-admin-login-modal').addEventListener('click', () => {
  $('admin-login-modal').classList.add('hidden');
});
$('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('admin-login-code').value.trim();
  const errBox = $('admin-login-error');
  errBox.classList.add('hidden');
  if (!code) return;
  try {
    const result = await callApi('GET', 'login', { code });
    if (!result.valid) {
      errBox.textContent = 'קוד לא תקין';
      errBox.classList.remove('hidden');
      return;
    }
    if (!result.isHr) {
      errBox.textContent = 'הקוד הזה אינו קוד HR';
      errBox.classList.remove('hidden');
      return;
    }
    enterApp(result.code || code, result.name, result.isAdmin, result.isManager, result.shiftTeam, result.isHr);
    $('admin-login-modal').classList.add('hidden');
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בהתחברות';
    errBox.classList.remove('hidden');
  }
});
document.querySelectorAll('[data-back-to]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.backTo));
});

// ---------------------------------------------------------------------
// מדריך שימוש (עזרה)
// ---------------------------------------------------------------------
function openHelpModal() { $('help-modal').classList.remove('hidden'); }
function closeHelpModal() { $('help-modal').classList.add('hidden'); }
$('help-btn-login').addEventListener('click', openHelpModal);
$('help-btn-app').addEventListener('click', openHelpModal);
$('close-help-modal').addEventListener('click', closeHelpModal);

// ---------------------------------------------------------------------
// התקנה למסך הבית - כפתור אחד שמפעיל את דיאלוג ההתקנה של הדפדפן
// (אנדרואיד/כרום), ובאייפון (שלא תומך בהפעלה אוטומטית) מציג הוראות.
// ---------------------------------------------------------------------
let deferredInstallPrompt = null;
const installBtn = $('install-app-btn');

function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

if (!isRunningStandalone()) {
  if (isIOSDevice()) {
    // אין ב-iOS אירוע/API שמאפשר להפעיל את "הוסף למסך הבית" אוטומטית -
    // זו מגבלה של אפל עצמה, לא משהו שאפשר לעקוף מהאתר. מציגים כפתור
    // שמסביר בדיוק מה ללחוץ, בלי לשלוח למשתמש לחפש בתפריטים לבד.
    installBtn.classList.remove('hidden');
    installBtn.addEventListener('click', () => {
      $('ios-install-modal').classList.remove('hidden');
    });
  } else {
    // אנדרואיד/כרום/אדג' - הדפדפן שולח אירוע כזה כשהאפליקציה "ראויה
    // להתקנה" (יש manifest תקין + service worker). שומרים אותו כדי
    // להפעיל את דיאלוג ההתקנה הרשמי של הדפדפן בלחיצת כפתור אחת.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      installBtn.classList.remove('hidden');
    });
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installBtn.classList.add('hidden');
      if (choice.outcome === 'accepted') showToast('האפליקציה הותקנה בהצלחה!');
    });
    window.addEventListener('appinstalled', () => {
      installBtn.classList.add('hidden');
    });
  }
}
$('close-ios-install-modal').addEventListener('click', () => $('ios-install-modal').classList.add('hidden'));

$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const firstName = $('reg-first').value.trim();
  const lastName = $('reg-last').value.trim();
  const email = $('reg-email').value.trim();
  const resultBox = $('register-result');
  resultBox.classList.add('hidden');
  try {
    const result = await callApi('POST', 'registerUser', { firstName, lastName, email });
    resultBox.textContent = result.success
      ? `נרשמת בהצלחה! הקוד האישי שלך: ${result.code}`
      : (result.message || 'ההרשמה לא הושלמה');
    resultBox.classList.remove('hidden');
  } catch (err) {
    resultBox.textContent = err.message || 'שגיאה בהרשמה';
    resultBox.classList.remove('hidden');
  }
});

$('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const firstName = $('forgot-first').value.trim();
  const lastName = $('forgot-last').value.trim();
  const resultBox = $('forgot-result');
  resultBox.classList.add('hidden');
  try {
    const result = await callApi('POST', 'sendForgotCode', { firstName, lastName });
    resultBox.textContent = result.message || 'אם הפרטים נמצאו, נשלח מייל עם הקוד.';
    resultBox.classList.remove('hidden');
  } catch (err) {
    resultBox.textContent = err.message || 'שגיאה בשליחה';
    resultBox.classList.remove('hidden');
  }
});

$('logout-btn').addEventListener('click', () => {
  clearSession();
  state.code = null;
  showScreen('screen-login');
});

// ---------------------------------------------------------------------
// מסך ניהול (מנהל בלבד) - רשימת משתמשים, השבתה/הפעלה, שליחת קוד, הודעות
// ---------------------------------------------------------------------
let adminMessageTarget = null; // null = הודעה לכולם

function relativeLoginLabel(iso) {
  if (!iso) return { label: 'מעולם לא התחבר', dot: 'gray' };
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return { label: 'התחבר/ה היום', dot: 'green' };
  if (days === 1) return { label: 'התחבר/ה אתמול', dot: 'amber' };
  if (days <= 7) return { label: 'לפני ' + days + ' ימים', dot: 'amber' };
  return { label: 'לפני ' + days + ' ימים', dot: 'gray' };
}

let cachedAdminUsersList = [];
async function loadAdminUsers() {
  const list = $('admin-users-list');
  const empty = $('admin-empty');
  list.innerHTML = '';
  try {
    const result = await callApi('GET', 'adminListUsers', { code: state.code });
    const users = result.users || [];
    cachedAdminUsersList = users;
    if (users.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    users.forEach(u => list.appendChild(renderAdminUserCard(u)));
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת רשימת המשתמשים');
  }
}

function renderAdminUserCard(u) {
  const card = document.createElement('div');
  card.className = 'shift-card';
  card.style.flexWrap = 'wrap';
  card.style.alignItems = 'flex-start';

  const rel = relativeLoginLabel(u.lastLoginAt);
  const dotColor = rel.dot === 'green' ? '#2e7d32' : (rel.dot === 'amber' ? '#d38b00' : '#9e9e9e');
  const isActive = u.status === 'פעיל';
  const hoursLabel = (u.monthlyHours === null || u.monthlyHours === undefined) ? '—' : u.monthlyHours;

  card.innerHTML = `
    <div class="admin-card-folder-icon" data-code="${escapeHtml(u.code || '')}" data-name="${escapeHtml(u.name || '')}" title="לחיצה כפולה לפתיחת המסמכים" style="font-size:38px;cursor:pointer;line-height:1;margin-left:6px;user-select:none">📁</div>
    <div style="flex:1;min-width:200px">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:15px;flex-wrap:wrap">
        ${u.isAdmin ? '' : `<input type="checkbox" class="bulk-select-checkbox" data-code="${escapeHtml(u.code)}" ${bulkSelectedCodes.has(u.code) ? 'checked' : ''} style="width:17px;height:17px;cursor:pointer">`}
        <span style="width:9px;height:9px;border-radius:50%;background:${dotColor};display:inline-block"></span>
        ${escapeHtml(u.name || '')} ${u.isAdmin ? '👑' : ''} ${u.isHr ? '🩺' : (u.isManager ? '🛡️' : '')} ${u.messagingBlocked ? '🚫' : ''}
        ${SHIFT_TEAM_BADGES.map(t => `
          <span class="shift-team-badge" data-code="${escapeHtml(u.code)}" data-team="${t.label}" data-active="${u.shiftTeam === t.label ? '1' : '0'}"
            style="width:20px;height:20px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;cursor:pointer;
              background:${u.shiftTeam === t.label ? t.color : '#fff'};color:${u.shiftTeam === t.label ? '#fff' : t.color};border:1.5px solid ${t.color}">${t.letter}</span>
        `).join('')}
      </div>
      <div style="font-size:12.5px;color:var(--text-muted);margin-top:3px">
        קוד: ${u.codeHidden ? '••••' : escapeHtml(u.code)} · ${rel.label} · ${hoursLabel} שעות החודש
      </div>
      <div style="font-size:12.5px;margin-top:2px;color:${isActive ? 'var(--success)' : 'var(--danger)'}">
        ${isActive ? 'פעיל' : 'לא פעיל'} ${u.isHr ? '· HR' : (u.isManager ? '· מנהל/ת צוות' : '')} ${u.shiftTeam ? '· ' + u.shiftTeam : ''} ${u.messagingBlocked ? '· חסום משליחת הודעות' : ''}
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${(u.isAdmin || !state.isAdmin) ? '' : `<button class="tool-btn admin-toggle-btn" data-code="${escapeHtml(u.code)}" data-status="${isActive ? 'פעיל' : 'לא פעיל'}" style="width:auto;padding:6px 12px">${isActive ? 'השבת' : 'הפעל'}</button>`}
      ${u.codeHidden ? '' : `<button class="tool-btn admin-resend-btn" data-code="${escapeHtml(u.code)}" style="width:auto;padding:6px 12px">שלח קוד</button>`}
      <button class="tool-btn admin-message-btn" data-code="${escapeHtml(u.code)}" data-name="${escapeHtml(u.name || '')}" style="width:auto;padding:6px 12px">שלח הודעה</button>
      ${u.isAdmin ? '' : `<button class="tool-btn admin-block-msg-btn" data-code="${escapeHtml(u.code)}" data-blocked="${u.messagingBlocked ? '1' : '0'}" style="width:auto;padding:6px 12px${u.messagingBlocked ? ';color:var(--danger)' : ''}">${u.messagingBlocked ? 'בטל חסימת הודעות' : 'חסום הודעות'}</button>`}
      ${(u.isAdmin || !state.isAdmin) ? '' : `
        <button class="tool-btn admin-role-btn" data-code="${escapeHtml(u.code)}" data-role="manager" style="width:auto;padding:6px 12px${u.role === 'manager' ? ';font-weight:700' : ''}">מנהל/ת צוות</button>
        <button class="tool-btn admin-role-btn" data-code="${escapeHtml(u.code)}" data-role="hr" style="width:auto;padding:6px 12px${u.role === 'hr' ? ';font-weight:700' : ''}">HR</button>
        ${u.role ? `<button class="tool-btn admin-role-btn" data-code="${escapeHtml(u.code)}" data-role="" style="width:auto;padding:6px 12px;color:var(--text-muted)">הסר תפקיד</button>` : ''}
      `}
      <button class="tool-btn admin-docs-btn" data-code="${escapeHtml(u.code)}" data-name="${escapeHtml(u.name || '')}" style="width:auto;padding:6px 12px">מסמכים</button>
      <button class="tool-btn admin-reminder-btn" data-code="${escapeHtml(u.code)}" data-name="${escapeHtml(u.name || '')}" style="width:auto;padding:6px 12px">תזכורת</button>
    </div>
  `;
  return card;
}

// ---------------------------------------------------------------------
// בחירה מרובה + שיוך משמרת מרוכז
// ---------------------------------------------------------------------
const bulkSelectedCodes = new Set();

function updateBulkBar() {
  const bar = $('bulk-shift-team-bar');
  const count = bulkSelectedCodes.size;
  $('bulk-selected-count').textContent = count + ' נבחרו';
  bar.classList.toggle('hidden', count === 0);
}

$('admin-users-list').addEventListener('change', (e) => {
  const cb = e.target.closest('.bulk-select-checkbox');
  if (!cb) return;
  if (cb.checked) bulkSelectedCodes.add(cb.dataset.code);
  else bulkSelectedCodes.delete(cb.dataset.code);
  updateBulkBar();
});

$('bulk-clear-selection-btn').addEventListener('click', () => {
  bulkSelectedCodes.clear();
  document.querySelectorAll('.bulk-select-checkbox').forEach(cb => { cb.checked = false; });
  updateBulkBar();
});

document.querySelectorAll('.bulk-team-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (bulkSelectedCodes.size === 0) return;
    const teamLabel = btn.dataset.team;
    try {
      const res = await callApi('POST', 'adminBulkSetShiftTeam', {
        adminCode: state.code, targetCodes: Array.from(bulkSelectedCodes), teamLabel
      });
      showToast(res.message || 'שויכו בהצלחה');
      bulkSelectedCodes.clear();
      updateBulkBar();
      loadAdminUsers();
    } catch (err) {
      showToast(err.message || 'שגיאה בשיוך המרוכז');
    }
  });
});

$('admin-users-list').addEventListener('dblclick', (e) => {
  const folderIcon = e.target.closest('.admin-card-folder-icon');
  if (folderIcon) openUserDocsModal(folderIcon.dataset.code, folderIcon.dataset.name);
});

$('admin-users-list').addEventListener('click', async (e) => {
  const toggleBtn = e.target.closest('.admin-toggle-btn');
  const resendBtn = e.target.closest('.admin-resend-btn');
  const msgBtn = e.target.closest('.admin-message-btn');
  const blockMsgBtn = e.target.closest('.admin-block-msg-btn');
  const roleBtn = e.target.closest('.admin-role-btn');
  const docsBtn = e.target.closest('.admin-docs-btn');
  const reminderBtn = e.target.closest('.admin-reminder-btn');
  const shiftTeamBadge = e.target.closest('.shift-team-badge');

  if (docsBtn) {
    openUserDocsModal(docsBtn.dataset.code, docsBtn.dataset.name);
    return;
  }

  if (reminderBtn) {
    openReminderModal(reminderBtn.dataset.code, reminderBtn.dataset.name);
    return;
  }

  if (shiftTeamBadge) {
    const code = shiftTeamBadge.dataset.code;
    const clickedTeam = shiftTeamBadge.dataset.team;
    // לחיצה על ריבוע שכבר פעיל = הסרת השיוך. לחיצה על ריבוע אחר = מעבר אליו.
    const alreadyActive = shiftTeamBadge.dataset.active === '1';
    const teamLabel = alreadyActive ? '' : clickedTeam;
    try {
      const res = await callApi('POST', 'adminSetShiftTeam', { adminCode: state.code, targetCode: code, teamLabel });
      showToast(res.message || 'עודכן');
      loadAdminUsers();
    } catch (err) {
      showToast(err.message || 'שגיאה בעדכון שיוך המשמרת');
    }
    return;
  }

  if (roleBtn) {
    const code = roleBtn.dataset.code;
    const role = roleBtn.dataset.role; // '', 'manager', 'hr'
    try {
      const res = await callApi('POST', 'adminSetUserRole', { adminCode: state.code, targetCode: code, role });
      showToast(res.message || 'התפקיד עודכן');
      loadAdminUsers();
    } catch (err) {
      showToast(err.message || 'שגיאה בעדכון תפקיד');
    }
    return;
  }

  if (blockMsgBtn) {
    const code = blockMsgBtn.dataset.code;
    const newBlocked = blockMsgBtn.dataset.blocked !== '1';
    try {
      const res = await callApi('POST', 'adminSetMessagingBlocked', { adminCode: state.code, targetCode: code, blocked: newBlocked });
      showToast(res.message || 'הסטטוס עודכן');
      loadAdminUsers();
    } catch (err) {
      showToast(err.message || 'שגיאה בעדכון חסימת הודעות');
    }
    return;
  }

  if (toggleBtn) {
    const code = toggleBtn.dataset.code;
    const newStatus = toggleBtn.dataset.status === 'פעיל' ? 'לא פעיל' : 'פעיל';
    try {
      const res = await callApi('POST', 'adminSetUserStatus', { adminCode: state.code, targetCode: code, newStatus });
      showToast(res.message || 'הסטטוס עודכן');
      loadAdminUsers();
    } catch (err) {
      showToast(err.message || 'שגיאה בעדכון סטטוס');
    }
    return;
  }

  if (resendBtn) {
    const code = resendBtn.dataset.code;
    try {
      const res = await callApi('POST', 'adminResendCode', { adminCode: state.code, targetCode: code });
      showToast(res.message || 'הקוד נשלח');
    } catch (err) {
      showToast(err.message || 'שגיאה בשליחת הקוד');
    }
    return;
  }

  if (msgBtn) {
    adminMessageTarget = msgBtn.dataset.code;
    $('admin-message-modal-title').textContent = 'הודעה ל-' + msgBtn.dataset.name;
    $('admin-message-text').value = '';
    $('admin-message-error').classList.add('hidden');
    $('admin-message-modal').classList.remove('hidden');
  }
});

$('admin-btn').addEventListener('click', () => {
  showScreen('screen-admin');
  $('admin-add-manager-btn').classList.toggle('hidden', !state.isAdmin);
  loadAdminUsers();
  loadOpenAlerts();
  loadCalendarEvents();
});
$('admin-back-btn').addEventListener('click', () => showScreen('screen-app'));

$('admin-broadcast-btn').addEventListener('click', () => {
  adminMessageTarget = null;
  $('admin-message-modal-title').textContent = 'הודעה לכולם';
  $('admin-message-text').value = '';
  $('admin-message-error').classList.add('hidden');
  $('admin-message-modal').classList.remove('hidden');
});

$('close-admin-message-modal').addEventListener('click', () => {
  $('admin-message-modal').classList.add('hidden');
});

// ---------------------------------------------------------------------
// הוספת מנהל/ת צוות חדש/ה (למשל ליסה)
// ---------------------------------------------------------------------
$('admin-add-manager-btn').addEventListener('click', () => {
  $('new-manager-name').value = '';
  $('new-manager-email').value = '';
  $('new-manager-phone').value = '';
  $('new-manager-code').value = '';
  $('add-manager-error').classList.add('hidden');
  $('add-manager-result').classList.add('hidden');
  $('add-manager-modal').classList.remove('hidden');
});
$('close-add-manager-modal').addEventListener('click', () => {
  $('add-manager-modal').classList.add('hidden');
  loadAdminUsers(); // אולי נוצר בהצלחה - נרענן את הרשימה
});
$('add-manager-submit-btn').addEventListener('click', async () => {
  const displayName = $('new-manager-name').value.trim();
  const email = $('new-manager-email').value.trim();
  const phone = $('new-manager-phone').value.trim();
  const customCode = $('new-manager-code').value.trim();
  const role = $('new-manager-role').value;
  const errBox = $('add-manager-error');
  const resultBox = $('add-manager-result');
  errBox.classList.add('hidden');
  resultBox.classList.add('hidden');
  try {
    const res = await callApi('POST', 'adminCreateManagerAccount', {
      adminCode: state.code, displayName, email, role, phone, customCode
    });
    resultBox.textContent = res.success
      ? `נוצר בהצלחה! הקוד האישי: ${res.code} (נשלח גם למייל)`
      : (res.message || 'לא הצלחתי ליצור את החשבון');
    resultBox.classList.remove('hidden');
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה ביצירת החשבון';
    errBox.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// מסך צוות ניהול - הודעות בין מנהל-על, מנהלי צוות, ליסה
// ---------------------------------------------------------------------
let teamMessageTarget = null;

async function loadTeamList() {
  const list = $('team-list');
  const empty = $('team-empty');
  list.innerHTML = '';
  try {
    const result = await callApi('GET', 'listManagementTeam', { code: state.code });
    const team = result.team || [];
    if (team.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    team.forEach(m => {
      const card = document.createElement('div');
      card.className = 'shift-card';
      card.innerHTML = `
        <div class="shift-details">
          <div class="shift-type">${escapeHtml(m.name || '')} ${m.isAdmin ? '👑' : '🛡️'}</div>
          <div class="shift-time">קוד: ${escapeHtml(m.code)}</div>
        </div>
        <button class="tool-btn team-message-btn" data-code="${escapeHtml(m.code)}" data-name="${escapeHtml(m.name || '')}" style="width:auto;padding:8px 14px">שלח הודעה</button>
      `;
      list.appendChild(card);
    });
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת צוות הניהול');
  }
}

$('team-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.team-message-btn');
  if (!btn) return;
  teamMessageTarget = btn.dataset.code;
  $('team-message-modal-title').textContent = 'הודעה ל-' + btn.dataset.name;
  $('team-message-text').value = '';
  $('team-message-error').classList.add('hidden');
  $('team-message-modal').classList.remove('hidden');
});

$('team-btn').addEventListener('click', () => {
  showScreen('screen-team');
  loadTeamList();
});
$('team-back-btn').addEventListener('click', () => showScreen('screen-app'));

// ---------------------------------------------------------------------
// ניהול משמרת (מפקד/סגן משמרת) - צוות שנשלף אוטומטית מהסידור
// ---------------------------------------------------------------------
async function loadShiftTeam() {
  const list = $('shift-team-list');
  const empty = $('shift-team-empty');
  list.innerHTML = '';
  try {
    const result = await callApi('GET', 'listMyShiftTeam', { code: state.code });
    $('shift-team-title').textContent = result.teamLabel ? ('ניהול ' + result.teamLabel) : 'ניהול משמרת';
    const members = result.members || [];
    if (members.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    members.forEach(m => {
      const rel = relativeLoginLabel(m.lastLoginAt);
      const dotColor = rel.dot === 'green' ? '#2e7d32' : (rel.dot === 'amber' ? '#d38b00' : '#9e9e9e');
      const hoursLabel = (m.monthlyHours === null || m.monthlyHours === undefined) ? '—' : m.monthlyHours;
      const card = document.createElement('div');
      card.className = 'shift-card';
      card.style.flexWrap = 'wrap';
      card.innerHTML = `
        <div class="shift-details" style="display:flex;align-items:flex-start;gap:8px;flex:1">
          <input type="checkbox" class="shift-team-select-checkbox" data-code="${escapeHtml(m.code)}" ${shiftTeamSelectedCodes.has(m.code) ? 'checked' : ''} style="width:17px;height:17px;cursor:pointer;margin-top:3px">
          <div>
            <div class="shift-type" style="display:flex;align-items:center;gap:6px">
              <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block"></span>
              ${escapeHtml(m.name)}
            </div>
            <div class="shift-time">${rel.label} · ${hoursLabel} שעות החודש · ${m.status === 'פעיל' ? 'פעיל' : 'לא פעיל'}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;width:100%">
          <button class="tool-btn shift-team-message-btn" data-code="${escapeHtml(m.code)}" data-name="${escapeHtml(m.name)}" style="width:auto;padding:6px 12px">שלח הודעה</button>
          <button class="tool-btn shift-team-docs-btn" data-code="${escapeHtml(m.code)}" data-name="${escapeHtml(m.name)}" style="width:auto;padding:6px 12px">מסמכים</button>
        </div>
      `;
      list.appendChild(card);
    });
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת הצוות');
  }
}

// בחירה מרובה + הקפצת קריאת פתע במסך ניהול משמרת
const shiftTeamSelectedCodes = new Set();
function updateShiftTeamBulkBar() {
  const bar = $('shift-team-bulk-bar');
  const count = shiftTeamSelectedCodes.size;
  $('shift-team-selected-count').textContent = count + ' נבחרו';
  bar.classList.toggle('hidden', count === 0);
}
$('shift-team-list').addEventListener('change', (e) => {
  const cb = e.target.closest('.shift-team-select-checkbox');
  if (!cb) return;
  if (cb.checked) shiftTeamSelectedCodes.add(cb.dataset.code);
  else shiftTeamSelectedCodes.delete(cb.dataset.code);
  updateShiftTeamBulkBar();
});
$('shift-team-clear-selection-btn').addEventListener('click', () => {
  shiftTeamSelectedCodes.clear();
  document.querySelectorAll('.shift-team-select-checkbox').forEach(cb => { cb.checked = false; });
  updateShiftTeamBulkBar();
});

$('shift-team-list').addEventListener('click', (e) => {
  const msgBtn = e.target.closest('.shift-team-message-btn');
  if (msgBtn) {
    teamMessageTarget = msgBtn.dataset.code;
    $('team-message-modal-title').textContent = 'הודעה ל-' + msgBtn.dataset.name;
    $('team-message-text').value = '';
    $('team-message-error').classList.add('hidden');
    $('team-message-modal').classList.remove('hidden');
    return;
  }
  const docsBtn = e.target.closest('.shift-team-docs-btn');
  if (docsBtn) {
    openUserDocsModal(docsBtn.dataset.code, docsBtn.dataset.name);
  }
});

$('shift-team-urgent-btn').addEventListener('click', () => {
  if (shiftTeamSelectedCodes.size === 0) return;
  $('urgent-alert-modal-title').textContent = '🚒🚨 הקפצת קריאת פתע (' + shiftTeamSelectedCodes.size + ' נבחרו)';
  $('urgent-alert-text').value = '';
  $('urgent-alert-error').classList.add('hidden');
  $('urgent-alert-modal').classList.remove('hidden');
});
$('close-urgent-alert-modal').addEventListener('click', () => $('urgent-alert-modal').classList.add('hidden'));
$('urgent-alert-send-btn').addEventListener('click', async () => {
  const text = $('urgent-alert-text').value.trim();
  const errBox = $('urgent-alert-error');
  if (!text) {
    errBox.textContent = 'יש להזין תוכן להודעה';
    errBox.classList.remove('hidden');
    return;
  }
  try {
    const res = await callApi('POST', 'triggerUrgentCallAlert', {
      fromCode: state.code, targetCodes: Array.from(shiftTeamSelectedCodes), message: text
    });
    showToast(res.message || 'הקריאה הוקפצה');
    playSirenSound(); // גם אצל מי ששיגר - אישור שמיעתי שהפעולה בוצעה
    $('urgent-alert-modal').classList.add('hidden');
    shiftTeamSelectedCodes.clear();
    updateShiftTeamBulkBar();
    loadShiftTeam();
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בשיגור ההתראה';
    errBox.classList.remove('hidden');
  }
});

// חתימת דוח שעות מרוכזת - ראש/סגן משמרת חותם/ת בבת אחת על כל מי
// שנבחר, בעזרת אותו פאנל חתימה (Canvas) שכבר קיים לכבאי הבודד
let signatureMode = 'personal'; // 'personal' (חתימה על מסמך עצמי) | 'commander' (חתימת ראש משמרת לצוות)
$('shift-team-sign-btn').addEventListener('click', () => {
  if (shiftTeamSelectedCodes.size === 0) return;
  signatureMode = 'commander';
  openSignatureModal(shiftTeamSelectedCodes.size + ' עובדים - דוח שעות');
});

$('shift-team-btn').addEventListener('click', () => {
  showScreen('screen-shift-team');
  loadShiftTeam();
});
$('shift-team-back-btn').addEventListener('click', () => showScreen('screen-app'));

$('close-team-message-modal').addEventListener('click', () => {
  $('team-message-modal').classList.add('hidden');
});
$('team-message-send-btn').addEventListener('click', async () => {
  const text = $('team-message-text').value.trim();
  const errBox = $('team-message-error');
  if (!text) {
    errBox.textContent = 'יש להזין תוכן להודעה';
    errBox.classList.remove('hidden');
    return;
  }
  try {
    const res = await callApi('POST', 'sendManagerMessage', {
      fromCode: state.code, toCode: teamMessageTarget, messageText: text
    });
    showToast(res.message || 'ההודעה נשלחה');
    $('team-message-modal').classList.add('hidden');
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בשליחת ההודעה';
    errBox.classList.remove('hidden');
  }
});

$('admin-message-send-btn').addEventListener('click', async () => {
  const text = $('admin-message-text').value.trim();
  const errBox = $('admin-message-error');
  if (!text) {
    errBox.textContent = 'יש להזין תוכן להודעה';
    errBox.classList.remove('hidden');
    return;
  }
  try {
    const res = await callApi('POST', 'adminSendMessage', {
      adminCode: state.code, targetCode: adminMessageTarget, messageText: text
    });
    showToast(res.message || 'ההודעה נשלחה');
    $('admin-message-modal').classList.add('hidden');
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בשליחת ההודעה';
    errBox.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// שליחת הודעה למנהל - כבאי רגיל (לא מנהל)
// ---------------------------------------------------------------------
$('send-admin-message-btn').addEventListener('click', () => {
  $('user-message-text').value = '';
  $('user-message-error').classList.add('hidden');
  $('user-message-modal').classList.remove('hidden');
});
$('close-user-message-modal').addEventListener('click', () => {
  $('user-message-modal').classList.add('hidden');
});
$('user-message-send-btn').addEventListener('click', async () => {
  const text = $('user-message-text').value.trim();
  const errBox = $('user-message-error');
  if (!text) {
    errBox.textContent = 'יש להזין תוכן להודעה';
    errBox.classList.remove('hidden');
    return;
  }
  try {
    const res = await callApi('POST', 'sendUserMessage', { code: state.code, messageText: text });
    showToast(res.message || 'ההודעה נשלחה');
    $('user-message-modal').classList.add('hidden');
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בשליחת ההודעה';
    errBox.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// חודש נוכחי + רשימת דיווחים
// ---------------------------------------------------------------------
function monthKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function refreshMonth() {
  const monthKey = monthKeyOf(state.currentMonth);
  $('month-label').textContent = `${MONTH_NAMES[state.currentMonth.getMonth()]} ${state.currentMonth.getFullYear()}`;

  // ציור מיידי מהמטמון המקומי. אם יש נתונים שמורים המסך מתמלא מיד,
  // והבקשה לשרת רק מעדכנת אותו. מעבר בין חודשים מרגיש מיידי.
  const hadCache = renderMonthFromCache();

  try {
    // בעבר: שתי בקשות נפרדות לשרת (listShifts + getMonthlyTotal). listShifts
    // כבר מחזירה hours לכל דיווח, אז מחשבים את הסכום כאן בצד הלקוח -
    // חוסך בקשה שלמה לשרת בכל טעינת מסך/מעבר חודש.
    // אם כבר הצגנו מהמטמון - הרענון שקט, בלי עיגול טעינה על המסך
    const shifts = await callApi('GET', 'listShifts', { code: state.code, monthKey }, hadCache);
    state.shifts = Array.isArray(shifts) ? shifts : (shifts.shifts || []);
    state.shifts.sort((a, b) => (a.dateStr || '').localeCompare(b.dateStr || ''));
    saveMonthToCache(monthKey, state.shifts);
    renderShifts();
    renderStatsBreakdown();
    const total = state.shifts.reduce((sum, s) => sum + (Number(s.hours) || 0), 0);
    $('month-total').textContent = Math.round(total * 100) / 100;
  } catch (err) {
    if (!hadCache) showToast(err.message || 'שגיאה בטעינת החודש');
  }
}

function renderShifts() {
  const list = $('shifts-list');
  list.innerHTML = '';
  $('shifts-empty').classList.toggle('hidden', state.shifts.length > 0);

  state.shifts.forEach((shift, index) => {
    const card = document.createElement('div');
    card.className = 'shift-card';
    card.style.animationDelay = Math.min(index * 0.04, 0.5) + 's';

    const d = shift.dateStr ? new Date(shift.dateStr) : null;
    const dayNum = shift.dateStr ? shift.dateStr.split('-')[2] : '-';
    const dayName = d && !isNaN(d) ? DAY_NAMES[d.getDay()] : '';
    const isProtected = (shift.notes || '').includes('***');
    const isSplit = shift.dayType === 'משמרת מפוצלת';
    const timeLine = isSplit
      ? `${shift.startTime || ''}-${shift.endTime || ''} + ${shift.entry2 || ''}-${shift.exit2 || ''}${shift.breakType ? ' (' + escapeHtml(shift.breakType) + ')' : ''}`
      : `${shift.startTime || ''}${shift.startTime && shift.endTime ? ' - ' : ''}${shift.endTime || ''}`;

    card.innerHTML = `
      <div class="shift-date-block">
        <div class="shift-date-num">${dayNum}</div>
        <div class="shift-date-day">${dayName}</div>
      </div>
      <div class="shift-details">
        <div class="shift-type ${isProtected ? 'protected' : ''}">${shift.dayType || 'רגיל'}</div>
        <div class="shift-time">${timeLine} ${shift.workplace ? '· ' + shift.workplace : ''}</div>
        ${shift.notes ? `<div class="shift-notes">${escapeHtml(shift.notes)}</div>` : ''}
      </div>
      <div class="shift-hours">${shift.hours ?? ''}</div>
    `;
    card.addEventListener('click', () => openShiftModal(shift.dateStr, shift));
    list.appendChild(card);
  });
}

// ---------------------------------------------------------------------
// כרטיס פירוט לפי סוג יום (סטטיסטיקה חודשית)
// ---------------------------------------------------------------------
function renderStatsBreakdown() {
  const card = $('stats-breakdown');
  const rowsEl = $('stats-breakdown-rows');

  if (!state.shifts.length) {
    card.classList.add('hidden');
    rowsEl.innerHTML = '';
    return;
  }

  const totals = {};
  state.shifts.forEach(shift => {
    const type = shift.dayType || 'רגיל';
    const hours = Number(shift.hours) || 0;
    totals[type] = (totals[type] || 0) + hours;
  });

  const types = Object.keys(totals).sort((a, b) => {
    const ai = DAY_TYPE_ORDER.indexOf(a);
    const bi = DAY_TYPE_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  rowsEl.innerHTML = types.map(type => `
    <div class="stats-row">
      <span class="stats-dot" style="background:${DAY_TYPE_COLORS[type] || '#999'}"></span>
      <span class="stats-name">${escapeHtml(type)}</span>
      <span class="stats-val">${formatHours(totals[type])} שעות</span>
    </div>
  `).join('');

  card.classList.remove('hidden');
}

function formatHours(n) {
  return Number.isInteger(n) ? n : Math.round(n * 100) / 100;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ממיר File שנבחר ב-input[type=file] ל-base64 טהור (בלי ה-"data:...;base64," בהתחלה)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDocDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch (e) {
    return '';
  }
}

$('prev-month').addEventListener('click', () => {
  if (state.isHr) return;
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
  refreshMonth();
});
$('next-month').addEventListener('click', () => {
  if (state.isHr) return;
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
  refreshMonth();
});

// ---------------------------------------------------------------------
// ייצוא החודש המוצג לגיליון Google Sheets אמיתי (אפשר לשלוח לליסה וכו')
// ---------------------------------------------------------------------
$('export-sheet-btn').addEventListener('click', async () => {
  // פותחים טאב ריק כבר עכשיו, בתוך אירוע הלחיצה עצמו - כדי שהדפדפן לא
  // יחסום אותו כפופ-אפ (הוא היה חוסם אם היינו פותחים אותו רק אחרי ה-await)
  const newTab = window.open('', '_blank');
  try {
    const monthKey = monthKeyOf(state.currentMonth);
    const result = await callApi('POST', 'exportMonthSheet', { code: state.code, monthKey });
    if (newTab) {
      newTab.location.href = result.url;
    } else {
      showToast('הקישור נוצר, אך הדפדפן חסם את פתיחת הטאב. אפשר לאשר פתיחת חלונות קופצים ולנסות שוב.');
    }
  } catch (err) {
    if (newTab) newTab.close();
    showToast(err.message || 'שגיאה בייצוא הגיליון');
  }
});

// ---------------------------------------------------------------------
// מודאל הוספה/עריכה של משמרת
// ---------------------------------------------------------------------
// סוגי יום שדורשים נימוק בכתב חובה כדי לשמור - זהה בדיוק לרשימה בשרת
// (REQUIRE_JUSTIFICATION_TYPES ב-Code.gs), חייבים להישאר מסונכרנים.
const REQUIRE_JUSTIFICATION_TYPES = new Set(['החלפה צרכי מערכת', 'קריאת פתע']);
let justifyBubbleInterval = null;

function updateJustifyBubble(type) {
  const bubble = $('justify-bubble');
  clearInterval(justifyBubbleInterval);
  if (!REQUIRE_JUSTIFICATION_TYPES.has(type)) {
    bubble.classList.add('hidden');
    return;
  }
  bubble.classList.remove('hidden');
  bubble.classList.remove('popping');
  // לולאת "בועה נעה עד שמתפוצצת ונעלמת, ואז מופיעה שוב" - תזכורת חוזרת
  // כל עוד הסוג נבחר, כדי שהתזכורת לא "תישכח" תוך כדי מילוי הטופס
  justifyBubbleInterval = setInterval(() => {
    bubble.classList.add('popping');
    setTimeout(() => {
      bubble.classList.remove('popping');
    }, 500);
  }, 3200);
}

function toggleTimeFields() {
  const type = $('shift-daytype').value;
  $('time-fields').classList.toggle('hidden', FIXED_HOUR_TYPES.has(type));
  $('split-fields').classList.toggle('hidden', type !== 'משמרת מפוצלת');
  updateJustifyBubble(type);

  const startInput = $('shift-start');
  const lockedStart = LOCKED_START_TIME[type];
  if (lockedStart) {
    // "המשך משמרת" - שעת הכניסה תמיד 07:00, המשתמש לא בוחר אותה בעצמו
    startInput.value = lockedStart;
    startInput.disabled = true;
    $('shift-start-label').textContent = 'שעת כניסה (קבועה 07:00)';
  } else {
    startInput.disabled = false;
    $('shift-start-label').textContent = type === 'משמרת מפוצלת' ? 'שעת כניסה - מקטע 1' : 'שעת כניסה';
  }
  $('shift-end-label').textContent = type === 'משמרת מפוצלת' ? 'שעת יציאה - מקטע 1 (לפני ההפסקה)' : 'שעת יציאה';
}
$('shift-daytype').addEventListener('change', toggleTimeFields);
$('shift-workplace').addEventListener('change', () => {
  $('shift-workplace-other').classList.toggle('hidden', $('shift-workplace').value !== 'אחר');
});

function openShiftModal(dateStr, existing) {
  state.editingDateStr = dateStr || null;
  $('shift-form-error').classList.add('hidden');
  $('shift-modal-title').textContent = existing ? 'עריכת דיווח' : 'דיווח חדש';
  $('shift-date').value = dateStr || defaultNewDate();
  $('shift-daytype').value = existing?.dayType || 'רגיל';
  $('shift-start').value = existing?.startTime || '';
  $('shift-end').value = existing?.endTime || '';
  $('shift-start2').value = existing?.entry2 || '';
  $('shift-end2').value = existing?.exit2 || '';
  $('shift-break-type').value = existing?.breakType || '';
  const existingWorkplace = existing?.workplace || '';
  if (existingWorkplace && !KNOWN_STATIONS.includes(existingWorkplace)) {
    $('shift-workplace').value = 'אחר';
    $('shift-workplace-other').value = existingWorkplace;
    $('shift-workplace-other').classList.remove('hidden');
  } else {
    $('shift-workplace').value = existingWorkplace;
    $('shift-workplace-other').value = '';
    $('shift-workplace-other').classList.add('hidden');
  }
  $('shift-notes').value = (existing?.notes || '').replace(/\*\*\*/g, '').trim();
  $('delete-shift-btn').classList.toggle('hidden', !existing);
  toggleTimeFields();
  $('shift-modal').classList.remove('hidden');
}

function defaultNewDate() {
  const today = new Date();
  if (today.getFullYear() === state.currentMonth.getFullYear() &&
      today.getMonth() === state.currentMonth.getMonth()) {
    return monthKeyOf(today) + '-' + String(today.getDate()).padStart(2, '0');
  }
  return monthKeyOf(state.currentMonth) + '-01';
}

function closeShiftModal() {
  $('shift-modal').classList.add('hidden');
}
$('close-shift-modal').addEventListener('click', closeShiftModal);
$('add-shift-btn').addEventListener('click', () => openShiftModal(null, null));

$('shift-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dateStr = $('shift-date').value;
  const dayType = $('shift-daytype').value;
  const startTime = LOCKED_START_TIME[dayType] || $('shift-start').value;
  const endTime = $('shift-end').value;
  const entry2 = $('shift-start2').value;
  const exit2 = $('shift-end2').value;
  const breakType = $('shift-break-type').value.trim();
  const workplaceSelect = $('shift-workplace').value;
  const workplace = workplaceSelect === 'אחר' ? $('shift-workplace-other').value.trim() : workplaceSelect;
  const notes = $('shift-notes').value.trim();
  const errBox = $('shift-form-error');
  errBox.classList.add('hidden');

  if (!dateStr) {
    errBox.textContent = 'יש לבחור תאריך';
    errBox.classList.remove('hidden');
    return;
  }
  if (!FIXED_HOUR_TYPES.has(dayType) && (!startTime || !endTime)) {
    errBox.textContent = 'יש להזין שעת כניסה ויציאה';
    errBox.classList.remove('hidden');
    return;
  }
  if (dayType === 'משמרת מפוצלת' && (!entry2 || !exit2)) {
    errBox.textContent = 'יש להזין גם את שעות מקטע 2 (אחרי ההפסקה)';
    errBox.classList.remove('hidden');
    return;
  }
  if (REQUIRE_JUSTIFICATION_TYPES.has(dayType) && !notes) {
    errBox.textContent = 'חובה לציין נימוק בכתב בשדה ההערות כדי לשמור "' + dayType + '"';
    errBox.classList.remove('hidden');
    // מפעילים את אפקט ההתפוצצות מיד, כדי שהתזכורת תהיה בולטת ברגע הזה
    const bubble = $('justify-bubble');
    bubble.classList.add('popping');
    setTimeout(() => bubble.classList.remove('popping'), 500);
    return;
  }

  try {
    // תמיד saveManualShift - זו הדרך היחידה שמבטיחה סימון ***
    // ומגינה על הדיווח מפני תיקון אוטומטי של המערכת.
    const params = {
      code: state.code, dateStr, startTime, endTime, notes, dayType, workplace,
      entry2, exit2, breakType
    };
    const result = await callApi('POST', 'saveManualShift', params);
    showToast(result.message || 'נשמר בהצלחה');
    closeShiftModal();
    await refreshMonthKeepingSelection(dateStr);
  } catch (err) {
    // אם זו שגיאת רשת אמיתית (לא שגיאת אימות מהשרת) - שומרים בתור
    // מקומי במקום לאבד את הדיווח, ומנסים לסנכרן אוטומטית כשהחיבור חוזר.
    if (isNetworkError(err)) {
      queueOfflineAction('saveManualShift', {
        code: state.code, dateStr, startTime, endTime, notes, dayType, workplace,
        entry2, exit2, breakType
      });
      showToast('אין חיבור כרגע - הדיווח נשמר ויישלח אוטומטית כשהחיבור יחזור');
      closeShiftModal();
    } else {
      errBox.textContent = err.message || 'שגיאה בשמירה';
      errBox.classList.remove('hidden');
    }
  }
});

async function refreshMonthKeepingSelection(dateStr) {
  const targetMonth = new Date(dateStr);
  if (!isNaN(targetMonth) &&
      (targetMonth.getFullYear() !== state.currentMonth.getFullYear() ||
       targetMonth.getMonth() !== state.currentMonth.getMonth())) {
    state.currentMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  }
  await refreshMonth();
}

$('delete-shift-btn').addEventListener('click', async () => {
  if (!state.editingDateStr) return;
  if (!confirm('למחוק את הדיווח ליום זה?')) return;
  try {
    const result = await callApi('POST', 'deleteShift', { code: state.code, dateStr: state.editingDateStr });
    showToast(result.message || 'נמחק בהצלחה');
    closeShiftModal();
    await refreshMonth();
  } catch (err) {
    showToast(err.message || 'שגיאה במחיקה');
  }
});

// ---------------------------------------------------------------------
// כלים תחתונים: בדיקת בעיות / תיקון / חישוב מחדש / ניקוי חודש
// ---------------------------------------------------------------------
$('check-issues-btn').addEventListener('click', async () => {
  try {
    const result = await callApi('GET', 'checkMyDataForIssues', { code: state.code });
    const body = $('issues-body');
    if (!result.issues || result.issues.length === 0) {
      body.innerHTML = '<div class="ok-msg">לא נמצאו בעיות בנתונים ✓</div>';
      $('fix-issues-btn').classList.add('hidden');
    } else {
      body.innerHTML = '<ul>' + result.issues.map(i => `<li>${escapeHtml(i)}</li>`).join('') + '</ul>';
      $('fix-issues-btn').classList.remove('hidden');
    }
    $('issues-modal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message || 'שגיאה בבדיקה');
  }
});
$('close-issues-modal').addEventListener('click', () => $('issues-modal').classList.add('hidden'));

$('fix-issues-btn').addEventListener('click', async () => {
  try {
    const result = await callApi('POST', 'fixMyDataIssues', { code: state.code });
    showToast(result.message || 'תוקן בהצלחה');
    $('issues-modal').classList.add('hidden');
    await refreshMonth();
  } catch (err) {
    showToast(err.message || 'שגיאה בתיקון');
  }
});

$('recalc-btn').addEventListener('click', async () => {
  try {
    const monthKey = monthKeyOf(state.currentMonth);
    const result = await callApi('POST', 'recalculateUserMonth', { code: state.code, monthKey });
    $('month-total').textContent = result.monthTotal ?? $('month-total').textContent;
    showToast(result.message || 'חושב מחדש');
  } catch (err) {
    showToast(err.message || 'שגיאה בחישוב');
  }
});

$('clear-month-btn').addEventListener('click', async () => {
  if (!confirm('לנקות את כל הדיווחים של החודש המוצג? פעולה זו לא ניתנת לביטול (דיווחים מוגנים ב-*** לא יימחקו).')) return;
  try {
    const result = await callApi('POST', 'clearMonth', { code: state.code });
    showToast(result.message || 'החודש נוקה');
    await refreshMonth();
  } catch (err) {
    showToast(err.message || 'שגיאה בניקוי');
  }
});

// ---------------------------------------------------------------------
// מצב אופליין
// ---------------------------------------------------------------------
function updateOnlineStatus() {
  $('offline-banner').classList.toggle('hidden', navigator.onLine);
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ---------------------------------------------------------------------
// תור פעולות לא-מקוון - דיווח משמרת שנכשל בגלל רשת נשמר מקומית ונשלח
// אוטומטית כשהחיבור חוזר. כדי שדיווח מאזור עם קליטה חלשה לא ילך לאיבוד.
// ---------------------------------------------------------------------
const OFFLINE_QUEUE_KEY = 'ds102_offline_queue';

// מבחין בין כשל רשת אמיתי (fetch לא הצליח בכלל - TypeError בדפדפנים
// סטנדרטיים) לבין שגיאה תקינה שהשרת החזיר בפועל (למשל נימוק חסר) -
// רק את הראשון תורים, את השני מציגים למשתמש כרגיל כדי שיתקן.
function isNetworkError(err) {
  return !navigator.onLine || err instanceof TypeError;
}

function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}
function saveOfflineQueueRaw(queue) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  updateOfflineQueueBanner();
}
function queueOfflineAction(action, params) {
  const queue = getOfflineQueue();
  queue.push({ action, params, queuedAt: new Date().toISOString() });
  saveOfflineQueueRaw(queue);
}
function updateOfflineQueueBanner() {
  const banner = $('offline-queue-banner');
  if (!banner) return;
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
    banner.textContent = queue.length + ' דיווחים ממתינים לסנכרון - יישלחו אוטומטית כשהחיבור יחזור';
  }
}

async function flushOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0 || !navigator.onLine) return;
  const remaining = [];
  let syncedCount = 0;

  for (const item of queue) {
    try {
      await callApi('POST', item.action, item.params);
      syncedCount++;
    } catch (err) {
      if (isNetworkError(err)) {
        remaining.push(item); // עדיין אין רשת בפועל - משאירים בתור לניסיון הבא
      }
      // שגיאה תקינה מהשרת (לא רשת) - לא ננסה שוב לבד, כדי לא להציף
      // בכשלונות חוזרים על אותה בעיה (למשל נימוק חסר). פשוט מוותרים
      // על הפריט הזה בשקט - זה מקרה נדיר וקצה, לא שכיח.
    }
  }

  saveOfflineQueueRaw(remaining);
  if (syncedCount > 0) {
    showToast(syncedCount + ' דיווחים סונכרנו בהצלחה');
    refreshMonth();
  }
}

window.addEventListener('online', flushOfflineQueue);
updateOfflineQueueBanner(); // בכל טעינת האפליקציה - מציג אם יש פעולות ממתינות משבתחילה

// ---------------------------------------------------------------------
// Service Worker
// ---------------------------------------------------------------------
let swRegistration = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => { swRegistration = reg; })
      .catch(() => {});
  });
}

// ---------------------------------------------------------------------
// Push Notifications (Firebase Cloud Messaging)
// ---------------------------------------------------------------------
// firebaseConfig הוא ציבורי בכוונה - מזהה לאיזה פרויקט הדפדפן מתחבר,
// לא מקנה שום גישה לשרת (בניגוד למפתח הפרטי שנשאר רק ב-Script Properties
// של ה-Apps Script). מוגדר גם ב-service-worker.js לצורך הודעות ברקע.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAAknVzs43Ruk9tuEV-dziswUNK16xFdWY",
  authDomain: "fire102report.firebaseapp.com",
  projectId: "fire102report",
  storageBucket: "fire102report.firebasestorage.app",
  messagingSenderId: "306754079111",
  appId: "1:306754079111:web:7aae9e1823df2da640ab22"
};
const FCM_VAPID_KEY = "BCMPwpgtlMtk0vzcrRwROJIVGlsyCxIS4iAUmdW8up3B4-fmvvmUqp9cRxh9GUQsIeg92eWbFA9uWteQztNdni4";

let firebaseMessaging = null;
function getFirebaseMessaging() {
  if (!firebaseMessaging && window.firebase) {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firebaseMessaging = firebase.messaging();
  }
  return firebaseMessaging;
}

async function enablePushNotifications() {
  if (!('Notification' in window)) {
    showToast('הדפדפן הזה לא תומך בהתראות');
    return;
  }
  if (!swRegistration) {
    showToast('עוד רגע - האפליקציה עדיין נטענת, נסה שוב בעוד כמה שניות');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('לא אושרה הרשאה להתראות');
      return;
    }
    const messaging = getFirebaseMessaging();
    if (!messaging) {
      showToast('שגיאה בטעינת שירות ההתראות');
      return;
    }
    const token = await messaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: swRegistration
    });
    if (!token) {
      showToast('לא הצלחתי לקבל טוקן התראות');
      return;
    }
    await callApi('POST', 'registerPushToken', { code: state.code, deviceToken: token });
    showToast('התראות הופעלו בהצלחה!');
  } catch (err) {
    showToast('שגיאה בהפעלת התראות: ' + (err.message || ''));
  }
}

$('enable-push-btn').addEventListener('click', enablePushNotifications);

// ---------------------------------------------------------------------
// צליל סירנה (Web Audio API, מסונתז - לא קובץ שמע חיצוני) - "כבאית":
// תדר עולה ויורד בלולאה, גבוה וצורם. חשוב: זה עובד רק כשהאפליקציה
// פתוחה בפועל (בזמן אמת, או ברגע שפותחים אותה ורואים התראה אישית
// ממתינה) - דפדפנים לא מאפשרים צליל מותאם אישית בהתראות רקע כשהאפליקציה
// סגורה לגמרי, זו מגבלה של הדפדפן עצמו ולא ניתן לעקוף אותה.
let sirenAudioCtx = null;
function playSirenSound(durationMs = 4000) {
  try {
    if (!sirenAudioCtx) sirenAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = sirenAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    gain.gain.value = 0.4;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const startTime = ctx.currentTime;
    const endTime = startTime + durationMs / 1000;
    let t = startTime;
    while (t < endTime) {
      osc.frequency.setValueAtTime(500, t);
      osc.frequency.linearRampToValueAtTime(1200, t + 0.5);
      osc.frequency.linearRampToValueAtTime(500, t + 1.0);
      t += 1.0;
    }
    osc.start(startTime);
    osc.stop(endTime);
  } catch (e) {
    // דפדפן שלא תומך ב-Web Audio, או שהמשתמש עוד לא "אישר" אינטראקציה
    // בעמוד (חלק מהדפדפנים חוסמים צליל אוטומטי לפני קליק ראשון) - לא קריטי
  }
}

// כשההודעה מגיעה בזמן שהאפליקציה פתוחה וברקע (לא סגורה) - מציגים Toast
// במקום להסתמך רק על התראת המערכת (שגם תופיע, דרך ה-Service Worker)
document.addEventListener('DOMContentLoaded', () => {
  const messaging = getFirebaseMessaging();
  if (messaging && messaging.onMessage) {
    messaging.onMessage(payload => {
      const title = payload.notification && payload.notification.title;
      const body = payload.notification && payload.notification.body;
      showToast((title ? title + ': ' : '') + (body || ''));
      if (payload.data && payload.data.urgent === 'true') {
        playSirenSound();
      }
    });
  }
});

// ---------------------------------------------------------------------
// המסמכים שלי (כבאי) - צפייה + העלאה
// ---------------------------------------------------------------------
async function loadMyDocuments() {
  try {
    const result = await callApi('GET', 'listUserDocuments', { code: state.code });
    renderDocList($('docs-to-me-list'), $('docs-to-me-empty'), result.toMe || [], true, false, null, true, 'toMe');
    renderDocList($('docs-from-me-list'), $('docs-from-me-empty'), result.fromMe || [], false, false, null, true, 'fromMe');
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת המסמכים');
  }
  try {
    const logResult = await callApi('GET', 'listMyDocumentSendLog', { code: state.code });
    const logList = $('doc-send-log-list');
    const logEmpty = $('doc-send-log-empty');
    logList.innerHTML = '';
    const log = logResult.log || [];
    if (log.length === 0) {
      logEmpty.classList.remove('hidden');
    } else {
      logEmpty.classList.add('hidden');
      log.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'shift-card';
        row.innerHTML = `
          <div class="shift-details">
            <div class="shift-type">${escapeHtml(entry.fileName)}</div>
            <div class="shift-time">אל ${escapeHtml(entry.recipientName || '')} · ${new Date(entry.sentAt).toLocaleString('he-IL')}</div>
          </div>
        `;
        logList.appendChild(row);
      });
    }
  } catch (err) {
    // כשל בטעינת הלוג לא קריטי - לא מציגים שגיאה בולטת
  }
}

// מוצא, בתוך אותה רשימת מסמכים, האם יש חתימה שמתאימה למסמך נתון -
// לפי תבנית השם הקבועה בשרת: "חתימה - {שם המסמך} - {תאריך שעה}.png"
function findSignatureForDoc(docs, docName) {
  const prefix = 'חתימה - ' + docName + ' - ';
  return docs.find(d => d.name.indexOf(prefix) === 0) || null;
}

function renderDocList(listEl, emptyEl, docs, allowSign, allowReject, rejectTargetCode, allowDelete, deleteDirection, allowEmailSelect) {
  listEl.innerHTML = '';
  if (docs.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  docs.forEach(d => {
    // מדלגים על רינדור קובץ חתימה כשורה נפרדת בפני עצמה - הוא יוצג
    // דרך כפתור "תעודת חתימה" על גבי המסמך המקורי שלו (למטה)
    if (d.name.indexOf('חתימה - ') === 0) return;

    const signature = findSignatureForDoc(docs, d.name);
    const card = document.createElement('div');
    card.className = 'shift-card';
    card.innerHTML = `
      <div class="shift-details" style="display:flex;align-items:flex-start;gap:8px">
        ${allowEmailSelect ? `<input type="checkbox" class="doc-email-select-checkbox" data-url="${escapeHtml(d.url)}" ${docEmailSelectedUrls.has(d.url) ? 'checked' : ''} style="width:17px;height:17px;cursor:pointer;margin-top:3px">` : ''}
        <div>
          <div class="shift-type">${d.name.indexOf('🔒 ') === 0 ? '🔒 ' + escapeHtml(d.name.slice(2)) : escapeHtml(d.name)}</div>
          <div class="shift-time">${formatDocDate(d.date)}${d.sentBy ? ' · מאת ' + escapeHtml(d.sentBy) : ''}${d.sentTo ? ' · אל ' + escapeHtml(d.sentTo) : ''}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="tool-btn doc-open-btn" data-url="${escapeHtml(d.url)}" style="width:auto;padding:8px 12px">פתח</button>
        ${signature ? `<button class="tool-btn doc-view-signed-btn" data-doc-url="${escapeHtml(d.url)}" data-sig-url="${escapeHtml(signature.url)}" data-name="${escapeHtml(d.name)}" style="width:auto;padding:8px 12px;font-weight:700">תעודת חתימה</button>` : ''}
        ${allowSign && !signature ? `<button class="tool-btn doc-sign-btn" data-name="${escapeHtml(d.name)}" style="width:auto;padding:8px 12px">חתום</button>` : ''}
        ${allowReject ? `<button class="tool-btn doc-reject-btn" data-code="${escapeHtml(rejectTargetCode)}" data-name="${escapeHtml(d.name)}" style="width:auto;padding:8px 12px;color:var(--danger)">דחה</button>` : ''}
        ${allowDelete && d.name.indexOf('🔒 ') !== 0 ? `<button class="tool-btn doc-delete-btn" data-name="${escapeHtml(d.name)}" data-direction="${deleteDirection}" style="width:auto;padding:8px 12px;color:var(--danger)">מחק</button>` : ''}
      </div>
    `;
    listEl.appendChild(card);
  });
}

function isPdfFile(name) {
  return /\.pdf$/i.test(name || '');
}

// קישורי Drive רגילים (file.getUrl()) הם דף צפייה מלא, לא ניתנים
// להטבעה ישירה בתוך <img>/<iframe>. ממירים לפורמט הטבעה: תמונה מקבלת
// uc?export=view, PDF מקבל /preview (זה שמתאים ל-iframe).
function driveDirectImageUrl(url) {
  const match = url && url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? ('https://drive.google.com/uc?export=view&id=' + match[1]) : url;
}
function drivePreviewUrl(url) {
  const match = url && url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? ('https://drive.google.com/file/d/' + match[1] + '/preview') : url;
}

function openSignedDocView(docUrl, sigUrl, docName) {
  $('signed-doc-view-title').textContent = docName;
  const container = $('signed-doc-view-doc-container');
  container.innerHTML = '';
  if (isPdfFile(docName)) {
    const iframe = document.createElement('iframe');
    iframe.src = drivePreviewUrl(docUrl);
    iframe.style.width = '100%';
    iframe.style.height = '360px';
    iframe.style.border = 'none';
    container.appendChild(iframe);
  } else {
    const img = document.createElement('img');
    img.src = driveDirectImageUrl(docUrl);
    img.style.width = '100%';
    img.style.display = 'block';
    img.alt = 'המסמך המקורי';
    container.appendChild(img);
  }
  $('signed-doc-view-signature').src = driveDirectImageUrl(sigUrl);
  $('signed-doc-view-open-original-btn').onclick = () => window.open(docUrl, '_blank');
  $('signed-doc-view-modal').classList.remove('hidden');
}
$('close-signed-doc-view-modal').addEventListener('click', () => $('signed-doc-view-modal').classList.add('hidden'));

document.addEventListener('click', async (e) => {
  const openBtn = e.target.closest('.doc-open-btn');
  if (openBtn) window.open(openBtn.dataset.url, '_blank');
  const viewSignedBtn = e.target.closest('.doc-view-signed-btn');
  if (viewSignedBtn) {
    openSignedDocView(viewSignedBtn.dataset.docUrl, viewSignedBtn.dataset.sigUrl, viewSignedBtn.dataset.name);
  }
  const signBtn = e.target.closest('.doc-sign-btn');
  if (signBtn) openSignatureModal(signBtn.dataset.name);
  const rejectBtn = e.target.closest('.doc-reject-btn');
  if (rejectBtn) {
    const reason = prompt('הסבר לדחיית המסמך "' + rejectBtn.dataset.name + '" (יישלח לשולח):');
    if (reason === null) return; // המשתמש ביטל
    if (!reason.trim()) {
      showToast('חובה לכתוב הסבר כדי לדחות מסמך');
      return;
    }
    try {
      const res = await callApi('POST', 'adminRejectDocument', {
        adminCode: state.code, targetCode: rejectBtn.dataset.code, fileName: rejectBtn.dataset.name, reason
      });
      showToast(res.message || 'המסמך נדחה');
      openUserDocsModal(userDocsTargetCode, $('user-docs-modal-title').textContent.replace('מסמכים - ', ''));
    } catch (err) {
      showToast(err.message || 'שגיאה בדחיית המסמך');
    }
  }
  const deleteBtn = e.target.closest('.doc-delete-btn');
  if (deleteBtn) {
    if (!confirm(`למחוק את "${deleteBtn.dataset.name}"? לא ניתן לשחזר.`)) return;
    try {
      await callApi('POST', 'deleteMyDocument', {
        code: state.code, fileName: deleteBtn.dataset.name, direction: deleteBtn.dataset.direction
      });
      loadMyDocuments();
    } catch (err) {
      showToast(err.message || 'שגיאה במחיקת המסמך');
    }
  }
});

$('documents-btn').addEventListener('click', () => {
  showScreen('screen-documents');
  loadMyDocuments();
});
$('documents-back-btn').addEventListener('click', () => showScreen('screen-app'));

$('upload-doc-btn').addEventListener('click', () => {
  $('doc-file-input').value = '';
  $('upload-doc-error').classList.add('hidden');
  const commanderOption = $('doc-recipient-select').querySelector('option[value="commander"]');
  if (commanderOption) commanderOption.disabled = !state.shiftTeam;
  $('doc-recipient-select').value = 'hr';
  $('upload-doc-modal').classList.remove('hidden');
});
$('close-upload-doc-modal').addEventListener('click', () => $('upload-doc-modal').classList.add('hidden'));
$('upload-doc-submit-btn').addEventListener('click', async () => {
  const file = $('doc-file-input').files[0];
  const docType = $('doc-type-select').value;
  const recipientType = $('doc-recipient-select').value;
  const errBox = $('upload-doc-error');
  if (!file) {
    errBox.textContent = 'יש לבחור קובץ';
    errBox.classList.remove('hidden');
    return;
  }
  const recipientLabel = recipientType === 'commander' ? 'מפקד/ת המשמרת שלך' : 'HR (ליסה)';
  if (!confirm(`לשלוח את "${file.name}" אל ${recipientLabel}?`)) return;
  try {
    const fileBase64 = await fileToBase64(file);
    const res = await callApi('POST', 'uploadUserDocument', {
      code: state.code, docType, fileBase64, fileName: file.name, mimeType: file.type, recipientType
    });
    showToast(res.message || 'המסמך הועלה בהצלחה');
    $('upload-doc-modal').classList.add('hidden');
    loadMyDocuments();
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בהעלאת המסמך';
    errBox.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// נהלים (כבאי)
// ---------------------------------------------------------------------
async function loadProcedures() {
  try {
    const result = await callApi('GET', 'listProcedures', { code: state.code });
    const list = $('procedures-list');
    const empty = $('procedures-empty');
    list.innerHTML = '';
    const files = result.files || [];
    if (files.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    files.forEach(f => {
      const card = document.createElement('div');
      card.className = 'shift-card';
      card.style.cursor = 'pointer';
      card.innerHTML = `<div class="shift-details"><div class="shift-type">${escapeHtml(f.name)}</div></div>`;
      card.addEventListener('click', () => window.open(f.url, '_blank'));
      list.appendChild(card);
    });
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת הנהלים');
  }
}
$('procedures-btn').addEventListener('click', () => {
  showScreen('screen-procedures');
  loadProcedures();
});
$('procedures-back-btn').addEventListener('click', () => showScreen('screen-app'));

// ---------------------------------------------------------------------
// חתימה דיגיטלית
// ---------------------------------------------------------------------
let signatureCtx = null;
let signatureDrawing = false;
let signatureDocName = '';

function setupSignatureCanvas() {
  const canvas = $('signature-canvas');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  signatureCtx = canvas.getContext('2d');
  signatureCtx.lineWidth = 2.5;
  signatureCtx.lineCap = 'round';
  signatureCtx.strokeStyle = '#232323';

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - r.left, y: point.clientY - r.top };
  };
  const start = (e) => {
    signatureDrawing = true;
    const p = getPos(e);
    signatureCtx.beginPath();
    signatureCtx.moveTo(p.x, p.y);
    e.preventDefault();
  };
  const move = (e) => {
    if (!signatureDrawing) return;
    const p = getPos(e);
    signatureCtx.lineTo(p.x, p.y);
    signatureCtx.stroke();
    e.preventDefault();
  };
  const end = () => { signatureDrawing = false; };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}

function openSignatureModal(docName) {
  signatureDocName = docName || '';
  $('signature-modal-title').textContent = 'חתימה על: ' + (docName || 'מסמך');
  $('signature-modal').classList.remove('hidden');
  setTimeout(setupSignatureCanvas, 50); // אחרי שהמודל נראה, כדי שהמידות יהיו נכונות
}
$('close-signature-modal').addEventListener('click', () => $('signature-modal').classList.add('hidden'));
$('signature-clear-btn').addEventListener('click', () => {
  if (signatureCtx) signatureCtx.clearRect(0, 0, $('signature-canvas').width, $('signature-canvas').height);
});
$('signature-save-btn').addEventListener('click', async () => {
  const canvas = $('signature-canvas');
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  try {
    let res;
    // שני מצבי החתימה של טופס אי החתמה - כל אחד סוגר את המודל שלו
    // ומרענן את התצוגה המתאימה, ולכן יוצא מוקדם ולא ממשיך למטה.
    // כל חתימה שנוצרת על הקנבס נשמרת גם כחתימה הקבועה של המשתמש,
    // כדי שבפעם הבאה יספיק לו לאשר במקום לצייר מחדש.
    if (!myStoredSignature) {
      try {
        await apiPost('saveMySignature', { code: state.code, signatureBase64: base64 });
        myStoredSignature = base64;
      } catch (e) { /* לא חוסם את החתימה עצמה */ }
    }

    if (signatureMode === 'store-only') {
      myStoredSignature = base64;
      $('signature-modal').classList.add('hidden');
      signatureMode = 'personal';
      renderSignatureButton();
      showToast('החתימה נשמרה');
      return;
    }
    if (signatureMode === 'missedpunch-employee') {
      res = await callApi('POST', 'submitMissedPunchReport', {
        code: state.code, reportId: missedPunchActiveId, signatureBase64: base64
      });
      $('signature-modal').classList.add('hidden');
      closeMpModal('mp-employee-modal');
      signatureMode = 'personal';
      showToast(res.message || 'הטופס נשלח לאישור ראש המשמרת');
      refreshMissedPunchUi();
      return;
    }
    if (signatureMode === 'missedpunch-commander') {
      res = await callApi('POST', 'commanderApproveMissedPunch', {
        code: state.code, reportId: missedPunchActiveId, signatureBase64: base64
      });
      $('signature-modal').classList.add('hidden');
      closeMpModal('mp-commander-modal');
      signatureMode = 'personal';
      showToast(res.message || 'הטופס אושר ונשלח למשאבי אנוש');
      openCommanderMissedPunchModal();
      return;
    }
    if (signatureMode === 'commander') {
      res = await callApi('POST', 'commanderSignHourReports', {
        commanderCode: state.code, targetCodes: Array.from(shiftTeamSelectedCodes), signatureBase64: base64
      });
      shiftTeamSelectedCodes.clear();
      updateShiftTeamBulkBar();
      loadShiftTeam();
    } else {
      res = await callApi('POST', 'submitDocumentSignature', {
        code: state.code, fileName: signatureDocName, signatureBase64: base64
      });
    }
    showToast(res.message || 'החתימה נשמרה');
    $('signature-modal').classList.add('hidden');
    signatureMode = 'personal'; // איפוס לברירת המחדל
  } catch (err) {
    showToast(err.message || 'שגיאה בשמירת החתימה');
  }
});

// ---------------------------------------------------------------------
// מנהל/ת צוות - מסמכי משתמש, שליחת קובץ, תזכורות, נהלים
// ---------------------------------------------------------------------
let userDocsTargetCode = null;
const docEmailSelectedUrls = new Set();

async function openUserDocsModal(code, name) {
  userDocsTargetCode = code;
  docEmailSelectedUrls.clear();
  updateDocEmailBar();
  $('user-docs-modal-title').textContent = 'מסמכים - ' + name;
  $('user-docs-modal').classList.remove('hidden');
  try {
    const result = await callApi('GET', 'adminListUserDocuments', { adminCode: state.code, targetCode: code });
    renderDocList($('user-docs-from-employee'), $('user-docs-from-employee'), result.fromEmployee || [], false, true, code, false, null, true);
    renderDocList($('user-docs-from-manager'), $('user-docs-from-manager'), result.fromManager || [], false, false, null, false, null, true);
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת מסמכים');
  }
}
$('close-user-docs-modal').addEventListener('click', () => $('user-docs-modal').classList.add('hidden'));

// בחירה מרובה לשליחה למייל
function updateDocEmailBar() {
  const bar = $('user-docs-email-bar');
  const count = docEmailSelectedUrls.size;
  $('user-docs-email-count').textContent = count + ' נבחרו';
  bar.classList.toggle('hidden', count === 0);
}
$('user-docs-modal').addEventListener('change', (e) => {
  const cb = e.target.closest('.doc-email-select-checkbox');
  if (!cb) return;
  if (cb.checked) docEmailSelectedUrls.add(cb.dataset.url);
  else docEmailSelectedUrls.delete(cb.dataset.url);
  updateDocEmailBar();
});
$('user-docs-email-clear-btn').addEventListener('click', () => {
  docEmailSelectedUrls.clear();
  document.querySelectorAll('.doc-email-select-checkbox').forEach(cb => { cb.checked = false; });
  updateDocEmailBar();
});
async function sendSelectedDocsByEmail(sendToHr) {
  if (docEmailSelectedUrls.size === 0) return;
  try {
    const res = await callApi('POST', 'emailDocumentsToMe', {
      code: state.code, fileUrls: Array.from(docEmailSelectedUrls), sendToHr
    });
    showToast(res.message || 'נשלח בהצלחה');
    docEmailSelectedUrls.clear();
    updateDocEmailBar();
    openUserDocsModal(userDocsTargetCode, $('user-docs-modal-title').textContent.replace('מסמכים - ', ''));
  } catch (err) {
    showToast(err.message || 'שגיאה בשליחה למייל');
  }
}
$('user-docs-email-send-btn').addEventListener('click', () => sendSelectedDocsByEmail(false));
$('user-docs-email-send-hr-btn').addEventListener('click', () => sendSelectedDocsByEmail(true));
$('user-docs-select-all-btn').addEventListener('click', () => {
  document.querySelectorAll('.doc-email-select-checkbox').forEach(cb => {
    cb.checked = true;
    docEmailSelectedUrls.add(cb.dataset.url);
  });
  updateDocEmailBar();
});

$('user-docs-send-btn').addEventListener('click', () => {
  $('send-doc-file-input').value = '';
  $('send-doc-error').classList.add('hidden');
  $('send-doc-modal').classList.remove('hidden');
});
$('close-send-doc-modal').addEventListener('click', () => $('send-doc-modal').classList.add('hidden'));
$('send-doc-submit-btn').addEventListener('click', async () => {
  const file = $('send-doc-file-input').files[0];
  const errBox = $('send-doc-error');
  if (!file) {
    errBox.textContent = 'יש לבחור קובץ';
    errBox.classList.remove('hidden');
    return;
  }
  const targetName = $('user-docs-modal-title').textContent.replace('מסמכים - ', '');
  if (!confirm(`לשלוח את "${file.name}" אל ${targetName}?`)) return;
  try {
    const fileBase64 = await fileToBase64(file);
    const res = await callApi('POST', 'adminUploadDocumentToUser', {
      adminCode: state.code, targetCode: userDocsTargetCode, fileBase64, fileName: file.name, mimeType: file.type,
      protectFromDeletion: $('send-doc-protect-checkbox').checked
    });
    showToast(res.message || 'הקובץ נשלח בהצלחה');
    $('send-doc-protect-checkbox').checked = false;
    $('send-doc-modal').classList.add('hidden');
    openUserDocsModal(userDocsTargetCode, targetName);
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בשליחת הקובץ';
    errBox.classList.remove('hidden');
  }
});

$('admin-upload-procedure-btn').addEventListener('click', () => {
  $('procedure-file-input').value = '';
  $('upload-procedure-error').classList.add('hidden');
  $('procedure-recipient-select').value = 'all';
  $('procedure-specific-user-select').classList.add('hidden');

  // אכלוס רשימת המשתמשים הספציפיים מתוך המטמון שכבר נטען למסך הניהול
  const userSelect = $('procedure-specific-user-select');
  userSelect.innerHTML = '';
  cachedAdminUsersList.filter(u => !u.isAdmin).forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.code;
    opt.textContent = u.name + (u.shiftTeam ? ' (' + u.shiftTeam + ')' : '');
    userSelect.appendChild(opt);
  });

  $('upload-procedure-modal').classList.remove('hidden');
});
$('procedure-recipient-select').addEventListener('change', () => {
  $('procedure-specific-user-select').classList.toggle('hidden', $('procedure-recipient-select').value !== 'specific');
});
$('close-upload-procedure-modal').addEventListener('click', () => $('upload-procedure-modal').classList.add('hidden'));
$('upload-procedure-submit-btn').addEventListener('click', async () => {
  const file = $('procedure-file-input').files[0];
  const errBox = $('upload-procedure-error');
  const recipientType = $('procedure-recipient-select').value;
  if (!file) {
    errBox.textContent = 'יש לבחור קובץ';
    errBox.classList.remove('hidden');
    return;
  }

  let confirmMsg, targetCode = null, targetName = '';
  if (recipientType === 'specific') {
    const sel = $('procedure-specific-user-select');
    targetCode = sel.value;
    targetName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
    if (!targetCode) {
      errBox.textContent = 'יש לבחור משתמש/ת מהרשימה';
      errBox.classList.remove('hidden');
      return;
    }
    confirmMsg = `לשלוח את "${file.name}" אל ${targetName}?`;
  } else {
    confirmMsg = `לשלוח את "${file.name}" בתפוצה לכל הכבאים?`;
  }
  if (!confirm(confirmMsg)) return;

  try {
    const fileBase64 = await fileToBase64(file);
    let res;
    if (recipientType === 'specific') {
      res = await callApi('POST', 'adminUploadDocumentToUser', {
        adminCode: state.code, targetCode, fileBase64, fileName: file.name, mimeType: file.type
      });
    } else {
      res = await callApi('POST', 'adminUploadProcedure', {
        adminCode: state.code, fileBase64, fileName: file.name, mimeType: file.type
      });
    }
    showToast(res.message || 'הועלה בהצלחה');
    $('upload-procedure-modal').classList.add('hidden');
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בהעלאה';
    errBox.classList.remove('hidden');
  }
});

let reminderTargetCode = null;
function openReminderModal(code, name) {
  reminderTargetCode = code;
  $('reminder-modal-title').textContent = 'תזכורת ל-' + name;
  $('reminder-datetime').value = '';
  $('reminder-text').value = '';
  $('reminder-error').classList.add('hidden');
  $('reminder-modal').classList.remove('hidden');
}
$('close-reminder-modal').addEventListener('click', () => $('reminder-modal').classList.add('hidden'));
$('reminder-submit-btn').addEventListener('click', async () => {
  const dt = $('reminder-datetime').value;
  const text = $('reminder-text').value.trim();
  const errBox = $('reminder-error');
  if (!dt || !text) {
    errBox.textContent = 'יש למלא תאריך/שעה ותוכן';
    errBox.classList.remove('hidden');
    return;
  }
  try {
    const res = await callApi('POST', 'adminCreateReminder', {
      adminCode: state.code, targetCode: reminderTargetCode, dateTimeISO: new Date(dt).toISOString(), message: text
    });
    showToast(res.message || 'התזכורת נקבעה');
    $('reminder-modal').classList.add('hidden');
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בקביעת התזכורת';
    errBox.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// התראות פתוחות (קריאת פתע / החלפה צרכי מערכת) - בליטה אדומה בדאשבורד
// ---------------------------------------------------------------------
async function loadOpenAlerts() {
  const section = $('open-alerts-section');
  const list = $('open-alerts-list');
  try {
    const result = await callApi('GET', 'listOpenAlerts', { code: state.code });
    const alerts = result.alerts || [];
    list.innerHTML = '';
    if (alerts.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    alerts.forEach(a => {
      const card = document.createElement('div');
      card.className = 'alert-card';
      card.innerHTML = `
        <div style="font-weight:700;color:var(--danger)">${escapeHtml(a.dayType)} - ${escapeHtml(a.employeeName)}</div>
        <div style="font-size:13px;margin-top:3px">${escapeHtml(a.date)} · נימוק: ${escapeHtml(a.notes || '')}</div>
        <button class="tool-btn alert-handled-btn" data-id="${escapeHtml(a.id)}" style="width:auto;padding:6px 12px;margin-top:8px">סמן כטופל</button>
      `;
      list.appendChild(card);
    });
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת ההתראות');
  }
}

$('open-alerts-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.alert-handled-btn');
  if (!btn) return;
  try {
    await callApi('POST', 'adminMarkAlertHandled', { adminCode: state.code, alertId: btn.dataset.id });
    loadOpenAlerts();
  } catch (err) {
    showToast(err.message || 'שגיאה בעדכון ההתראה');
  }
});

// ---------------------------------------------------------------------
// המראה
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// אישור דוח שעות חודשי (כבאי)
// ---------------------------------------------------------------------
$('confirm-month-btn').addEventListener('click', async () => {
  const monthKey = monthKeyOf(state.currentMonth);
  const label = `${MONTH_NAMES[state.currentMonth.getMonth()]} ${state.currentMonth.getFullYear()}`;
  if (!confirm(`לאשר שדוח השעות לחודש ${label} תקין? לאחר האישור ייווצר דוח סופי ולא ניתן לבטל את האישור.`)) return;
  try {
    const res = await callApi('POST', 'submitMonthlyConfirmation', { code: state.code, monthKey });
    showToast(res.message || 'הדוח אושר בהצלחה');
  } catch (err) {
    showToast(err.message || 'שגיאה באישור הדוח');
  }
});

// ---------------------------------------------------------------------
// התראות אישיות (לכל משתמש - למשל "קיבלת מסמך מליסה")
// ---------------------------------------------------------------------
const sirenPlayedAlertIds = new Set(); // בתוך הסשן הנוכחי בלבד - לא לחזור על אותה סירנה שוב ושוב

const toastedAlertIds = new Set(); // בתוך הסשן הנוכחי - כדי לא להציג את אותה "חלונית" שוב ושוב

function renderAlertCard(a) {
  const card = document.createElement('div');
  card.className = 'alert-card';
  const isConfirmable = (a.linkUrl || '').indexOf('confirmable:') === 0;
  const broadcastId = isConfirmable ? a.linkUrl.replace('confirmable:', '') : null;
  card.innerHTML = `
    <div style="font-weight:700;color:var(--danger)">${escapeHtml(a.title)}</div>
    <div style="font-size:13px;margin-top:3px">${escapeHtml(a.body || '')}</div>
    <div style="display:flex;gap:6px;margin-top:8px">
      ${isConfirmable ? `<button class="tool-btn broadcast-confirm-btn" data-broadcast-id="${escapeHtml(broadcastId)}" data-alert-id="${escapeHtml(a.id)}" style="width:auto;padding:6px 12px;font-weight:700">קראתי ואישרתי</button>` : ''}
      ${(a.linkUrl && !isConfirmable) ? `<button class="tool-btn personal-alert-open-btn" data-url="${escapeHtml(a.linkUrl)}" style="width:auto;padding:6px 12px">פתח</button>` : ''}
      <button class="tool-btn personal-alert-handled-btn" data-id="${escapeHtml(a.id)}" style="width:auto;padding:6px 12px">סמן כטופל</button>
    </div>
  `;
  return card;
}

async function loadPersonalAlerts() {
  const section = $('personal-alerts-section');
  const list = $('personal-alerts-list');
  const adminSection = $('admin-personal-alerts-section');
  const adminList = $('admin-personal-alerts-list');
  try {
    // רענון שקט - התראות נטענות ברקע ולא אמורות לחסום את המסך
    const result = await callApi('GET', 'listMyPersonalAlerts', { code: state.code }, true);
    applyPersonalAlerts(result.alerts || []);
  } catch (err) {
    // כשל בטעינת התראות אישיות לא אמור להציג שגיאה בולטת - זה לא קריטי
  }
}

// הציור עצמו, מופרד מהטעינה - כדי ש-bootstrap יוכל להזין אותו ישירות
// בלי בקשה נוספת לשרת.
function applyPersonalAlerts(alerts) {
  const section = $('personal-alerts-section');
  const list = $('personal-alerts-list');
  const adminSection = $('admin-personal-alerts-section');
  const adminList = $('admin-personal-alerts-list');
  {

    // באדג' חיווי - גם על 📁 (מסמכים) וגם על ⚙ (ניהול, ל-HR/מנהלים)
    const docAlertsCount = alerts.filter(a => (a.title || '').indexOf('📄') === 0).length;
    const docsBadge = $('documents-badge');
    if (docAlertsCount > 0) {
      docsBadge.textContent = docAlertsCount > 9 ? '9+' : String(docAlertsCount);
      docsBadge.classList.remove('hidden');
    } else {
      docsBadge.classList.add('hidden');
    }
    const adminBadge = $('admin-alerts-badge');
    if (alerts.length > 0) {
      adminBadge.textContent = alerts.length > 9 ? '9+' : String(alerts.length);
      adminBadge.classList.remove('hidden');
    } else {
      adminBadge.classList.add('hidden');
    }

    list.innerHTML = '';
    adminList.innerHTML = '';
    // אזור הכרטיסים האדום של admin-personal-alerts-section מוחלף עכשיו
    // לחלוטין בבועות (dash-bubbles-container) - לא מציגים את שניהם יחד
    adminSection.classList.add('hidden');
    if (alerts.length === 0) {
      section.classList.add('hidden');
      renderNotificationBubbles([]);
      return;
    }
    section.classList.remove('hidden');

    alerts.forEach(a => {
      // התראות "קריאת פתע" מתחילות בתגית 🚒🚨 (ראה triggerUrgentCallAlert
      // בשרת) - אם זו התראה כזו שעדיין לא השמענו עליה סירנה בסשן הזה,
      // מפעילים אותה עכשיו. זה בדיוק המקרה של "פספסתי את ה-Push, אבל
      // ברגע שפתחתי את האפליקציה זה מיד מצפצף".
      const isUrgent = (a.title || '').indexOf('🚒🚨') === 0;
      if (isUrgent && !sirenPlayedAlertIds.has(a.id)) {
        sirenPlayedAlertIds.add(a.id);
        playSirenSound();
      }
      // "חלונית" (Toast) בנוסף לכרטיס הקבוע - פעם אחת בלבד לכל התראה בסשן
      if (!toastedAlertIds.has(a.id)) {
        toastedAlertIds.add(a.id);
        showToast(a.title + (a.body ? ' - ' + a.body : ''));
      }
      list.appendChild(renderAlertCard(a));
      adminList.appendChild(renderAlertCard(a));
    });
    renderNotificationBubbles(alerts);
  }
}

function handlePersonalAlertsClick(e) {
  const openBtn = e.target.closest('.personal-alert-open-btn');
  if (openBtn) window.open(openBtn.dataset.url, '_blank');

  const confirmBtn = e.target.closest('.broadcast-confirm-btn');
  if (confirmBtn) {
    callApi('POST', 'confirmBroadcastRead', { code: state.code, broadcastId: confirmBtn.dataset.broadcastId })
      .then(() => callApi('POST', 'markPersonalAlertHandled', { code: state.code, alertId: confirmBtn.dataset.alertId }))
      .then(() => {
        showToast('האישור נשמר');
        loadPersonalAlerts();
      })
      .catch(err => showToast(err.message || 'שגיאה באישור הקריאה'));
    return;
  }

  const handledBtn = e.target.closest('.personal-alert-handled-btn');
  if (handledBtn) {
    callApi('POST', 'markPersonalAlertHandled', { code: state.code, alertId: handledBtn.dataset.id })
      .then(() => loadPersonalAlerts())
      .catch(err => showToast(err.message || 'שגיאה בעדכון ההתראה'));
  }
}
$('personal-alerts-list').addEventListener('click', handlePersonalAlertsClick);
$('admin-personal-alerts-list').addEventListener('click', handlePersonalAlertsClick);

// ---------------------------------------------------------------------
// קיצורי דרך ניתנים להתאמה אישית (HR / ראשי משמרות)
// ---------------------------------------------------------------------
const AVAILABLE_SHORTCUTS = [
  { id: 'broadcast_all', label: '📢 הודעה לכולם' },
  { id: 'add_manager', label: '👤 הוסף מנהל/ת צוות' },
  { id: 'upload_procedure', label: '📋 העלאת נוהל/מסמך' },
  { id: 'confirmable_broadcast', label: '✅ קרא וחתום' },
  { id: 'missed_punch', label: '📝 דוחות אי החתמה' },
  { id: 'create_missed_punch', label: '⚠️ פתיחת דוח אי החתמה' }
];

function getMyShortcuts() {
  try {
    return JSON.parse(localStorage.getItem('ds102_shortcuts_' + state.code) || '[]');
  } catch (e) {
    return [];
  }
}
function saveMyShortcuts(ids) {
  localStorage.setItem('ds102_shortcuts_' + state.code, JSON.stringify(ids));
}

function renderShortcutsBar() {
  const bar = $('shortcuts-bar');
  if (!state.isManager) {
    bar.classList.add('hidden');
    return;
  }
  const myIds = getMyShortcuts();
  bar.innerHTML = '';
  myIds.forEach(id => {
    const def = AVAILABLE_SHORTCUTS.find(s => s.id === id);
    if (!def) return;
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.textContent = def.label;
    btn.addEventListener('click', () => triggerShortcut(id));
    bar.appendChild(btn);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'tool-btn';
  addBtn.textContent = '+ הוסף קיצור דרך';
  addBtn.addEventListener('click', openAddShortcutModal);
  bar.appendChild(addBtn);
  bar.classList.remove('hidden');
}

function openAddShortcutModal() {
  const container = $('add-shortcut-options');
  const myIds = getMyShortcuts();
  container.innerHTML = '';
  const available = AVAILABLE_SHORTCUTS.filter(s => myIds.indexOf(s.id) === -1);
  if (available.length === 0) {
    container.innerHTML = '<div class="empty-state">כל קיצורי הדרך הזמינים כבר נוספו</div>';
  } else {
    available.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-install';
      btn.style.marginBottom = '8px';
      btn.style.width = '100%';
      btn.textContent = s.label;
      btn.addEventListener('click', () => {
        const ids = getMyShortcuts();
        ids.push(s.id);
        saveMyShortcuts(ids);
        $('add-shortcut-modal').classList.add('hidden');
        renderShortcutsBar();
      });
      container.appendChild(btn);
    });
  }
  $('add-shortcut-modal').classList.remove('hidden');
}
$('close-add-shortcut-modal').addEventListener('click', () => $('add-shortcut-modal').classList.add('hidden'));

function triggerShortcut(id) {
  if (id === 'broadcast_all') {
    adminMessageTarget = null;
    $('admin-message-modal-title').textContent = 'הודעה לכולם';
    $('admin-message-text').value = '';
    $('admin-message-error').classList.add('hidden');
    $('admin-message-modal').classList.remove('hidden');
  } else if (id === 'add_manager') {
    $('admin-add-manager-btn').click();
  } else if (id === 'upload_procedure') {
    $('admin-upload-procedure-btn').click();
  } else if (id === 'confirmable_broadcast') {
    openConfirmableBroadcastModal();
  } else if (id === 'missed_punch') {
    openCommanderMissedPunchModal();
  } else if (id === 'create_missed_punch') {
    openCreateMissedPunchModal();
  }
}

// ---------------------------------------------------------------------
// קריאה עם אישור קריאה
// ---------------------------------------------------------------------
async function openConfirmableBroadcastModal() {
  const sel = $('confirmable-broadcast-targets');
  sel.innerHTML = '';
  try {
    const result = await callApi('GET', 'adminListUsers', { code: state.code });
    (result.users || []).filter(u => !u.isAdmin).forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.code;
      opt.textContent = u.name;
      sel.appendChild(opt);
    });
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת רשימת המשתמשים');
  }
  $('confirmable-broadcast-text').value = '';
  $('confirmable-broadcast-error').classList.add('hidden');
  $('confirmable-broadcast-modal').classList.remove('hidden');
}
$('close-confirmable-broadcast-modal').addEventListener('click', () => $('confirmable-broadcast-modal').classList.add('hidden'));
$('confirmable-broadcast-send-btn').addEventListener('click', async () => {
  const sel = $('confirmable-broadcast-targets');
  const targetCodes = Array.from(sel.selectedOptions).map(o => o.value);
  const text = $('confirmable-broadcast-text').value.trim();
  const errBox = $('confirmable-broadcast-error');
  if (targetCodes.length === 0) {
    errBox.textContent = 'יש לבחור לפחות נמען אחד';
    errBox.classList.remove('hidden');
    return;
  }
  if (!text) {
    errBox.textContent = 'יש להזין תוכן להודעה';
    errBox.classList.remove('hidden');
    return;
  }
  try {
    const res = await callApi('POST', 'sendConfirmableBroadcast', {
      fromCode: state.code, targetCodes, message: text
    });
    showToast(res.message || 'השידור נשלח');
    $('confirmable-broadcast-modal').classList.add('hidden');
    if (res.broadcastId) openBroadcastStatusModal(res.broadcastId);
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בשיגור';
    errBox.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// יומן אירועים - יש שני יעדים אפשריים: המסך הנפרד (calendar-*, לראשי
// משמרות שמגיעים דרך הכפתור) והגרסה המוטמעת ישירות במסך הכניסה של HR
// (dash-calendar-*) - שניהם חולקים את אותו state ואותו נתונים.
// ---------------------------------------------------------------------
const calendarState = {
  currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  allEvents: [],
  categoryFilter: '',
  selectedDateStr: null
};

const HEBREW_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HEBREW_MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const CALENDAR_TARGETS = []; // אילו קידומות פעילות במסך הנוכחי - נבדק דינמית לפי מה שקיים ב-DOM

function activeCalendarPrefixes() {
  return ['calendar-', 'dash-calendar-'].filter(p => document.getElementById(p + 'grid'));
}

$('calendar-btn').addEventListener('click', () => {
  showScreen('screen-calendar');
  loadCalendarEvents();
});
$('calendar-back-btn').addEventListener('click', () => showScreen(state.isHr ? 'screen-admin' : 'screen-app'));

async function loadCalendarEvents() {
  try {
    const result = await callApi('GET', 'listMyEvents', { code: state.code });
    calendarState.allEvents = result.events || [];

    ['calendar-category-filter', 'dash-calendar-category-filter'].forEach(id => {
      const sel = $(id);
      if (sel && sel.options.length <= 1) {
        (result.categories || []).forEach(c => {
          const opt = document.createElement('option'); opt.value = c; opt.textContent = c;
          sel.appendChild(opt);
        });
      }
    });
    const catSel = $('event-category-input');
    if (catSel && catSel.options.length === 0) {
      (result.categories || []).forEach(c => {
        const opt = document.createElement('option'); opt.value = c; opt.textContent = c;
        catSel.appendChild(opt);
      });
    }

    ['calendar-distribute-btn', 'dash-calendar-distribute-btn'].forEach(id => {
      const btn = $(id);
      if (btn) btn.classList.toggle('hidden', !state.shiftTeam);
    });
    renderCalendarGrid();
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת היומן');
  }
}

function renderCalendarGrid() {
  activeCalendarPrefixes().forEach(prefix => renderCalendarGridInto(prefix));
}

function renderCalendarGridInto(prefix) {
  const month = calendarState.currentMonth;
  const titleLabel = $(prefix + 'month-label');
  if (titleLabel) titleLabel.textContent = HEBREW_MONTH_NAMES[month.getMonth()] + ' ' + month.getFullYear();

  const dayNamesEl = $(prefix + 'day-names');
  if (dayNamesEl) dayNamesEl.innerHTML = HEBREW_DAY_NAMES.map(d => `<div>${d}</div>`).join('');

  const filtered = calendarState.allEvents.filter(e =>
    !calendarState.categoryFilter || e.category === calendarState.categoryFilter
  );

  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const startOffset = firstDay.getDay(); // 0=ראשון

  const grid = $(prefix + 'grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < startOffset; i++) {
    grid.appendChild(document.createElement('div'));
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = month.getFullYear() + '-' + String(month.getMonth() + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dayEvents = filtered.filter(e => e.eventDate && e.eventDate.indexOf(dateStr) === 0);

    const cell = document.createElement('div');
    cell.style.cssText = 'min-height:78px;border:1px solid var(--border);border-radius:8px;padding:6px;cursor:pointer;background:#fff' + (dateStr === todayStr ? ';border-color:var(--brand);border-width:2px' : '');
    cell.innerHTML = `
      <div style="font-size:22px;font-weight:800;text-align:center">${d}</div>
      <div style="display:flex;flex-direction:column;gap:2px;margin-top:2px">
        ${dayEvents.slice(0, 2).map(e => `<div style="background:${e.color};color:#fff;border-radius:4px;padding:1px 3px;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.icon}</div>`).join('')}
        ${dayEvents.length > 2 ? `<div style="font-size:9px;color:var(--text-muted)">+${dayEvents.length - 2}</div>` : ''}
      </div>
    `;
    cell.addEventListener('click', () => showCalendarDayEvents(prefix, dateStr, dayEvents));
    grid.appendChild(cell);
  }
}

function showCalendarDayEvents(prefix, dateStr, dayEvents) {
  calendarState.selectedDateStr = dateStr;
  const list = $(prefix + 'day-events-list');
  if (!list) return;
  if (dayEvents.length === 0) {
    list.innerHTML = `<div class="empty-state">אין אירועים ב-${dateStr}</div>`;
    return;
  }
  list.innerHTML = `<div class="stats-card-title" style="margin-bottom:8px">אירועי ${dateStr}</div>` + dayEvents.map(e => `
    <div class="shift-card">
      <div class="shift-details">
        <div class="shift-type">${e.icon} ${escapeHtml(e.title)}</div>
        <div class="shift-time">${new Date(e.eventDate).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} · ${escapeHtml(e.category)}</div>
      </div>
      <button class="tool-btn calendar-delete-event-btn" data-id="${escapeHtml(e.id)}" style="width:auto;padding:8px 12px;color:var(--danger)">מחק</button>
    </div>
  `).join('');
}

async function handleCalendarDeleteClick(e) {
  const btn = e.target.closest('.calendar-delete-event-btn');
  if (!btn) return;
  if (!confirm('למחוק את האירוע?')) return;
  try {
    await callApi('POST', 'deleteMyEvent', { code: state.code, eventId: btn.dataset.id });
    await loadCalendarEvents();
    document.querySelectorAll('[id$="calendar-day-events-list"]').forEach(el => { el.innerHTML = ''; });
  } catch (err) {
    showToast(err.message || 'שגיאה במחיקת האירוע');
  }
}
$('calendar-day-events-list').addEventListener('click', handleCalendarDeleteClick);
$('dash-calendar-day-events-list').addEventListener('click', handleCalendarDeleteClick);

function bindCalendarNav(prefix) {
  const prevBtn = $(prefix + 'prev-month');
  const nextBtn = $(prefix + 'next-month');
  const filterSel = $(prefix + 'category-filter');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    calendarState.currentMonth = new Date(calendarState.currentMonth.getFullYear(), calendarState.currentMonth.getMonth() - 1, 1);
    renderCalendarGrid();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    calendarState.currentMonth = new Date(calendarState.currentMonth.getFullYear(), calendarState.currentMonth.getMonth() + 1, 1);
    renderCalendarGrid();
  });
  if (filterSel) filterSel.addEventListener('change', (e) => {
    calendarState.categoryFilter = e.target.value;
    renderCalendarGrid();
  });
}
bindCalendarNav('calendar-');
bindCalendarNav('dash-calendar-');

function openAddEventModal() {
  $('event-title-input').value = '';
  $('event-datetime-input').value = '';
  document.querySelectorAll('.event-reminder-checkbox').forEach(cb => { cb.checked = false; });
  $('add-event-error').classList.add('hidden');
  $('add-event-modal').classList.remove('hidden');
}
$('calendar-add-event-btn').addEventListener('click', openAddEventModal);
$('dash-calendar-add-btn').addEventListener('click', openAddEventModal);

$('close-add-event-modal').addEventListener('click', () => $('add-event-modal').classList.add('hidden'));
$('add-event-submit-btn').addEventListener('click', async () => {
  const title = $('event-title-input').value.trim();
  const datetimeVal = $('event-datetime-input').value;
  const category = $('event-category-input').value;
  const offsetDaysList = Array.from(document.querySelectorAll('.event-reminder-checkbox:checked')).map(cb => Number(cb.value));
  const errBox = $('add-event-error');
  if (!title) {
    errBox.textContent = 'יש להזין כותרת';
    errBox.classList.remove('hidden');
    return;
  }
  if (!datetimeVal) {
    errBox.textContent = 'יש לבחור תאריך ושעה';
    errBox.classList.remove('hidden');
    return;
  }
  try {
    const res = await callApi('POST', 'createEventWithReminders', {
      code: state.code, title, eventDateISO: new Date(datetimeVal).toISOString(), offsetDaysList, category
    });
    showToast(res.message || 'האירוע נוצר');
    $('add-event-modal').classList.add('hidden');
    loadCalendarEvents();
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה ביצירת האירוע';
    errBox.classList.remove('hidden');
  }
});

async function handleDistributeCalendar() {
  const monthKey = calendarState.currentMonth.getFullYear() + '-' + String(calendarState.currentMonth.getMonth() + 1).padStart(2, '0');
  if (!confirm(`להפיץ את יומן החודש (${HEBREW_MONTH_NAMES[calendarState.currentMonth.getMonth()]}) לכל אנשי הצוות שלך?`)) return;
  try {
    const res = await callApi('POST', 'distributeCalendarToTeam', { code: state.code, monthKey });
    showToast(res.message || 'היומן הופץ');
  } catch (err) {
    showToast(err.message || 'שגיאה בהפצת היומן');
  }
}
$('calendar-distribute-btn').addEventListener('click', handleDistributeCalendar);
$('dash-calendar-distribute-btn').addEventListener('click', handleDistributeCalendar);

// ---------------------------------------------------------------------
// בועות סבון להתראות אישיות - מוצג במקום כרטיסים במסך הכניסה של HR
// ---------------------------------------------------------------------
function renderNotificationBubbles(alerts) {
  const container = $('dash-bubbles-container');
  if (!container) return;
  container.innerHTML = '';
  alerts.forEach(a => {
    const bubble = document.createElement('button');
    bubble.className = 'notif-bubble';
    bubble.innerHTML = `<span class="notif-bubble-text">${escapeHtml((a.title || '').replace(/^[^\s]+\s/, ''))}</span>`;
    bubble.addEventListener('click', () => popBubble(bubble, a));
    container.appendChild(bubble);
  });
}

function popBubble(bubbleEl, alert) {
  bubbleEl.classList.add('popping');
  setTimeout(() => {
    bubbleEl.remove();
    openBubbleAlertModal(alert);
  }, 280);
}

function openBubbleAlertModal(a) {
  $('bubble-alert-title').textContent = a.title;
  $('bubble-alert-body').textContent = a.body || '';
  const actions = $('bubble-alert-actions');
  actions.innerHTML = '';

  const isConfirmable = (a.linkUrl || '').indexOf('confirmable:') === 0;
  if (isConfirmable) {
    const broadcastId = a.linkUrl.replace('confirmable:', '');
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.textContent = 'קראתי ואישרתי';
    confirmBtn.addEventListener('click', async () => {
      try {
        await callApi('POST', 'confirmBroadcastRead', { code: state.code, broadcastId });
        await callApi('POST', 'markPersonalAlertHandled', { code: state.code, alertId: a.id });
        showToast('האישור נשמר');
        $('bubble-alert-modal').classList.add('hidden');
        loadPersonalAlerts();
      } catch (err) {
        showToast(err.message || 'שגיאה באישור');
      }
    });
    actions.appendChild(confirmBtn);
  } else {
    if (a.linkUrl) {
      const openBtn = document.createElement('button');
      openBtn.className = 'btn btn-install';
      openBtn.textContent = 'פתח';
      openBtn.addEventListener('click', () => window.open(a.linkUrl, '_blank'));
      actions.appendChild(openBtn);
    }
    const handledBtn = document.createElement('button');
    handledBtn.className = 'btn btn-primary';
    handledBtn.textContent = 'סמן כטופל';
    handledBtn.addEventListener('click', async () => {
      try {
        await callApi('POST', 'markPersonalAlertHandled', { code: state.code, alertId: a.id });
        $('bubble-alert-modal').classList.add('hidden');
        loadPersonalAlerts();
      } catch (err) {
        showToast(err.message || 'שגיאה בעדכון ההתראה');
      }
    });
    actions.appendChild(handledBtn);
  }

  $('bubble-alert-modal').classList.remove('hidden');
}
$('close-bubble-alert-modal').addEventListener('click', () => $('bubble-alert-modal').classList.add('hidden'));

// ---------------------------------------------------------------------
// מעקב אחר אישורי קריאה - "מי אישר ומי לא" לשידור ספציפי
// ---------------------------------------------------------------------
let currentBroadcastId = null;

async function openBroadcastStatusModal(broadcastId) {
  currentBroadcastId = broadcastId;
  $('broadcast-status-modal').classList.remove('hidden');
  await refreshBroadcastStatus();
}

async function refreshBroadcastStatus() {
  if (!currentBroadcastId) return;
  try {
    const res = await callApi('GET', 'getBroadcastConfirmationStatus', {
      fromCode: state.code, broadcastId: currentBroadcastId
    });
    $('broadcast-status-message').textContent = res.message || '';

    const confirmedEl = $('broadcast-status-confirmed');
    const notConfirmedEl = $('broadcast-status-not-confirmed');
    const confirmed = res.confirmed || [];
    const notConfirmed = res.notConfirmed || [];

    confirmedEl.innerHTML = confirmed.length === 0
      ? '<div class="empty-state">עדיין אף אחד לא אישר</div>'
      : confirmed.map(name => `<div class="shift-card"><div class="shift-details"><div class="shift-type">✅ ${escapeHtml(name)}</div></div></div>`).join('');

    notConfirmedEl.innerHTML = notConfirmed.length === 0
      ? '<div class="empty-state">כולם אישרו!</div>'
      : notConfirmed.map(name => `<div class="shift-card"><div class="shift-details"><div class="shift-type">⏳ ${escapeHtml(name)}</div></div></div>`).join('');
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת המעקב');
  }
}

$('close-broadcast-status-modal').addEventListener('click', () => {
  $('broadcast-status-modal').classList.add('hidden');
  currentBroadcastId = null;
});
$('broadcast-status-refresh-btn').addEventListener('click', refreshBroadcastStatus);


// =====================================================================
//  אי החתמת כרטיס + הצעות תיקון
// =====================================================================
//  כל ה-DOM כאן נבנה דינמית מתוך JS ולא ב-index.html, כדי שהוספת
//  הפיצ'רים האלה לא תדרוש שינוי במבנה ה-HTML הקיים.
// =====================================================================

let missedPunchActiveId = null;
let missedPunchActiveRows = [];

function mpModal(id, title) {
  let el = document.getElementById(id);
  if (el) {
    el.querySelector('.mp-title').textContent = title;
    el.classList.remove('hidden');
    return el.querySelector('.mp-body');
  }
  el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;' +
    'display:flex;align-items:flex-end;justify-content:center';
  el.innerHTML =
    '<div style="background:#fff;width:100%;max-width:640px;max-height:88vh;overflow:auto;' +
    'border-radius:18px 18px 0 0;padding:18px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
    '<div class="mp-title" style="font-weight:800;font-size:17px"></div>' +
    '<button class="mp-close" style="border:none;background:none;font-size:26px;' +
    'cursor:pointer;line-height:1;padding:0 6px">×</button></div>' +
    '<div class="mp-body"></div></div>';
  document.body.appendChild(el);
  el.querySelector('.mp-close').addEventListener('click', () => el.classList.add('hidden'));
  el.addEventListener('click', (ev) => { if (ev.target === el) el.classList.add('hidden'); });
  el.querySelector('.mp-title').textContent = title;
  return el.querySelector('.mp-body');
}

function closeMpModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function mpDateLabel(d) {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const p = d.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  return d;
}

// ---------------------------------------------------------------------
//  כבאי - כרטיס בדאשבורד + טופס מילוי
// ---------------------------------------------------------------------

function mpBanner() {
  let el = document.getElementById('mp-employee-banner');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'mp-employee-banner';
  el.className = 'hidden';
  el.style.cssText = 'margin:12px 0';
  const anchor = document.getElementById('personal-alerts-section');
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
  else document.getElementById('screen-app').prepend(el);
  return el;
}

async function refreshMissedPunchUi() {
  if (!state.code || state.isHr) return;
  const banner = mpBanner();
  try {
    const res = await apiGet('listMyMissedPunchReports', { code: state.code });
    applyMissedPunchReports((res && res.reports) || []);
  } catch (e) {
    // כשל בטעינה לא אמור להקפיץ שגיאה בולטת - זה לא חוסם שום דבר אחר
  }
}

function applyMissedPunchReports(reports) {
  const banner = mpBanner();
  {
    if (reports.length === 0) {
      banner.classList.add('hidden');
      banner.innerHTML = '';
      return;
    }
    banner.classList.remove('hidden');
    banner.innerHTML = reports.map(r =>
      '<div class="alert-card" style="margin-bottom:8px">' +
      '<div style="font-weight:800;color:var(--danger)">⚠️ טופס אי החתמת כרטיס</div>' +
      '<div style="font-size:13px;margin-top:3px">' +
      r.rows.length + ' תאריכים · ' + escapeHtml(r.monthKey || '') +
      ' · נפתח על ידי ' + escapeHtml(r.createdBy || '') + '</div>' +
      (r.rejectReason
        ? '<div style="font-size:13px;margin-top:5px;color:var(--danger)">הוחזר לתיקון: ' +
          escapeHtml(r.rejectReason) + '</div>'
        : '') +
      '<div style="font-size:12.5px;margin-top:4px;color:var(--text-muted)">' +
      escapeHtml(r.status) + '</div>' +
      (r.status === 'ממתין לאישור מפקד' ? '' :
        '<button class="tool-btn mp-open-btn" data-id="' + escapeHtml(r.id) +
        '" style="width:auto;padding:7px 14px;margin-top:9px;font-weight:700">מלא את הטופס</button>') +
      '</div>'
    ).join('');
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.mp-open-btn');
  if (btn) openEmployeeMissedPunchModal(btn.dataset.id);
});

async function openEmployeeMissedPunchModal(reportId) {
  try {
    const res = await callApi('GET', 'listMyMissedPunchReports', { code: state.code });
    const report = (res.reports || []).find(r => r.id === reportId);
    if (!report) { showToast('הדוח לא נמצא'); return; }
    missedPunchActiveId = reportId;
    missedPunchActiveRows = report.rows || [];
    renderEmployeeMissedPunchRows(report);
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת הטופס');
  }
}

function renderEmployeeMissedPunchRows(report) {
  const body = mpModal('mp-employee-modal', 'טופס אי החתמת כרטיס — ' + (report.monthKey || ''));
  body.innerHTML =
    '<div style="font-size:13.5px;color:var(--text-muted);line-height:1.6;margin-bottom:12px">' +
    'לכל תאריך יש למלא שעת כניסה, שעת יציאה והסבר מנומק. ' +
    'לחיצה על שורה פותחת אותה למילוי.</div>' +
    '<div id="mp-rows"></div>' +
    '<div id="mp-employee-error" class="hidden" style="color:var(--danger);' +
    'font-size:13.5px;margin:10px 0"></div>' +
    '<button id="mp-sign-btn" class="btn btn-primary" style="width:100%;margin-top:14px">' +
    'חתום ושלח לאישור ראש המשמרת</button>';

  drawMpRows();

  document.getElementById('mp-sign-btn').addEventListener('click', async () => {
    const errBox = document.getElementById('mp-employee-error');
    const missing = missedPunchActiveRows.filter(r => !r.entry || !r.exit || !String(r.reason || '').trim());
    if (missing.length > 0) {
      errBox.textContent = 'חסרים פרטים ב-' + missing.length + ' תאריכים. יש למלא כניסה, יציאה והסבר לכל שורה.';
      errBox.classList.remove('hidden');
      return;
    }
    errBox.classList.add('hidden');
    try {
      await callApi('POST', 'saveMissedPunchRows', {
        code: state.code, reportId: missedPunchActiveId, rows: missedPunchActiveRows
      });
      signWithStoredOrDraw('missedpunch-employee', 'טופס אי החתמת כרטיס', async () => {
        const r = await callApi('POST', 'submitMissedPunchReport', {
          code: state.code, reportId: missedPunchActiveId, signatureBase64: ''
        });
        closeMpModal('mp-employee-modal');
        showToast(r.message || 'הטופס נשלח לאישור ראש המשמרת');
        refreshMissedPunchUi();
      });
    } catch (err) {
      errBox.textContent = err.message || 'שגיאה בשמירה';
      errBox.classList.remove('hidden');
    }
  });
}

function drawMpRows() {
  const wrap = document.getElementById('mp-rows');
  if (!wrap) return;
  wrap.innerHTML = missedPunchActiveRows.map((r, i) => {
    // השעות מגיעות כבר מלאות מהדיווח הקיים - מה שחסר הוא ההסבר המנומק
    const done = String(r.reason || '').trim();
    return '<div class="shift-card mp-row" data-idx="' + i + '" style="cursor:pointer;' +
      'border-right:6px solid ' + (done ? 'var(--success,#2e7d32)' : 'var(--danger,#c62828)') + '">' +
      '<div class="shift-details"><div class="shift-type">' + mpDateLabel(r.date) +
      (done ? ' ✓' : '') + '</div>' +
      '<div class="shift-time">' +
      (r.entry || r.exit ? escapeHtml(r.entry || '--') + ' - ' + escapeHtml(r.exit || '--') : 'ללא שעות') +
      (r.missing ? ' · <b style="color:var(--danger)">' +
        (r.missing === 'entry' ? 'חסרה כניסה' :
         r.missing === 'exit' ? 'חסרה יציאה' : 'חסרות כניסה ויציאה') + '</b>' : '') +
      '</div>' +
      (r.reason ? '<div class="shift-notes">' + escapeHtml(r.reason) + '</div>' : '') +
      '</div></div>';
  }).join('');

  wrap.querySelectorAll('.mp-row').forEach(row => {
    row.addEventListener('click', () => openMpRowEditor(Number(row.dataset.idx)));
  });
}

function openMpRowEditor(idx) {
  const r = missedPunchActiveRows[idx];
  const body = mpModal('mp-row-modal', 'מילוי ' + mpDateLabel(r.date));
  body.innerHTML =
    '<label class="form-label" style="display:block;margin-bottom:4px">שעת כניסה</label>' +
    '<input id="mp-row-entry" type="time" value="' + (r.entry || '') + '" ' +
    'style="width:100%;padding:11px;font-size:16px;border:1px solid var(--border,#ccc);' +
    'border-radius:8px;margin-bottom:12px">' +
    '<label class="form-label" style="display:block;margin-bottom:4px">שעת יציאה</label>' +
    '<input id="mp-row-exit" type="time" value="' + (r.exit || '') + '" ' +
    'style="width:100%;padding:11px;font-size:16px;border:1px solid var(--border,#ccc);' +
    'border-radius:8px;margin-bottom:12px">' +
    '<label class="form-label" style="display:block;margin-bottom:4px">הסבר מנומק</label>' +
    '<textarea id="mp-row-reason" rows="4" placeholder="לדוגמה: יציאה לאירוע מבצעי בשעת הכניסה" ' +
    'style="width:100%;padding:11px;font-size:16px;border:1px solid var(--border,#ccc);' +
    'border-radius:8px;resize:vertical">' + (r.reason || '') + '</textarea>' +
    '<button id="mp-row-save" class="btn btn-primary" style="width:100%;margin-top:14px">שמור</button>';

  document.getElementById('mp-row-save').addEventListener('click', () => {
    missedPunchActiveRows[idx] = {
      date: r.date,
      missing: r.missing,
      entry: document.getElementById('mp-row-entry').value,
      exit: document.getElementById('mp-row-exit').value,
      reason: document.getElementById('mp-row-reason').value.trim()
    };
    closeMpModal('mp-row-modal');
    drawMpRows();
  });
}

// ---------------------------------------------------------------------
//  ראש משמרת - קיצור דרך לדוחות הממתינים
// ---------------------------------------------------------------------

async function openCommanderMissedPunchModal() {
  const body = mpModal('mp-commander-modal', 'דוחות אי החתמה ממתינים');
  body.innerHTML = '<div class="empty-state">טוען...</div>';
  try {
    const res = await callApi('GET', 'commanderListMissedPunch', { code: state.code });
    const reports = res.reports || [];
    if (reports.length === 0) {
      body.innerHTML = '<div class="empty-state">אין דוחות הממתינים לאישורך</div>';
      return;
    }
    body.innerHTML = reports.map(r =>
      '<div class="shift-card" style="flex-direction:column;align-items:stretch">' +
      '<div style="font-weight:800;font-size:15px">' + escapeHtml(r.empName) + '</div>' +
      '<div style="font-size:13px;color:var(--text-muted);margin-top:2px">' +
      escapeHtml(r.monthKey || '') + ' · ' + r.rows.length + ' תאריכים</div>' +
      '<div style="margin-top:8px;font-size:13.5px;line-height:1.7">' +
      r.rows.map(x =>
        '<div>· <b>' + mpDateLabel(x.date) + '</b> ' + escapeHtml(x.entry || '') + '-' +
        escapeHtml(x.exit || '') + ' — ' + escapeHtml(x.reason || '') + '</div>'
      ).join('') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
      '<button class="tool-btn mp-approve-btn" data-id="' + escapeHtml(r.id) +
      '" style="width:auto;padding:8px 14px;font-weight:700">אשר וחתום</button>' +
      '<button class="tool-btn mp-reject-btn" data-id="' + escapeHtml(r.id) +
      '" style="width:auto;padding:8px 14px;color:var(--danger)">דחה</button>' +
      '</div></div>'
    ).join('');

    body.querySelectorAll('.mp-approve-btn').forEach(b => {
      b.addEventListener('click', () => {
        missedPunchActiveId = b.dataset.id;
        signWithStoredOrDraw('missedpunch-commander', 'אישור טופס אי החתמה', async () => {
          const r = await callApi('POST', 'commanderApproveMissedPunch', {
            code: state.code, reportId: missedPunchActiveId, signatureBase64: ''
          });
          showToast(r.message || 'הטופס אושר ונשלח למשאבי אנוש');
          openCommanderMissedPunchModal();
        });
      });
    });

    body.querySelectorAll('.mp-reject-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const reason = prompt('נימוק לדחייה (יישלח לעובד):');
        if (reason === null) return;
        if (!reason.trim()) { showToast('חובה לציין נימוק'); return; }
        try {
          const res2 = await callApi('POST', 'commanderRejectMissedPunch', {
            code: state.code, reportId: b.dataset.id, reason
          });
          showToast(res2.message || 'הטופס הוחזר לעובד');
          openCommanderMissedPunchModal();
        } catch (err) {
          showToast(err.message || 'שגיאה בדחייה');
        }
      });
    });
  } catch (err) {
    body.innerHTML = '<div class="empty-state">' + escapeHtml(err.message || 'שגיאה') + '</div>';
  }
}

// ---------------------------------------------------------------------
//  HR - פתיחת דוח אי החתמה לעובד
// ---------------------------------------------------------------------

// ליסה בוחרת עובד וחודש, ואז מסמנת ביומן את הימים שחסרה בהם החתמה.
// לחיצה חוזרת על אותו יום מסובבת: כניסה ← יציאה ← שניהם ← ביטול.
const mpCreateState = { month: new Date(), selected: {} };
const MP_MISSING_CYCLE = ['entry', 'exit', 'both', null];
const MP_MISSING_SHORT = { entry: 'כניסה', exit: 'יציאה', both: 'כניסה+יציאה' };

async function openCreateMissedPunchModal() {
  const body = mpModal('mp-create-modal', 'פתיחת דוח אי החתמה');
  body.innerHTML = '<div class="empty-state">טוען רשימת עובדים...</div>';
  mpCreateState.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  mpCreateState.selected = {};

  try {
    const res = await callApi('GET', 'adminListUsers', { code: state.code });
    const users = (res.users || []).filter(u => !u.isAdmin);

    body.innerHTML =
      '<label class="form-label" style="display:block;margin-bottom:4px">עובד</label>' +
      '<select id="mp-create-user" style="width:100%;padding:11px;font-size:16px;' +
      'border:1px solid var(--border,#ccc);border-radius:8px;margin-bottom:14px">' +
      users.map(u => '<option value="' + escapeHtml(u.code) + '">' +
        escapeHtml(u.name) + '</option>').join('') + '</select>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<button id="mp-cal-prev" class="tool-btn" style="width:auto;padding:6px 14px">‹</button>' +
      '<div id="mp-cal-label" style="font-weight:800;font-size:15px"></div>' +
      '<button id="mp-cal-next" class="tool-btn" style="width:auto;padding:6px 14px">›</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;' +
      'text-align:center;font-size:12px;color:var(--text-muted);margin-bottom:4px">' +
      HEBREW_DAY_NAMES.map(d => '<div>' + d.slice(0, 1) + '</div>').join('') + '</div>' +
      '<div id="mp-cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px"></div>' +
      '<div style="font-size:12.5px;color:var(--text-muted);margin-top:8px;line-height:1.6">' +
      'לחיצה על יום מסמנת חסרה כניסה, שוב — יציאה, שוב — שניהם, שוב — ביטול.</div>' +
      '<div id="mp-create-summary" style="margin-top:10px;font-size:13.5px"></div>' +
      '<div id="mp-create-error" class="hidden" style="color:var(--danger);' +
      'font-size:13.5px;margin-top:10px"></div>' +
      '<button id="mp-create-submit" class="btn btn-primary" ' +
      'style="width:100%;margin-top:14px">שלח לעובד</button>';

    document.getElementById('mp-cal-prev').addEventListener('click', () => {
      mpCreateState.month = new Date(mpCreateState.month.getFullYear(),
        mpCreateState.month.getMonth() - 1, 1);
      drawMpCalendar();
    });
    document.getElementById('mp-cal-next').addEventListener('click', () => {
      mpCreateState.month = new Date(mpCreateState.month.getFullYear(),
        mpCreateState.month.getMonth() + 1, 1);
      drawMpCalendar();
    });

    document.getElementById('mp-create-submit').addEventListener('click', async () => {
      const errBox = document.getElementById('mp-create-error');
      const targetCode = document.getElementById('mp-create-user').value;
      const dates = Object.keys(mpCreateState.selected)
        .filter(d => mpCreateState.selected[d])
        .sort()
        .map(d => ({ date: d, missing: mpCreateState.selected[d] }));

      if (dates.length === 0) {
        errBox.textContent = 'יש לסמן לפחות יום אחד ביומן';
        errBox.classList.remove('hidden');
        return;
      }
      const monthKey = dates[0].date.slice(0, 7);
      try {
        const r = await callApi('POST', 'hrCreateMissedPunchReport', {
          hrCode: state.code, targetCode, monthKey, dates
        });
        showToast(r.message || 'הדוח נשלח');
        closeMpModal('mp-create-modal');
      } catch (err) {
        errBox.textContent = err.message || 'שגיאה ביצירת הדוח';
        errBox.classList.remove('hidden');
      }
    });

    drawMpCalendar();
  } catch (err) {
    body.innerHTML = '<div class="empty-state">' + escapeHtml(err.message || 'שגיאה') + '</div>';
  }
}

function drawMpCalendar() {
  const m = mpCreateState.month;
  const label = document.getElementById('mp-cal-label');
  if (label) label.textContent = HEBREW_MONTH_NAMES[m.getMonth()] + ' ' + m.getFullYear();

  const grid = document.getElementById('mp-cal-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const startOffset = new Date(m.getFullYear(), m.getMonth(), 1).getDay();
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  for (let i = 0; i < startOffset; i++) grid.appendChild(document.createElement('div'));

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = m.getFullYear() + '-' +
      String(m.getMonth() + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const missing = mpCreateState.selected[dateStr];

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.style.cssText = 'min-height:52px;border-radius:8px;cursor:pointer;padding:3px;' +
      'font-family:inherit;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:2px;' +
      (missing
        ? 'background:var(--danger,#c62828);color:#fff;border:2px solid var(--danger,#c62828)'
        : 'background:#fff;color:inherit;border:1px solid var(--border,#ddd)');
    cell.innerHTML = '<span style="font-size:16px;font-weight:700">' + d + '</span>' +
      (missing ? '<span style="font-size:9px">' + MP_MISSING_SHORT[missing] + '</span>' : '');

    cell.addEventListener('click', () => {
      const cur = mpCreateState.selected[dateStr] || null;
      const next = MP_MISSING_CYCLE[(MP_MISSING_CYCLE.indexOf(cur) + 1) % MP_MISSING_CYCLE.length];
      if (next) mpCreateState.selected[dateStr] = next;
      else delete mpCreateState.selected[dateStr];
      drawMpCalendar();
    });

    grid.appendChild(cell);
  }

  const summary = document.getElementById('mp-create-summary');
  if (summary) {
    const picked = Object.keys(mpCreateState.selected).sort();
    summary.innerHTML = picked.length === 0
      ? '<span style="color:var(--text-muted)">לא סומנו ימים</span>'
      : '<b>נבחרו ' + picked.length + ':</b> ' + picked.map(d =>
          mpDateLabel(d) + ' (' + MP_MISSING_SHORT[mpCreateState.selected[d]] + ')').join(' · ');
  }
}

// ---------------------------------------------------------------------
//  מנהל-על - הצעות תיקון אוטומטיות הממתינות לאישור
// ---------------------------------------------------------------------

async function loadFixProposals() {
  if (!state.isAdmin) return;
  let el = document.getElementById('fix-proposals-section');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fix-proposals-section';
    el.className = 'hidden';
    el.style.cssText = 'margin:12px 0';
    const anchor = document.getElementById('open-alerts-section');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
    else document.getElementById('screen-admin').prepend(el);
  }

  try {
    const res = await apiGet('listPendingProposals', { code: state.code });
    applyFixProposals((res && res.proposals) || []);
  } catch (e) {
    // לא חוסם שום דבר אחר במסך
  }
}

function applyFixProposals(items) {
  if (!state.isAdmin) return;
  const el = document.getElementById('fix-proposals-section');
  if (!el) return;
  {
    if (items.length === 0) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML =
      '<div class="stats-card-title" style="margin-bottom:8px">' +
      '🔧 הצעות תיקון ממתינות (' + items.length + ')</div>' +
      items.map(p =>
        '<div class="alert-card" style="margin-bottom:8px">' +
        '<div style="font-weight:800">' + escapeHtml(p.type) + ' — ' +
        escapeHtml(p.sheetName) + ', יום ' + escapeHtml(String(p.day)) + '</div>' +
        '<div style="font-size:13px;margin-top:5px">' +
        '<b>נוכחי:</b> ' + escapeHtml(String(p.currentValue || '(ריק)')) + '</div>' +
        '<div style="font-size:13px;margin-top:2px">' +
        '<b>מוצע:</b> ' + escapeHtml(String(p.proposedValue || '(ריקון)')) + '</div>' +
        '<div style="font-size:12.5px;margin-top:5px;color:var(--text-muted)">' +
        escapeHtml(p.reason || '') + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="tool-btn fix-approve-btn" data-id="' + escapeHtml(p.id) +
        '" style="width:auto;padding:7px 14px;font-weight:700">אשר תיקון</button>' +
        '<button class="tool-btn fix-reject-btn" data-id="' + escapeHtml(p.id) +
        '" style="width:auto;padding:7px 14px;color:var(--danger)">דחה</button>' +
        '</div></div>'
      ).join('');
  }
}

document.addEventListener('click', async (e) => {
  const approveBtn = e.target.closest('.fix-approve-btn');
  if (approveBtn) {
    if (!confirm('לאשר את התיקון? הנתון הנוכחי ישתנה, והשינוי יירשם ביומן השינויים.')) return;
    try {
      const r = await callApi('POST', 'approveProposal', {
        code: state.code, proposalId: approveBtn.dataset.id
      });
      showToast(r.message || 'התיקון בוצע');
      loadFixProposals();
    } catch (err) {
      showToast(err.message || 'שגיאה באישור');
    }
    return;
  }
  const rejectBtn = e.target.closest('.fix-reject-btn');
  if (rejectBtn) {
    try {
      const r = await callApi('POST', 'rejectProposal', {
        code: state.code, proposalId: rejectBtn.dataset.id
      });
      showToast(r.message || 'ההצעה נדחתה');
      loadFixProposals();
    } catch (err) {
      showToast(err.message || 'שגיאה בדחייה');
    }
  }
});


// =====================================================================
//  חתימה אישית שמורה
// =====================================================================
//  הכבאי חותם פעם אחת. מכאן כל טופס דורש ממנו רק "אשר חתימה",
//  והחתימה השמורה מודבקת אוטומטית במקום המיועד לה.

let myStoredSignature = '';
let myStoredSignatureAt = null;

async function loadMySignature() {
  if (!state.code) return;
  try {
    const res = await apiGet('getMySignature', { code: state.code });
    myStoredSignature = (res && res.signature) || '';
    myStoredSignatureAt = (res && res.savedAt) || null;
  } catch (e) {
    myStoredSignature = '';
  }
  renderSignatureButton();
}

// אם יש חתימה שמורה - מציג אישור עם תצוגה מקדימה. אם אין - פותח
// את הקנבס, והחתימה שתצויר תישמר אוטומטית גם לפעמים הבאות.
function signWithStoredOrDraw(mode, title, onConfirmed) {
  if (!myStoredSignature) {
    signatureMode = mode;
    openSignatureModal(title);
    return;
  }

  const body = mpModal('sig-confirm-modal', title);
  body.innerHTML =
    '<div style="font-size:13.5px;color:var(--text-muted);margin-bottom:10px">' +
    'החתימה השמורה שלך תופיע במקום המיועד לחתימה בטופס.</div>' +
    '<div style="border:1px solid var(--border,#ddd);border-radius:10px;padding:10px;' +
    'background:#fff;text-align:center">' +
    '<img src="data:image/png;base64,' + myStoredSignature +
    '" style="max-height:110px;max-width:100%">' +
    '</div>' +
    '<button id="sig-confirm-ok" class="btn btn-primary" ' +
    'style="width:100%;margin-top:14px">אישור חתימה</button>' +
    '<button id="sig-confirm-redraw" class="tool-btn" ' +
    'style="width:100%;margin-top:8px">חתום מחדש</button>';

  document.getElementById('sig-confirm-ok').addEventListener('click', async () => {
    closeMpModal('sig-confirm-modal');
    try {
      await onConfirmed();
    } catch (err) {
      showToast(err.message || 'שגיאה באישור');
    }
  });

  document.getElementById('sig-confirm-redraw').addEventListener('click', () => {
    closeMpModal('sig-confirm-modal');
    signatureMode = mode;
    openSignatureModal(title);
  });
}

// כפתור לניהול החתימה - נוסף לסרגל הכלים התחתון של כל משתמש
function renderSignatureButton() {
  if (state.isHr) return;
  let btn = document.getElementById('my-signature-btn');
  if (!btn) {
    const tools = document.querySelector('.bottom-tools');
    if (!tools) return;
    btn = document.createElement('button');
    btn.id = 'my-signature-btn';
    btn.className = 'tool-btn';
    btn.addEventListener('click', openMySignatureModal);
    tools.appendChild(btn);
  }
  btn.textContent = myStoredSignature ? '✍️ החתימה שלי' : '✍️ שמור חתימה';
}

function openMySignatureModal() {
  const body = mpModal('my-signature-modal', 'החתימה שלי');
  if (myStoredSignature) {
    let savedLabel = '';
    try {
      savedLabel = new Date(myStoredSignatureAt).toLocaleDateString('he-IL');
    } catch (e) { savedLabel = ''; }

    body.innerHTML =
      '<div style="font-size:13.5px;color:var(--text-muted);margin-bottom:10px">' +
      'זו החתימה שמופיעה על כל טופס שאתה מאשר' +
      (savedLabel ? '. נשמרה ב-' + savedLabel : '') + '.</div>' +
      '<div style="border:1px solid var(--border,#ddd);border-radius:10px;padding:10px;' +
      'background:#fff;text-align:center">' +
      '<img src="data:image/png;base64,' + myStoredSignature +
      '" style="max-height:120px;max-width:100%"></div>' +
      '<button id="sig-replace" class="btn btn-primary" ' +
      'style="width:100%;margin-top:14px">החלף חתימה</button>' +
      '<button id="sig-delete" class="tool-btn" ' +
      'style="width:100%;margin-top:8px;color:var(--danger)">מחק חתימה</button>';

    document.getElementById('sig-delete').addEventListener('click', async () => {
      if (!confirm('למחוק את החתימה השמורה? בפעם הבאה תתבקש לחתום מחדש.')) return;
      try {
        const r = await callApi('POST', 'deleteMySignature', { code: state.code });
        myStoredSignature = '';
        myStoredSignatureAt = null;
        closeMpModal('my-signature-modal');
        renderSignatureButton();
        showToast(r.message || 'החתימה נמחקה');
      } catch (err) {
        showToast(err.message || 'שגיאה במחיקה');
      }
    });
  } else {
    body.innerHTML =
      '<div style="font-size:13.5px;color:var(--text-muted);margin-bottom:10px">' +
      'עדיין לא שמרת חתימה. חתום פעם אחת, ומכאן כל טופס ידרוש ממך ' +
      'רק לאשר במקום לחתום מחדש.</div>' +
      '<button id="sig-replace" class="btn btn-primary" ' +
      'style="width:100%;margin-top:6px">חתום עכשיו</button>';
  }

  document.getElementById('sig-replace').addEventListener('click', () => {
    closeMpModal('my-signature-modal');
    signatureMode = 'store-only';
    openSignatureModal('החתימה שלי');
  });
}


// =====================================================================
//  כניסה מהירה — בקשה אחת + הצגה מיידית מהמטמון
// =====================================================================
//  הצוואר האמיתי אינו זמן הריצה בשרת אלא מספר הבקשות: כל בקשה
//  ל-Apps Script עולה כחצי שנייה עד שנייה וחצי בתקורה קבועה.
//  שני שינויים: הכניסה שולחת בקשה אחת במקום חמש, והמסך מצויר מיד
//  מהמטמון המקומי בלי לחכות בכלל לשרת.

function monthCacheKey(monthKey) {
  return 'ds102_month_' + state.code + '_' + monthKey;
}

function saveMonthToCache(monthKey, shifts) {
  try {
    localStorage.setItem(monthCacheKey(monthKey), JSON.stringify(shifts || []));
  } catch (e) { /* אחסון מלא - לא קריטי */ }
}

function renderMonthFromCache() {
  const monthKey = monthKeyOf(state.currentMonth);
  $('month-label').textContent =
    MONTH_NAMES[state.currentMonth.getMonth()] + ' ' + state.currentMonth.getFullYear();
  try {
    const raw = localStorage.getItem(monthCacheKey(monthKey));
    if (!raw) return false;
    state.shifts = JSON.parse(raw);
    renderShifts();
    renderStatsBreakdown();
    const total = state.shifts.reduce((sum, s) => sum + (Number(s.hours) || 0), 0);
    $('month-total').textContent = Math.round(total * 100) / 100;
    return true;
  } catch (e) {
    return false;
  }
}

async function loadBootstrap() {
  const monthKey = monthKeyOf(state.currentMonth);
  try {
    const res = await apiGet('bootstrap', { code: state.code, monthKey });
    if (!res || res.valid === false) return;

    if (Array.isArray(res.shifts)) {
      state.shifts = res.shifts;
      state.shifts.sort((a, b) => (a.dateStr || '').localeCompare(b.dateStr || ''));
      saveMonthToCache(monthKey, state.shifts);
      renderShifts();
      renderStatsBreakdown();
      const total = state.shifts.reduce((sum, s) => sum + (Number(s.hours) || 0), 0);
      $('month-total').textContent = Math.round(total * 100) / 100;
    }

    myStoredSignature = res.signature || '';
    myStoredSignatureAt = res.signatureAt || null;
    renderSignatureButton();

    if (Array.isArray(res.alerts)) applyPersonalAlerts(res.alerts);
    if (Array.isArray(res.missedPunch)) applyMissedPunchReports(res.missedPunch);
    if (Array.isArray(res.proposals)) applyFixProposals(res.proposals);
  } catch (e) {
    // אין רשת - מה שהוצג מהמטמון נשאר על המסך, וזה בדיוק הרצוי
  }
}


// =====================================================================
//  ניקוי מטמון ידני — פתרון עצמאי לתקיעות אחרי עדכון גרסה
// =====================================================================
//  כשעולה גרסה חדשה, דפדפן שנשאר עם Service Worker ישן יכול להחזיר
//  קבצים ותשובות שמורות ולהיראות "תקוע" או להחזיר 404. במקום להדריך
//  39 אנשים בטלפון איך מוחקים נתוני אתר - כפתור אחד עושה הכל.
//
//  הכפתור בולט בכוונה, אבל האישור מזהיר במפורש אם יש דיווחים
//  שממתינים לשליחה - ניקוי ימחק אותם, וזה הנזק היחיד האפשרי כאן.

function buildClearCacheButton() {
  const anchor = document.getElementById('version-indicator');
  if (!anchor || document.getElementById('clear-cache-btn')) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin:14px auto 0;max-width:420px;padding:0 16px';

  const btn = document.createElement('button');
  btn.id = 'clear-cache-btn';
  btn.type = 'button';
  btn.innerHTML = '🔄 האפליקציה תקועה? לחץ כאן לרענון מלא';
  btn.style.cssText =
    'width:100%;padding:14px;border-radius:12px;border:2px solid #C1272D;' +
    'background:#fff;color:#C1272D;font-size:15px;font-weight:700;' +
    'font-family:inherit;cursor:pointer;line-height:1.4';

  const hint = document.createElement('div');
  hint.textContent = 'מוחק את הזיכרון המקומי וטוען מחדש את הגרסה העדכנית';
  hint.style.cssText = 'text-align:center;font-size:12.5px;color:#777;margin-top:6px';

  wrap.appendChild(btn);
  wrap.appendChild(hint);
  anchor.parentNode.insertBefore(wrap, anchor);

  btn.addEventListener('click', clearAppCacheAndReload);
}

async function clearAppCacheAndReload() {
  // אזהרה על דיווחים שממתינים לשליחה - זה הדבר היחיד שהניקוי יכול
  // להרוס, ולכן הוא מוצג במפורש ולא נקבר בטקסט כללי.
  let pending = 0;
  try {
    pending = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]').length;
  } catch (e) { pending = 0; }

  let msg = 'לרענן את האפליקציה מחדש?\n\nהפעולה תמחק את הזיכרון המקומי ' +
    'ותטען את הגרסה העדכנית. תצטרך להזין את הקוד האישי שוב.';
  if (pending > 0) {
    msg = '⚠️ שים לב: יש ' + pending + ' דיווחים שממתינים לשליחה, והם יימחקו!\n\n' +
      'עדיף להתחבר לאינטרנט ולחכות שיישלחו לפני שמנקים.\n\nלהמשיך בכל זאת?';
  }
  if (!confirm(msg)) return;

  const btn = document.getElementById('clear-cache-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'מנקה...';
  }

  // 1. הסרת כל ה-Service Workers הרשומים
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) { /* ממשיכים לשלבים הבאים */ }

  // 2. מחיקת כל המטמונים
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) { /* ממשיכים */ }

  // 3. ניקוי האחסון המקומי
  try { localStorage.clear(); } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}

  // 4. טעינה מחדש עם פרמטר ייחודי, כדי שגם הדפדפן עצמו לא יגיש
  //    את ה-HTML מהמטמון שלו
  const base = location.href.split('?')[0].split('#')[0];
  location.replace(base + '?fresh=' + Date.now());
}

document.addEventListener('DOMContentLoaded', buildClearCacheButton);
buildClearCacheButton();

tryAutoLogin();

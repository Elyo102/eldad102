/* =====================================================================
 *  app.js — "דוח נוכחות כבאים"
 *  חזית PWA שמדברת עם Apps Script Web App דרך fetch().
 * ===================================================================== */

// !!! זו הכתובת שקיבלנו מהמשתמש - כבר מולאה, אין צורך לשנות !!!
// עודכן ל-Web App של הפרויקט הפרטי החדש (הפרדה מגיליון "סידור עבודה" של ליסה)
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbykXHT-HBpsiBw_pvFBxc3IYdH90bpkQavQIliC980YLDBSRK47pirTxSOGaFXgFM0i/exec'
};

// ⚙️ הגדרות Firebase להתראות פוש - מגיעות מ-Firebase Console > הגדרות
// הפרויקט > כללי > "האפליקציות שלך" > אפליקציית ווב (או יוצרים אחת אם
// אין). זה לא מידע סודי - זה מזהה ציבורי, בטוח לגמרי שיהיה גלוי בקוד
// הצד-לקוח (ככה Firebase בנוי לעבוד). ⚙️ VAPID_KEY מגיע מאותו מסך
// הגדרות > Cloud Messaging > "אישורי דחיפה באינטרנט" (Web Push
// certificates) > "צור זוג מפתחות". ההוראות המדויקות נשלחות בנפרד בצ'אט.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAAknVzs43Ruk9tuEV-dziswUNK16xFdWY',
  authDomain: 'fire102report.firebaseapp.com',
  projectId: 'fire102report',
  storageBucket: 'fire102report.firebasestorage.app',
  messagingSenderId: '306754079111',
  appId: '1:306754079111:web:7aae9e1823df2da640ab22'
};
// ⚠️ עדיין חסר - שלב הבא ב-Firebase Console: הגדרות פרויקט > Cloud
// Messaging > "Web Push certificates" > "Generate key pair"
const VAPID_KEY = 'BCMPwpgtlMtk0vzcrRwROJIVGlsyCxIS4iAUmdW8up3B4-fmvvmUqp9cRxh9GUQsIeg92eWbFA9uWteQztNdni4';

const DAY_NAMES = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

// סוגי יום שיש להם שעות קבועות (לא צריך שעת כניסה/יציאה)
const FIXED_HOUR_TYPES = new Set(['חופש', 'מחלה', 'מילואים', 'יטבתה']);

// סוגי יום שמאפשרים צירוף אישור (נשלח אוטומטית לליסה במשאבי אנוש)
const ATTACHMENT_TYPES = new Set(['מחלה', 'מילואים']);
// גודל קובץ מקסימלי לצירוף - מגבלה שמרנית כדי להישאר בטוח מתחת למגבלת
// המצורפים של Gmail/MailApp (25MB לכלל המייל, לא רק לקובץ)
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// צבע לכל סוג יום, לתצוגת הפירוט החודשי (כרטיס הסטטיסטיקה)
const DAY_TYPE_COLORS = {
  'רגיל': 'var(--c-regular)',
  'חופש': 'var(--c-vacation)',
  'מחלה': 'var(--c-sick)',
  'מילואים': 'var(--c-reserve)',
  'יטבתה': 'var(--c-yotvata)',
  'החלפה צרכי מערכת': 'var(--c-swap)',
  'המשך משמרת': 'var(--c-continued)'
};
const DAY_TYPE_ORDER = ['רגיל', 'חופש', 'מחלה', 'מילואים', 'יטבתה', 'החלפה צרכי מערכת', 'המשך משמרת'];

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
  ['screen-login', 'screen-register', 'screen-forgot', 'screen-app', 'screen-admin-login', 'screen-admin-dashboard'].forEach(s => {
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
  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error('שגיאת שרת (' + res.status + ')');
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

async function callApi(method, action, params) {
  setLoading(true);
  try {
    const result = method === 'GET' ? await apiGet(action, params) : await apiPost(action, params);
    if (result && result.success === false) {
      throw new Error(result.error || result.message || 'שגיאה לא ידועה');
    }
    return result;
  } finally {
    setLoading(false);
  }
}

// ---------------------------------------------------------------------
// אחסון מקומי (זוכר התחברות בין פתיחות)
// ---------------------------------------------------------------------
function saveSession(code, name) {
  localStorage.setItem('ds102_code', code);
  localStorage.setItem('ds102_name', name || '');
}
function loadSession() {
  return {
    code: localStorage.getItem('ds102_code'),
    name: localStorage.getItem('ds102_name')
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
      enterApp(result.code || saved.code, result.name || saved.name);
    } else {
      clearSession();
      showScreen('screen-login');
    }
  } catch (err) {
    // אין אינטרנט/שגיאת שרת - עדיין ניכנס עם המידע השמור, ברוח offline-first
    if (saved.code) {
      enterApp(saved.code, saved.name);
      showToast('לא הצלחתי לאמת מול השרת כרגע, עובד/ת במצב לא מקוון');
    } else {
      showScreen('screen-login');
    }
  }
}

function enterApp(code, name) {
  state.code = code;
  state.name = name;
  saveSession(code, name);
  $('user-name').textContent = name || 'שלום';
  const now = new Date();
  state.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  showScreen('screen-app');
  refreshMonth();
  refreshPushButtonUI();
  silentlyRefreshPushTokenIfEnabled();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('login-code').value.trim();
  $('login-error').classList.add('hidden');
  if (!code) return;
  try {
    const result = await callApi('GET', 'login', { code });
    if (result.valid) {
      enterApp(result.code || code, result.name);
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
// מסך ניהול (Admin) - אין session/טוקן, בדיוק כמו שאר המערכת: הסיסמה
// נשלחת מחדש בכל קריאה. שומרים אותה רק בזיכרון (משתנה JS), לא ב-
// localStorage - כדי שלא תישאר שמורה על המכשיר בין פתיחות. חוויית
// "מילוי אוטומטי" (Windows Hello / Face ID) מגיעה ממנהל הסיסמאות של
// הדפדפן/הטלפון על שדה הסיסמה, לא מאחסון בקוד עצמו.
// ---------------------------------------------------------------------
let adminPassword = null;
const adminState = { users: [], monthKey: null };

$('go-admin-login').addEventListener('click', () => showScreen('screen-admin-login'));

$('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('admin-password').value;
  const errBox = $('admin-login-error');
  errBox.classList.add('hidden');
  try {
    await callApi('POST', 'adminLogin', { password });
    adminPassword = password;
    $('admin-password').value = '';
    showScreen('screen-admin-dashboard');
    await loadAdminDashboard();
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בכניסה';
    errBox.classList.remove('hidden');
  }
});

async function loadAdminDashboard() {
  try {
    const result = await callApi('POST', 'getAdminDashboard', { password: adminPassword });
    adminState.users = result.users || [];
    adminState.monthKey = result.monthKey || '';
    renderAdminDashboard();
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת מסך הניהול');
    if (/סיסמ/.test(err.message || '')) {
      adminPassword = null;
      showScreen('screen-admin-login');
    }
  }
}

function renderAdminDashboard() {
  const users = adminState.users;

  const activeCount = users.filter(u => u.status === 'פעיל').length;
  const totalHours = users.reduce((sum, u) => sum + (Number(u.monthTotal) || 0), 0);
  const issuesCount = users.filter(u => (Number(u.issueCount) || 0) > 0).length;

  $('admin-summary').innerHTML = `
    <div class="admin-summary-item">
      <div class="admin-summary-val">${activeCount}</div>
      <div class="admin-summary-label">משתמשים פעילים</div>
    </div>
    <div class="admin-summary-item">
      <div class="admin-summary-val">${formatHours(totalHours)}</div>
      <div class="admin-summary-label">סה"כ שעות החודש</div>
    </div>
    <div class="admin-summary-item">
      <div class="admin-summary-val">${issuesCount}</div>
      <div class="admin-summary-label">משתמשים עם ממצאים</div>
    </div>
  `;

  const body = $('admin-table-body');
  if (!users.length) {
    body.innerHTML = '<tr><td colspan="7" class="admin-empty">אין משתמשים להצגה</td></tr>';
    return;
  }

  body.innerHTML = users.map(u => {
    const isActive = u.status === 'פעיל';
    const lastLogin = u.lastLoginDate ? escapeHtml(u.lastLoginDate + (u.lastLoginTime ? ' ' + u.lastLoginTime : '')) : '—';
    const issueCount = Number(u.issueCount) || 0;
    const issueBadge = issueCount > 0
      ? `<span class="admin-badge admin-badge-warn">${issueCount}</span>`
      : '<span class="admin-badge admin-badge-ok">0</span>';
    return `
      <tr>
        <td>${escapeHtml(u.name || '')}</td>
        <td>${escapeHtml(u.code || '')}</td>
        <td>${formatHours(Number(u.monthTotal) || 0)}</td>
        <td>${lastLogin}</td>
        <td>${issueBadge}</td>
        <td><span class="admin-badge ${isActive ? 'admin-badge-ok' : 'admin-badge-off'}">${escapeHtml(u.status || '')}</span></td>
        <td class="admin-actions-cell">
          <button type="button" class="admin-action-btn" data-action="toggle" data-code="${escapeHtml(u.code || '')}" data-active="${isActive ? '0' : '1'}">${isActive ? 'השבת' : 'הפעל'}</button>
          <button type="button" class="admin-action-btn" data-action="resend" data-code="${escapeHtml(u.code || '')}">שלח קוד</button>
          <button type="button" class="admin-action-btn" data-action="reset" data-code="${escapeHtml(u.code || '')}">שנה קוד</button>
          <button type="button" class="admin-action-btn" data-action="push" data-code="${escapeHtml(u.code || '')}">שלח הודעה</button>
        </td>
      </tr>
    `;
  }).join('');
}

$('admin-table-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('.admin-action-btn');
  if (!btn) return;
  const action = btn.dataset.action;
  const code = btn.dataset.code;

  if (action === 'push') {
    const user = adminState.users.find(u => String(u.code) === String(code));
    openPushComposeModal({ code, name: (user && user.name) || code });
    return;
  }

  try {
    if (action === 'toggle') {
      const active = btn.dataset.active === '1';
      if (!confirm(active
        ? `להפעיל מחדש את המשתמש עם קוד ${code}?`
        : `להשבית את המשתמש עם קוד ${code}? הוא לא יוכל להתחבר עד שיופעל מחדש.`)) return;
      const result = await callApi('POST', 'adminSetUserStatus', { password: adminPassword, code, active });
      showToast(result.message || 'עודכן בהצלחה');
      await loadAdminDashboard();
    } else if (action === 'resend') {
      if (!confirm(`לשלוח מחדש את הקוד האישי למייל הרשום של המשתמש ${code}?`)) return;
      const result = await callApi('POST', 'adminResendCode', { password: adminPassword, code });
      showToast(result.message || 'הקוד נשלח');
    } else if (action === 'reset') {
      const newCode = prompt('קוד אישי חדש (3-8 ספרות):');
      if (!newCode) return;
      const result = await callApi('POST', 'adminResetUserCode', { password: adminPassword, oldCode: code, newCode: newCode.trim() });
      showToast(result.message || 'הקוד עודכן');
      await loadAdminDashboard();
    }
  } catch (err) {
    showToast(err.message || 'שגיאה בביצוע הפעולה');
  }
});

$('admin-refresh-btn').addEventListener('click', loadAdminDashboard);

$('admin-logout-btn').addEventListener('click', () => {
  adminPassword = null;
  adminState.users = [];
  showScreen('screen-login');
});

// ---------------------------------------------------------------------
// שליחת התראות פוש מהמנהל (שידור לכולם, או הודעה אישית ממסך המשתמש
// בטבלה) - אותו מודאל משמש לשני המצבים, נבדל לפי pushComposeTarget.
// ---------------------------------------------------------------------
let pushComposeTarget = null; // null = שידור לכולם, {code, name} = הודעה אישית

function openPushComposeModal(target) {
  pushComposeTarget = target || null;
  $('push-compose-title').textContent = target ? ('הודעה אישית ל-' + target.name) : 'שידור לכולם';
  $('push-title').value = '';
  $('push-body').value = '';
  $('push-compose-error').classList.add('hidden');
  $('push-compose-modal').classList.remove('hidden');
}
$('close-push-compose-modal').addEventListener('click', () => $('push-compose-modal').classList.add('hidden'));
$('admin-broadcast-btn').addEventListener('click', () => openPushComposeModal(null));

$('push-compose-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('push-title').value.trim();
  const body = $('push-body').value.trim();
  const errBox = $('push-compose-error');
  errBox.classList.add('hidden');
  if (!title || !body) {
    errBox.textContent = 'יש למלא כותרת ותוכן';
    errBox.classList.remove('hidden');
    return;
  }
  try {
    const result = pushComposeTarget
      ? await callApi('POST', 'adminSendPushToUser', { password: adminPassword, code: pushComposeTarget.code, title, body })
      : await callApi('POST', 'adminBroadcastPush', { password: adminPassword, title, body });
    showToast(result.message || 'ההודעה נשלחה');
    $('push-compose-modal').classList.add('hidden');
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בשליחה';
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

  try {
    const [shifts, totalRes] = await Promise.all([
      callApi('GET', 'listShifts', { code: state.code, monthKey }),
      callApi('GET', 'getMonthlyTotal', { code: state.code, mKey: monthKey })
    ]);
    state.shifts = Array.isArray(shifts) ? shifts : (shifts.shifts || []);
    state.shifts.sort((a, b) => (a.dateStr || '').localeCompare(b.dateStr || ''));
    renderShifts();
    renderStatsBreakdown();
    $('month-total').textContent = (totalRes.totalHours ?? 0);
  } catch (err) {
    showToast(err.message || 'שגיאה בטעינת החודש');
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

    card.innerHTML = `
      <div class="shift-date-block">
        <div class="shift-date-num">${dayNum}</div>
        <div class="shift-date-day">${dayName}</div>
      </div>
      <div class="shift-details">
        <div class="shift-type ${isProtected ? 'protected' : ''}">${shift.dayType || 'רגיל'}</div>
        <div class="shift-time">${shift.startTime || ''}${shift.startTime && shift.endTime ? ' - ' : ''}${shift.endTime || ''} ${shift.workplace ? '· ' + shift.workplace : ''}</div>
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

$('prev-month').addEventListener('click', () => {
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
  refreshMonth();
});
$('next-month').addEventListener('click', () => {
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
    if (result.emailed) {
      showToast('הדוח נפתח, וגם נשלח למייל שלך');
    }
  } catch (err) {
    if (newTab) newTab.close();
    showToast(err.message || 'שגיאה בייצוא הגיליון');
  }
});

// ---------------------------------------------------------------------
// מודאל הוספה/עריכה של משמרת
// ---------------------------------------------------------------------
function toggleTimeFields() {
  const type = $('shift-daytype').value;
  $('time-fields').classList.toggle('hidden', FIXED_HOUR_TYPES.has(type));
  $('attachment-field').classList.toggle('hidden', !ATTACHMENT_TYPES.has(type));
}
$('shift-daytype').addEventListener('change', toggleTimeFields);

function openShiftModal(dateStr, existing) {
  state.editingDateStr = dateStr || null;
  $('shift-form-error').classList.add('hidden');
  $('shift-modal-title').textContent = existing ? 'עריכת דיווח' : 'דיווח חדש';
  $('shift-date').value = dateStr || defaultNewDate();
  $('shift-daytype').value = existing?.dayType || 'רגיל';
  $('shift-start').value = existing?.startTime || '';
  $('shift-end').value = existing?.endTime || '';
  $('shift-workplace').value = existing?.workplace || '';
  $('shift-notes').value = (existing?.notes || '').replace(/\*\*\*/g, '').trim();
  $('shift-attachment').value = ''; // תמיד מתחילים ריק - קובץ מצורף לא נשמר/מוצג מחדש בעריכה
  $('delete-shift-btn').classList.toggle('hidden', !existing);
  toggleTimeFields();
  $('shift-modal').classList.remove('hidden');
}

// קורא את הקובץ שנבחר כ-base64 (בלי ה-prefix "data:...;base64,") כדי
// שאפשר יהיה לשלוח אותו בגוף בקשת ה-POST הרגילה (text/plain, כמו כל
// שאר הקריאות ל-API - לא משתמשים ב-FormData/multipart בכוונה, כדי
// לא לשבור את מנגנון ה-CORS-preflight-avoidance הקיים).
function readFileAsBase64_(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const base64 = String(result).split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
    reader.readAsDataURL(file);
  });
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
  const startTime = $('shift-start').value;
  const endTime = $('shift-end').value;
  const workplace = $('shift-workplace').value.trim();
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

  // קובץ מצורף (אופציונלי) - רק לסוגי יום שרלוונטיים (מחלה/מילואים)
  let fileData = null, fileName = '', fileMimeType = '';
  if (ATTACHMENT_TYPES.has(dayType)) {
    const fileInput = $('shift-attachment');
    const file = fileInput.files && fileInput.files[0];
    if (file) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        errBox.textContent = 'הקובץ גדול מדי (מקסימום 5MB) - בחר קובץ קטן יותר';
        errBox.classList.remove('hidden');
        return;
      }
      try {
        fileData = await readFileAsBase64_(file);
        fileName = file.name;
        fileMimeType = file.type || 'application/octet-stream';
      } catch (err) {
        errBox.textContent = 'שגיאה בקריאת הקובץ המצורף';
        errBox.classList.remove('hidden');
        return;
      }
    }
  }

  try {
    // תמיד saveManualShift - זו הדרך היחידה שמבטיחה סימון ***
    // ומגינה על הדיווח מפני תיקון אוטומטי של המערכת.
    const result = await callApi('POST', 'saveManualShift', {
      code: state.code, dateStr, startTime, endTime, notes, dayType, workplace,
      fileData, fileName, fileMimeType
    });
    showToast(result.attachmentSent ? (result.message || 'נשמר בהצלחה') + ' - האישור התקבל ויועבר לליסה' : (result.message || 'נשמר בהצלחה'));
    closeShiftModal();
    await refreshMonthKeepingSelection(dateStr);
  } catch (err) {
    errBox.textContent = err.message || 'שגיאה בשמירה';
    errBox.classList.remove('hidden');
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
// Service Worker
// ---------------------------------------------------------------------
let swRegistration = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then((reg) => { swRegistration = reg; })
      .catch(() => {});
  });
}

// ---------------------------------------------------------------------
// התראות פוש (Firebase Cloud Messaging) - צד המשתמש
// שומרים דגל "התראות הופעלו" ב-localStorage (לא את הטוקן עצמו - אותו
// Firebase מנהל בעצמו במכשיר) כדי שהאייקון בכותרת ידע איזה מצב להראות
// כבר בטעינה הבאה, בלי לשאול את המשתמש שוב מיותר.
// ---------------------------------------------------------------------
let firebaseMessaging = null;

function pushEnabledLocally() {
  return localStorage.getItem('ds102_push_enabled') === '1';
}
function setPushEnabledLocally(on) {
  if (on) localStorage.setItem('ds102_push_enabled', '1');
  else localStorage.removeItem('ds102_push_enabled');
}

// מאתחל את Firebase Messaging בפעם הראשונה שצריך אותו בפועל (לא כבר
// בטעינת הדף) - ומחזיר null בשקט אם ה-SDK לא נטען או שההגדרות
// (FIREBASE_CONFIG) עדיין לא מולאו, כדי שהאפליקציה תמשיך לעבוד רגיל
// גם לפני שהתראות מוגדרות.
function initFirebaseMessaging_() {
  if (firebaseMessaging) return firebaseMessaging;
  if (typeof firebase === 'undefined' || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'CHANGE_ME') return null;
  firebase.initializeApp(FIREBASE_CONFIG);
  firebaseMessaging = firebase.messaging();
  return firebaseMessaging;
}

function refreshPushButtonUI() {
  const btn = $('push-toggle-btn');
  if (!btn || !('Notification' in window)) return;
  if (Notification.permission === 'denied') {
    btn.textContent = '🔕';
    btn.title = 'התראות חסומות בדפדפן - יש לאשר אותן בהגדרות האתר כדי להפעיל';
    btn.classList.remove('push-active');
  } else if (pushEnabledLocally() && Notification.permission === 'granted') {
    btn.textContent = '🔔';
    btn.title = 'התראות פעילות (לחיצה תכבה)';
    btn.classList.add('push-active');
  } else {
    btn.textContent = '🔔';
    btn.title = 'הפעלת התראות';
    btn.classList.remove('push-active');
  }
}

async function enablePush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    showToast('הדפדפן הזה לא תומך בהתראות');
    return;
  }
  const messaging = initFirebaseMessaging_();
  if (!messaging) {
    showToast('התראות עדיין לא הוגדרו באפליקציה');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast(permission === 'denied'
        ? 'ההתראות נחסמו - אפשר לאשר אותן בהגדרות האתר בדפדפן'
        : 'לא אושרה הרשאה להתראות');
      refreshPushButtonUI();
      return;
    }
    if (!swRegistration) swRegistration = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swRegistration });
    if (!token) throw new Error('לא התקבל טוקן התראות מהדפדפן');
    await callApi('POST', 'registerPushToken', { code: state.code, token });
    setPushEnabledLocally(true);
    showToast('התראות הופעלו בהצלחה');
  } catch (err) {
    showToast(err.message || 'שגיאה בהפעלת התראות');
  }
  refreshPushButtonUI();
}

async function disablePush() {
  try {
    const messaging = initFirebaseMessaging_();
    if (messaging) {
      try { await messaging.deleteToken(); } catch (e) { /* לא קריטי אם נכשל */ }
    }
    await callApi('POST', 'unregisterPushToken', { code: state.code });
    setPushEnabledLocally(false);
    showToast('התראות כובו');
  } catch (err) {
    showToast(err.message || 'שגיאה בכיבוי התראות');
  }
  refreshPushButtonUI();
}

const pushToggleBtn = $('push-toggle-btn');
if (pushToggleBtn) {
  pushToggleBtn.addEventListener('click', () => {
    if (Notification.permission === 'denied') {
      showToast('ההתראות חסומות בהגדרות האתר של הדפדפן - יש לאשר אותן שם ידנית');
      return;
    }
    if (pushEnabledLocally() && Notification.permission === 'granted') {
      disablePush();
    } else {
      enablePush();
    }
  });
}

// אם ההרשאה כבר אושרה בעבר - מרעננים בשקט את הטוקן ברקע בכל כניסה
// לאפליקציה, בלי לשאול את המשתמש שוב. תופס גם מקרים שבהם הטוקן
// התחלף אצל Firebase מאז הפעם הקודמת (Firebase מחליף טוקנים מדי פעם).
async function silentlyRefreshPushTokenIfEnabled() {
  if (!('Notification' in window) || !pushEnabledLocally() || Notification.permission !== 'granted') return;
  try {
    const messaging = initFirebaseMessaging_();
    if (!messaging) return;
    if (!swRegistration) swRegistration = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swRegistration });
    if (token) await callApi('POST', 'registerPushToken', { code: state.code, token });
  } catch (e) {
    // שקט לגמרי - זו רק סנכרון ברקע, לא פעולה שהמשתמש יזם במפורש
  }
}

// ---------------------------------------------------------------------
// המראה
// ---------------------------------------------------------------------
tryAutoLogin();

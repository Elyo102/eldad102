/* =====================================================================
 *  app.js — "דוח נוכחות כבאים"
 *  חזית PWA שמדברת עם Apps Script Web App דרך fetch().
 * ===================================================================== */

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
  ['screen-login', 'screen-register', 'screen-forgot', 'screen-app'].forEach(s => {
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

  try {
    // תמיד saveManualShift - זו הדרך היחידה שמבטיחה סימון ***
    // ומגינה על הדיווח מפני תיקון אוטומטי של המערכת.
    const result = await callApi('POST', 'saveManualShift', {
      code: state.code, dateStr, startTime, endTime, notes, dayType, workplace
    });
    showToast(result.message || 'נשמר בהצלחה');
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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// ---------------------------------------------------------------------
// המראה
// ---------------------------------------------------------------------
tryAutoLogin();

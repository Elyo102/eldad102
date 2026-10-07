/* New-month loading is always opt-in; it never clears reports or local queues. */
let scheduleImportRunning = false;
let scheduleImportResult = null;
let lastCalendarMonth = monthKeyOf(new Date());
const monthPromptMemory = new Set();
function monthPromptKey(code, month) { return 'ds102_month_prompt_' + code + '_' + month; }
function monthPromptSeen(code, month) {
  const key = monthPromptKey(code, month);
  try { return monthPromptMemory.has(key) || localStorage.getItem(key) === '1'; }
  catch (_) { return monthPromptMemory.has(key); }
}
function rememberMonthPrompt(code, month) {
  const key = monthPromptKey(code, month);
  monthPromptMemory.add(key);
  try { localStorage.setItem(key, '1'); } catch (_) { /* still usable this session */ }
}
function renderMonthStart() {
  const box = $('month-start');
  if (!box) return;
  const month = monthKeyOf(state.currentMonth);
  const available = !!state.code && !state.isHr && month === monthKeyOf(new Date()) &&
    monthSync.phase === 'ready' && monthSync.code === state.code && monthSync.month === month;
  box.hidden = !available;
  if (!available) return;
  const seen = monthPromptSeen(state.code, month);
  $('month-start-title').textContent = seen ? 'משמרות מהסידור' : 'נפתח חודש ' + MONTH_NAMES[state.currentMonth.getMonth()];
  $('month-start-description').textContent = seen
    ? 'אפשר להשלים משמרות חסרות. דיווחים שכבר הזנת יישמרו.'
    : 'לטעון את המשמרות שלך מהסידור? דיווחי החודשים הקודמים נשארים זמינים בחיצי החודשים.';
  $('month-start-dismiss').hidden = seen;
  $('month-start-load').disabled = scheduleImportRunning;
  $('month-start-load').textContent = scheduleImportRunning ? 'טוען משמרות…' : 'כן, טען מהסידור';
  const result = scheduleImportResult;
  const show = result && result.code === state.code && result.month === month;
  const feedback = $('month-start-feedback');
  feedback.hidden = !show;
  feedback.textContent = show ? result.message : '';
  feedback.dataset.status = show ? result.status : '';
}
async function loadScheduleForDisplayedMonth() {
  if (scheduleImportRunning) return;
  const code = state.code, month = monthKeyOf(state.currentMonth);
  if (month !== monthKeyOf(new Date()) || monthSync.phase !== 'ready' ||
      monthSync.code !== code || monthSync.month !== month) {
    showToast('טעינה מהסידור זמינה בחודש הנוכחי לאחר טעינת נתוניו.'); return;
  }
  scheduleImportRunning = true;
  scheduleImportResult = null;
  renderMonthStart();
  try {
    if (!navigator.onLine) throw new Error('אין חיבור לשרת. התחבר לרשת ונסה שוב.');
    if (shiftFormSubmitting || pendingReportOperation || offlineFlushRunning ||
        getOfflineQueue().some(x => !x.params || (x.params.code === code && (!x.params.dateStr || x.params.dateStr.startsWith(month))))) {
      throw new Error('יש דיווח בתהליך שמירה או ממתין לשליחה. יש להשלים את שמירתו לפני טעינה מהסידור.');
    }
    const result = await callApi('POST', 'importMyMonthSchedule', {code, monthKey:month}, true);
    if (!result || result.success !== true || result.monthKey !== month || !Number.isInteger(result.filled)) {
      throw new Error('לא התקבל אישור מלא מהשרת. אפשר לנסות שוב; הטעינה מוסיפה רק משמרות חסרות.');
    }
    const issues = Array.isArray(result.issues) ? result.issues : [];
    const review = result.needsReview || !result.complete;
    scheduleImportResult = {code, month, status:review ? 'review' : 'saved',
      message:(review ? 'נדרשת בדיקה: ' : '✓ ') + result.message + (issues.length ? '\n' + issues.join('\n') : '')};
    if (result.complete) rememberMonthPrompt(code, month);
    if (state.code === code && monthKeyOf(state.currentMonth) === month) {
      $('issues-modal').classList.add('hidden');
      await refreshMonth(true);
      if (monthSync.phase !== 'ready') showToast('השרת אישר את הטעינה, אך לא התקבל עדכון תצוגה. הדיווחים נשמרו.');
    }
  } catch (error) {
    scheduleImportResult = {code, month, status:'review', message:error.message || 'הטעינה לא הושלמה. אפשר לנסות שוב.'};
  } finally {
    scheduleImportRunning = false;
    renderMonthStart();
  }
}
$('month-start-load').addEventListener('click', loadScheduleForDisplayedMonth);
$('month-start-dismiss').addEventListener('click', () => {
  rememberMonthPrompt(state.code, monthKeyOf(state.currentMonth)); renderMonthStart();
});
function checkCalendarMonthRollover() {
  if (document.hidden || !state.code || state.isHr) return;
  const current = monthKeyOf(new Date());
  if (current === lastCalendarMonth || scheduleImportRunning || shiftFormSubmitting ||
      document.body.classList.contains('shift-report-open')) return;
  const previous = lastCalendarMonth;
  lastCalendarMonth = current;
  if (monthKeyOf(state.currentMonth) === previous) {
    const now = new Date();
    state.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    refreshMonth();
  }
}
document.addEventListener('visibilitychange', checkCalendarMonthRollover);
setInterval(checkCalendarMonthRollover, 60000);

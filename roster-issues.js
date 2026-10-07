// Review markers come from the acknowledged monthly server snapshot.
function renderRosterIssues() {
  const section = $('roster-issues');
  if (!section) return;
  const month = monthKeyOf(state.currentMonth);
  const ready = monthSync.phase === 'ready' && monthSync.code === state.code && monthSync.month === month;
  const issues = ready && Array.isArray(monthSync.scheduleIssues) ? monthSync.scheduleIssues : [];
  const valid = issues.filter(i => typeof i.dateStr === 'string' && i.dateStr.startsWith(month + '-') && /^\d{4}-\d{2}-\d{2}$/.test(i.dateStr));
  section.hidden = valid.length === 0;
  $('roster-issues-list').replaceChildren();
  document.querySelectorAll('.shift-roster-review').forEach(card => card.classList.remove('shift-roster-review'));
  document.querySelectorAll('.roster-review-badge').forEach(badge => badge.remove());
  $('roster-issues-title').textContent = 'ימים שדורשים תיקון (' + new Set(valid.map(i=>i.dateStr)).size + ')';
  valid.forEach(issue => {
    const row = document.createElement('div'); row.className = 'roster-issue-row';
    const text = document.createElement('span');
    const parts = issue.dateStr.split('-');
    text.textContent = Number(parts[2]) + '/' + Number(parts[1]) + '/' + parts[0] + ' — ' + issue.reason;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-btn';
    button.textContent = 'ערוך דיווח';
    button.setAttribute('aria-label', 'ערוך דיווח ליום ' + Number(parts[2]) + '/' + Number(parts[1]));
    const owner = state.code;
    button.addEventListener('click', () => {
      if (owner !== state.code || month !== monthKeyOf(state.currentMonth) || monthSync.phase !== 'ready') return;
      const existing = state.shifts.find(s => s.dateStr === issue.dateStr);
      openShiftModal(issue.dateStr, existing);
    });
    row.append(text, button); $('roster-issues-list').appendChild(row);
    document.querySelectorAll('#shifts-list .shift-card').forEach(card => {
      if (card.dataset.reportDate !== issue.dateStr) return;
      card.classList.add('shift-roster-review');
      if (card.querySelector('.roster-review-badge')) return;
      const badge = document.createElement('div'); badge.className = 'roster-review-badge'; badge.textContent = '⚠ נדרש תיקון — ' + issue.reason;
      card.querySelector('.shift-details').appendChild(badge);
    });
  });
}

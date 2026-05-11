// PiQPull — Browse: Format v1.4.0
// Single job: pure display formatting. No state mutation. No DOM. No API calls.

const BrowseFormat = (() => {

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // claude-sonnet-4-6           → Claude Sonnet 4.6
  // claude-3-5-sonnet-20240620  → Claude Sonnet 3.5
  // claude-opus-5-20260101      → Claude Opus 5
  function formatModelName(model) {
    if (!model || !model.startsWith('claude-')) return model || 'Unknown';

    // New format: claude-{type}-{major}[-{minor}][-{date}]
    const newFmt = model.match(/^claude-(sonnet|opus|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i);
    if (newFmt) {
      const [, type, major, minor] = newFmt;
      const name = type.charAt(0).toUpperCase() + type.slice(1);
      const ver  = minor ? `${major}.${minor}` : major;
      return `Claude ${name} ${ver}`;
    }

    // Old format: claude-{major}[-{minor}]-{type}-{date}
    const oldFmt = model.match(/^claude-(\d+)(?:-(\d+))?-(sonnet|opus|haiku)-\d{8}$/i);
    if (oldFmt) {
      const [, major, minor, type] = oldFmt;
      const name = type.charAt(0).toUpperCase() + type.slice(1);
      const ver  = minor ? `${major}.${minor}` : major;
      return `Claude ${name} ${ver}`;
    }

    return model;
  }

  function getModelBadgeClass(model) {
    if (!model) return '';
    if (model.includes('sonnet')) return 'sonnet';
    if (model.includes('opus'))   return 'opus';
    if (model.includes('haiku'))  return 'haiku';
    return '';
  }

  function formatDate(dt, dateFormat) {
    const m = dt.getMonth() + 1;
    const d = dt.getDate();
    const y = dt.getFullYear();
    return dateFormat === 'dmy' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
  }

  function formatTime(dt, timeFormat) {
    const opts = { hour: '2-digit', minute: '2-digit', hour12: timeFormat !== '24h' };
    return dt.toLocaleTimeString([], opts);
  }

  function getProjectName(conversation, projectsMap) {
    const id = conversation.project_uuid || conversation.project_id || conversation.projectUuid;
    if (!id) return '-';
    return projectsMap[id] || '-';
  }

  function getSortIndicator(field, sortStack) {
    if (!sortStack.length || sortStack[0].field !== field) return '';
    const arrow = sortStack[0].direction === 'asc' ? '↑' : '↓';
    const sub   = sortStack[0].direction === 'asc' ? '↓' : '↑';
    return ` <span class="sort-indicator">${arrow}<sub>${sub}</sub></span>`;
  }

  return { escapeHtml, formatModelName, getModelBadgeClass, formatDate, formatTime, getProjectName, getSortIndicator };
})();

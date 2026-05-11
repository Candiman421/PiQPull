// PiQPull — Browse: Table v1.4.0
// FIX Bug 1: autoSelectNewUpdated no longer calls render() internally.
//            Caller (browse.js) calls applyFiltersAndSort first, then autoSelectNewUpdated.
// v1.4.0: groupByProject CSS classes now styled in browse.css; _renderGrouped active.

const BrowseTable = (() => {

  let onExport = null;
  let onView = null;

  function init(callbacks) {
    onExport = callbacks.onExport;
    onView = callbacks.onView;
  }

  // ---------------------------------------------------------------------------
  // Filter + Sort
  // ---------------------------------------------------------------------------

  function applyFiltersAndSort() {
    const searchTerm = (document.getElementById('searchInput')?.value || '').toLowerCase();

    BrowseState.filtered = BrowseState.all.filter(conv => {
      const matchesSearch = !searchTerm ||
        conv.name.toLowerCase().includes(searchTerm) ||
        (conv.summary && conv.summary.toLowerCase().includes(searchTerm));

      let matchesStatus = true;
      if (BrowseState.statusFilter === 'new') matchesStatus = BrowseState.isNewOrUpdated(conv);
      if (BrowseState.statusFilter === 'exported') matchesStatus = !BrowseState.isNewOrUpdated(conv);

      return matchesSearch && matchesStatus;
    });

    sortConversations();
    BrowseState.lastIdx = null;
    render();
    updateStats();
  }

  function sortConversations() {
    BrowseState.filtered.sort((a, b) => {
      for (const { field, direction } of BrowseState.sortStack) {
        let aVal, bVal;
        switch (field) {
          case 'name': aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
          case 'project': aVal = BrowseFormat.getProjectName(a, BrowseState.pMap).toLowerCase();
            bVal = BrowseFormat.getProjectName(b, BrowseState.pMap).toLowerCase(); break;
          case 'created': aVal = new Date(a.created_at); bVal = new Date(b.created_at); break;
          case 'updated': aVal = new Date(a.updated_at); bVal = new Date(b.updated_at); break;
          case 'model': aVal = BrowseFormat.formatModelName(a.model).toLowerCase();
            bVal = BrowseFormat.formatModelName(b.model).toLowerCase(); break;
          default: continue;
        }
        const cmp = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  function handleColumnSort(field) {
    const stack = BrowseState.sortStack;
    const idx = stack.findIndex(s => s.field === field);
    if (idx === 0) {
      stack[0].direction = stack[0].direction === 'asc' ? 'desc' : 'asc';
    } else if (idx > 0) {
      const [item] = stack.splice(idx, 1);
      stack.unshift(item);
    } else {
      stack.unshift({ field, direction: 'asc' });
    }
    applyFiltersAndSort();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function _buildTableHead(si) {
    return `<table>
      <thead><tr>
        <th class="sortable" data-sort="name">Name${si('name')}</th>
        <th class="sortable" data-sort="project">Project${si('project')}</th>
        <th class="sortable" data-sort="updated">Updated${si('updated')}</th>
        <th class="sortable" data-sort="model">Model${si('model')}</th>
        <th>Actions</th>
        <th class="checkbox-col"><input type="checkbox" class="select-all-checkbox" data-group="all"></th>
      </tr></thead>
      <tbody>`;
  }

  function _buildRow(conv, index, dateFormat, timeFormat) {
    const updDt = new Date(conv.updated_at);
    const badge = BrowseFormat.getModelBadgeClass(conv.model);
    const proj = BrowseFormat.escapeHtml(BrowseFormat.getProjectName(conv, BrowseState.pMap));
    const isNew = BrowseState.isNewOrUpdated(conv);
    const sel = BrowseState.selected.has(conv.uuid) ? 'checked' : '';
    const id = BrowseFormat.escapeHtml(conv.uuid);
    const name = BrowseFormat.escapeHtml(conv.name);
    return `<tr data-id="${id}">
      <td><div class="conversation-name">
        ${isNew ? '<span class="new-dot" title="New or updated since last export"></span>' : ''}
        <a href="https://claude.ai/chat/${id}" target="_blank" title="${name}">${name}</a>
      </div></td>
      <td>${proj}</td>
      <td class="date">
        ${BrowseFormat.escapeHtml(BrowseFormat.formatDate(updDt, dateFormat))}
        <br><span class="time">${BrowseFormat.escapeHtml(BrowseFormat.formatTime(updDt, timeFormat))}</span>
      </td>
      <td><span class="model-badge ${badge}">${BrowseFormat.escapeHtml(BrowseFormat.formatModelName(conv.model))}</span></td>
      <td><div class="actions">
        <button class="btn-small btn-export" data-id="${id}" data-name="${name}">Export</button>
        <button class="btn-small btn-view" data-id="${id}">View</button>
      </div></td>
      <td class="checkbox-col">
        <input type="checkbox" class="conversation-checkbox" data-id="${id}" data-index="${index}" ${sel}>
      </td>
    </tr>`;
  }

  function render() {
    const container = document.getElementById('tableContent');
    if (!container) return;

    if (BrowseState.filtered.length === 0) {
      container.innerHTML = '<div class="no-results">No conversations found.</div>';
      updateExportButtonText();
      return;
    }

    const { dateFormat, timeFormat } = BrowseState;
    const stack = BrowseState.sortStack;
    const si = f => BrowseFormat.getSortIndicator(f, stack);

    if (BrowseState.groupByProject) {
      _renderGrouped(container, dateFormat, timeFormat, si);
    } else {
      _renderFlat(container, dateFormat, timeFormat, si);
    }

    _wireTableEvents(container);
    document.getElementById('exportAllBtn').disabled = false;
    updateExportButtonText();
  }

  function _renderFlat(container, dateFormat, timeFormat, si) {
    let html = _buildTableHead(si);
    BrowseState.filtered.forEach((conv, index) => {
      html += _buildRow(conv, index, dateFormat, timeFormat);
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function _renderGrouped(container, dateFormat, timeFormat, si) {
    const groups = {};
    const ORPHAN = '__orphaned__';
    BrowseState.filtered.forEach((conv, index) => {
      const key = conv.project_uuid
        ? (BrowseFormat.getProjectName(conv, BrowseState.pMap) || ORPHAN)
        : ORPHAN;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ conv, index });
    });

    const sortedKeys = Object.keys(groups)
      .filter(k => k !== ORPHAN)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (groups[ORPHAN]) sortedKeys.push(ORPHAN);

    let html = '';
    for (const key of sortedKeys) {
      const label = key === ORPHAN ? 'Orphaned Chats' : BrowseFormat.escapeHtml(key);
      const groupId = `grp-${key.replace(/[^a-z0-9]/gi, '_')}`;
      const count = groups[key].length;
      const prefix = key === ORPHAN ? '\uD83D\uDD34 ' : '';
      html += `<div class="conv-group" id="${groupId}">
        <div class="group-header">
          <input type="checkbox" class="group-select-all" data-group="${groupId}" title="Select all in group">
          <span class="group-label">${prefix}${label}</span>
          <span class="group-count">${count}</span>
          <button class="group-toggle" data-group="${groupId}" title="Collapse/expand">&#9662;</button>
        </div>
        <div class="group-body">${_buildTableHead(si)}`;
      groups[key].forEach(({ conv, index }) => {
        html += _buildRow(conv, index, dateFormat, timeFormat);
      });
      html += '</tbody></table></div></div>';
    }
    container.innerHTML = html;
  }

  function _wireTableEvents(container) {
    container.querySelectorAll('.btn-export').forEach(btn => {
      btn.addEventListener('click', () => onExport && onExport(btn.dataset.id, btn.dataset.name));
    });
    container.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', () => window.open(`https://claude.ai/chat/${btn.dataset.id}`, '_blank'));
    });
    container.querySelectorAll('.conversation-checkbox').forEach(cb => {
      cb.addEventListener('click', handleCheckboxClick);
    });
    container.querySelectorAll('.sortable').forEach(th => {
      th.addEventListener('click', () => handleColumnSort(th.dataset.sort));
    });
    container.querySelectorAll('.select-all-checkbox').forEach(cb => {
      cb.addEventListener('click', handleSelectAll);
    });
    container.querySelectorAll('.group-select-all').forEach(cb => {
      cb.addEventListener('click', e => {
        const groupId = e.target.dataset.group;
        const groupEl = document.getElementById(groupId);
        if (!groupEl) return;
        groupEl.querySelectorAll('.conversation-checkbox').forEach(c => {
          c.checked = e.target.checked;
          e.target.checked
            ? BrowseState.selected.add(c.dataset.id)
            : BrowseState.selected.delete(c.dataset.id);
        });
        updateExportButtonText();
      });
    });
    container.querySelectorAll('.group-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        const groupId = e.target.dataset.group;
        const body = document.querySelector(`#${groupId} .group-body`);
        if (body) {
          const collapsed = body.style.display === 'none';
          body.style.display = collapsed ? '' : 'none';
          e.target.textContent = collapsed ? '\u25BE' : '\u25B8';
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Checkbox management
  // ---------------------------------------------------------------------------

  function handleCheckboxClick(e) {
    const cb = e.target;
    const id = cb.dataset.id;
    const idx = parseInt(cb.dataset.index);

    if (e.shiftKey && BrowseState.lastIdx !== null) {
      const start = Math.min(BrowseState.lastIdx, idx);
      const end = Math.max(BrowseState.lastIdx, idx);
      document.querySelectorAll('.conversation-checkbox').forEach((c, i) => {
        if (i >= start && i <= end) {
          c.checked = cb.checked;
          cb.checked ? BrowseState.selected.add(c.dataset.id) : BrowseState.selected.delete(c.dataset.id);
        }
      });
    } else {
      cb.checked ? BrowseState.selected.add(id) : BrowseState.selected.delete(id);
    }

    BrowseState.lastIdx = idx;
    updateExportButtonText();
    syncSelectAll();
  }

  function handleSelectAll(e) {
    document.querySelectorAll('.conversation-checkbox').forEach(cb => {
      cb.checked = e.target.checked;
      e.target.checked ? BrowseState.selected.add(cb.dataset.id) : BrowseState.selected.delete(cb.dataset.id);
    });
    BrowseState.lastIdx = null;
    updateExportButtonText();
  }

  function syncSelectAll() {
    const sa = document.getElementById('selectAll');
    if (sa) sa.checked = BrowseState.selected.size > 0;
  }

  // FIX Bug 1: autoSelectNewUpdated no longer calls render() — caller handles rendering
  function autoSelectNewUpdated() {
    BrowseState.selected.clear();
    BrowseState.filtered.forEach(conv => {
      if (BrowseState.isNewOrUpdated(conv)) BrowseState.selected.add(conv.uuid);
    });
    updateExportButtonText();  // just update the button, no render
  }

  function updateExportButtonText() {
    const btn = document.getElementById('exportAllBtn');
    if (!btn) return;
    btn.textContent = BrowseState.selected.size > 0
      ? `Export Selected (${BrowseState.selected.size})`
      : 'Export All';
  }

  function updateStats() {
    const el = document.getElementById('stats');
    if (!el) return;
    const newCount = BrowseState.all.filter(c => BrowseState.isNewOrUpdated(c)).length;
    el.textContent = `Showing ${BrowseState.filtered.length} of ${BrowseState.all.length} conversations (${newCount} new/updated)`;
  }

  function showError(message) {
    const container = document.getElementById('tableContent');
    if (container) container.innerHTML = `<div class="error">${BrowseFormat.escapeHtml(message)}</div>`;
  }

  return { init, applyFiltersAndSort, render, autoSelectNewUpdated, updateStats, showError, updateExportButtonText };
})();

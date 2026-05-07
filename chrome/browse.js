// PiQPull — Browse: Orchestrator
// Single job: init sequence + event wiring.
// No business logic. Calls atomic modules only.

document.addEventListener('DOMContentLoaded', async () => {

  // ---------------------------------------------------------------------------
  // Theme — apply before paint to avoid flash
  // ---------------------------------------------------------------------------

  const savedTheme = localStorage.getItem('piqpull-theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  // ---------------------------------------------------------------------------
  // Init sequence
  // ---------------------------------------------------------------------------

  BrowseTable.init({
    onExport: (id, name) => BrowseExport.exportSingle(BrowseState.orgId, id, name),
    onView:   (id) => window.open(`https://claude.ai/chat/${id}`, '_blank')
  });

  await BrowseState.loadTimestamps();
  await BrowseState.loadPrefs();

  const serverPushDefault = await BrowseState.loadServerPush();
  const serverPushEl = document.getElementById('serverPush');
  if (serverPushEl) serverPushEl.checked = serverPushDefault;

  // Org ID
  const orgId = await BrowseApi.resolveOrgId();
  BrowseState.orgId = orgId;

  if (!orgId) {
    BrowseTable.showError('Organization ID not found. Open a Claude.ai tab and reload, or configure in Settings.');
    return;
  }

  // Projects (non-fatal — conversations still load if this fails)
  try {
    const projects = await BrowseApi.fetchProjects(orgId);
    BrowseState.projects = projects;
    const pMap = {};
    projects.forEach(p => {
      const pid  = p.uuid || p.id;
      const name = p.name || p.title || 'Untitled Project';
      pMap[pid] = name;
    });
    BrowseState.pMap = pMap;
  } catch (e) {
    console.warn('PiQPull: Could not load projects:', e.message);
  }

  // Conversations
  try {
    const conversations = await BrowseApi.fetchConversations(orgId);
    BrowseState.all = conversations.map(conv => ({ ...conv, model: inferModel(conv) }));
    BrowseTable.autoSelectNewUpdated();
    BrowseTable.applyFiltersAndSort();
  } catch (e) {
    BrowseTable.showError(`Failed to load conversations: ${e.message}`);
    return;
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  // Search
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', e => {
    document.getElementById('searchBox').classList.toggle('has-text', !!e.target.value);
    BrowseTable.applyFiltersAndSort();
  });
  document.getElementById('clearSearch').addEventListener('click', () => {
    searchInput.value = '';
    document.getElementById('searchBox').classList.remove('has-text');
    BrowseTable.applyFiltersAndSort();
  });

  // Status filter dropdown
  const filterBtn      = document.getElementById('filterBtn');
  const filterDropdown = document.getElementById('filterDropdown');
  filterBtn.addEventListener('click', e => { e.stopPropagation(); filterDropdown.classList.toggle('open'); });
  document.addEventListener('click', () => filterDropdown.classList.remove('open'));
  filterDropdown.addEventListener('click', e => e.stopPropagation());

  document.querySelectorAll('.filter-option').forEach(opt => {
    opt.addEventListener('click', () => {
      BrowseState.statusFilter = opt.dataset.value;
      document.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      filterBtn.classList.toggle('active', BrowseState.statusFilter !== 'all');
      filterDropdown.classList.remove('open');
      BrowseTable.applyFiltersAndSort();
    });
  });
  document.querySelector('.filter-option[data-value="all"]')?.classList.add('selected');

  // Checkbox dependencies — chats gates thinking / metadata / inline artifacts
  const chatsEl = document.getElementById('includeChats');
  const gatedEls = ['includeThinking', 'includeMetadata', 'includeArtifacts']
    .map(id => document.getElementById(id));

  function syncGated() {
    const enabled = chatsEl.checked;
    gatedEls.forEach(el => {
      if (!el) return;
      el.disabled = !enabled;
      if (!enabled) el.checked = false;
    });
  }
  chatsEl.addEventListener('change', syncGated);
  syncGated();

  // Export all / selected
  document.getElementById('exportAllBtn').addEventListener('click', () => {
    BrowseExport.exportAll(BrowseState.orgId);
  });

  // Settings dropdown
  const settingsBtn      = document.getElementById('settingsBtn');
  const settingsDropdown = document.getElementById('settingsDropdown');

  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    settingsDropdown.classList.toggle('open');
    if (settingsDropdown.classList.contains('open')) refreshSettingsDisplay();
  });
  document.addEventListener('click', () => settingsDropdown.classList.remove('open'));
  settingsDropdown.addEventListener('click', e => e.stopPropagation());

  function refreshSettingsDisplay() {
    const orgEl = document.getElementById('orgIdDisplay');
    if (orgEl) {
      orgEl.textContent = BrowseState.orgId ? `${BrowseState.orgId.substring(0, 8)}...` : 'Not set';
      orgEl.title       = BrowseState.orgId || '';
    }
    const themeEl = document.getElementById('themeLabel');
    if (themeEl) {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      themeEl.textContent = current === 'dark' ? 'Dark' : 'Light';
    }
    const dfEl = document.getElementById('dateFormatLabel');
    if (dfEl) dfEl.textContent = BrowseState.dateFormat === 'mdy' ? 'M/D/Y' : 'D/M/Y';
    const tfEl = document.getElementById('timeFormatLabel');
    if (tfEl) tfEl.textContent = BrowseState.timeFormat;
  }

  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('piqpull-theme', next);
    refreshSettingsDisplay();
  });

  document.getElementById('settingsOrgId').addEventListener('click', async () => {
    if (!BrowseState.orgId) { BrowseExport.showToast('No org ID set.', true); return; }
    try {
      await navigator.clipboard.writeText(BrowseState.orgId);
      BrowseExport.showToast('Org ID copied.');
    } catch {
      BrowseExport.showToast('Copy failed.', true);
    }
    settingsDropdown.classList.remove('open');
  });

  document.getElementById('editOrgId').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    settingsDropdown.classList.remove('open');
  });

  document.getElementById('markAllExported').addEventListener('click', async () => {
    await BrowseState.markAllExported(BrowseState.all.map(c => c.uuid));
    BrowseTable.render();
    BrowseTable.updateStats();
    settingsDropdown.classList.remove('open');
    BrowseExport.showToast(`Marked ${BrowseState.all.length} as exported.`);
  });

  document.getElementById('markAllNew').addEventListener('click', async () => {
    await BrowseState.clearAllTimestamps();
    BrowseState.selected.clear();
    BrowseTable.autoSelectNewUpdated();
    BrowseTable.updateStats();
    settingsDropdown.classList.remove('open');
    BrowseExport.showToast('All marked as new.');
  });

  document.getElementById('toggleDateFormat').addEventListener('click', () => {
    const next = BrowseState.dateFormat === 'mdy' ? 'dmy' : 'mdy';
    BrowseState.saveDateFormat(next);
    refreshSettingsDisplay();
    BrowseTable.render();
  });

  document.getElementById('toggleTimeFormat').addEventListener('click', () => {
    const next = BrowseState.timeFormat === '12h' ? '24h' : '12h';
    BrowseState.saveTimeFormat(next);
    refreshSettingsDisplay();
    BrowseTable.render();
  });

  // Test connection — class-driven status, no inline color
  document.getElementById('testConnection').addEventListener('click', async () => {
    const statusEl = document.getElementById('connectionStatus');
    statusEl.textContent = 'Testing...';
    statusEl.classList.remove('conn-ok', 'conn-error');
    try {
      const result = await BrowseApi.fetchConversations(BrowseState.orgId);
      statusEl.textContent = `OK (${result.length})`;
      statusEl.classList.add('conn-ok');
    } catch {
      statusEl.textContent = 'Error';
      statusEl.classList.add('conn-error');
    }
  });
});

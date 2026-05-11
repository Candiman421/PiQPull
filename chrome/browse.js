// PiQPull — Browse: Orchestrator v1.4.0
// Fixed: loadPiQuixProjectSelection + loadServerPush now exist (browse-state v1.4.1)
// Fixed: mode badge + localModeControls/piquixModeInfo toggled on picker change and init

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
    onExport: (conversationId, conversationName) =>
      BrowseExport.exportSingle(BrowseState.orgId, conversationId, conversationName),
    onView: (conversationId) =>
      window.open(`https://claude.ai/chat/${conversationId}`, '_blank')
  });

  await BrowseState.loadTimestamps();
  await BrowseState.loadPrefs();
  await BrowseState.loadPiQuixProjectSelection();
  await BrowseState.loadGroupPrefs();

  // NEW: load account slug
  await BrowseState.loadAccountSlug();

  const serverPushDefault = await BrowseState.loadServerPush();
  const serverPushEl      = document.getElementById('serverPush');
  if (serverPushEl) {
    serverPushEl.checked = serverPushDefault;
    // Persist change so reload restores the last user-set value
    serverPushEl.addEventListener('change', async () => {
      await BrowseState.saveServerPush(serverPushEl.checked);
    });
  }

  // Org ID + org name
  const { orgId, orgName } = await BrowseApi.resolveOrgId();
  BrowseState.orgId   = orgId;
  BrowseState.orgName = orgName;

  // NEW: resolve and update account slug via background
  if (orgId) {
    const slugResult = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action: 'fetchAccountSlug', orgId, orgName }, resolve));
    if (slugResult && slugResult.success) {
      await BrowseState.saveAccountSlug(slugResult.accountSlug);
    }
  }

  if (!orgId) {
    BrowseTable.showError('Organization ID not found. Open a Claude.ai tab and reload, or configure in Settings.');
    return;
  }

  // Claude.ai projects (non-fatal)
  try {
    const claudeProjects = await BrowseApi.fetchProjects(orgId);
    BrowseState.projects = claudeProjects;
    const projectLookup  = {};
    claudeProjects.forEach(proj => {
      const projectId = proj.uuid || proj.id;
      projectLookup[projectId] = proj.name || proj.title || 'Untitled Project';
    });
    BrowseState.pMap = projectLookup;
  } catch (projectErr) {
    console.warn('PiQPull: Could not load Claude.ai projects:', projectErr.message);
  }

  // PiQuix project picker
  await initPiQuixProjectPicker();

  // Conversations
  try {
    const conversations = await BrowseApi.fetchConversations(orgId);
    BrowseState.all = conversations.map(conv => ({ ...conv, model: inferModel(conv) }));

    // FIX Bug 1: applyFiltersAndSort FIRST (populates BrowseState.filtered),
    //            THEN autoSelectNewUpdated (iterates populated filtered)
    BrowseTable.applyFiltersAndSort();
    BrowseTable.autoSelectNewUpdated();
    // Re-render after selection so checkboxes reflect auto-selection
    BrowseTable.render();
    BrowseTable.updateStats();

  } catch (convErr) {
    BrowseTable.showError(`Failed to load conversations: ${convErr.message}`);
    return;
  }

  // ---------------------------------------------------------------------------
  // PiQuix project picker init + wiring
  // ---------------------------------------------------------------------------

  async function initPiQuixProjectPicker() {
    const selectEl = document.getElementById('piQuixProjectSelect');
    const statusEl = document.getElementById('browseProjectLoadStatus');
    if (!selectEl) return;

    statusEl.textContent = 'loading…';

    const projectResult = await BrowseApi.fetchPiQuixProjects();

    if (!projectResult || !projectResult.success || !projectResult.piQuixProjects) {
      statusEl.textContent = '(server offline)';
      return;
    }

    statusEl.textContent = '';

    const sectionOrder   = [];
    const sectionBuckets = {};

    for (const proj of projectResult.piQuixProjects) {
      const sectionKey = proj.navSection || 'OTHER';
      if (!sectionBuckets[sectionKey]) { sectionBuckets[sectionKey] = []; sectionOrder.push(sectionKey); }
      sectionBuckets[sectionKey].push(proj);
    }

    for (const sectionKey of sectionOrder) {
      const optGroup = document.createElement('optgroup');
      optGroup.label = sectionKey;
      for (const proj of sectionBuckets[sectionKey]) {
        const optionEl       = document.createElement('option');
        optionEl.value       = proj.folder;
        optionEl.textContent = proj.claudeProject;
        optionEl.dataset.projectName = proj.claudeProject;
        if (proj.folder === BrowseState.piQuixProjectFolder) optionEl.selected = true;
        optGroup.appendChild(optionEl);
      }
      selectEl.appendChild(optGroup);
    }

    // Apply mode UI for the stored selection (no change event fires on load)
    applyDestinationMode(BrowseState.piQuixProjectFolder);

    selectEl.addEventListener('change', async (e) => {
      const selectedOption = e.target.selectedOptions[0];
      const folder         = e.target.value;
      const projectName    = selectedOption ? (selectedOption.dataset.projectName || '') : '';
      await BrowseState.savePiQuixProjectSelection(folder, projectName);
      applyDestinationMode(folder);
    });
  }

  // ---------------------------------------------------------------------------
  // Destination mode toggle
  // Updates badge + shows/hides localModeControls vs piquixModeInfo.
  // ---------------------------------------------------------------------------

  function applyDestinationMode(folder) {
    const badge      = document.getElementById('exportModeBadge');
    const local      = document.getElementById('localModeControls');
    const piquix     = document.getElementById('piquixModeInfo');
    const pathEl     = document.getElementById('piquixRoutePath');
    const isPiQuix   = !!folder;

    if (badge) {
      badge.textContent = isPiQuix ? '⬆ PiQuix Server' : '⬇ Local Download';
      badge.classList.toggle('mode-piquix', isPiQuix);
      badge.classList.toggle('mode-local',  !isPiQuix);
    }
    if (local)  local.classList.toggle('hidden', isPiQuix);
    if (piquix) piquix.classList.toggle('hidden', !isPiQuix);
    if (pathEl && isPiQuix) {
      pathEl.textContent = `incoming\\PiQPull\\${BrowseState.accountSlug}\\${folder}\\{chat}\\`;
    }
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  // Search
  const searchInputEl = document.getElementById('searchInput');
  searchInputEl.addEventListener('input', (e) => {
    document.getElementById('searchBox').classList.toggle('has-text', !!e.target.value);
    BrowseTable.applyFiltersAndSort();
  });
  document.getElementById('clearSearch').addEventListener('click', () => {
    searchInputEl.value = '';
    document.getElementById('searchBox').classList.remove('has-text');
    BrowseTable.applyFiltersAndSort();
  });

  // Status filter dropdown
  const filterBtn      = document.getElementById('filterBtn');
  const filterDropdown = document.getElementById('filterDropdown');
  filterBtn.addEventListener('click', (e) => { e.stopPropagation(); filterDropdown.classList.toggle('open'); });
  document.addEventListener('click', () => filterDropdown.classList.remove('open'));
  filterDropdown.addEventListener('click', (e) => e.stopPropagation());

  document.querySelectorAll('.filter-option').forEach(optionEl => {
    optionEl.addEventListener('click', () => {
      BrowseState.statusFilter = optionEl.dataset.value;
      document.querySelectorAll('.filter-option').forEach(el => el.classList.remove('selected'));
      optionEl.classList.add('selected');
      filterBtn.classList.toggle('active', BrowseState.statusFilter !== 'all');
      filterDropdown.classList.remove('open');
      BrowseTable.applyFiltersAndSort();
    });
  });
  document.querySelector('.filter-option[data-value="all"]')?.classList.add('selected');

  // Checkbox dependencies — chats gates thinking / metadata / inline artifacts
  const chatsCheckbox = document.getElementById('includeChats');
  const gatedCheckboxes = ['includeThinking', 'includeMetadata', 'includeArtifacts']
    .map(elId => document.getElementById(elId)).filter(Boolean);

  function syncGatedCheckboxes() {
    const chatsEnabled = chatsCheckbox.checked;
    gatedCheckboxes.forEach(el => {
      el.disabled = !chatsEnabled;
      if (!chatsEnabled) el.checked = false;
    });
  }
  chatsCheckbox.addEventListener('change', syncGatedCheckboxes);
  syncGatedCheckboxes();

  // Group by project toggle
  const groupByProjectBtn = document.getElementById('groupByProjectBtn');
  if (groupByProjectBtn) {
    if (BrowseState.groupByProject) groupByProjectBtn.classList.add('active');
    groupByProjectBtn.addEventListener('click', async () => {
      const next = !BrowseState.groupByProject;
      await BrowseState.saveGroupByProject(next);
      groupByProjectBtn.classList.toggle('active', next);
      BrowseTable.applyFiltersAndSort();
    });
  }

  // Include project home checkbox
  const projectHomeEl = document.getElementById('includeProjectHome');
  if (projectHomeEl) {
    projectHomeEl.checked = BrowseState.includeProjectHome;
    projectHomeEl.addEventListener('change', async () => {
      await BrowseState.saveIncludeProjectHome(projectHomeEl.checked);
    });
  }

  // Export all / selected
  document.getElementById('exportAllBtn').addEventListener('click', () => {
    BrowseExport.exportAll(BrowseState.orgId);
  });

  // Settings dropdown
  const settingsBtn      = document.getElementById('settingsBtn');
  const settingsDropdown = document.getElementById('settingsDropdown');

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsDropdown.classList.toggle('open');
    if (settingsDropdown.classList.contains('open')) refreshSettingsDisplay();
  });
  document.addEventListener('click', () => settingsDropdown.classList.remove('open'));
  settingsDropdown.addEventListener('click', (e) => e.stopPropagation());

  function refreshSettingsDisplay() {
    const orgDisplayEl = document.getElementById('orgIdDisplay');
    if (orgDisplayEl) {
      orgDisplayEl.textContent = BrowseState.orgId
        ? `${BrowseState.orgId.substring(0, 8)}…`
        : 'Not set';
      orgDisplayEl.title = BrowseState.orgId || '';
    }
    const themeLabelEl = document.getElementById('themeLabel');
    if (themeLabelEl) {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      themeLabelEl.textContent = currentTheme === 'dark' ? 'Dark' : 'Light';
    }
    const dateFmtEl = document.getElementById('dateFormatLabel');
    if (dateFmtEl) dateFmtEl.textContent = BrowseState.dateFormat === 'mdy' ? 'M/D/Y' : 'D/M/Y';
    const timeFmtEl = document.getElementById('timeFormatLabel');
    if (timeFmtEl) timeFmtEl.textContent = BrowseState.timeFormat;
    const slugEl = document.getElementById('accountSlugDisplay');
    if (slugEl) slugEl.textContent = BrowseState.accountSlug || 'unknown';
  }

  document.getElementById('themeToggle').addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const nextTheme    = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('piqpull-theme', nextTheme);
    refreshSettingsDisplay();
  });

  document.getElementById('settingsOrgId').addEventListener('click', async () => {
    if (!BrowseState.orgId) { BrowseExport.showToast('No org ID set.', true); return; }
    try {
      await navigator.clipboard.writeText(BrowseState.orgId);
      BrowseExport.showToast('Org ID copied.');
    } catch (_err) {
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
    BrowseTable.applyFiltersAndSort();
    BrowseTable.autoSelectNewUpdated();
    BrowseTable.render();
    BrowseTable.updateStats();
    settingsDropdown.classList.remove('open');
    BrowseExport.showToast('All marked as new.');
  });

  document.getElementById('toggleDateFormat').addEventListener('click', () => {
    const nextFormat = BrowseState.dateFormat === 'mdy' ? 'dmy' : 'mdy';
    BrowseState.saveDateFormat(nextFormat);
    refreshSettingsDisplay();
    BrowseTable.render();
  });

  document.getElementById('toggleTimeFormat').addEventListener('click', () => {
    const nextFormat = BrowseState.timeFormat === '12h' ? '24h' : '12h';
    BrowseState.saveTimeFormat(nextFormat);
    refreshSettingsDisplay();
    BrowseTable.render();
  });

  document.getElementById('testConnection').addEventListener('click', async () => {
    const connectionStatusEl = document.getElementById('connectionStatus');
    connectionStatusEl.textContent = 'Testing…';
    connectionStatusEl.classList.remove('conn-ok', 'conn-error');
    try {
      const conversations = await BrowseApi.fetchConversations(BrowseState.orgId);
      connectionStatusEl.textContent = `OK (${conversations.length})`;
      connectionStatusEl.classList.add('conn-ok');
    } catch (_testErr) {
      connectionStatusEl.textContent = 'Error';
      connectionStatusEl.classList.add('conn-error');
    }
  });
});

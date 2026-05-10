// PiQPull — Popup Logic v1.2.0
// Simplified: 3 buttons only. Format/artifact options removed (project route always raw JSON).
// Added: Export Project Home page button.

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function getStoredOrgId() {
  return new Promise(resolve =>
    chrome.storage.sync.get(['organizationId'], s => resolve(s.organizationId || null)));
}

async function resolveOrgId() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('claude.ai')) {
      const relayResponse = await new Promise(resolve => {
        chrome.tabs.sendMessage(activeTab.id, { action: 'detectOrgId' }, res => {
          resolve(chrome.runtime.lastError ? null : res);
        });
      });
      if (relayResponse && relayResponse.success && relayResponse.orgId) {
        // Also track org + resolve account slug on successful detection
        chrome.runtime.sendMessage({
          action: 'fetchAccountSlug',
          orgId: relayResponse.orgId,
          orgName: relayResponse.orgName || null
        }, () => {});
        return { orgId: relayResponse.orgId, orgName: relayResponse.orgName || null };
      }
    }
  } catch (_err) { /* fall through */ }
  const storedOrgId = await getStoredOrgId();
  const storedOrgName = await new Promise(resolve =>
    chrome.storage.sync.get(['orgName'], s => resolve(s.orgName || null)));
  return { orgId: storedOrgId, orgName: storedOrgName };
}

function getStoredAccountSlug() {
  return new Promise(resolve =>
    chrome.storage.sync.get(['currentAccountSlug'], s => resolve(s.currentAccountSlug || 'unknown')));
}

function getStoredProjectSelection() {
  return new Promise(resolve =>
    chrome.storage.sync.get(['piQuixProjectFolder', 'piQuixProjectName'], s =>
      resolve({ folder: s.piQuixProjectFolder || '', projectName: s.piQuixProjectName || '' })));
}

function saveProjectSelection(folder, projectName) {
  return new Promise(resolve =>
    chrome.storage.sync.set({ piQuixProjectFolder: folder, piQuixProjectName: projectName }, resolve));
}

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

function showStatus(message, statusType) {
  const statusEl     = document.getElementById('status');
  const resolvedType = statusType || 'info';
  statusEl.className = `status ${resolvedType}`;

  if (resolvedType === 'error' && (message.includes('403') || message.includes('404'))) {
    statusEl.innerHTML = `${message}<br>Check <a href="#" id="statusOpenOptions">Settings</a>`;
    document.getElementById('statusOpenOptions')?.addEventListener('click', e => {
      e.preventDefault(); chrome.runtime.openOptionsPage();
    });
  } else {
    statusEl.textContent = message;
  }

  if (resolvedType === 'success') {
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 5000);
  }
}

// ---------------------------------------------------------------------------
// Route note
// ---------------------------------------------------------------------------

function updateProjectRouteNote(selectedFolder, accountSlug) {
  const noteEl = document.getElementById('projectRouteNote');
  const pathEl = document.getElementById('projectRoutePath');
  if (!noteEl) return;

  if (selectedFolder) {
    noteEl.classList.remove('hidden');
    if (pathEl) pathEl.textContent = `incoming\\PiQPull\\${accountSlug || '…'}\\…\\{chat}\\`;
    // Enable the Project Home button when project is selected
    document.getElementById('exportProjectHome').disabled = false;
  } else {
    noteEl.classList.add('hidden');
    document.getElementById('exportProjectHome').disabled = true;
  }
}

// ---------------------------------------------------------------------------
// Project picker
// ---------------------------------------------------------------------------

function populatePiQuixProjectPicker(piQuixProjects, storedFolder) {
  const selectEl = document.getElementById('piQuixProjectSelect');

  const sectionOrder   = [];
  const sectionBuckets = {};

  for (const proj of piQuixProjects) {
    const section = proj.navSection || 'OTHER';
    if (!sectionBuckets[section]) { sectionBuckets[section] = []; sectionOrder.push(section); }
    sectionBuckets[section].push(proj);
  }

  for (const section of sectionOrder) {
    const optGroup = document.createElement('optgroup');
    optGroup.label = section;
    for (const proj of sectionBuckets[section]) {
      const optionEl               = document.createElement('option');
      optionEl.value               = proj.folder;
      optionEl.textContent         = proj.claudeProject;
      optionEl.dataset.projectName = proj.claudeProject;
      if (proj.folder === storedFolder) optionEl.selected = true;
      optGroup.appendChild(optionEl);
    }
    selectEl.appendChild(optGroup);
  }
}

async function loadPiQuixProjects() {
  const statusEl       = document.getElementById('projectLoadStatus');
  statusEl.textContent = 'loading…';

  const backgroundResponse = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'fetchPiQuixProjects' }, resolve));

  if (!backgroundResponse || !backgroundResponse.success) {
    statusEl.textContent = '(server offline)';
    return;
  }

  statusEl.textContent = '';
  const { folder: storedFolder } = await getStoredProjectSelection();
  populatePiQuixProjectPicker(backgroundResponse.piQuixProjects, storedFolder);
}

// ---------------------------------------------------------------------------
// Active tab helpers
// ---------------------------------------------------------------------------

async function getActiveClaudeTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab || null;
}

function extractConversationIdFromUrl(tabUrl) {
  try {
    const urlPath = new URL(tabUrl).pathname;
    const idMatch = urlPath.match(/\/chat\/([a-f0-9-]+)/);
    return idMatch ? idMatch[1] : null;
  } catch (_err) {
    return null;
  }
}

function getSelectedProject() {
  const selectEl       = document.getElementById('piQuixProjectSelect');
  const selectedOption = selectEl.selectedOptions[0];
  return {
    folder:      selectEl.value || '',
    projectName: selectedOption ? (selectedOption.dataset.projectName || '') : ''
  };
}

// ---------------------------------------------------------------------------
// Ensure content script is loaded before any export
// ---------------------------------------------------------------------------

async function ensureContentScript(tabId) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'ensureContentScript' }, resolve));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  // Version display
  const manifest = chrome.runtime.getManifest();
  document.getElementById('header-version').textContent = `v${manifest.version}`;

  // Resolve org + account slug
  const { orgId, orgName } = await resolveOrgId();
  if (!orgId) document.getElementById('setupNotice').hidden = false;

  // Resolve account slug and cache it
  let accountSlug = 'unknown';
  if (orgId) {
    const slugResult = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action: 'fetchAccountSlug', orgId, orgName }, resolve));
    if (slugResult && slugResult.success) {
      accountSlug = slugResult.accountSlug;
      chrome.storage.sync.set({ currentAccountSlug: accountSlug });
    }
  }

  // Load project picker
  await loadPiQuixProjects();

  // Restore project selection and update route note
  const { folder: storedFolder } = await getStoredProjectSelection();
  if (storedFolder) updateProjectRouteNote(storedFolder, accountSlug);

  // Wire project picker changes
  document.getElementById('piQuixProjectSelect').addEventListener('change', async e => {
    const selectedOption = e.target.selectedOptions[0];
    const folder     = e.target.value;
    const projName   = selectedOption ? (selectedOption.dataset.projectName || '') : '';
    await saveProjectSelection(folder, projName);
    updateProjectRouteNote(folder, accountSlug);
  });

  document.getElementById('openOptions')?.addEventListener('click', e => {
    e.preventDefault(); chrome.runtime.openOptionsPage();
  });
});

// ---------------------------------------------------------------------------
// Export Current Conversation
// ---------------------------------------------------------------------------

document.getElementById('exportCurrent').addEventListener('click', async () => {
  const exportBtn    = document.getElementById('exportCurrent');
  exportBtn.disabled = true;
  showStatus('Fetching conversation…', 'info');

  try {
    const { orgId, orgName } = await resolveOrgId();
    const activeTab = await getActiveClaudeTab();

    if (!orgId) throw new Error('Organization ID not configured. Open Settings to fix.');
    if (!activeTab || !activeTab.url) throw new Error('No active tab detected.');
    if (!activeTab.url.includes('claude.ai')) throw new Error('Navigate to a Claude.ai conversation first.');

    const conversationId = extractConversationIdFromUrl(activeTab.url);
    if (!conversationId) throw new Error('Could not detect conversation ID. Open a Claude.ai conversation first.');

    // FIX Bug 4: ensure content script is loaded before sending
    await ensureContentScript(activeTab.id);

    const selectedProject = getSelectedProject();
    const accountSlug     = await getStoredAccountSlug();

    chrome.tabs.sendMessage(activeTab.id, {
      action:        'exportToIncoming',
      conversationId,
      orgId,
      orgName,
      accountSlug,
      projectFolder: selectedProject.folder,
      projectName:   selectedProject.projectName,
      tabUrl:        activeTab.url,
    }, serverResponse => {
      if (chrome.runtime.lastError) {
        showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      } else if (serverResponse && serverResponse.success) {
        const fname    = serverResponse.data?.jsonFilename || 'saved';
        const artCount = serverResponse.data?.artifactCount
          ? ` · ${serverResponse.data.artifactCount} artifact(s)` : '';
        showStatus(`✅ ${fname}${artCount}`, 'success');
      } else {
        showStatus((serverResponse && serverResponse.error) || 'Export failed', 'error');
      }
      exportBtn.disabled = false;
    });

  } catch (err) {
    showStatus(err.message, 'error');
    exportBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Download Project Home Page
// ---------------------------------------------------------------------------

document.getElementById('exportProjectHome').addEventListener('click', async () => {
  const homeBtn    = document.getElementById('exportProjectHome');
  homeBtn.disabled = true;
  showStatus('Fetching project home…', 'info');

  try {
    const { orgId, orgName } = await resolveOrgId();
    const activeTab = await getActiveClaudeTab();

    if (!orgId)   throw new Error('Organization ID not configured.');
    if (!activeTab || !activeTab.url) throw new Error('No active tab detected.');
    if (!activeTab.url.includes('claude.ai')) throw new Error('Navigate to a Claude.ai conversation first.');

    const conversationId = extractConversationIdFromUrl(activeTab.url);
    if (!conversationId) throw new Error('Open a Claude.ai conversation inside a project first.');

    await ensureContentScript(activeTab.id);

    const selectedProject = getSelectedProject();
    if (!selectedProject.folder) throw new Error('Select a PiQuix project first.');

    const accountSlug = await getStoredAccountSlug();

    chrome.tabs.sendMessage(activeTab.id, {
      action:        'exportProjectHome',
      conversationId,
      orgId,
      orgName,
      accountSlug,
      projectFolder: selectedProject.folder,
      tabUrl:        activeTab.url,
    }, serverResponse => {
      if (chrome.runtime.lastError) {
        showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      } else if (serverResponse && serverResponse.success) {
        const projName = serverResponse.projectName || 'project';
        showStatus(`✅ ${projName} home saved`, 'success');
      } else {
        showStatus((serverResponse && serverResponse.error) || 'Project home export failed', 'error');
      }
      homeBtn.disabled = false;
    });

  } catch (err) {
    showStatus(err.message, 'error');
    homeBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Browse All Conversations
// ---------------------------------------------------------------------------

document.getElementById('browseConversations').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('browse.html') });
});

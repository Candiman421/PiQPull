// PiQPull — Popup Logic
// Handles: org ID resolution, project picker, export routing, option persistence.

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function getStoredOrgId() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['organizationId'], stored => resolve(stored.organizationId || null));
  });
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
        return relayResponse.orgId;
      }
    }
  } catch (_err) {
    // fall through to stored value
  }
  return getStoredOrgId();
}

function getStoredProjectSelection() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['piQuixProjectFolder', 'piQuixProjectName'], stored => {
      resolve({ folder: stored.piQuixProjectFolder || '', projectName: stored.piQuixProjectName || '' });
    });
  });
}

function saveProjectSelection(folder, projectName) {
  return new Promise(resolve => {
    chrome.storage.sync.set({ piQuixProjectFolder: folder, piQuixProjectName: projectName }, resolve);
  });
}

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

function showStatus(message, statusType) {
  const statusEl      = document.getElementById('status');
  const resolvedType  = statusType || 'info';
  statusEl.className  = `status ${resolvedType}`;

  if (resolvedType === 'error' && (message.includes('403') || message.includes('404'))) {
    statusEl.innerHTML = `${message}<br>Is your <a href="#" id="statusOpenOptions">Organization ID</a> correct?`;
    document.getElementById('statusOpenOptions').addEventListener('click', e => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  } else {
    statusEl.textContent = message;
  }

  if (resolvedType === 'success') {
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 4000);
  }
}

// ---------------------------------------------------------------------------
// Route note — shows actual folder name when project is selected
// ---------------------------------------------------------------------------

function updateProjectRouteNote(selectedFolder) {
  const noteEl    = document.getElementById('projectRouteNote');
  const pathEl    = document.getElementById('projectRoutePath');
  const modeNote  = document.getElementById('incomingModeNote');
  if (!noteEl) return;

  if (selectedFolder) {
    noteEl.classList.remove('hidden');
    if (pathEl) pathEl.textContent = `incoming\\${selectedFolder}\\{chat}\\`;
    if (modeNote) modeNote.classList.remove('hidden');
  } else {
    noteEl.classList.add('hidden');
    if (modeNote) modeNote.classList.add('hidden');
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
    const optGroup   = document.createElement('optgroup');
    optGroup.label   = section;
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

  updateProjectRouteNote(selectEl.value);
}

async function loadPiQuixProjects() {
  const statusEl       = document.getElementById('projectLoadStatus');
  statusEl.textContent = 'loading…';

  const backgroundResponse = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'fetchPiQuixProjects' }, resolve);
  });

  if (!backgroundResponse || !backgroundResponse.success) {
    statusEl.textContent = '(server offline)';
    return;
  }

  statusEl.textContent = '';
  const { folder: storedFolder } = await getStoredProjectSelection();
  populatePiQuixProjectPicker(backgroundResponse.piQuixProjects, storedFolder);
}

// ---------------------------------------------------------------------------
// Option gathering
// ---------------------------------------------------------------------------

function gatherExportOptions() {
  return {
    format:           document.getElementById('format').value,
    includeChats:     document.getElementById('includeChats').checked,
    includeThinking:  document.getElementById('includeThinking').checked,
    includeMetadata:  document.getElementById('includeMetadata').checked,
    includeArtifacts: document.getElementById('includeArtifacts').checked,
    extractArtifacts: document.getElementById('extractArtifacts').checked,
    artifactFormat:   document.getElementById('artifactFormat').value,
    flattenArtifacts: document.getElementById('flattenArtifacts').checked,
    serverPush:       document.getElementById('serverPush').checked
  };
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
  } catch (_parseErr) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Get stored org name (set by content.js detectOrgId)
// ---------------------------------------------------------------------------

function getStoredOrgName() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['orgName'], stored => resolve(stored.orgName || null));
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  // Version display
  const manifest = chrome.runtime.getManifest();
  document.getElementById('header-version').textContent = `v${manifest.version}`;

  // Restore persisted option states
  chrome.storage.sync.get(['serverPush', 'includeThinking', 'includeMetadata'], stored => {
    // serverPush: default off
    if (stored.serverPush) document.getElementById('serverPush').checked = true;

    // Thinking + Metadata: default ON (HTML already has checked, but respect if user changed it)
    // Only override HTML default if a stored value exists (null = first run, keep HTML default)
    if (stored.includeThinking === false) document.getElementById('includeThinking').checked = false;
    if (stored.includeMetadata === false) document.getElementById('includeMetadata').checked = false;
  });

  // Persist option changes
  document.getElementById('serverPush').addEventListener('change', e => {
    chrome.storage.sync.set({ serverPush: e.target.checked });
  });
  document.getElementById('includeThinking').addEventListener('change', e => {
    chrome.storage.sync.set({ includeThinking: e.target.checked });
  });
  document.getElementById('includeMetadata').addEventListener('change', e => {
    chrome.storage.sync.set({ includeMetadata: e.target.checked });
  });

  // Resolve org ID (also stores orgName via content.js detectOrgId)
  const orgId = await resolveOrgId();
  if (!orgId) document.getElementById('setupNotice').hidden = false;

  // Load PiQuix project picker
  await loadPiQuixProjects();

  // Save project selection on change + update route note
  document.getElementById('piQuixProjectSelect').addEventListener('change', async (e) => {
    const selectedOption = e.target.selectedOptions[0];
    const folder         = e.target.value;
    const projName       = selectedOption ? (selectedOption.dataset.projectName || '') : '';
    await saveProjectSelection(folder, projName);
    updateProjectRouteNote(folder);
  });

  // Checkbox dependency: Chats gates Thinking / Metadata / Inline Artifacts
  const chatsEl  = document.getElementById('includeChats');
  const gatedEls = ['includeThinking', 'includeMetadata', 'includeArtifacts']
    .map(elId => document.getElementById(elId));

  function syncGatedCheckboxes() {
    const chatsEnabled = chatsEl.checked;
    gatedEls.forEach(el => {
      el.disabled = !chatsEnabled;
      if (!chatsEnabled) el.checked = false;
    });
  }

  chatsEl.addEventListener('change', syncGatedCheckboxes);
  syncGatedCheckboxes();

  document.getElementById('openOptions').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});

// ---------------------------------------------------------------------------
// Export current conversation
// ---------------------------------------------------------------------------

document.getElementById('exportCurrent').addEventListener('click', async () => {
  const exportBtn      = document.getElementById('exportCurrent');
  exportBtn.disabled   = true;
  showStatus('Fetching conversation…', 'info');

  try {
    const orgId      = await resolveOrgId();
    const orgName    = await getStoredOrgName();
    const activeTab  = await getActiveClaudeTab();

    if (!orgId) throw new Error('Organization ID not configured. Click the setup link above.');
    if (!activeTab || !activeTab.url) throw new Error('No active tab detected.');
    if (!activeTab.url.includes('claude.ai')) throw new Error('Navigate to a Claude.ai conversation first.');

    const conversationId = extractConversationIdFromUrl(activeTab.url);
    if (!conversationId) throw new Error('Could not detect conversation ID. Open a Claude.ai conversation first.');

    const selectedProject = getSelectedProject();
    const exportOptions   = gatherExportOptions();

    if (selectedProject.folder) {
      // Project selected → structured /export/incoming path
      chrome.tabs.sendMessage(activeTab.id, {
        action:        'exportToIncoming',
        conversationId,
        orgId,
        orgName,
        projectFolder: selectedProject.folder,
        projectName:   selectedProject.projectName,
        tabUrl:        activeTab.url,
        ...exportOptions
      }, serverResponse => {
        if (chrome.runtime.lastError) {
          showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
        } else if (serverResponse && serverResponse.success) {
          const fname    = serverResponse.data && serverResponse.data.jsonFilename
            ? serverResponse.data.jsonFilename : 'saved';
          const artCount = serverResponse.data && serverResponse.data.artifactCount
            ? ` · ${serverResponse.data.artifactCount} artifact(s)` : '';
          showStatus(`✅ ${fname}${artCount}`, 'success');
        } else {
          showStatus((serverResponse && serverResponse.error) || 'Export to incoming failed', 'error');
        }
        exportBtn.disabled = false;
      });

    } else {
      // No project → legacy browser download
      chrome.tabs.sendMessage(activeTab.id, {
        action: 'exportConversation',
        conversationId,
        orgId,
        orgName,
        ...exportOptions
      }, downloadResponse => {
        if (chrome.runtime.lastError) {
          showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
        } else if (downloadResponse && downloadResponse.success) {
          showStatus('Exported to Downloads!', 'success');
        } else {
          showStatus((downloadResponse && downloadResponse.error) || 'Export failed', 'error');
        }
        exportBtn.disabled = false;
      });
    }
  } catch (err) {
    showStatus(err.message, 'error');
    exportBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Export all conversations
// When a project is selected: open Browse page — that's where the bulk
// incoming pipeline lives (PiQ Orb, PiQExportSession, per-conv routing).
// When no project: legacy ZIP download.
// ---------------------------------------------------------------------------

document.getElementById('exportAll').addEventListener('click', async () => {
  const selectedProject = getSelectedProject();

  if (selectedProject.folder) {
    // Project selected — redirect to Browse page which has the full pipeline
    showStatus('Opening Browse page for bulk export…', 'info');
    chrome.tabs.create({ url: chrome.runtime.getURL('browse.html') });
    return;
  }

  // No project selected — legacy ZIP download
  const exportAllBtn       = document.getElementById('exportAll');
  exportAllBtn.disabled    = true;
  showStatus('Fetching all conversations…', 'info');

  try {
    const orgId   = await resolveOrgId();
    if (!orgId) throw new Error('Organization ID not configured. Click the setup link above.');
    const activeTab = await getActiveClaudeTab();

    chrome.tabs.sendMessage(activeTab.id, {
      action: 'exportAllConversations',
      orgId,
      ...gatherExportOptions()
    }, bulkResponse => {
      if (chrome.runtime.lastError) {
        showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      } else if (bulkResponse && bulkResponse.success) {
        showStatus(bulkResponse.warnings || `Exported ${bulkResponse.count} conversations!`,
          bulkResponse.warnings ? 'info' : 'success');
      } else {
        showStatus((bulkResponse && bulkResponse.error) || 'Export failed', 'error');
      }
      exportAllBtn.disabled = false;
    });
  } catch (err) {
    showStatus(err.message, 'error');
    exportAllBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Open browse page
// ---------------------------------------------------------------------------

document.getElementById('browseConversations').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('browse.html') });
});

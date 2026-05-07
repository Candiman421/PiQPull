// PiQPull — Popup Logic

async function getStoredOrgId() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['organizationId'], result => resolve(result.organizationId));
  });
}

async function getOrgId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('claude.ai')) {
      const response = await new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, { action: 'detectOrgId' }, res => {
          resolve(chrome.runtime.lastError ? null : res);
        });
      });
      if (response && response.success && response.orgId) {
        chrome.storage.sync.set({ organizationId: response.orgId });
        return response.orgId;
      }
    }
  } catch (e) {
    console.log('PiQPull: Auto-detect org ID failed, falling back to stored:', e);
  }
  return getStoredOrgId();
}

function showStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.className = `status ${type}`;

  if (type === 'error' && (message.includes('403') || message.includes('404'))) {
    el.innerHTML = `${message}<br>Is your <a href="#" id="statusOpenOptions">Organization ID</a> correct?`;
    document.getElementById('statusOpenOptions').addEventListener('click', e => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  } else {
    el.textContent = message;
  }

  if (type === 'success') {
    setTimeout(() => { el.textContent = ''; el.className = ''; }, 3000);
  }
}

function gatherOptions() {
  return {
    format: document.getElementById('format').value,
    includeChats: document.getElementById('includeChats').checked,
    includeThinking: document.getElementById('includeThinking').checked,
    includeMetadata: document.getElementById('includeMetadata').checked,
    includeArtifacts: document.getElementById('includeArtifacts').checked,
    extractArtifacts: document.getElementById('extractArtifacts').checked,
    artifactFormat: document.getElementById('artifactFormat').value,
    flattenArtifacts: document.getElementById('flattenArtifacts').checked,
    serverPush: document.getElementById('serverPush').checked
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  // Version display
  const manifest = chrome.runtime.getManifest();
  document.getElementById('header-version').textContent = `v${manifest.version}`;

  // Restore serverPush preference
  chrome.storage.sync.get(['serverPush'], result => {
    if (result.serverPush) document.getElementById('serverPush').checked = true;
  });
  document.getElementById('serverPush').addEventListener('change', e => {
    chrome.storage.sync.set({ serverPush: e.target.checked });
  });

  const orgId = await getOrgId();
  if (!orgId) document.getElementById('setupNotice').hidden = false;

  // Checkbox dependency: thinking/metadata/inline artifacts require chats enabled
  const includeChats = document.getElementById('includeChats');
  const deps = ['includeThinking', 'includeMetadata', 'includeArtifacts'].map(id => document.getElementById(id));

  function updateCheckboxStates() {
    const enabled = includeChats.checked;
    deps.forEach(el => {
      el.disabled = !enabled;
      if (!enabled) el.checked = false;
    });
  }

  includeChats.addEventListener('change', updateCheckboxStates);
  updateCheckboxStates();
});

document.getElementById('openOptions').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function getCurrentConversationId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const match = new URL(tab.url).pathname.match(/\/chat\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

document.getElementById('exportCurrent').addEventListener('click', async () => {
  const button = document.getElementById('exportCurrent');
  button.disabled = true;
  showStatus('Fetching conversation...', 'info');

  try {
    const orgId = await getOrgId();
    const conversationId = await getCurrentConversationId();

    if (!orgId) throw new Error('Organization ID not configured. Click the setup link above.');
    if (!conversationId) throw new Error('Could not detect conversation ID. Open a Claude.ai conversation first.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url.includes('claude.ai')) throw new Error('Navigate to a Claude.ai conversation page first.');

    chrome.tabs.sendMessage(tab.id, {
      action: 'exportConversation',
      conversationId,
      orgId,
      ...gatherOptions()
    }, response => {
      if (chrome.runtime.lastError) {
        showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      } else if (response?.success) {
        showStatus('Exported successfully!', 'success');
      } else {
        showStatus(response?.error || 'Export failed', 'error');
      }
      button.disabled = false;
    });
  } catch (error) {
    showStatus(error.message, 'error');
    button.disabled = false;
  }
});

document.getElementById('exportAll').addEventListener('click', async () => {
  const button = document.getElementById('exportAll');
  button.disabled = true;
  showStatus('Fetching all conversations...', 'info');

  try {
    const orgId = await getOrgId();
    if (!orgId) throw new Error('Organization ID not configured. Click the setup link above.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, {
      action: 'exportAllConversations',
      orgId,
      ...gatherOptions()
    }, response => {
      if (chrome.runtime.lastError) {
        showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      } else if (response?.success) {
        showStatus(response.warnings || `Exported ${response.count} conversations!`, response.warnings ? 'info' : 'success');
      } else {
        showStatus(response?.error || 'Export failed', 'error');
      }
      button.disabled = false;
    });
  } catch (error) {
    showStatus(error.message, 'error');
    button.disabled = false;
  }
});

document.getElementById('browseConversations').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('browse.html') });
});

// PiQPull — Popup Logic v1.4.0
// Two buttons only: Export Conversation + Browse All Conversations.
// No project picker — conversation path derived from metadata inside content.js.
// Project Home download moved exclusively to the Browse page.

'use strict';

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
        chrome.runtime.sendMessage({
          action:  'fetchAccountSlug',
          orgId:   relayResponse.orgId,
          orgName: relayResponse.orgName || null,
        }, () => {});
        return { orgId: relayResponse.orgId, orgName: relayResponse.orgName || null };
      }
    }
  } catch (_err) { /* fall through */ }
  const storedOrgId  = await getStoredOrgId();
  const storedOrgName = await new Promise(resolve =>
    chrome.storage.sync.get(['orgName'], s => resolve(s.orgName || null)));
  return { orgId: storedOrgId, orgName: storedOrgName };
}

function getStoredAccountSlug() {
  return new Promise(resolve =>
    chrome.storage.sync.get(['currentAccountSlug'], s => resolve(s.currentAccountSlug || 'unknown')));
}

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

function showStatus(message, statusType) {
  const statusEl     = document.getElementById('status');
  if (!statusEl) return;
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

// ---------------------------------------------------------------------------
// Ensure content script is loaded before any export
// ---------------------------------------------------------------------------

async function ensureContentScript(_tabId) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'ensureContentScript' }, resolve));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  // Version display
  const manifest = chrome.runtime.getManifest();
  const versionEl = document.getElementById('header-version');
  if (versionEl) versionEl.textContent = `v${manifest.version}`;

  // Resolve org + account slug
  const { orgId, orgName } = await resolveOrgId();
  const setupNotice = document.getElementById('setupNotice');
  if (setupNotice) setupNotice.hidden = !!orgId;

  if (orgId) {
    const slugResult = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action: 'fetchAccountSlug', orgId, orgName }, resolve));
    if (slugResult && slugResult.success) {
      chrome.storage.sync.set({ currentAccountSlug: slugResult.accountSlug });
    }
  }

  document.getElementById('openOptions')?.addEventListener('click', e => {
    e.preventDefault(); chrome.runtime.openOptionsPage();
  });
});

// ---------------------------------------------------------------------------
// Export Current Conversation
// Sends message to content.js which handles fetch + push to /export/incoming.
// Path is always derived from conversation metadata — no project selection needed here.
// ---------------------------------------------------------------------------

document.getElementById('exportCurrent').addEventListener('click', async () => {
  const exportBtn    = document.getElementById('exportCurrent');
  exportBtn.disabled = true;
  showStatus('Fetching conversation…', 'info');

  try {
    const { orgId, orgName } = await resolveOrgId();
    const activeTab          = await getActiveClaudeTab();

    if (!orgId)                throw new Error('Organization ID not configured. Open Settings to fix.');
    if (!activeTab?.url)       throw new Error('No active tab detected.');
    if (!activeTab.url.includes('claude.ai')) throw new Error('Navigate to a Claude.ai conversation first.');

    const conversationId = extractConversationIdFromUrl(activeTab.url);
    if (!conversationId)  throw new Error('Could not detect conversation ID. Open a Claude.ai conversation first.');

    await ensureContentScript(activeTab.id);

    const accountSlug = await getStoredAccountSlug();

    // Safety: re-enable button after 30s if callback never fires
    const safetyTimer = setTimeout(() => {
      exportBtn.disabled = false;
      showStatus('Request timed out. Reload and try again.', 'error');
    }, 30000);

    chrome.tabs.sendMessage(activeTab.id, {
      action:        'exportToIncoming',
      conversationId,
      orgId,
      orgName,
      accountSlug,
      projectFolder: '',   // derived from conversation metadata server-side
      projectName:   '',
      tabUrl:        activeTab.url,
    }, serverResponse => {
      clearTimeout(safetyTimer);
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
// Browse All Conversations
// ---------------------------------------------------------------------------

document.getElementById('browseConversations').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('browse.html') });
});

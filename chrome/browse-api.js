// PiQPull — Browse: API Relay
// Single job: communicate with claude.ai via content script relay,
//             and with PiQuix server via background service worker.
// No UI. No state mutation. Returns plain data or throws.

const BrowseApi = (() => {

  // Find a claude.ai tab and relay a message to the content script.
  // Rejects if no claude.ai tab is open.
  function relayToContentScript(action, messageData) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!tabs || tabs.length === 0) {
          reject(new Error('Open a Claude.ai tab first, then reload this page.'));
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { action, ...messageData }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error(response && response.error ? response.error : `${action} failed`));
          }
        });
      });
    });
  }

  // Relay a message to the background service worker.
  function relayToBackground(messagePayload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(messagePayload, (response) => {
        resolve(response || { success: false, error: 'No response from background' });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  // Auto-detect org ID and org name, save both to storage.
  // Returns { orgId, orgName } — callers destructure what they need.
  // Falls back to stored values if auto-detect fails (no claude.ai tab open).
  async function resolveOrgId() {
    try {
      const relayResponse = await relayToContentScript('detectOrgId');
      if (relayResponse.orgId) {
        chrome.storage.sync.set({
          organizationId: relayResponse.orgId,
          orgName:        relayResponse.orgName || null
        });
        return { orgId: relayResponse.orgId, orgName: relayResponse.orgName || null };
      }
    } catch (relayErr) {
      console.warn('PiQPull: org ID auto-detect failed:', relayErr.message);
    }

    return new Promise(resolve => {
      chrome.storage.sync.get(['organizationId', 'orgName'], stored => {
        resolve({ orgId: stored.organizationId || null, orgName: stored.orgName || null });
      });
    });
  }

  async function fetchConversations(orgId) {
    const relayResponse = await relayToContentScript('loadConversations', { orgId });
    return relayResponse.conversations;
  }

  async function fetchProjects(orgId) {
    const relayResponse = await relayToContentScript('loadProjects', { orgId });
    return relayResponse.projects;
  }

  // Push JSONL to /export/write via background service worker (avoids CORS)
  function pushToServer(filename, jsonlContent) {
    return relayToBackground({ action: 'pushToServer', filename, content: jsonlContent });
  }

  // Push structured conversation payload to /export/incoming via background service worker
  function pushToIncoming(incomingPayload) {
    return relayToBackground({ action: 'pushToIncoming', ...incomingPayload });
  }

  // Fetch PiQuix project list from the running local server
  function fetchPiQuixProjects() {
    return relayToBackground({ action: 'fetchPiQuixProjects' });
  }

  return { resolveOrgId, fetchConversations, fetchProjects, pushToServer, pushToIncoming, fetchPiQuixProjects };
})();

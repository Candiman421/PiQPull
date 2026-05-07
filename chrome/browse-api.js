// PiQPull — Browse: API Relay
// Single job: communicate with claude.ai via the content script in an open tab.
// No UI. No state mutation. Returns plain data or throws.

const BrowseApi = (() => {

  // Find a claude.ai tab and send it a message. Rejects if none found.
  function relay(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ url: 'https://claude.ai/*' }, tabs => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!tabs || tabs.length === 0) {
          reject(new Error('Open a Claude.ai tab first, then reload this page.'));
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || `${action} failed`));
          }
        });
      });
    });
  }

  // Auto-detect org ID, save to storage, return string.
  // Falls back to stored value if auto-detect fails.
  async function resolveOrgId() {
    try {
      const r = await relay('detectOrgId');
      if (r.orgId) {
        chrome.storage.sync.set({ organizationId: r.orgId });
        return r.orgId;
      }
    } catch (e) {
      console.warn('PiQPull: org ID auto-detect failed:', e.message);
    }

    return new Promise(resolve => {
      chrome.storage.sync.get(['organizationId'], r => resolve(r.organizationId || null));
    });
  }

  async function fetchConversations(orgId) {
    const r = await relay('loadConversations', { orgId });
    return r.conversations;
  }

  async function fetchProjects(orgId) {
    const r = await relay('loadProjects', { orgId });
    return r.projects;
  }

  // Push JSONL via background service worker (avoids CORS in browse page context)
  function pushToServer(filename, content) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'pushToServer', filename, content }, response => {
        resolve(response || { success: false, error: 'No response from background' });
      });
    });
  }

  return { resolveOrgId, fetchConversations, fetchProjects, pushToServer };
})();

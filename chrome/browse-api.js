// PiQPull — Browse: API Relay v1.2.0
// Single responsibility: communicate with Claude.ai (via content script)
// and PiQuix server (via background). No UI. No state. Returns data or throws.

'use strict';

const BrowseApi = (() => {

  /**
   * Relay a message to the content script of the first open Claude.ai tab.
   * @param {string} action
   * @param {object} data
   * @returns {Promise<object>}
   */
  function relayToContent(action, data) {
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
        chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error((response && response.error) ? response.error : `${action} failed`));
          }
        });
      });
    });
  }

  /**
   * Relay a message to the background service worker.
   * @param {object} payload
   * @returns {Promise<{ success: boolean, error?: string, data?: unknown }>}
   */
  function relayToBackground(payload) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(payload, response => {
        resolve(response || { success: false, error: 'No response from background' });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Auto-detect org ID and name; fall back to storage.
   * @returns {Promise<{ orgId: string|null, orgName: string|null }>}
   */
  async function resolveOrgId() {
    try {
      const res = await relayToContent('detectOrgId', {});
      if (res && res.orgId) {
        chrome.storage.sync.set({
          organizationId: res.orgId,
          orgName:        res.orgName || null,
        });
        return { orgId: res.orgId, orgName: res.orgName || null };
      }
    } catch (e) {
      console.warn('PiQPull: org ID auto-detect failed:', e.message);
    }
    return new Promise(resolve => {
      chrome.storage.sync.get(['organizationId', 'orgName'], stored => {
        resolve({
          orgId:   stored.organizationId || null,
          orgName: stored.orgName        || null,
        });
      });
    });
  }

  /**
   * @param {string} orgId
   * @returns {Promise<unknown[]>}
   */
  async function fetchConversations(orgId) {
    const res = await relayToContent('loadConversations', { orgId });
    const conversations = Array.isArray(res && res.conversations) ? res.conversations : [];
    return conversations;
  }

  /**
   * @param {string} orgId
   * @returns {Promise<unknown[]>}
   */
  async function fetchProjects(orgId) {
    const res = await relayToContent('loadProjects', { orgId });
    const projects = Array.isArray(res && res.projects) ? res.projects : [];
    return projects;
  }

  /**
   * Push JSONL to /export/write via background (avoids CORS).
   * @param {string} filename
   * @param {string} jsonlContent
   */
  function pushToServer(filename, jsonlContent) {
    return relayToBackground({ action: 'pushToServer', filename, content: jsonlContent });
  }

  /**
   * Push structured conversation payload to /export/incoming.
   * @param {object} payload
   */
  function pushToIncoming(payload) {
    return relayToBackground({ action: 'pushToIncoming', ...payload });
  }

  /**
   * Push session log to account-level folder on server.
   * @param {{ accountSlug: string, projectFolder: string, timestamp: string, logContent: string }} opts
   */
  function pushSessionLog(opts) {
    return relayToBackground({ action: 'pushSessionLog', ...opts });
  }

  /**
   * Fetch PiQuix project list from local server.
   */
  function fetchPiQuixProjects() {
    return relayToBackground({ action: 'fetchPiQuixProjects' });
  }

  return {
    resolveOrgId, fetchConversations, fetchProjects,
    pushToServer, pushToIncoming, pushSessionLog, fetchPiQuixProjects,
  };
})();

// PiQPull — Background Service Worker v1.3.0
// v1.3.0: postToServer — 90s AbortController timeout prevents service worker from hanging
//         on slow server responses (large payloads, disk writes, etc.)

'use strict';

const PIQUIX_SERVER = 'http://localhost:7432';

// ── Install: reinject content scripts into open Claude.ai tabs ────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: 'https://claude.ai/*' }, tabs => {
    if (!tabs) return;
    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files:  ['jszip.min.js', 'utils.js', 'content.js'],
      }).catch(err => console.warn('PiQPull: reinject failed for tab', tab.id, err.message));
    }
  });
});

// ── Account alias helpers ─────────────────────────────────────────────────

/** @param {string} orgId @param {string|null} orgName @returns {Promise<string>} */
async function resolveAccountSlug(orgId, orgName) {
  if (!orgId) return 'unknown';
  const stored = await new Promise(resolve =>
    chrome.storage.sync.get(['orgAliases'], s => resolve(s.orgAliases || {})));
  if (stored[orgId]) return stored[orgId];
  const match = (orgName || '').match(/^([^@]+)@/);
  return match ? match[1] : 'unknown';
}

/** @param {string} orgId @param {string|null} orgName */
async function trackKnownOrg(orgId, orgName) {
  if (!orgId) return;
  const stored = await new Promise(resolve =>
    chrome.storage.sync.get(['knownOrgs'], s => resolve(s.knownOrgs || {})));
  if (!stored[orgId]) {
    stored[orgId] = { orgId, orgName: orgName || '', firstSeen: new Date().toISOString() };
    chrome.storage.sync.set({ knownOrgs: stored });
  }
}

// ── Message router ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case 'ensureContentScript':   handleEnsureContentScript(sendResponse); return true;
    case 'pushToServer':          handlePushToServer(request, sendResponse); return true;
    case 'pushToIncoming':        handlePushToIncoming(request, sendResponse); return true;
    case 'pushProjectHome':       handlePushProjectHome(request, sendResponse); return true;
    case 'pushSessionLog':        handlePushSessionLog(request, sendResponse); return true;
    case 'fetchPiQuixProjects':   handleFetchPiQuixProjects(sendResponse); return true;
    case 'fetchAccountSlug':      handleFetchAccountSlug(request, sendResponse); return true;
    case 'saveOrgAlias':          handleSaveOrgAlias(request, sendResponse); return true;
    case 'getKnownOrgs':          handleGetKnownOrgs(sendResponse); return true;
    default: return false;
  }
});

// ── Handlers ─────────────────────────────────────────────────────────────

function handleEnsureContentScript(sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs || tabs.length === 0) {
      sendResponse({ success: false, error: 'No active tab' }); return;
    }
    chrome.scripting.executeScript(
      { target: { tabId: tabs[0].id }, files: ['jszip.min.js', 'utils.js', 'content.js'] },
      () => sendResponse({ success: !chrome.runtime.lastError })
    );
  });
}

function handlePushToServer(request, sendResponse) {
  const { filename, content } = request;
  postToServer('/export/write', { filename, content })
    .then(r => sendResponse(r))
    .catch(e => sendResponse({ success: false, error: e.message }));
}

function handlePushToIncoming(request, sendResponse) {
  const {
    projectFolder, accountSlug, chatSlug, conversationId,
    exportPayload, imageAssets, artifactFiles,
  } = request;

  postToServer('/export/incoming', {
    projectFolder:  projectFolder  || '',
    accountSlug:    accountSlug    || 'unknown',
    chatSlug:       chatSlug       || 'untitled',
    conversationId: conversationId || '',
    exportPayload:  exportPayload  || {},
    imageAssets:    Array.isArray(imageAssets)   ? imageAssets   : [],
    artifactFiles:  Array.isArray(artifactFiles) ? artifactFiles : [],
  })
    .then(r => sendResponse(r))
    .catch(e => sendResponse({ success: false, error: e.message }));
}

function handlePushProjectHome(request, sendResponse) {
  const { accountSlug, projectFolder, payload } = request;
  postToServer('/export/project-home', {
    accountSlug:   accountSlug   || 'unknown',
    projectFolder: projectFolder || 'unknown',
    payload:       payload       || {},
  })
    .then(r => sendResponse(r))
    .catch(e => sendResponse({ success: false, error: e.message }));
}

function handlePushSessionLog(request, sendResponse) {
  const { accountSlug, projectFolder, timestamp, logContent } = request;
  postToServer('/export/session-log', {
    accountSlug:   accountSlug   || 'unknown',
    projectFolder: projectFolder || '_no-project',
    timestamp:     timestamp     || String(Date.now()),
    logContent:    logContent    || '',
  })
    .then(r => sendResponse(r))
    .catch(e => sendResponse({ success: false, error: e.message }));
}

function handleFetchPiQuixProjects(sendResponse) {
  fetch(`${PIQUIX_SERVER}/api/projects`, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
    .then(async res => {
      if (!res.ok) { sendResponse({ success: false, error: `Server ${res.status}` }); return; }
      const data = await res.json();
      const projects = Array.isArray(data && data.projects) ? data.projects : [];
      const piQuixProjects = projects
        .filter(p => p && p.claudeProject && p.folder)
        .map(p => ({ folder: p.folder, claudeProject: p.claudeProject, navSection: p.navSection || 'OTHER' }));
      sendResponse({ success: true, piQuixProjects });
    })
    .catch(e => sendResponse({ success: false, error: e.message }));
}

function handleFetchAccountSlug(request, sendResponse) {
  const { orgId, orgName } = request;
  if (orgId) trackKnownOrg(orgId, orgName || null);
  resolveAccountSlug(orgId || '', orgName || null)
    .then(slug => sendResponse({ success: true, accountSlug: slug }))
    .catch(e  => sendResponse({ success: false, error: e.message, accountSlug: 'unknown' }));
}

function handleSaveOrgAlias(request, sendResponse) {
  const { orgId, alias } = request;
  if (!orgId) { sendResponse({ success: false, error: 'orgId required' }); return; }
  chrome.storage.sync.get(['orgAliases'], stored => {
    const aliases = stored.orgAliases || {};
    if (alias && alias.trim()) {
      aliases[orgId] = alias.trim();
    } else {
      delete aliases[orgId];
    }
    chrome.storage.sync.set({ orgAliases: aliases }, () =>
      sendResponse({ success: true, orgId, alias: aliases[orgId] || null }));
  });
}

function handleGetKnownOrgs(sendResponse) {
  chrome.storage.sync.get(['knownOrgs', 'orgAliases'], stored => {
    const knownOrgs  = stored.knownOrgs  || {};
    const orgAliases = stored.orgAliases || {};
    const orgs = Object.values(knownOrgs).map(org => ({
      orgId:     org.orgId,
      orgName:   org.orgName    || '',
      alias:     orgAliases[org.orgId] || null,
      firstSeen: org.firstSeen || null,
    }));
    sendResponse({ success: true, orgs });
  });
}

// ── Server communication ──────────────────────────────────────────────────

/** @param {string} path @param {object} body @returns {Promise<{ success: boolean, data?: unknown, error?: string }>} */
async function postToServer(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000); // 90s timeout — prevents service worker hang on large payloads
  let res;
  try {
    res = await fetch(`${PIQUIX_SERVER}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
  } catch (netErr) {
    return { success: false, error: netErr.name === 'AbortError' ? 'Server timeout (90s) — server may be overloaded or payload too large' : `Network error: ${netErr.message}` };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { success: false, error: `Server ${res.status}: ${text}` };
  }

  const data = await res.json().catch(() => ({}));
  return { success: true, data };
}

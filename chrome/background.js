// PiQPull — Background Service Worker
// Handles: extension install injection, content script relay,
//           server push to localhost:7432 (avoids CORS from page context).

const PIQUIX_SERVER_BASE = 'http://localhost:7432';

chrome.runtime.onInstalled.addListener(reinjectOpenClaudeTabs);

function reinjectOpenClaudeTabs() {
  chrome.tabs.query({ url: 'https://claude.ai/*' }, openTabs => {
    openTabs.forEach(tab => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files:  ['jszip.min.js', 'utils.js', 'content.js']
      }).catch(err => console.warn('PiQPull: Could not inject into tab', tab.id, err));
    });
  });
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case 'ensureContentScript':   return handleEnsureContentScript(sendResponse);
    case 'pushToServer':          return handlePushToServer(request, sendResponse);
    case 'pushToIncoming':        return handlePushToIncoming(request, sendResponse);
    case 'fetchPiQuixProjects':   return handleFetchPiQuixProjects(sendResponse);
    default:                      return false;
  }
});

function handleEnsureContentScript(sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs || tabs.length === 0) { sendResponse({ success: false, error: 'No active tab found' }); return; }
    chrome.scripting.executeScript(
      { target: { tabId: tabs[0].id }, files: ['jszip.min.js', 'utils.js', 'content.js'] },
      () => sendResponse({ success: true })
    );
  });
  return true;
}

function handlePushToServer(request, sendResponse) {
  const { filename, content } = request;
  postToServer('/export/write', { filename, content })
    .then(result => sendResponse(result))
    .catch(err  => sendResponse({ success: false, error: err.message }));
  return true;
}

// Structured incoming push — forwards all fields including orgName and artifactFiles.
function handlePushToIncoming(request, sendResponse) {
  const {
    projectFolder,
    chatSlug,
    conversationId,
    exportPayload,
    imageAssets,
    artifactFiles,  // [{ filename, content }] — text artifacts for disk write
  } = request;

  postToServer('/export/incoming', {
    projectFolder,
    chatSlug,
    conversationId,
    exportPayload,
    imageAssets:   imageAssets   || [],
    artifactFiles: artifactFiles || [],
  })
    .then(result => sendResponse(result))
    .catch(err  => sendResponse({ success: false, error: err.message }));

  return true;
}

function handleFetchPiQuixProjects(sendResponse) {
  fetch(`${PIQUIX_SERVER_BASE}/api/projects`, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
    .then(async serverResponse => {
      if (!serverResponse.ok) { sendResponse({ success: false, error: `Server ${serverResponse.status}` }); return; }
      const responseData  = await serverResponse.json();
      const piQuixProjects = (responseData.projects || [])
        .filter(proj => proj.claudeProject && proj.folder)
        .map(proj => ({
          folder:        proj.folder,
          claudeProject: proj.claudeProject,
          navSection:    proj.navSection || 'OTHER'
        }));
      sendResponse({ success: true, piQuixProjects });
    })
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true;
}

async function postToServer(endpointPath, bodyPayload) {
  const serverResponse = await fetch(`${PIQUIX_SERVER_BASE}${endpointPath}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(bodyPayload)
  });
  if (!serverResponse.ok) {
    const errorText = await serverResponse.text();
    return { success: false, error: `Server ${serverResponse.status}: ${errorText}` };
  }
  return { success: true, data: await serverResponse.json() };
}

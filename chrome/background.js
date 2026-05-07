// PiQPull — Background Service Worker
// Handles: extension install/update injection, content script relay,
//           server push to localhost:7432 (avoids CORS from page context).

chrome.runtime.onInstalled.addListener(() => {
  console.log('PiQPull installed');

  // Re-inject into any already-open claude.ai tabs
  chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['jszip.min.js', 'utils.js', 'content.js']
      }).catch(err => console.log('PiQPull: Could not inject into tab', tab.id, err));
    });
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // Ensure content scripts are injected into the active tab
  if (request.action === 'ensureContentScript') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['jszip.min.js', 'utils.js', 'content.js']
        }, () => sendResponse({ success: true }));
      }
    });
    return true;
  }

  // Push JSONL to PiQuix server (called from content script or browse page).
  // Service worker context avoids CORS issues.
  if (request.action === 'pushToServer') {
    const { filename, content } = request;

    fetch('http://localhost:7432/export/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content })
    })
      .then(async response => {
        if (!response.ok) {
          const text = await response.text();
          sendResponse({ success: false, error: `Server ${response.status}: ${text}` });
        } else {
          sendResponse({ success: true });
        }
      })
      .catch(err => {
        // Server not running — non-fatal, log only
        console.warn('PiQPull: Server push failed (server may not be running):', err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }
});

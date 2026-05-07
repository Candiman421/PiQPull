// PiQPull — Options Page Logic
// Single job: load/save/test settings. No export logic here.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function setStatus(elementId, message, type) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `status ${type}`;
}

function clearStatus(elementId) {
  const el = document.getElementById(elementId);
  el.textContent = '';
  el.className = 'status';
}

// Load saved settings on page open
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['organizationId', 'serverPush'], result => {
    if (result.organizationId) {
      document.getElementById('orgId').value = result.organizationId;
    }
    document.getElementById('serverPushGlobal').checked = !!result.serverPush;
  });
});

// Save org ID
document.getElementById('saveBtn').addEventListener('click', () => {
  const orgId = document.getElementById('orgId').value.trim();

  if (!orgId) {
    setStatus('saveStatus', 'Enter an Organization ID or use Clear to remove stored value.', 'error');
    return;
  }

  if (!UUID_REGEX.test(orgId)) {
    setStatus('saveStatus', 'Invalid format. Must be UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'error');
    return;
  }

  chrome.storage.sync.set({ organizationId: orgId }, () => {
    setStatus('saveStatus', 'Saved.', 'success');
    setTimeout(() => clearStatus('saveStatus'), 2000);
  });
});

// Clear stored org ID (revert to auto-detect)
document.getElementById('clearBtn').addEventListener('click', () => {
  chrome.storage.sync.remove('organizationId', () => {
    document.getElementById('orgId').value = '';
    setStatus('saveStatus', 'Cleared. Auto-detect will be used.', 'success');
    setTimeout(() => clearStatus('saveStatus'), 2000);
  });
});

// Save server push preference
document.getElementById('saveServerPush').addEventListener('click', () => {
  const enabled = document.getElementById('serverPushGlobal').checked;
  chrome.storage.sync.set({ serverPush: enabled }, () => {
    setStatus('serverPushStatus', `Server push default set to: ${enabled ? 'ON' : 'OFF'}.`, 'success');
    setTimeout(() => clearStatus('serverPushStatus'), 2000);
  });
});

// Test connection — direct fetch from options page using stored/entered org ID
document.getElementById('testBtn').addEventListener('click', async () => {
  const entered = document.getElementById('orgId').value.trim();
  let orgId = entered;

  if (!orgId) {
    // Fall back to stored
    orgId = await new Promise(resolve => {
      chrome.storage.sync.get(['organizationId'], r => resolve(r.organizationId || ''));
    });
  }

  if (!orgId) {
    setStatus('testStatus', 'No Organization ID available. Auto-detect requires an open Claude.ai tab.', 'error');
    return;
  }

  setStatus('testStatus', 'Testing...', 'success');

  try {
    const response = await fetch(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations`,
      { credentials: 'include', headers: { Accept: 'application/json' } }
    );

    if (response.ok) {
      const data = await response.json();
      setStatus('testStatus', `Connected. Found ${data.length} conversation(s).`, 'success');
    } else if (response.status === 401) {
      setStatus('testStatus', 'Not authenticated. Log into Claude.ai first.', 'error');
    } else if (response.status === 403) {
      setStatus('testStatus', 'Access denied. Organization ID may be incorrect.', 'error');
    } else {
      setStatus('testStatus', `HTTP ${response.status}`, 'error');
    }
  } catch (err) {
    setStatus('testStatus', `Connection error: ${err.message}`, 'error');
  }
});

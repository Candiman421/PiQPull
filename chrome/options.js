// PiQPull — Options Page v1.2.0
// Handles: org ID override, account name aliases, server push preference.

'use strict';

document.addEventListener('DOMContentLoaded', () => {

  const orgIdEl          = /** @type {HTMLInputElement}  */ (document.getElementById('orgId'));
  const saveBtn          = document.getElementById('saveBtn');
  const clearBtn         = document.getElementById('clearBtn');
  const saveStatusEl     = document.getElementById('saveStatus');
  const testBtn          = document.getElementById('testBtn');
  const testStatusEl     = document.getElementById('testStatus');
  const serverPushEl     = /** @type {HTMLInputElement}  */ (document.getElementById('serverPushGlobal'));
  const saveServerPushBtn = document.getElementById('saveServerPush');
  const serverPushStatusEl = document.getElementById('serverPushStatus');
  const orgAliasListEl   = document.getElementById('orgAliasList');
  const saveAliasesBtn   = document.getElementById('saveAliasesBtn');
  const aliasStatusEl    = document.getElementById('aliasStatus');
  const orgLoadingHint   = document.getElementById('orgLoadingHint');

  // ── Org ID section ────────────────────────────────────────────────────

  chrome.storage.sync.get(['organizationId'], stored => {
    if (stored.organizationId && orgIdEl) orgIdEl.value = stored.organizationId;
  });

  saveBtn && saveBtn.addEventListener('click', () => {
    const val = orgIdEl ? orgIdEl.value.trim() : '';
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (val && !uuidRe.test(val)) {
      showStatus(saveStatusEl, 'Invalid format. Expected: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', true);
      return;
    }
    chrome.storage.sync.set({ organizationId: val || null }, () =>
      showStatus(saveStatusEl, val ? 'Saved.' : 'Cleared.', false));
  });

  clearBtn && clearBtn.addEventListener('click', () => {
    if (orgIdEl) orgIdEl.value = '';
    chrome.storage.sync.remove('organizationId', () => showStatus(saveStatusEl, 'Cleared.', false));
  });

  // ── Test connection ───────────────────────────────────────────────────

  testBtn && testBtn.addEventListener('click', async () => {
    showStatus(testStatusEl, 'Testing…', false);
    chrome.storage.sync.get(['organizationId'], async stored => {
      const orgId = stored.organizationId;
      if (!orgId) { showStatus(testStatusEl, 'No Org ID — set one or auto-detect by opening a Claude.ai tab.', true); return; }
      try {
        const res = await fetch(
          `https://claude.ai/api/organizations/${orgId}/chat_conversations?limit=1`,
          { credentials: 'include', headers: { Accept: 'application/json' } }
        );
        if (res.ok) {
          showStatus(testStatusEl, `Connection OK (HTTP ${res.status}).`, false);
        } else {
          showStatus(testStatusEl, `Failed — HTTP ${res.status}. Check that you're logged in to Claude.ai.`, true);
        }
      } catch (e) {
        showStatus(testStatusEl, `Network error: ${e.message}`, true);
      }
    });
  });

  // ── Server push preference ────────────────────────────────────────────

  chrome.storage.sync.get(['serverPush'], stored => {
    if (serverPushEl) serverPushEl.checked = !!stored.serverPush;
  });

  saveServerPushBtn && saveServerPushBtn.addEventListener('click', () => {
    const val = serverPushEl ? serverPushEl.checked : false;
    chrome.storage.sync.set({ serverPush: val }, () =>
      showStatus(serverPushStatusEl, `Server push ${val ? 'enabled' : 'disabled'}.`, false));
  });

  // ── Account aliases section ───────────────────────────────────────────

  loadKnownOrgs();

  saveAliasesBtn && saveAliasesBtn.addEventListener('click', () => {
    const inputs = document.querySelectorAll('.alias-input');
    const updates = [];
    inputs.forEach(input => {
      const orgId = /** @type {HTMLElement} */ (input).dataset.orgId;
      const alias = /** @type {HTMLInputElement} */ (input).value.trim();
      if (orgId) updates.push({ orgId, alias });
    });

    chrome.storage.sync.get(['orgAliases'], stored => {
      const aliases = stored.orgAliases || {};
      for (const { orgId, alias } of updates) {
        if (alias) {
          aliases[orgId] = alias;
        } else {
          delete aliases[orgId];
        }
      }
      chrome.storage.sync.set({ orgAliases: aliases }, () => {
        // Also update currentAccountSlug if applicable
        showStatus(aliasStatusEl, 'Account names saved.', false);
      });
    });
  });

  // ── Helpers ───────────────────────────────────────────────────────────

  function loadKnownOrgs() {
    chrome.runtime.sendMessage({ action: 'getKnownOrgs' }, response => {
      if (!orgAliasListEl) return;
      if (orgLoadingHint) orgLoadingHint.remove();

      const orgs = (response && Array.isArray(response.orgs)) ? response.orgs : [];

      if (orgs.length === 0) {
        orgAliasListEl.innerHTML = '<p class="hint">No accounts detected yet. Export a conversation first.</p>';
        return;
      }

      orgAliasListEl.innerHTML = '';

      for (const org of orgs) {
        const emailPrefix = (org.orgName || '').match(/^([^@]+)@/);
        const fallback    = emailPrefix ? emailPrefix[1] : 'unknown';

        const row   = document.createElement('div');
        row.className = 'alias-row';

        const label = document.createElement('div');
        label.className = 'alias-org-info';
        label.innerHTML = `
          <span class="alias-org-name">${escHtml(org.orgName || '(unknown org)')}</span>
          <span class="alias-org-id">${escHtml((org.orgId || '').substring(0, 8))}…</span>
        `;

        const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
        input.type        = 'text';
        input.className   = 'alias-input';
        input.dataset.orgId = org.orgId || '';
        input.value       = org.alias || '';
        input.placeholder = `${fallback} (auto-detected prefix)`;
        input.maxLength   = 40;

        row.appendChild(label);
        row.appendChild(input);
        orgAliasListEl.appendChild(row);
      }
    });
  }

  /** @param {HTMLElement|null} el @param {string} msg @param {boolean} isError */
  function showStatus(el, msg, isError) {
    if (!el) return;
    el.textContent = msg;
    el.className = `status ${isError ? 'error' : 'success'}`;
    setTimeout(() => { if (el) { el.textContent = ''; el.className = 'status'; } }, 6000);
  }

  /** @param {string} s @returns {string} */
  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});

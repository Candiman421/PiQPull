// PiQPull — Content Script
// Runs in claude.ai page context. Handles all API calls and export triggers.
// Utils (getCurrentBranch, inferModel, DEFAULT_MODEL_TIMELINE, getPiQTimestamp,
//        extractArtifactFiles, convertToMarkdown, convertToText, convertToJSONL,
//        downloadFile) are all injected from utils.js — do not redefine here.

// Double-injection guard
if (window.piqPullContentScriptLoaded) {
  console.log('PiQPull: content script already loaded, skipping');
} else {
  window.piqPullContentScriptLoaded = true;

  // ---------------------------------------------------------------------------
  // Export timestamp tracking
  // ---------------------------------------------------------------------------

  function recordExportTimestamp(conversationId) {
    chrome.storage.local.get(['exportTimestamps'], result => {
      const ts = result.exportTimestamps || {};
      ts[conversationId] = new Date().toISOString();
      chrome.storage.local.set({ exportTimestamps: ts });
    });
  }

  function recordExportTimestamps(conversationIds) {
    chrome.storage.local.get(['exportTimestamps'], result => {
      const ts = result.exportTimestamps || {};
      const now = new Date().toISOString();
      for (const id of conversationIds) ts[id] = now;
      chrome.storage.local.set({ exportTimestamps: ts });
    });
  }

  // ---------------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------------

  async function fetchConversation(orgId, conversationId) {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`;
    const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Fetch conversation failed: ${response.status}`);
    return response.json();
  }

  async function fetchAllConversations(orgId) {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations`;
    const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Fetch conversations failed: ${response.status}`);
    return response.json();
  }

  // ---------------------------------------------------------------------------
  // Server push helper — routes through background.js (avoids CORS)
  // ---------------------------------------------------------------------------

  function pushToServerViaBackground(filename, content) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'pushToServer', filename, content }, response => {
        resolve(response || { success: false, error: 'No response from background' });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Export helpers — ZIP builder shared by single + bulk flows
  // ---------------------------------------------------------------------------

  function buildSingleExportContent(data, request) {
    const { format, includeChats, includeThinking, includeMetadata, includeArtifacts } = request;
    const id = request.conversationId;
    switch (format) {
      case 'markdown':
        return {
          content: convertToMarkdown(data, includeMetadata, id, includeArtifacts, includeThinking),
          filename: `${data.name || id}.md`,
          type: 'text/markdown'
        };
      case 'text':
        return {
          content: convertToText(data, includeMetadata, includeArtifacts, includeThinking),
          filename: `${data.name || id}.txt`,
          type: 'text/plain'
        };
      case 'jsonl':
        return {
          content: convertToJSONL(data, id),
          filename: `${data.name || id}.jsonl`,
          type: 'application/x-ndjson'
        };
      default:
        return {
          content: JSON.stringify(data, null, 2),
          filename: `${data.name || id}.json`,
          type: 'application/json'
        };
    }
  }

  async function handleSingleExport(data, request, sendResponse) {
    const { extractArtifacts: doNested, flattenArtifacts: doFlat,
            includeChats, artifactFormat, conversationId, serverPush } = request;

    const artifactFiles = (doNested || doFlat)
      ? extractArtifactFiles(data, artifactFormat || 'original')
      : [];

    if ((doNested || doFlat) && artifactFiles.length > 0) {
      const zip = new JSZip();
      const { content: convContent, filename: convFilename } = buildSingleExportContent(data, request);

      if (includeChats !== false) {
        doFlat && !doNested
          ? zip.folder('Chats').file(convFilename, convContent)
          : zip.file(convFilename, convContent);
      }

      if (doNested) {
        const artifactsFolder = includeChats !== false ? zip.folder('artifacts') : zip;
        for (const af of artifactFiles) artifactsFolder.file(af.filename, af.content);
      }

      if (doFlat && !doNested) {
        const artifactsFolder = zip.folder('Artifacts');
        for (const af of artifactFiles) {
          artifactsFolder.file(`${data.name || conversationId}_${af.filename}`, af.content);
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.name || conversationId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      if (includeChats === false) {
        sendResponse({ success: false, error: 'Nothing to export. Enable "Chats" or an Artifacts option.' });
        return;
      }
      const { content, filename, type } = buildSingleExportContent(data, request);
      downloadFile(content, filename, type);
    }

    // Server push (non-blocking)
    if (serverPush) {
      const jsonlContent = convertToJSONL(data, conversationId);
      const ts = getPiQTimestamp();
      const safeName = (data.name || conversationId).replace(/[<>:"/\\|?*]/g, '_');
      pushToServerViaBackground(`piqpull-claude-${safeName}-${ts}.jsonl`, jsonlContent)
        .then(r => { if (!r.success) console.warn('PiQPull: server push failed:', r.error); });
    }

    recordExportTimestamp(conversationId);
    sendResponse({ success: true });
  }

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // Auto-detect org ID
    if (request.action === 'detectOrgId') {
      fetch('https://claude.ai/api/organizations', {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(orgs => {
          if (!Array.isArray(orgs) || orgs.length === 0) throw new Error('No organizations found');
          const chatOrg = orgs.find(o => o.capabilities && o.capabilities.includes('chat'));
          const orgId = chatOrg ? chatOrg.uuid : orgs[0].uuid;
          sendResponse({ success: true, orgId });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // Single conversation export
    if (request.action === 'exportConversation') {
      fetchConversation(request.orgId, request.conversationId)
        .then(data => {
          if (!data || !data.chat_messages || !Array.isArray(data.chat_messages)) {
            throw new Error('Invalid conversation data. Refresh and try again.');
          }
          data.model = inferModel(data);
          return handleSingleExport(data, request, sendResponse);
        })
        .catch(err => sendResponse({ success: false, error: err.message, details: err.stack }));
      return true;
    }

    // Bulk export
    if (request.action === 'exportAllConversations') {
      fetchAllConversations(request.orgId)
        .then(async conversations => {
          const { format, includeChats, includeThinking, includeMetadata, includeArtifacts,
                  extractArtifacts: doNested, flattenArtifacts: doFlat,
                  artifactFormat, serverPush } = request;

          const zip = new JSZip();
          const allJsonl = [];
          let included = 0;
          const errors = [];

          for (const conv of conversations) {
            try {
              const data = await fetchConversation(request.orgId, conv.uuid);
              data.model = inferModel(data);
              const artifactFiles = (doNested || doFlat)
                ? extractArtifactFiles(data, artifactFormat || 'original') : [];

              if (includeChats === false && artifactFiles.length === 0) {
                await new Promise(r => setTimeout(r, 500));
                continue;
              }

              const safeName = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');
              let content, filename;

              switch (format) {
                case 'markdown':
                  content = convertToMarkdown(data, includeMetadata, conv.uuid, includeArtifacts, includeThinking);
                  filename = `${safeName}.md`; break;
                case 'text':
                  content = convertToText(data, includeMetadata, includeArtifacts, includeThinking);
                  filename = `${safeName}.txt`; break;
                case 'jsonl':
                  content = convertToJSONL(data, conv.uuid);
                  filename = `${safeName}.jsonl`; break;
                default:
                  content = JSON.stringify(data, null, 2);
                  filename = `${safeName}.json`;
              }

              if (doFlat && !doNested) {
                if (includeChats !== false) zip.folder('Chats').file(filename, content);
                if (artifactFiles.length > 0) {
                  const af = zip.folder('Artifacts');
                  for (const f of artifactFiles) af.file(`${safeName}_${f.filename}`, f.content);
                }
              } else if (doNested) {
                const convFolder = zip.folder(safeName);
                if (includeChats !== false) convFolder.file(filename, content);
                if (artifactFiles.length > 0) {
                  const af = includeChats !== false ? convFolder.folder('artifacts') : convFolder;
                  for (const f of artifactFiles) af.file(f.filename, f.content);
                }
              } else {
                if (includeChats !== false) zip.file(filename, content);
              }

              if (serverPush) allJsonl.push(convertToJSONL(data, conv.uuid));
              included++;
            } catch (err) {
              errors.push(`${conv.name || conv.uuid}: ${err.message}`);
            }
            await new Promise(r => setTimeout(r, 500));
          }

          const ts = getPiQTimestamp();
          const onlyArtifacts = doFlat && !doNested && includeChats === false;
          const prefix = onlyArtifacts ? 'piqpull-claude-artifacts' : 'piqpull-claude-exports';
          const blob = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${prefix}-${ts}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          // Server push — bulk JSONL
          if (serverPush && allJsonl.length > 0) {
            pushToServerViaBackground(`piqpull-claude-bulk-${ts}.jsonl`, allJsonl.join('\n'))
              .then(r => { if (!r.success) console.warn('PiQPull: server push failed:', r.error); });
          }

          const exportedIds = conversations.map(c => c.uuid).filter(id => !errors.some(e => e.includes(id)));
          recordExportTimestamps(exportedIds);

          if (errors.length > 0) {
            sendResponse({ success: true, count: included, warnings: `Exported ${included}. Failures: ${errors.join('; ')}` });
          } else {
            sendResponse({ success: true, count: included });
          }
        })
        .catch(err => sendResponse({ success: false, error: err.message, details: err.stack }));
      return true;
    }

    // Browse page — load conversations list
    if (request.action === 'loadConversations') {
      fetchAllConversations(request.orgId)
        .then(conversations => sendResponse({ success: true, conversations }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // Browse page — load projects
    if (request.action === 'loadProjects') {
      fetch(`https://claude.ai/api/organizations/${request.orgId}/projects`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(projects => sendResponse({ success: true, projects }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

} // end double-injection guard

// PiQPull — Content Script
// v1.2.0: accountSlug threading; project home page fetch; ensureContentScript guard

if (window.piqPullContentScriptLoaded) {
  console.log('PiQPull: content script already loaded, skipping re-injection');
} else {
  window.piqPullContentScriptLoaded = true;

  // ---------------------------------------------------------------------------
  // Timestamp tracking
  // ---------------------------------------------------------------------------

  function recordExportTimestamp(conversationId) {
    chrome.storage.local.get(['exportTimestamps'], stored => {
      const timestamps = stored.exportTimestamps || {};
      timestamps[conversationId] = new Date().toISOString();
      chrome.storage.local.set({ exportTimestamps: timestamps });
    });
  }

  function recordExportTimestamps(conversationIds) {
    chrome.storage.local.get(['exportTimestamps'], stored => {
      const timestamps = stored.exportTimestamps || {};
      const now = new Date().toISOString();
      for (const convId of conversationIds) timestamps[convId] = now;
      chrome.storage.local.set({ exportTimestamps: timestamps });
    });
  }

  // ---------------------------------------------------------------------------
  // Claude.ai API helpers
  // ---------------------------------------------------------------------------

  async function fetchConversationFromApi(orgId, conversationId) {
    const apiUrl = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`;
    const apiResponse = await fetch(apiUrl, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!apiResponse.ok) throw new Error(`Fetch conversation failed: ${apiResponse.status}`);
    return apiResponse.json();
  }

  async function fetchAllConversationsFromApi(orgId) {
    const apiUrl = `https://claude.ai/api/organizations/${orgId}/chat_conversations`;
    const apiResponse = await fetch(apiUrl, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!apiResponse.ok) throw new Error(`Fetch conversations list failed: ${apiResponse.status}`);
    return apiResponse.json();
  }

  async function fetchClaudeProjectInfo(orgId, projectUuid) {
    if (!orgId || !projectUuid) return null;
    try {
      const projectResponse = await fetch(
        `https://claude.ai/api/organizations/${orgId}/projects/${projectUuid}`,
        { credentials: 'include', headers: { Accept: 'application/json' } }
      );
      if (!projectResponse.ok) return null;
      const projectData = await projectResponse.json();
      return {
        name:         projectData.name         || null,
        uuid:         projectData.uuid         || projectUuid,
        description:  projectData.description  || null,
        instructions: projectData.prompt        || projectData.instructions || null,
        memory:       projectData.memory        || null,
      };
    } catch (_err) {
      return null;
    }
  }

  // Fetch project knowledge files (docs)
  async function fetchProjectDocs(orgId, projectUuid) {
    if (!orgId || !projectUuid) return [];
    try {
      const response = await fetch(
        `https://claude.ai/api/organizations/${orgId}/projects/${projectUuid}/docs`,
        { credentials: 'include', headers: { Accept: 'application/json' } }
      );
      if (!response.ok) return [];
      const data = await response.json();
      // Response may be array or { docs: [] }
      return Array.isArray(data) ? data : (data.docs || []);
    } catch (_err) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Background relay helpers
  // ---------------------------------------------------------------------------

  function relayToBackground(messagePayload) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(messagePayload, response => {
        resolve(response || { success: false, error: 'No response from background' });
      });
    });
  }

  function pushIncomingViaBackground(incomingPayload) {
    return relayToBackground({ action: 'pushToIncoming', ...incomingPayload });
  }

  function pushProjectHomeViaBackground(payload) {
    return relayToBackground({ action: 'pushProjectHome', ...payload });
  }

  // ---------------------------------------------------------------------------
  // Structured incoming export — conversation → /export/incoming
  // ---------------------------------------------------------------------------

  async function handleIncomingExport(request, sendResponse) {
    const { orgId, orgName, conversationId, projectFolder, projectName,
            tabUrl, accountSlug } = request;

    // Fetch conversation
    let conversationData;
    try {
      conversationData = await fetchConversationFromApi(orgId, conversationId);
    } catch (fetchErr) {
      sendResponse({ success: false, error: fetchErr.message });
      return;
    }

    if (!conversationData || !conversationData.chat_messages || !Array.isArray(conversationData.chat_messages)) {
      sendResponse({ success: false, error: 'Invalid conversation data. Refresh and try again.' });
      return;
    }

    conversationData.model = inferModel(conversationData);

    // Enrich with Claude.ai project name
    let claudeaiProjectName = null;
    let claudeaiProjectUuid = conversationData.project_uuid || null;
    if (claudeaiProjectUuid && orgId) {
      const projectInfo = await fetchClaudeProjectInfo(orgId, claudeaiProjectUuid);
      if (projectInfo) claudeaiProjectName = projectInfo.name;
    }

    const exportTimestamp = getPiQTimestamp();
    const chatSlug        = generateChatSlug(conversationData.name);
    const conversationUrl = tabUrl || `https://claude.ai/chat/${conversationId}`;

    // Collect image assets
    let imageAssets = [];
    try {
      imageAssets = await collectImageAssets(conversationData, exportTimestamp);
    } catch (_assetErr) {
      console.warn('PiQPull: Image asset collection failed:', _assetErr);
    }

    // Collect artifacts
    const artifactFiles     = collectArtifactsForTransport(conversationData);
    const artifactsManifest = artifactFiles.map(af => ({
      filename:   af.filename,
      size_chars: af.content ? af.content.length : 0,
    }));

    const exportPayload = buildExportPayload(
      conversationData, conversationId, conversationUrl,
      projectFolder, projectName, imageAssets, exportTimestamp,
      orgId, orgName || null, claudeaiProjectName, claudeaiProjectUuid,
      artifactsManifest, accountSlug || null
    );

    const imageAssetsForTransport = imageAssets.map(asset => ({
      asset_filename: asset.asset_filename,
      data_base64:    asset.data_base64,
      mime_type:      asset.mime_type
    }));

    const serverResult = await pushIncomingViaBackground({
      projectFolder,
      accountSlug:   accountSlug || 'unknown',
      chatSlug,
      conversationId,
      exportPayload,
      imageAssets:   imageAssetsForTransport,
      artifactFiles: artifactFiles.map(af => ({ filename: af.filename, content: af.content })),
    });

    if (!serverResult.success) {
      sendResponse({ success: false, error: `Server error: ${serverResult.error}` });
      return;
    }

    recordExportTimestamp(conversationId);
    sendResponse({ success: true, data: serverResult.data });
  }

  // ---------------------------------------------------------------------------
  // Project home page export — project metadata + knowledge files
  // ---------------------------------------------------------------------------

  async function handleProjectHomeExport(request, sendResponse) {
    const { orgId, orgName, conversationId, projectFolder, accountSlug, tabUrl } = request;

    // Determine project UUID from current conversation
    let projectUuid = null;
    try {
      const convData = await fetchConversationFromApi(orgId, conversationId);
      projectUuid    = convData.project_uuid || null;
    } catch (_err) {
      // Try to get from tab URL or current page context
    }

    if (!projectUuid) {
      sendResponse({ success: false, error: 'No Claude.ai project found for this conversation. Open a conversation inside a Claude.ai project first.' });
      return;
    }

    const exportTimestamp = getPiQTimestamp();

    // Fetch project details
    let projectInfo = null;
    try {
      projectInfo = await fetchClaudeProjectInfo(orgId, projectUuid);
    } catch (_err) { /* non-fatal */ }

    // Fetch knowledge files list
    let docs = [];
    try {
      docs = await fetchProjectDocs(orgId, projectUuid);
    } catch (_err) { /* non-fatal */ }

    // Build knowledge files manifest with content
    const knowledgeFiles = docs.map((doc, idx) => ({
      index:       idx + 1,
      uuid:        doc.uuid || doc.id || null,
      filename:    doc.file_name || doc.filename || doc.name || `doc_${idx + 1}`,
      created_at:  doc.created_at || null,
      updated_at:  doc.updated_at || null,
      file_size:   doc.file_size  || null,
      content:     doc.content    || doc.extracted_content || null,
    }));

    const projectName   = projectInfo?.name        || null;
    const projectSlug   = (projectName || 'unknown-project')
                            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const payload = {
      piqpull_project_meta: {
        export_type:       'project_home',
        export_version:    1,
        exported_at:       exportTimestamp,
        provider:          'claude.ai',
        account_slug:      accountSlug || 'unknown',
        org_id:            orgId       || null,
        org_name:          orgName     || null,
        piQuix_folder:     projectFolder || null,
        project_uuid:      projectUuid,
        project_name:      projectName,
        project_slug:      projectSlug,
        project_description: projectInfo?.description  || null,
        project_instructions: projectInfo?.instructions || null,
        project_memory:    projectInfo?.memory         || null,
        knowledge_files_count: knowledgeFiles.length,
        knowledge_files:   knowledgeFiles,
      }
    };

    const serverResult = await pushProjectHomeViaBackground({
      accountSlug:   accountSlug   || 'unknown',
      projectFolder: projectFolder || 'unknown',
      payload,
    });

    if (!serverResult.success) {
      sendResponse({ success: false, error: `Server error: ${serverResult.error}` });
      return;
    }

    sendResponse({ success: true, data: serverResult.data, projectName });
  }

  // ---------------------------------------------------------------------------
  // Legacy browser-download export
  // ---------------------------------------------------------------------------

  function buildDownloadContent(conversationData, request) {
    const { format, includeChats, includeThinking, includeMetadata, includeArtifacts, conversationId } = request;
    switch (format) {
      case 'markdown': return {
        content:  convertToMarkdown(conversationData, includeMetadata, conversationId, includeArtifacts, includeThinking),
        filename: `${conversationData.name || conversationId}.md`, mimeType: 'text/markdown'
      };
      case 'text': return {
        content:  convertToText(conversationData, includeMetadata, includeArtifacts, includeThinking),
        filename: `${conversationData.name || conversationId}.txt`, mimeType: 'text/plain'
      };
      case 'jsonl': return {
        content:  convertToJSONL(conversationData, conversationId),
        filename: `${conversationData.name || conversationId}.jsonl`, mimeType: 'application/x-ndjson'
      };
      default: return {
        content:  JSON.stringify(conversationData, null, 2),
        filename: `${conversationData.name || conversationId}.json`, mimeType: 'application/json'
      };
    }
  }

  async function handleLegacyDownloadExport(conversationData, request, sendResponse) {
    const { extractArtifacts: doNested, flattenArtifacts: doFlat,
            includeChats, artifactFormat, conversationId, serverPush } = request;

    const artifactFiles = (doNested || doFlat)
      ? extractArtifactFiles(conversationData, artifactFormat || 'original') : [];

    if ((doNested || doFlat) && artifactFiles.length > 0) {
      const zipArchive = new JSZip();
      const { content: convContent, filename: convFilename } = buildDownloadContent(conversationData, request);
      if (includeChats !== false) {
        doFlat && !doNested
          ? zipArchive.folder('Chats').file(convFilename, convContent)
          : zipArchive.file(convFilename, convContent);
      }
      if (doNested) {
        const af = includeChats !== false ? zipArchive.folder('artifacts') : zipArchive;
        for (const f of artifactFiles) af.file(f.filename, f.content);
      }
      if (doFlat && !doNested) {
        const af = zipArchive.folder('Artifacts');
        for (const f of artifactFiles) af.file(`${conversationData.name || conversationId}_${f.filename}`, f.content);
      }
      const zipBlob = await zipArchive.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${conversationData.name || conversationId}.zip`;
      document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } else {
      if (includeChats === false) { sendResponse({ success: false, error: 'Nothing to export.' }); return; }
      const { content, filename, mimeType } = buildDownloadContent(conversationData, request);
      downloadFile(content, filename, mimeType);
    }

    if (serverPush) {
      const ts       = getPiQTimestamp();
      const safeName = (conversationData.name || conversationId).replace(/[<>:"/\\|?*]/g, '_');
      relayToBackground({ action: 'pushToServer', filename: `piqpull-claude-${safeName}-${ts}.jsonl`, content: convertToJSONL(conversationData, conversationId) });
    }

    recordExportTimestamp(conversationId);
    sendResponse({ success: true });
  }

  // ---------------------------------------------------------------------------
  // Bulk export
  // ---------------------------------------------------------------------------

  async function handleBulkExport(request, sendResponse) {
    const conversations = await fetchAllConversationsFromApi(request.orgId);
    const { format, includeChats, includeThinking, includeMetadata, includeArtifacts,
            extractArtifacts: doNested, flattenArtifacts: doFlat, artifactFormat, serverPush } = request;

    const zipArchive    = new JSZip();
    const allJsonlLines = [];
    let   successCount  = 0;
    const failedNames   = [];

    for (const conv of conversations) {
      try {
        const convData = await fetchConversationFromApi(request.orgId, conv.uuid);
        convData.model = inferModel(convData);
        const safeName = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');
        const artifactFiles = (doNested || doFlat)
          ? extractArtifactFiles(convData, artifactFormat || 'original') : [];

        if (includeChats === false && artifactFiles.length === 0) { await new Promise(r => setTimeout(r, 500)); continue; }

        let exportContent, exportFilename;
        switch (format) {
          case 'markdown': exportContent = convertToMarkdown(convData, includeMetadata, conv.uuid, includeArtifacts, includeThinking); exportFilename = `${safeName}.md`; break;
          case 'text':     exportContent = convertToText(convData, includeMetadata, includeArtifacts, includeThinking); exportFilename = `${safeName}.txt`; break;
          case 'jsonl':    exportContent = convertToJSONL(convData, conv.uuid); exportFilename = `${safeName}.jsonl`; break;
          default:         exportContent = JSON.stringify(convData, null, 2); exportFilename = `${safeName}.json`;
        }

        if (doFlat && !doNested) {
          if (includeChats !== false) zipArchive.folder('Chats').file(exportFilename, exportContent);
          if (artifactFiles.length > 0) {
            const af = zipArchive.folder('Artifacts');
            for (const f of artifactFiles) af.file(`${safeName}_${f.filename}`, f.content);
          }
        } else if (doNested) {
          const cf = zipArchive.folder(safeName);
          if (includeChats !== false) cf.file(exportFilename, exportContent);
          if (artifactFiles.length > 0) {
            const af = includeChats !== false ? cf.folder('artifacts') : cf;
            for (const f of artifactFiles) af.file(f.filename, f.content);
          }
        } else {
          if (includeChats !== false) zipArchive.file(exportFilename, exportContent);
        }

        if (serverPush) allJsonlLines.push(convertToJSONL(convData, conv.uuid));
        successCount++;
      } catch (convErr) {
        failedNames.push(conv.name || conv.uuid);
        console.warn('PiQPull: bulk failed for:', conv.name, convErr);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    const ts     = getPiQTimestamp();
    const prefix = doFlat && !doNested && includeChats === false ? 'piqpull-claude-artifacts' : 'piqpull-claude-exports';
    const zipBlob = await zipArchive.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${prefix}-${ts}.zip`;
    document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    if (serverPush && allJsonlLines.length > 0) {
      relayToBackground({ action: 'pushToServer', filename: `piqpull-claude-bulk-${ts}.jsonl`, content: allJsonlLines.join('\n') });
    }

    recordExportTimestamps(conversations.map(c => c.uuid).filter(id => !failedNames.some(n => n.includes(id))));

    sendResponse(failedNames.length > 0
      ? { success: true, count: successCount, warnings: `Exported ${successCount}. Failures: ${failedNames.join('; ')}` }
      : { success: true, count: successCount });
  }

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

    if (request.action === 'detectOrgId') {
      fetch('https://claude.ai/api/organizations', { credentials: 'include', headers: { Accept: 'application/json' } })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(orgList => {
          if (!Array.isArray(orgList) || orgList.length === 0) throw new Error('No organizations found');
          const chatOrg = orgList.find(org => org.capabilities && org.capabilities.includes('chat'));
          const org     = chatOrg || orgList[0];
          chrome.storage.sync.set({ organizationId: org.uuid, orgName: org.name || null });
          sendResponse({ success: true, orgId: org.uuid, orgName: org.name || null });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'exportToIncoming') {
      handleIncomingExport(request, sendResponse).catch(err => {
        sendResponse({ success: false, error: err.message, details: err.stack });
      });
      return true;
    }

    if (request.action === 'exportProjectHome') {
      handleProjectHomeExport(request, sendResponse).catch(err => {
        sendResponse({ success: false, error: err.message, details: err.stack });
      });
      return true;
    }

    if (request.action === 'exportConversation') {
      fetchConversationFromApi(request.orgId, request.conversationId)
        .then(conversationData => {
          if (!conversationData || !conversationData.chat_messages || !Array.isArray(conversationData.chat_messages)) {
            throw new Error('Invalid conversation data. Refresh and try again.');
          }
          conversationData.model = inferModel(conversationData);
          return handleLegacyDownloadExport(conversationData, request, sendResponse);
        })
        .catch(err => sendResponse({ success: false, error: err.message, details: err.stack }));
      return true;
    }

    if (request.action === 'exportAllConversations') {
      handleBulkExport(request, sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message, details: err.stack }));
      return true;
    }

    if (request.action === 'loadConversations') {
      fetchAllConversationsFromApi(request.orgId)
        .then(conversations => sendResponse({ success: true, conversations }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'loadProjects') {
      fetch(`https://claude.ai/api/organizations/${request.orgId}/projects`, {
        credentials: 'include', headers: { Accept: 'application/json' }
      })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(projects => sendResponse({ success: true, projects }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

} // end injection guard

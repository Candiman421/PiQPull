// PiQPull — Browse: Export Engine
// Single job: build exports (single and bulk) and trigger downloads.
// Reads options from DOM. Reads/writes BrowseState timestamps.
// Uses utils.js globals: convertToMarkdown, convertToText, convertToJSONL,
//   extractArtifactFiles, downloadFile, getPiQTimestamp, inferModel.

const BrowseExport = (() => {

  function gatherOptions() {
    return {
      format:           document.getElementById('exportFormat').value,
      includeChats:     document.getElementById('includeChats').checked,
      includeThinking:  document.getElementById('includeThinking').checked,
      includeMetadata:  document.getElementById('includeMetadata').checked,
      includeArtifacts: document.getElementById('includeArtifacts').checked,
      extractArtifacts: document.getElementById('extractArtifacts').checked,
      artifactFormat:   document.getElementById('artifactFormat').value,
      flattenArtifacts: document.getElementById('flattenArtifacts').checked,
      serverPush:       document.getElementById('serverPush').checked
    };
  }

  function buildContent(data, opts, convId) {
    switch (opts.format) {
      case 'markdown': return {
        content:  convertToMarkdown(data, opts.includeMetadata, convId, opts.includeArtifacts, opts.includeThinking),
        filename: `${data.name || convId}.md`,
        mimeType: 'text/markdown'
      };
      case 'text': return {
        content:  convertToText(data, opts.includeMetadata, opts.includeArtifacts, opts.includeThinking),
        filename: `${data.name || convId}.txt`,
        mimeType: 'text/plain'
      };
      case 'jsonl': return {
        content:  convertToJSONL(data, convId),
        filename: `${data.name || convId}.jsonl`,
        mimeType: 'application/x-ndjson'
      };
      default: return {
        content:  JSON.stringify(data, null, 2),
        filename: `${data.name || convId}.json`,
        mimeType: 'application/json'
      };
    }
  }

  // Returns artifact count for caller to use in skip logic
  function buildZip(data, opts, convId, zip, folderName) {
    const artifactFiles = (opts.extractArtifacts || opts.flattenArtifacts)
      ? extractArtifactFiles(data, opts.artifactFormat || 'original')
      : [];

    const { content, filename } = buildContent(data, opts, convId);
    const safeFolder = folderName || (data.name || convId).replace(/[<>:"/\\|?*]/g, '_');

    if (opts.flattenArtifacts && !opts.extractArtifacts) {
      if (opts.includeChats !== false) zip.folder('Chats').file(filename, content);
      if (artifactFiles.length > 0) {
        const artifactsFolder = zip.folder('Artifacts');
        for (const af of artifactFiles) artifactsFolder.file(`${safeFolder}_${af.filename}`, af.content);
      }
    } else if (opts.extractArtifacts) {
      const convFolder = zip.folder(safeFolder);
      if (opts.includeChats !== false) convFolder.file(filename, content);
      if (artifactFiles.length > 0) {
        const artifactsFolder = opts.includeChats !== false ? convFolder.folder('artifacts') : convFolder;
        for (const af of artifactFiles) artifactsFolder.file(af.filename, af.content);
      }
    } else {
      if (opts.includeChats !== false) zip.file(filename, content);
    }

    return artifactFiles.length;
  }

  // ---------------------------------------------------------------------------
  // Modal helpers — class-driven, no inline styles
  // ---------------------------------------------------------------------------

  function showModal(progressModal, progressBar, progressText, progressStats, label) {
    progressBar.style.width = '0%'; // dynamic value — class cannot express a computed percentage
    progressStats.textContent = '';
    progressText.textContent = label;
    progressModal.classList.add('open');
  }

  function hideModal(progressModal) {
    progressModal.classList.remove('open');
  }

  // ---------------------------------------------------------------------------
  // Toast — class-driven error state
  // ---------------------------------------------------------------------------

  function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.remove('toast-error');
    }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Single conversation export (from browse table row)
  // ---------------------------------------------------------------------------

  async function exportSingle(orgId, conversationId, conversationName) {
    const opts = gatherOptions();
    showToast(`Exporting ${conversationName}...`);

    try {
      const response = await fetch(
        `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`,
        { credentials: 'include', headers: { Accept: 'application/json' } }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      data.model = inferModel(data);

      const artifactFiles = (opts.extractArtifacts || opts.flattenArtifacts)
        ? extractArtifactFiles(data, opts.artifactFormat || 'original')
        : [];

      if ((opts.extractArtifacts || opts.flattenArtifacts) && artifactFiles.length > 0) {
        const zip  = new JSZip();
        const safe = conversationName.replace(/[<>:"/\\|?*]/g, '_');
        buildZip(data, opts, conversationId, zip, safe);
        const blob = await zip.generateAsync({ type: 'blob' });
        const url  = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${conversationName}.zip`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        showToast(`Exported: ${conversationName} (${artifactFiles.length} artifact(s))`);
      } else {
        if (opts.includeChats === false) {
          showToast('Nothing to export. Enable Chats or an Artifacts option.', true);
          return;
        }
        const { content, filename, mimeType } = buildContent(data, opts, conversationId);
        downloadFile(content, filename, mimeType);
        showToast(`Exported: ${conversationName}`);
      }

      if (opts.serverPush) {
        const ts       = getPiQTimestamp();
        const safe     = conversationName.replace(/[<>:"/\\|?*]/g, '_');
        const jsonl    = convertToJSONL(data, conversationId);
        BrowseApi.pushToServer(`piqpull-claude-${safe}-${ts}.jsonl`, jsonl)
          .then(result => { if (!result.success) console.warn('PiQPull: server push failed:', result.error); });
      }

      await BrowseState.saveTimestamp(conversationId);
      BrowseTable.render();
      BrowseTable.updateStats();

    } catch (err) {
      console.error('PiQPull: exportSingle error:', err);
      showToast(`Failed: ${err.message}`, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk export
  // ---------------------------------------------------------------------------

  async function exportAll(orgId) {
    const opts = gatherOptions();

    const toExport = BrowseState.selected.size > 0
      ? BrowseState.filtered.filter(c => BrowseState.selected.has(c.uuid))
      : BrowseState.filtered;

    // Single item — delegate; avoids unnecessary ZIP wrapping
    if (toExport.length === 1) {
      await exportSingle(orgId, toExport[0].uuid, toExport[0].name);
      return;
    }

    const button   = document.getElementById('exportAllBtn');
    const origText = button.textContent;
    button.disabled  = true;
    button.textContent = 'Preparing...';

    const progressModal = document.getElementById('progressModal');
    const progressBar   = document.getElementById('progressBar');
    const progressText  = document.getElementById('progressText');
    const progressStats = document.getElementById('progressStats');

    showModal(progressModal, progressBar, progressText, progressStats,
      `Exporting ${toExport.length} conversations...`);

    let cancelled = false;
    document.getElementById('cancelExport').onclick = () => {
      cancelled = true;
      hideModal(progressModal);
      showToast('Export cancelled.', true);
    };

    const zip      = new JSZip();
    const allJsonl = [];
    const total    = toExport.length;
    let completed  = 0;
    let failed     = 0;
    const failedNames = [];

    try {
      const batchSize = 3;

      for (let i = 0; i < total; i += batchSize) {
        if (cancelled) break;

        const batch = toExport.slice(i, Math.min(i + batchSize, total));

        await Promise.all(batch.map(async conv => {
          try {
            const response = await fetch(
              `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
              { credentials: 'include', headers: { Accept: 'application/json' } }
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            data.model = inferModel(data);

            const safeFolder    = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');
            const artifactCount = buildZip(data, opts, conv.uuid, zip, safeFolder);

            // Skip-silently: chats off, nothing extracted
            if (opts.includeChats === false && artifactCount === 0
                && !opts.extractArtifacts && !opts.flattenArtifacts) {
              completed++;
              return;
            }

            if (opts.serverPush) allJsonl.push(convertToJSONL(data, conv.uuid));
            completed++;

          } catch (err) {
            console.error(`PiQPull: failed to export ${conv.name}:`, err);
            failed++;
            failedNames.push(conv.name || conv.uuid);
          }
        }));

        const pct = Math.round((completed + failed) / total * 100);
        progressBar.style.width = `${pct}%`; // computed value — must be JS
        progressStats.textContent = `${completed} succeeded, ${failed} failed of ${total}`;

        if (i + batchSize < total && !cancelled) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      if (cancelled) return;

      progressText.textContent = 'Creating ZIP...';

      const ts      = getPiQTimestamp();
      const onlyArt = opts.flattenArtifacts && !opts.extractArtifacts && opts.includeChats === false;
      const prefix  = onlyArt ? 'piqpull-claude-artifacts' : 'piqpull-claude-exports';

      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        meta => { progressBar.style.width = `${Math.round(meta.percent)}%`; }
      );

      const url    = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href     = url;
      anchor.download = `${prefix}-${ts}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      if (opts.serverPush && allJsonl.length > 0) {
        BrowseApi.pushToServer(`piqpull-claude-bulk-${ts}.jsonl`, allJsonl.join('\n'))
          .then(result => { if (!result.success) console.warn('PiQPull: server push failed:', result.error); });
      }

      const exportedIds = toExport
        .filter(c => !failedNames.includes(c.name))
        .map(c => c.uuid);

      await BrowseState.saveTimestamps(exportedIds);
      BrowseTable.render();
      BrowseTable.updateStats();

      showToast(failed > 0
        ? `Exported ${completed} of ${total} (${failed} failed)`
        : `Exported all ${completed} conversations`);

    } catch (err) {
      console.error('PiQPull: exportAll error:', err);
      showToast(`Export failed: ${err.message}`, true);
    } finally {
      hideModal(progressModal);
      button.disabled    = false;
      button.textContent = origText;
    }
  }

  return { exportSingle, exportAll, showToast };
})();

// PiQPull — Browse: Export Engine v1.6.0
// v1.6.0: Artifact error surfacing (server-side artifact write failures now visible in error panel).
//         Inline retry on push failure (2s delay, 1 attempt) for network/server errors.
//         End-of-run retry pass: re-fetches and re-pushes all failed conversations once.
//         postToServer timeout (90s) in background.js prevents service worker hang.
//         fetchImageAssetBytes timeout (15s) in utils.js prevents single-image hang.
//         Server artifact filename sanitization: Windows-invalid chars replaced with _.
// v1.5.1: orgName in project home section fixed to BrowseState.orgName (was bare undefined var).
// v1.5.0: pushToIncoming accepts optional overrideFolder/ProjName params; exportAll snapshots
//         routing state at start so destination-picker changes mid-run have no effect.
//         Picker + export button disabled during active bulk run, re-enabled in finally.

'use strict';

// ============================================================================
// PiQExportResult — per-conversation phase tracker
// ============================================================================

class PiQExportResult {
  /**
   * @param {string} conversationId
   * @param {string} conversationName
   */
  constructor(conversationId, conversationName) {
    this.uuid = conversationId || '';
    this.name = conversationName || 'Untitled';
    this.slug = null;
    this.status = 'pending';
    /** @type {Object.<string, { ok: boolean|null, startMs: number, ms: number|null, error: string|null }>} */
    this.phases = {};
    this.meta = { msgCount: 0, thinkingCount: 0, artifactCount: 0, imageCount: 0, model: null, outputFilename: null };
    this.retries = 0;
    this.startedAt = null;
    this.completedAt = null;
    this.durationMs = null;
    this.outputPath = null;
    this.notes = /** @type {string[]} */ ([]);
  }

  /** @param {string} name */
  beginPhase(name) {
    if (!this.startedAt) this.startedAt = Date.now();
    this.phases[name] = { ok: null, startMs: Date.now(), ms: null, error: null };
    return this;
  }

  /** @param {string} name @param {boolean} ok @param {string|null} err */
  endPhase(name, ok, err) {
    const ph = this.phases[name];
    if (!ph) { this.phases[name] = { ok: !!ok, startMs: Date.now(), ms: 0, error: err || null }; return this; }
    ph.ok = !!ok;
    ph.ms = Date.now() - ph.startMs;
    ph.error = err || null;
    return this;
  }

  /** @param {string|null} outputPath */
  seal(outputPath) {
    this.completedAt = Date.now();
    this.durationMs = this.startedAt ? this.completedAt - this.startedAt : 0;
    this.outputPath = outputPath || null;
    const phaseValues = Object.values(this.phases);
    if (phaseValues.length === 0) {
      this.status = 'skipped';
    } else {
      const anyFailed = phaseValues.some(p => p.ok === false);
      const allOk = phaseValues.every(p => p.ok === true);
      this.status = allOk ? 'success' : (anyFailed ? 'failed' : 'partial');
    }
    return this;
  }

  toJSON() {
    return {
      uuid: this.uuid, name: this.name, slug: this.slug, status: this.status,
      phases: this.phases, meta: this.meta, retries: this.retries,
      durationMs: this.durationMs, outputPath: this.outputPath, notes: this.notes,
    };
  }
}

// ============================================================================
// PiQExportSession — bulk session rollup
// ============================================================================

class PiQExportSession {
  /**
   * @param {number} totalCount
   * @param {string|null} projectFolder
   * @param {string|null} accountSlug
   */
  constructor(totalCount, projectFolder, accountSlug) {
    this.sessionId = typeof getPiQTimestamp === 'function' ? getPiQTimestamp() : String(Date.now());
    this.projectFolder = projectFolder || null;
    this.accountSlug = accountSlug || 'unknown';
    this.totalCount = totalCount;
    this.results = /** @type {PiQExportResult[]} */ ([]);
    this.startedAt = Date.now();
    this.completedAt = null;
    this.durationMs = null;
    this.cancelled = false;
  }

  /** @param {PiQExportResult} result */
  addResult(result) { this.results.push(result); return this; }

  get successCount() { return this.results.filter(r => r.status === 'success').length; }
  get failedCount() { return this.results.filter(r => r.status === 'failed').length; }
  get partialCount() { return this.results.filter(r => r.status === 'partial').length; }
  get skippedCount() { return this.results.filter(r => r.status === 'skipped').length; }
  get processedCount() { return this.results.filter(r => r.status !== 'pending').length; }

  /** @param {boolean} wasCancelled */
  seal(wasCancelled) {
    this.completedAt = Date.now();
    this.durationMs = this.completedAt - this.startedAt;
    this.cancelled = !!wasCancelled;
    return this;
  }

  toLogText() {
    const mins = Math.floor((this.durationMs || 0) / 60000);
    const secs = Math.floor(((this.durationMs || 0) % 60000) / 1000);
    const lines = [
      `PiQPull Export Session — ${this.sessionId}`,
      `Account  : ${this.accountSlug}`,
      `Project  : ${this.projectFolder || '(download only)'}`,
      `Total    : ${this.totalCount}`,
      `Success  : ${this.successCount}`,
      `Partial  : ${this.partialCount}`,
      `Failed   : ${this.failedCount}`,
      `Skipped  : ${this.skippedCount}`,
      `Duration : ${mins}m ${secs}s`,
      `Cancelled: ${this.cancelled ? 'yes' : 'no'}`,
      '',
      '--- Results ---',
    ];
    for (const r of this.results) {
      const icon = r.status === 'success' ? 'OK  ' : r.status === 'failed' ? 'FAIL' : r.status === 'partial' ? 'PART' : 'SKIP';
      const ph = Object.entries(r.phases).map(([k, v]) => `${k[0].toUpperCase()}:${v.ok ? 'ok' : 'ERR'}(${v.ms || 0}ms)`).join(' ');
      const notes = r.notes.length > 0 ? ` | ${r.notes.join('; ')}` : '';
      lines.push(`[${icon}] ${r.name.substring(0, 60)} | ${ph} | ${r.durationMs || 0}ms${notes}`);
    }
    return lines.join('\n');
  }

  toConsoleSummary() {
    const mins = Math.floor((this.durationMs || 0) / 60000);
    const secs = Math.floor(((this.durationMs || 0) % 60000) / 1000);
    return [
      `── PiQExportSession ${this.sessionId} ──`,
      `Account  : ${this.accountSlug}`,
      `Project  : ${this.projectFolder || '(download)'}`,
      `Total    : ${this.totalCount}`,
      `✅ OK    : ${this.successCount}`,
      `⚡ Partial: ${this.partialCount}`,
      `❌ Failed : ${this.failedCount}`,
      `⬜ Skipped: ${this.skippedCount}`,
      `Duration : ${mins}m ${secs}s`,
      this.cancelled ? '⚠️  Cancelled by user.' : '',
    ].filter(Boolean).join('\n');
  }
}

// ============================================================================
// OrbController — animated orb with shotgun speech spray
// Butt-Head: top-left of sphere, words spray upper-left outward.
// Beavis   : bottom-right of sphere, words spray lower-right outward.
// Faces are NEVER covered — words travel away from them.
// ============================================================================


// ============================================================================
// BrowseExport — public export API
// ============================================================================

const BrowseExport = (() => {

  'use strict';

  /** @param {string} model @returns {string} */
  function shortModel(model) {
    if (!model) return '?';
    if (model.includes('sonnet-4-6')) return 'S4.6';
    if (model.includes('sonnet-4-5')) return 'S4.5';
    if (model.includes('sonnet-4-20')) return 'S4';
    if (model.includes('3-7-sonnet')) return 'S3.7';
    if (model.includes('3-5-sonnet')) return 'S3.5';
    if (model.includes('3-sonnet')) return 'S3';
    if (model.includes('haiku')) return 'Haiku';
    if (model.includes('opus')) return 'Opus';
    return model.split('-').slice(0, 2).join('-');
  }

  /**
   * @param {unknown[]} messages
   * @param {string} blockType
   * @returns {number}
   */
  function countBlock(messages, blockType) {
    let n = 0;
    for (const msg of (Array.isArray(messages) ? messages : [])) {
      for (const block of (Array.isArray(msg && msg.content) ? msg.content : [])) {
        if (block && block.type === blockType) n++;
      }
    }
    return n;
  }

  /**
   * Count artifact-producing tool_use blocks (both legacy and create_file).
   * @param {unknown[]} messages @returns {number}
   */
  function countArtifactBlocks(messages) {
    let n = 0;
    for (const msg of (Array.isArray(messages) ? messages : [])) {
      for (const block of (Array.isArray(msg && msg.content) ? msg.content : [])) {
        if (block && block.type === 'tool_use' && (block.name === 'artifacts' || block.name === 'create_file')) n++;
      }
    }
    return n;
  }

  /** @param {PiQExportResult} result @param {{ chat_messages?: unknown[], model?: string }} convData */
  function fillResultMeta(result, convData) {
    const msgs = Array.isArray(convData && convData.chat_messages) ? convData.chat_messages : [];
    result.meta.msgCount = msgs.length;
    result.meta.thinkingCount = countBlock(msgs, 'thinking');
    result.meta.artifactCount = countArtifactBlocks(msgs);
    result.meta.model = (convData && convData.model) || null;
  }

  function gatherOpts() {
    const gb = /** @param {string} id */ (id) => { const e = document.getElementById(id); return e ? /** @type {HTMLInputElement} */ (e).checked : false; };
    const gv = /** @param {string} id */ (id) => { const e = document.getElementById(id); return e ? /** @type {HTMLSelectElement} */ (e).value : ''; };
    return {
      format: gv('exportFormat'),
      includeChats: gb('includeChats'),
      includeThinking: gb('includeThinking'),
      includeMetadata: gb('includeMetadata'),
      includeArtifacts: gb('includeArtifacts'),
      extractArtifacts: gb('extractArtifacts'),
      flattenArtifacts: gb('flattenArtifacts'),
      artifactFormat: gv('artifactFormat'),
      serverPush: gb('serverPush'),
    };
  }

  /**
   * @param {{ name?: string, chat_messages?: unknown[] }} convData
   * @param {ReturnType<typeof gatherOpts>} opts
   * @param {string} convId
   * @returns {{ content: string, filename: string, mimeType: string }}
   */
  function buildContent(convData, opts, convId) {
    const safeName = (convData.name || convId || 'export').replace(/[<>:"/\\|?*]/g, '_');
    switch (opts.format) {
      case 'markdown': return {
        content: convertToMarkdown(convData, opts.includeMetadata, convId, opts.includeArtifacts, opts.includeThinking),
        filename: `${safeName}.md`, mimeType: 'text/markdown',
      };
      case 'text': return {
        content: convertToText(convData, opts.includeMetadata, opts.includeArtifacts, opts.includeThinking),
        filename: `${safeName}.txt`, mimeType: 'text/plain',
      };
      case 'jsonl': return {
        content: convertToJSONL(convData, convId),
        filename: `${safeName}.jsonl`, mimeType: 'application/x-ndjson',
      };
      default: return {
        content: JSON.stringify(convData, null, 2),
        filename: `${safeName}.json`, mimeType: 'application/json',
      };
    }
  }

  /**
   * Add a conversation's content to a JSZip archive.
   * @param {{ name?: string, chat_messages?: unknown[] }} convData
   * @param {ReturnType<typeof gatherOpts>} opts
   * @param {string} convId
   * @param {ReturnType<typeof import('jszip')>} zip
   * @param {string} folderName
   */
  function addToZip(convData, opts, convId, zip, folderName) {
    const safeFolder = (folderName || 'export').replace(/[<>:"/\\|?*]/g, '_');
    const artFiles = (opts.extractArtifacts || opts.flattenArtifacts)
      ? extractArtifactFiles(convData, opts.artifactFormat || 'original') : [];
    const { content, filename } = buildContent(convData, opts, convId);

    if (opts.flattenArtifacts && !opts.extractArtifacts) {
      if (opts.includeChats) zip.folder('Chats').file(filename, content);
      if (artFiles.length > 0) {
        const af = zip.folder('Artifacts');
        for (const f of artFiles) af.file(`${safeFolder}_${f.filename}`, f.content || '');
      }
    } else if (opts.extractArtifacts) {
      const cf = zip.folder(safeFolder);
      if (opts.includeChats) cf.file(filename, content);
      if (artFiles.length > 0) {
        const af = opts.includeChats ? cf.folder('artifacts') : cf;
        for (const f of artFiles) af.file(f.filename, f.content || '');
      }
    } else {
      if (opts.includeChats) zip.file(filename, content);
    }
  }

  /** @param {string} msg @param {boolean} [isError] */
  function showToast(msg, isError) {
    const toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle('toast-error', !!isError);
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show', 'toast-error'), 5000);
  }

  // ── Incoming push (PiQuix server path) ────────────────────────────────

  /**
   * Push a single conversation to /export/incoming via background.
   * @param {{ chat_messages?: unknown[], project_uuid?: string, name?: string, model?: string }} convData
   * @param {string} convId
   * @param {string} convUrl
   * @param {string} [overrideFolder] - optional: use this folder instead of live BrowseState value
   * @param {string} [overrideProjName] - optional: use this name instead of live BrowseState value
   */
  async function pushToIncoming(convData, convId, convUrl, overrideFolder, overrideProjName) {
    const ts = getPiQTimestamp();
    const slug = generateChatSlug((convData && convData.name) || convId);
    // Use snapshot values when provided (bulk export), fall back to live state (single export)
    const folder   = overrideFolder   !== undefined ? overrideFolder   : BrowseState.piQuixProjectFolder;
    const projName = overrideProjName !== undefined ? overrideProjName : BrowseState.piQuixProjectName;

    let imageAssets = [];
    try {
      imageAssets = await collectImageAssets(convData, ts);
    } catch (_e) { /* non-fatal */ }

    const projectUuid = (convData && convData.project_uuid) || null;
    const projectName = projectUuid && BrowseState.pMap[projectUuid]
      ? BrowseState.pMap[projectUuid] : null;

    const artFiles = collectArtifactsForTransport(convData);
    const artManifest = artFiles.map(f => ({
      filename: f.filename, size_chars: typeof f.content === 'string' ? f.content.length : 0,
    }));

    const payload = buildExportPayload(
      convData, convId, convUrl,
      folder, projName,
      imageAssets, ts,
      BrowseState.orgId || null,
      BrowseState.orgName || null,
      projectName, projectUuid,
      artManifest,
      BrowseState.accountSlug || 'unknown'
    );

    return BrowseApi.pushToIncoming({
      projectFolder: folder,
      accountSlug: BrowseState.accountSlug || 'unknown',
      chatSlug: slug,
      conversationId: convId,
      exportPayload: payload,
      imageAssets: imageAssets.map(a => ({
        asset_filename: a.asset_filename,
        data_base64: a.data_base64,
        mime_type: a.mime_type,
      })),
      artifactFiles: artFiles.map(f => ({ filename: f.filename, content: f.content || '' })),
    });
  }

  // ── Session log writer ────────────────────────────────────────────────

  /** @param {PiQExportSession} session */
  async function writeSessionLog(session) {
    try {
      await BrowseApi.pushSessionLog({
        accountSlug: session.accountSlug,
        projectFolder: session.projectFolder || '_no-project',
        timestamp: session.sessionId,
        logContent: session.toLogText(),
      });
      OrbController.say('log', [], []);
    } catch (_e) {
      // Non-fatal — log failure never blocks the user
      console.warn('PiQPull: session log write failed:', _e);
    }
  }

  // ── Single export ─────────────────────────────────────────────────────

  /**
   * @param {string} orgId
   * @param {string} convId
   * @param {string} convName
   */
  async function exportSingle(orgId, convId, convName) {
    const opts = gatherOpts();
    const convUrl = `https://claude.ai/chat/${convId}`;
    showToast(`Fetching: ${convName}…`);

    try {
      const res = await fetch(
        `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}?tree=True&rendering_mode=messages&render_all_tools=true`,
        { credentials: 'include', headers: { Accept: 'application/json' } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const convData = await res.json();
      if (!convData || !Array.isArray(convData.chat_messages)) throw new Error('Invalid conversation response');
      convData.model = inferModel(convData);

      const msgs = (Array.isArray(convData.chat_messages) ? convData.chat_messages : []).length;
      const model = shortModel(convData.model);
      const thinking = countBlock(Array.isArray(convData.chat_messages) ? convData.chat_messages : [], 'thinking');
      const arts = countArtifactBlocks(Array.isArray(convData.chat_messages) ? convData.chat_messages : []);
      const metaStr = [
        `${msgs}msgs`, model,
        thinking > 0 ? `🧠${thinking}` : null,
        arts > 0 ? `🎨${arts}` : null,
      ].filter(Boolean).join(' · ');

      if (BrowseState.piQuixProjectFolder) {
        const result = await pushToIncoming(convData, convId, convUrl);
        if (result.success) {
          const fname = (result.data && result.data.jsonFilename) || convName;
          showToast(`✅ → ${BrowseState.piQuixProjectFolder}: ${fname} · ${metaStr}`);
        } else {
          showToast(`Push failed: ${result.error || 'Unknown error'}`, true);
          return;
        }
      } else {
        const artFiles = (opts.extractArtifacts || opts.flattenArtifacts)
          ? extractArtifactFiles(convData, opts.artifactFormat || 'original') : [];

        if ((opts.extractArtifacts || opts.flattenArtifacts) && artFiles.length > 0) {
          const zip = new JSZip();
          addToZip(convData, opts, convId, zip, convName);
          const blob = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `${(convName || 'export').replace(/[<>:"/\\|?*]/g, '_')}.zip`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          if (!opts.includeChats) { showToast('Nothing to export — enable Chats or Artifacts.', true); return; }
          const { content, filename, mimeType } = buildContent(convData, opts, convId);
          downloadFile(content, filename, mimeType);
        }

        if (opts.serverPush) {
          const ts = getPiQTimestamp();
          const safe = (convName || convId).replace(/[<>:"/\\|?*]/g, '_');
          BrowseApi.pushToServer(`piqpull-claude-${safe}-${ts}.jsonl`, convertToJSONL(convData, convId))
            .catch(e => console.warn('PiQPull: server push failed:', e));
        }
        showToast(`Downloaded: ${convName} · ${metaStr}`);
      }

      await BrowseState.saveTimestamp(convId);
      BrowseTable.render();
      BrowseTable.updateStats();

    } catch (err) {
      console.error('PiQPull exportSingle:', err);
      showToast(`Failed: ${err.message}`, true);
    }
  }

  // ── Bulk export ───────────────────────────────────────────────────────

  /** @param {string} orgId */
  async function exportAll(orgId) {
    const opts = gatherOpts();

    const subset = BrowseState.selected.size > 0
      ? BrowseState.filtered.filter(c => BrowseState.selected.has(c.uuid))
      : BrowseState.filtered;

    // Guard: nothing to export
    if (!Array.isArray(subset) || subset.length === 0) {
      showToast('Nothing to export. Conversations may still be loading.', true);
      return;
    }

    // Single item: skip orb, go direct
    if (subset.length === 1) {
      await exportSingle(orgId, subset[0].uuid, subset[0].name || 'Untitled');
      return;
    }

    const exportBtn = document.getElementById('exportAllBtn');
    const origLabel = exportBtn ? exportBtn.textContent : 'Export All';
    if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = 'Running…'; }

    const total = subset.length;
    // Snapshot routing state — user changing destination picker mid-run has no effect
    const snapFolder   = BrowseState.piQuixProjectFolder;
    const snapProjName = BrowseState.piQuixProjectName;
    const usingPush = !!snapFolder;
    const session = new PiQExportSession(total, snapFolder, BrowseState.accountSlug);
    let isCancelled = false;

    // Lock picker + export button for the duration of the run
    const pickerEl = document.getElementById('piQuixProjectSelect');
    if (pickerEl) pickerEl.disabled = true;

    OrbController.show(total, snapFolder);
    OrbController.onCancel(() => { isCancelled = true; });
    OrbController.say('init', [total, snapFolder], []);

    // ── PATH A: per-conversation incoming push ──────────────────────────

    if (usingPush) {
      try {
        for (let idx = 0; idx < total; idx++) {
          if (isCancelled) break;

          const conv = subset[idx];
          const result = new PiQExportResult(conv.uuid, conv.name || 'Untitled');
          session.addResult(result);

          OrbController.setCurrentName(conv.name || conv.uuid);
          OrbController.setCount(idx + 1, total);
          // Throttle fetching speech — every 8th conversation only
          if (idx % 8 === 0) OrbController.say('fetching', [conv.name, idx + 1, total], []);

          result.beginPhase('fetch');
          let convData = null;
          let attempts = 0;
          const MAX_ATTEMPTS = 2;

          while (attempts < MAX_ATTEMPTS && !convData) {
            attempts++;
            try {
              const res = await fetch(
                `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
                { credentials: 'include', headers: { Accept: 'application/json' } }
              );

              if (res.status === 429) {
                OrbController.say('retrying', [conv.name, attempts + 1], []);
                result.retries++;
                await new Promise(r => setTimeout(r, 3000));
                continue;
              }

              if (!res.ok) throw new Error(`HTTP ${res.status}`);

              const data = await res.json();
              if (!data || !Array.isArray(data.chat_messages)) throw new Error('Invalid response');
              data.model = inferModel(data);
              convData = data;

            } catch (fetchErr) {
              if (attempts >= MAX_ATTEMPTS) {
                result.endPhase('fetch', false, fetchErr.message);
                result.notes.push(`fetch failed: ${fetchErr.message}`);
                OrbController.say('fetchFail', [conv.name, fetchErr.message], []);
              } else {
                OrbController.say('retrying', [conv.name, attempts + 1], []);
                result.retries++;
                await new Promise(r => setTimeout(r, 1500));
              }
            }
          }

          // Bug 3 fix: seal if 429 exhausted while loop without triggering catch
          if (!convData) {
            if (!result.phases['fetch'] || result.phases['fetch'].ok === null) {
              result.endPhase('fetch', false, 'Rate limited — retries exhausted');
            }
            result.seal(null);
            OrbController.logResult(result);
            OrbController.announce(`❌ ${session.failedCount} failed — rate limited`, 'error');
            OrbController.setMeta(`❌ ${session.failedCount} failed so far`);
            await new Promise(r => setTimeout(r, 100));
            continue;
          }

          result.endPhase('fetch', true);
          fillResultMeta(result, convData);
          result.slug = generateChatSlug((convData.name) || conv.uuid);

          const model = shortModel(convData.model);
          const msgs = result.meta.msgCount;
          const thinking = result.meta.thinkingCount;
          const arts = result.meta.artifactCount;

          OrbController.setMeta(
            `${msgs}msgs · ${model}` +
            (thinking > 0 ? ` · 🧠${thinking}` : '') +
            (arts > 0 ? ` · 🎨${arts}` : '') +
            ` | ✅${session.successCount} ❌${session.failedCount}`
          );

          // Throttle speech — hasThink/hasArts always fire, pushing only every 8th
          if (thinking > 30) {
            OrbController.say('hasThink', [thinking], [thinking]);
          } else if (arts > 5) {
            OrbController.say('hasArts', [arts], []);
          } else if (idx % 8 === 0) {
            OrbController.say('pushing', [conv.name, msgs, model], []);
          }

          // Phase: push
          result.beginPhase('push');
          const convUrl = `https://claude.ai/chat/${conv.uuid}`;

          try {
            const pushResult = await pushToIncoming(convData, conv.uuid, convUrl, snapFolder, snapProjName);

            if (pushResult.success) {
              // Surface any artifact write failures the server flagged (partial success)
              const artErrors = (pushResult.data && Array.isArray(pushResult.data.artifacts))
                ? pushResult.data.artifacts.filter(a => a && a.error) : [];
              for (const ae of artErrors) {
                OrbController.addError(`Artifact failed: ${ae.filename || '?'} — ${ae.error}`);
              }
              result.endPhase('push', true);
              result.meta.outputFilename = (pushResult.data && pushResult.data.jsonFilename) || null;
              result.seal((pushResult.data && pushResult.data.jsonPath) || null);
              OrbController.say('pushOk', [], []);
            } else {
              // Inline retry: wait 2s, try once more before marking as failed
              await new Promise(r => setTimeout(r, 2000));
              let retryR = null;
              try { retryR = await pushToIncoming(convData, conv.uuid, convUrl, snapFolder, snapProjName); } catch (_re) { /* fall through to failure */ }
              if (retryR && retryR.success) {
                result.retries++;
                const artE = (retryR.data && Array.isArray(retryR.data.artifacts)) ? retryR.data.artifacts.filter(a => a && a.error) : [];
                for (const ae of artE) OrbController.addError(`Artifact failed: ${ae.filename || '?'} — ${ae.error}`);
                result.endPhase('push', true);
                result.meta.outputFilename = (retryR.data && retryR.data.jsonFilename) || null;
                result.seal((retryR.data && retryR.data.jsonPath) || null);
                OrbController.say('pushOk', [], []);
              } else {
                result.endPhase('push', false, pushResult.error || 'Unknown error');
                result.notes.push(`push: ${pushResult.error || 'Unknown error'}`);
                result.seal(null);
                OrbController.say('pushFail', [conv.name], []);
              }
            }
          } catch (pushErr) {
            // Inline retry for network/timeout errors
            await new Promise(r => setTimeout(r, 2000));
            let retryR = null;
            try { retryR = await pushToIncoming(convData, conv.uuid, convUrl, snapFolder, snapProjName); } catch (_re) { /* fall through to failure */ }
            if (retryR && retryR.success) {
              result.retries++;
              const artE = (retryR.data && Array.isArray(retryR.data.artifacts)) ? retryR.data.artifacts.filter(a => a && a.error) : [];
              for (const ae of artE) OrbController.addError(`Artifact failed: ${ae.filename || '?'} — ${ae.error}`);
              result.endPhase('push', true);
              result.meta.outputFilename = (retryR.data && retryR.data.jsonFilename) || null;
              result.seal((retryR.data && retryR.data.jsonPath) || null);
              OrbController.say('pushOk', [], []);
            } else {
              result.endPhase('push', false, pushErr.message);
              result.notes.push(`push threw: ${pushErr.message}`);
              result.seal(null);
              OrbController.say('pushFail', [conv.name], []);
              OrbController.announce(`Push failed: ${result.phases.push?.error || 'unknown'}`, 'error');
            }
          }

          OrbController.logResult(result);

          const processed = session.processedCount;
          if (processed === Math.floor(total * 0.5)) {
            OrbController.say('halfway', [processed, total], []);
          } else if (processed === total - 3 && total > 4) {
            OrbController.say('nearEnd', [3], []);
          }

          await new Promise(r => setTimeout(r, 60));
        } // end for

        // ── End-of-run retry pass ── re-fetch + re-push all failed conversations once ────────
        const toRetry = session.results.filter(r => r.status === 'failed');
        if (!isCancelled && toRetry.length > 0) {
          OrbController.announce(`↺ Retrying ${toRetry.length} failed…`, 'warn');
          await new Promise(r => setTimeout(r, 1500));

          for (const failedResult of toRetry) {
            if (isCancelled) break;
            const conv = subset.find(c => c.uuid === failedResult.uuid);
            if (!conv) continue;

            OrbController.setCurrentName(`↺ ${conv.name || conv.uuid}`);
            const retryStart = Date.now();
            try {
              const res = await fetch(
                `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
                { credentials: 'include', headers: { Accept: 'application/json' } }
              );
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const convData = await res.json();
              if (!convData || !Array.isArray(convData.chat_messages)) throw new Error('Invalid response');
              convData.model = inferModel(convData);

              const retryPush = await pushToIncoming(convData, conv.uuid, `https://claude.ai/chat/${conv.uuid}`, snapFolder, snapProjName);

              if (retryPush.success) {
                const artE = (retryPush.data && Array.isArray(retryPush.data.artifacts))
                  ? retryPush.data.artifacts.filter(a => a && a.error) : [];
                for (const ae of artE) OrbController.addError(`↺ Art: ${ae.filename || '?'} — ${ae.error}`);
                failedResult.phases['retry'] = { ok: true, startMs: retryStart, ms: Date.now() - retryStart, error: null };
                failedResult.retries++;
                failedResult.status = 'success';
                failedResult.outputPath = (retryPush.data && retryPush.data.jsonPath) || null;
                failedResult.meta.outputFilename = (retryPush.data && retryPush.data.jsonFilename) || null;
                OrbController.announce(`↺ Recovered: ${(conv.name || conv.uuid).substring(0, 30)}`, 'status');
              } else {
                failedResult.phases['retry'] = { ok: false, startMs: retryStart, ms: Date.now() - retryStart, error: retryPush.error || 'retry failed' };
                OrbController.addError(`↺ Still failed: ${(conv.name || conv.uuid).substring(0, 28)}`);
              }
            } catch (retryErr) {
              failedResult.phases['retry'] = { ok: false, startMs: retryStart, ms: Date.now() - retryStart, error: retryErr.message };
              OrbController.addError(`↺ Retry error: ${(conv.name || conv.uuid).substring(0, 24)}: ${retryErr.message}`);
            }
            OrbController.logResult(failedResult);
            await new Promise(r => setTimeout(r, 400));
          }
        }

        session.seal(isCancelled);
        console.log(session.toConsoleSummary());

        // Download project homes once per unique project if checkbox checked
        if (!isCancelled && BrowseState.includeProjectHome) {
          const seenProjectIds = new Set();
          const exportSubset = BrowseState.selected.size > 0
            ? BrowseState.filtered.filter(c => BrowseState.selected.has(c.uuid))
            : BrowseState.filtered;

          const projectConvs = [];
          for (const conv of exportSubset) {
            if (conv.project_uuid && !seenProjectIds.has(conv.project_uuid)) {
              seenProjectIds.add(conv.project_uuid);
              projectConvs.push(conv);
            }
          }

          for (const conv of projectConvs) {
            try {
              const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
              const resp = await new Promise(resolve =>
                chrome.tabs.sendMessage(activeTab.id, {
                  action: 'exportProjectHome',
                  conversationId: conv.uuid,
                  orgId,
                  orgName: BrowseState.orgName,
                  accountSlug: BrowseState.accountSlug,
                  projectFolder: snapFolder,
                  tabUrl: activeTab ? activeTab.url : '',
                }, resolve)
              );
              const projName = (resp && resp.projectName) || conv.project_uuid || 'unknown';
              if (resp && resp.success) {
                OrbController.announce(`Project home: ${projName}`, 'status');
              } else {
                OrbController.announce(`Project home failed: ${projName}`, 'error');
                OrbController.addError(`Project home failed: ${(resp && resp.error) || 'unknown'}`);
              }
            } catch (projErr) {
              OrbController.announce(`Project home error: ${projErr.message}`, 'error');
              OrbController.addError(`Project home threw: ${projErr.message}`);
            }
          }
        }

        // Write session log (non-blocking)
        if (session.projectFolder) {
          await writeSessionLog(session);
        }

        if (isCancelled) {
          OrbController.say('cancelled', [], []);
          showToast(`Cancelled after ${session.processedCount} of ${total}.`, true);
        } else {
          OrbController.say('done', [session.successCount, total], [session.successCount, total]);
          const msg = session.failedCount > 0
            ? `✅${session.successCount} ⚡${session.partialCount} ❌${session.failedCount} of ${total} → ${snapFolder}`
            : `All ${session.successCount} pushed to ${snapFolder} 🎉`;
          showToast(msg, session.failedCount > 0);
          OrbController.announce(session.failedCount === 0 ? `All ${session.successCount} complete ✓` : `${session.successCount} ok · ${session.failedCount} failed`, session.failedCount > 0 ? 'error' : 'status');

          const doneIds = session.results.filter(r => r.status === 'success').map(r => r.uuid);
          await BrowseState.saveTimestamps(doneIds);
          BrowseTable.render();
          BrowseTable.updateStats();
        }

      } catch (sessionErr) {
        console.error('PiQPull bulk session error:', sessionErr);
        showToast(`Session error: ${sessionErr.message}`, true);
      } finally {
        OrbController.setDone();
        setTimeout(() => OrbController.hide(), 5000);
        if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = origLabel; }
        if (pickerEl) pickerEl.disabled = false;
      }
      return;
    }

    // ── PATH B: ZIP download ──────────────────────────────────────────────

    const zip = new JSZip();
    const jsonlLines = /** @type {string[]} */ ([]);

    try {
      const BATCH = 3;

      for (let start = 0; start < total; start += BATCH) {
        if (isCancelled) break;
        const batch = subset.slice(start, Math.min(start + BATCH, total));

        await Promise.all(batch.map(async (conv) => {
          const result = new PiQExportResult(conv.uuid, conv.name || 'Untitled');
          session.addResult(result);
          result.beginPhase('fetch');

          try {
            const res = await fetch(
              `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
              { credentials: 'include', headers: { Accept: 'application/json' } }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data || !Array.isArray(data.chat_messages)) throw new Error('Invalid response');
            data.model = inferModel(data);

            result.endPhase('fetch', true);
            fillResultMeta(result, data);
            OrbController.setCurrentName(conv.name || conv.uuid);
            OrbController.say('pushing', [conv.name, result.meta.msgCount, shortModel(data.model)], []);

            result.beginPhase('zip');
            const safeName = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');
            addToZip(data, opts, conv.uuid, zip, safeName);
            result.endPhase('zip', true);

            if (opts.serverPush) jsonlLines.push(convertToJSONL(data, conv.uuid));
            result.seal('(zip)');

          } catch (convErr) {
            result.endPhase('fetch', false, convErr.message);
            result.seal(null);
            console.warn(`PiQPull ZIP: ${conv.name}:`, convErr.message);
          }

          OrbController.logResult(result);
          OrbController.setCount(session.processedCount, total);
          OrbController.setMeta(`✅${session.successCount} ❌${session.failedCount} / ${total}`);
        }));

        if (start + BATCH < total && !isCancelled) await new Promise(r => setTimeout(r, 200));
      }

      if (!isCancelled) {
        OrbController.say('zipping', [], []);
      }

      session.seal(isCancelled);
      console.log(session.toConsoleSummary());

      const ts = getPiQTimestamp();
      const prefix = opts.flattenArtifacts && !opts.extractArtifacts && !opts.includeChats
        ? 'piqpull-artifacts' : 'piqpull-exports';
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${prefix}-${ts}.zip`;
      document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      if (opts.serverPush && jsonlLines.length > 0) {
        BrowseApi.pushToServer(`piqpull-bulk-${ts}.jsonl`, jsonlLines.join('\n'))
          .catch(e => console.warn('PiQPull push failed:', e));
      }

      if (isCancelled) {
        showToast(`Cancelled — ${session.processedCount} packed in ZIP.`, true);
      } else {
        OrbController.say('zipDone', [], []);
        const doneIds = session.results.filter(r => r.status === 'success').map(r => r.uuid);
        await BrowseState.saveTimestamps(doneIds);
        BrowseTable.render();
        BrowseTable.updateStats();
        showToast(session.failedCount > 0
          ? `ZIP: ${session.successCount} ok, ${session.failedCount} failed of ${total}`
          : `All ${session.successCount} in ZIP 🎉`);
      }

    } catch (bulkErr) {
      console.error('PiQPull ZIP bulk error:', bulkErr);
      showToast(`Export error: ${bulkErr.message}`, true);
    } finally {
      setTimeout(() => OrbController.hide(), 3000);
      if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = origLabel; }
      if (pickerEl) pickerEl.disabled = false; // re-enable picker (disabled before PATH A/B split)
    }
  }

  return { exportSingle, exportAll, showToast };
})();

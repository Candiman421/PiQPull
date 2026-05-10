// PiQPull — Browse: Export Engine
// Single job: build exports (single and bulk), drive the PiQ Orb, log results.
//
// Architecture:
//   PiQExportResult  — per-conversation result object with phase tracking
//   PiQExportSession — session-level rollup object
//   OrbController    — drives the animated orb modal UI
//   BrowseExport     — public API: exportSingle, exportAll, showToast

// ============================================================================
// PiQExportResult
// Extensible per-conversation result object with phase-level granularity.
// Designed to grow: add phases, meta fields, retry state as pipeline deepens.
// ============================================================================

class PiQExportResult {
  constructor(conversationId, conversationName) {
    this.uuid        = conversationId;
    this.name        = conversationName || 'Untitled';
    this.slug        = null;
    this.status      = 'pending';   // pending | success | partial | failed | skipped
    this.phases      = {};          // { fetch, image, push } — each: { ok, startMs, ms, error }
    this.meta        = {
      msgCount:       0,
      thinkingCount:  0,
      artifactCount:  0,
      imageCount:     0,
      model:          null,
      fileSizeBytes:  null,
      outputFilename: null,
    };
    this.retries     = 0;
    this.startedAt   = null;
    this.completedAt = null;
    this.durationMs  = null;
    this.outputPath  = null;
    this.notes       = [];          // extensible: push strings for ad-hoc observations
  }

  // Call before starting a phase. Also records session start on first call.
  beginPhase(phaseName) {
    if (!this.startedAt) this.startedAt = Date.now();
    this.phases[phaseName] = { ok: null, startMs: Date.now(), ms: null, error: null };
    return this;
  }

  // Call after a phase finishes. succeeded = bool, errorMessage = string|null.
  endPhase(phaseName, succeeded, errorMessage) {
    const phase = this.phases[phaseName];
    if (!phase) return this;
    phase.ok    = !!succeeded;
    phase.ms    = Date.now() - phase.startMs;
    phase.error = errorMessage || null;
    return this;
  }

  // Finalize status from phase outcomes. Call once when done.
  seal(outputPath) {
    this.completedAt = Date.now();
    this.durationMs  = this.startedAt ? this.completedAt - this.startedAt : 0;
    this.outputPath  = outputPath || null;

    const phaseValues = Object.values(this.phases);
    if (phaseValues.length === 0) {
      this.status = 'skipped';
    } else {
      const anyFailed = phaseValues.some(p => p.ok === false);
      const allOk     = phaseValues.every(p => p.ok === true);
      this.status = allOk ? 'success' : anyFailed ? 'partial' : 'failed';
    }
    return this;
  }

  // One-line summary for the orb log and console.
  toLogLine() {
    const icons   = { success: '✅', partial: '⚡', failed: '❌', skipped: '⬜', pending: '⏳' };
    const icon    = icons[this.status] || '?';
    const phaseStr = Object.entries(this.phases).map(([k, v]) =>
      `${k[0].toUpperCase()}:${v.ok ? '✓' : '✗'}(${v.ms || 0}ms)`
    ).join(' ');
    const meta = this.meta.msgCount ? `${this.meta.msgCount}msgs` : '';
    return `${icon} ${this.name.substring(0, 32)} | ${phaseStr}${meta ? ' | ' + meta : ''} | ${this.durationMs}ms`;
  }

  // Full JSON for optional session log file.
  toJSON() {
    return {
      uuid:       this.uuid,
      name:       this.name,
      slug:       this.slug,
      status:     this.status,
      phases:     this.phases,
      meta:       this.meta,
      retries:    this.retries,
      durationMs: this.durationMs,
      outputPath: this.outputPath,
      notes:      this.notes,
    };
  }
}

// ============================================================================
// PiQExportSession
// Session-level rollup. Holds all PiQExportResult objects for one bulk run.
// ============================================================================

class PiQExportSession {
  constructor(totalCount, projectFolder) {
    this.sessionId     = typeof getPiQTimestamp === 'function' ? getPiQTimestamp() : String(Date.now());
    this.projectFolder = projectFolder || null;
    this.totalCount    = totalCount;
    this.results       = [];
    this.startedAt     = Date.now();
    this.completedAt   = null;
    this.durationMs    = null;
    this.cancelled     = false;
  }

  addResult(result) {
    this.results.push(result);
    return this;
  }

  get successCount()   { return this.results.filter(r => r.status === 'success').length; }
  get failedCount()    { return this.results.filter(r => r.status === 'failed').length; }
  get partialCount()   { return this.results.filter(r => r.status === 'partial').length; }
  get skippedCount()   { return this.results.filter(r => r.status === 'skipped').length; }
  get processedCount() { return this.results.filter(r => r.status !== 'pending').length; }

  seal(wasCancelled) {
    this.completedAt = Date.now();
    this.durationMs  = this.completedAt - this.startedAt;
    this.cancelled   = !!wasCancelled;
    return this;
  }

  // Human-readable summary logged to console on completion.
  toConsoleSummary() {
    const mins = Math.floor((this.durationMs || 0) / 60000);
    const secs = Math.floor(((this.durationMs || 0) % 60000) / 1000);
    return [
      `── PiQExportSession ${this.sessionId} ──`,
      `Project : ${this.projectFolder || '(download)'}`,
      `Total   : ${this.totalCount}`,
      `✅ OK   : ${this.successCount}`,
      `⚡ Partial: ${this.partialCount}`,
      `❌ Failed: ${this.failedCount}`,
      `⬜ Skipped: ${this.skippedCount}`,
      `Duration: ${mins}m ${secs}s`,
      this.cancelled ? '⚠️  Cancelled by user.' : '',
    ].filter(Boolean).join('\n');
  }
}

// ============================================================================
// OrbController
// Drives the PiQ Orb modal UI. Pure DOM manipulation — no fetch, no business logic.
// ============================================================================

const OrbController = (() => {

  let cancelCb  = null;
  const logBuf  = [];           // ring buffer of recent PiQExportResult log lines
  const LOG_MAX = 9;

  // ── Speech line banks ──────────────────────────────────────────────────────

  const BH = {
    init:       (n, proj)    => `Uh, we're exporting ${n} conversations${proj ? ' to ' + proj : ''}. That's like... a lot of data.`,
    fetching:   (name, n, t) => `Uh, fetching "${cap(name)}"... ${n} of ${t}.`,
    hasThink:   (n)          => `This one had ${n} thinking blocks. That's... uh... a lot of thinking.`,
    hasArts:    (n)          => `${n} artifact${n !== 1 ? 's' : ''}. Like in a museum or whatever.`,
    pushing:    (name, msgs, model) => `Sending "${cap(name)}" — ${msgs} msg${msgs !== 1 ? 's' : ''}, ${model}.`,
    pushOk:     ()           => `Uh, that one saved. Good job us.`,
    fetchFail:  (name, err)  => `Uh, "${cap(name)}" broke${err && err.includes('429') ? ' — too fast, cool it.' : '. Skipping it.'}`,
    pushFail:   (name)       => `Server said no on "${cap(name)}". Moving on.`,
    retrying:   (name, n)    => `Trying "${cap(name)}" again. Attempt ${n}.`,
    halfway:    (n, t)       => `Uh, we're ${Math.round(n/t*100)}% done. That's like, halfway-ish.`,
    nearEnd:    (left)       => `Uh, only ${left} left. Almost done I think.`,
    done:       (ok, t)      => ok === t ? `We got all ${t}. That was a lot of work.` : `Got ${ok} of ${t}. ${t - ok} didn't make it.`,
    cancelled:  ()           => `Uh, you cancelled it. That's fine I guess.`,
    zipping:    ()           => `Making the zip file now. Uh, it's compressing things.`,
    zipDone:    ()           => `Uh, the zip is ready. Download it or whatever.`,
  };

  const BV = {
    init:       ()     => 'Heh heh. Export.',
    fetching:   ()     => pick(['Heh heh. Fetch.', 'Yeah yeah, get it.', 'Heh, downloading is cool.']),
    hasThink:   (n)    => n > 40 ? 'Heh heh heh. It\'s thinking REALLY hard!' : 'Yeah yeah, thinking.',
    hasArts:    ()     => pick(['Heh heh. Artifacts.', 'Yeah yeah, like treasure!', 'Heh, artifacts are cool.']),
    pushing:    ()     => pick(['Yeah yeah, push it!', 'Heh heh, pushing.', 'Push push push! Heh.']),
    pushOk:     ()     => pick(['Heh heh. Done.', 'YEAH! Next one!', 'Heh, it worked!']),
    fetchFail:  ()     => pick(['WHAT?! It broke! Heh heh. Broke.', 'Heh, that one died.', 'Ugh, broken. Heh.']),
    pushFail:   ()     => pick(['Heh heh. Server said no.', 'Server\'s being dumb! Heh.', 'Yeah yeah, server sucks.']),
    retrying:   ()     => pick(['Heh heh, try again.', 'Yeah yeah, once more!', 'Try it again! Heh!']),
    halfway:    ()     => pick(['Heh heh, half.', 'We\'re in the middle! Heh.', 'Yeah half is like, cool.']),
    nearEnd:    ()     => pick(['YEAH! Almost done! Heh heh!', 'So close! Heh heh heh!', 'Almost! YEAH!']),
    done:       (ok, t)=> ok === t ? 'YEAH! WE DID IT! HEH HEH HEH HEH!' : pick(['Heh, we missed some.', 'Some broke. Heh heh.', 'Eh, close enough. Heh.']),
    cancelled:  ()     => 'Heh heh. You quit. Heh.',
    zipping:    ()     => 'Heh heh. Zipping things.',
    zipDone:    ()     => 'YEAH! It\'s a zip! Heh heh!',
  };

  function cap(str)       { return (str || '').substring(0, 26); }
  function pick(arr)      { return arr[Math.floor(Math.random() * arr.length)]; }
  function el(id)         { return document.getElementById(id); }
  function setText(id, t) { const e = el(id); if (e) e.textContent = t || ''; }

  // ── Public API ─────────────────────────────────────────────────────────────

  function show(totalCount, projectFolder) {
    logBuf.length = 0;
    const modal = el('piqOrbModal');
    if (modal) modal.classList.remove('hidden');
    setText('piqOrbCount', `0 / ${totalCount}`);
    setText('piqOrbPct',   '0%');
    setText('piqOrbName',  'Initializing…');
    setText('piqOrbMeta',  '');
    const fillEl = el('piqOrbFill');
    if (fillEl) fillEl.style.width = '0%';
    say('init', 'init', [totalCount, projectFolder], []);
  }

  function hide() {
    const modal = el('piqOrbModal');
    if (modal) modal.classList.add('hidden');
  }

  function onCancel(cb) {
    cancelCb = cb;
    const btn = el('piqOrbCancel');
    if (btn) btn.onclick = () => { if (cancelCb) cancelCb(); };
  }

  // Update both speech bubbles at once.
  // bhKey/bvKey are keys in BH/BV. bhArgs/bvArgs are argument arrays.
  function say(bhKey, bvKey, bhArgs, bvArgs) {
    if (BH[bhKey]) setText('piqBHText', BH[bhKey](...(bhArgs || [])));
    if (BV[bvKey]) setText('piqBVText', BV[bvKey](...(bvArgs || [])));
  }

  function setCount(current, total) {
    const pct = total > 0 ? Math.round(current / total * 100) : 0;
    setText('piqOrbCount', `${current} / ${total}`);
    setText('piqOrbPct',   `${pct}%`);
    const fillEl = el('piqOrbFill');
    if (fillEl) fillEl.style.width = `${pct}%`;
  }

  function setCurrentName(conversationName) {
    setText('piqOrbName', (conversationName || '').substring(0, 52));
  }

  function setMeta(text) {
    setText('piqOrbMeta', text || '');
  }

  // Append a PiQExportResult to the scrolling log.
  function logResult(result) {
    logBuf.push(result);
    if (logBuf.length > LOG_MAX) logBuf.shift();

    const logEl = el('piqOrbLog');
    if (!logEl) return;
    logEl.innerHTML = logBuf.map(r => {
      const cls  = `piq-log-line piq-log-${r.status === 'success' ? 'ok' : r.status === 'partial' ? 'partial' : r.status === 'skipped' ? 'skip' : 'failed'}`;
      const icon = r.status === 'success' ? '✅' : r.status === 'partial' ? '⚡' : r.status === 'skipped' ? '⬜' : '❌';
      const name = esc(r.name.substring(0, 30));
      const ph   = Object.entries(r.phases).map(([k, v]) => `${k[0].toUpperCase()}:${v.ok ? '✓' : '✗'}`).join(' ');
      const ms   = r.durationMs ? `${r.durationMs}ms` : '';
      return `<div class="${cls}">${icon} ${name} ${ph} ${ms}</div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function esc(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { show, hide, onCancel, say, setCount, setCurrentName, setMeta, logResult };
})();

// ============================================================================
// BrowseExport — public export API
// ============================================================================

const BrowseExport = (() => {

  // ── Metadata helpers ────────────────────────────────────────────────────────

  function shortModelLabel(modelStr) {
    if (!modelStr) return '?';
    if (modelStr.includes('sonnet-4-6'))   return 'S4.6';
    if (modelStr.includes('sonnet-4-5'))   return 'S4.5';
    if (modelStr.includes('sonnet-4-20'))  return 'S4';
    if (modelStr.includes('3-7-sonnet'))   return 'S3.7';
    if (modelStr.includes('3-5-sonnet'))   return 'S3.5';
    if (modelStr.includes('3-sonnet'))     return 'S3';
    if (modelStr.includes('haiku'))        return 'Haiku';
    if (modelStr.includes('opus'))         return 'Opus';
    return modelStr.split('-').slice(0, 2).join('-');
  }

  function countBlockType(messages, blockType) {
    let n = 0;
    for (const msg of (messages || [])) {
      for (const block of (msg.content || [])) {
        if (block.type === blockType) n++;
      }
    }
    return n;
  }

  function countArtifacts(messages) {
    let n = 0;
    for (const msg of (messages || [])) {
      for (const block of (msg.content || [])) {
        if (block.type === 'tool_use' && block.name === 'artifacts') n++;
      }
    }
    return n;
  }

  function populateResultMeta(result, conversationData) {
    const messages          = conversationData.chat_messages || [];
    result.meta.msgCount      = messages.length;
    result.meta.thinkingCount = countBlockType(messages, 'thinking');
    result.meta.artifactCount = countArtifacts(messages);
    result.meta.model         = conversationData.model || null;
  }

  // ── Options ─────────────────────────────────────────────────────────────────

  function gatherExportOptions() {
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

  // ── Download content builders ───────────────────────────────────────────────

  function buildDownloadContent(conversationData, opts, conversationId) {
    switch (opts.format) {
      case 'markdown': return {
        content:  convertToMarkdown(conversationData, opts.includeMetadata, conversationId, opts.includeArtifacts, opts.includeThinking),
        filename: `${conversationData.name || conversationId}.md`,
        mimeType: 'text/markdown'
      };
      case 'text': return {
        content:  convertToText(conversationData, opts.includeMetadata, opts.includeArtifacts, opts.includeThinking),
        filename: `${conversationData.name || conversationId}.txt`,
        mimeType: 'text/plain'
      };
      case 'jsonl': return {
        content:  convertToJSONL(conversationData, conversationId),
        filename: `${conversationData.name || conversationId}.jsonl`,
        mimeType: 'application/x-ndjson'
      };
      default: return {
        content:  JSON.stringify(conversationData, null, 2),
        filename: `${conversationData.name || conversationId}.json`,
        mimeType: 'application/json'
      };
    }
  }

  function addConversationToZip(conversationData, opts, conversationId, zipArchive, folderName) {
    const artifactFiles = (opts.extractArtifacts || opts.flattenArtifacts)
      ? extractArtifactFiles(conversationData, opts.artifactFormat || 'original')
      : [];
    const { content, filename } = buildDownloadContent(conversationData, opts, conversationId);
    const safeFolder = folderName || (conversationData.name || conversationId).replace(/[<>:"/\\|?*]/g, '_');

    if (opts.flattenArtifacts && !opts.extractArtifacts) {
      if (opts.includeChats !== false) zipArchive.folder('Chats').file(filename, content);
      if (artifactFiles.length > 0) {
        const af = zipArchive.folder('Artifacts');
        for (const f of artifactFiles) af.file(`${safeFolder}_${f.filename}`, f.content);
      }
    } else if (opts.extractArtifacts) {
      const cf = zipArchive.folder(safeFolder);
      if (opts.includeChats !== false) cf.file(filename, content);
      if (artifactFiles.length > 0) {
        const af = opts.includeChats !== false ? cf.folder('artifacts') : cf;
        for (const f of artifactFiles) af.file(f.filename, f.content);
      }
    } else {
      if (opts.includeChats !== false) zipArchive.file(filename, content);
    }
    return artifactFiles.length;
  }

  // ── Toast ───────────────────────────────────────────────────────────────────

  function showToast(message, isError) {
    const toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.toggle('toast-error', !!isError);
    toastEl.classList.add('show');
    setTimeout(() => {
      toastEl.classList.remove('show');
      toastEl.classList.remove('toast-error');
    }, 5000);
  }

  // ── Incoming push — full v2 treatment ───────────────────────────────────────
  // Includes: org identity, project name lookup, artifact extraction.
  // Called from both exportSingle and the PATH A bulk loop.

  async function pushToIncoming(conversationData, conversationId, conversationUrl) {
    const exportTimestamp = getPiQTimestamp();
    const chatSlug        = generateChatSlug(conversationData.name);

    // Image assets (non-fatal)
    let imageAssets = [];
    try {
      imageAssets = await collectImageAssets(conversationData, exportTimestamp);
    } catch (_imageErr) { /* non-fatal */ }

    // Claude.ai project name — zero-cost lookup from already-loaded pMap (no API call)
    const claudeaiProjectUuid = conversationData.project_uuid || null;
    const claudeaiProjectName = claudeaiProjectUuid
      ? (BrowseState.pMap[claudeaiProjectUuid] || null)
      : null;

    // Extract artifacts for disk write
    const artifactFiles = collectArtifactsForTransport(conversationData);
    const artifactsManifest = artifactFiles.map(af => ({
      filename:   af.filename,
      size_chars: af.content ? af.content.length : 0,
    }));

    // Build v2 payload with full identity chain
    const exportPayload = buildExportPayload(
      conversationData,
      conversationId,
      conversationUrl,
      BrowseState.piQuixProjectFolder,
      BrowseState.piQuixProjectName,
      imageAssets,
      exportTimestamp,
      BrowseState.orgId   || null,
      BrowseState.orgName || null,
      claudeaiProjectName,
      claudeaiProjectUuid,
      artifactsManifest
    );

    return BrowseApi.pushToIncoming({
      projectFolder: BrowseState.piQuixProjectFolder,
      chatSlug,
      conversationId,
      exportPayload,
      imageAssets: imageAssets.map(a => ({
        asset_filename: a.asset_filename,
        data_base64:    a.data_base64,
        mime_type:      a.mime_type
      })),
      artifactFiles: artifactFiles.map(af => ({ filename: af.filename, content: af.content })),
    });
  }

  // ── Single export (from table Export button) ─────────────────────────────────

  async function exportSingle(orgId, conversationId, conversationName) {
    const opts            = gatherExportOptions();
    const conversationUrl = `https://claude.ai/chat/${conversationId}`;
    showToast(`Fetching: ${conversationName}…`);

    try {
      const fetchResp = await fetch(
        `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`,
        { credentials: 'include', headers: { Accept: 'application/json' } }
      );
      if (!fetchResp.ok) throw new Error(`HTTP ${fetchResp.status}`);
      const conversationData = await fetchResp.json();
      conversationData.model = inferModel(conversationData);

      const msgs     = (conversationData.chat_messages || []).length;
      const model    = shortModelLabel(conversationData.model);
      const thinking = countBlockType(conversationData.chat_messages || [], 'thinking');
      const arts     = countArtifacts(conversationData.chat_messages || []);
      const metaBits = [`${msgs}msgs`, model, thinking > 0 ? `🧠${thinking}` : null, arts > 0 ? `🎨${arts}` : null].filter(Boolean).join(' · ');

      if (BrowseState.piQuixProjectFolder) {
        const serverResult = await pushToIncoming(conversationData, conversationId, conversationUrl);
        if (serverResult.success) {
          const fname = serverResult.data && serverResult.data.jsonFilename ? serverResult.data.jsonFilename : conversationName;
          showToast(`✅ → ${BrowseState.piQuixProjectFolder}: ${fname} · ${metaBits}`);
        } else {
          showToast(`Push failed: ${serverResult.error}`, true);
          return;
        }
      } else {
        const artifactFiles = (opts.extractArtifacts || opts.flattenArtifacts)
          ? extractArtifactFiles(conversationData, opts.artifactFormat || 'original') : [];

        if ((opts.extractArtifacts || opts.flattenArtifacts) && artifactFiles.length > 0) {
          const zip = new JSZip();
          addConversationToZip(conversationData, opts, conversationId, zip,
            conversationName.replace(/[<>:"/\\|?*]/g, '_'));
          const blob = await zip.generateAsync({ type: 'blob' });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url; a.download = `${conversationName}.zip`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast(`Downloaded: ${conversationName} · ${metaBits}`);
        } else {
          if (opts.includeChats === false) { showToast('Nothing to export. Enable Chats or Artifacts.', true); return; }
          const { content, filename, mimeType } = buildDownloadContent(conversationData, opts, conversationId);
          downloadFile(content, filename, mimeType);
          showToast(`Downloaded: ${conversationName} · ${metaBits}`);
        }

        if (opts.serverPush) {
          const ts = getPiQTimestamp();
          const safe = conversationName.replace(/[<>:"/\\|?*]/g, '_');
          BrowseApi.pushToServer(`piqpull-claude-${safe}-${ts}.jsonl`, convertToJSONL(conversationData, conversationId))
            .then(r => { if (!r.success) console.warn('PiQPull push failed:', r.error); });
        }
      }

      await BrowseState.saveTimestamp(conversationId);
      BrowseTable.render();
      BrowseTable.updateStats();

    } catch (err) {
      console.error('PiQPull exportSingle:', err);
      showToast(`Failed: ${err.message}`, true);
    }
  }

  // ── Bulk export — routes to incoming (project) or ZIP (no project) ──────────

  async function exportAll(orgId) {
    const opts = gatherExportOptions();

    const conversationsToExport = BrowseState.selected.size > 0
      ? BrowseState.filtered.filter(c => BrowseState.selected.has(c.uuid))
      : BrowseState.filtered;

    if (conversationsToExport.length === 1) {
      await exportSingle(orgId, conversationsToExport[0].uuid, conversationsToExport[0].name);
      return;
    }

    const exportAllBtn   = document.getElementById('exportAllBtn');
    const origBtnText    = exportAllBtn.textContent;
    exportAllBtn.disabled   = true;
    exportAllBtn.textContent = 'Running…';

    const totalCount     = conversationsToExport.length;
    const usingIncoming  = !!BrowseState.piQuixProjectFolder;
    const session        = new PiQExportSession(totalCount, BrowseState.piQuixProjectFolder);
    let   isCancelled    = false;

    OrbController.show(totalCount, BrowseState.piQuixProjectFolder);
    OrbController.onCancel(() => { isCancelled = true; });

    // ── PATH A: incoming per-conversation ─────────────────────────────────────

    if (usingIncoming) {
      try {
        for (let idx = 0; idx < totalCount; idx++) {
          if (isCancelled) break;

          const conv   = conversationsToExport[idx];
          const result = new PiQExportResult(conv.uuid, conv.name);
          session.addResult(result);

          OrbController.setCurrentName(conv.name);
          OrbController.setCount(idx + 1, totalCount);
          OrbController.say('fetching', 'fetching', [conv.name, idx + 1, totalCount], []);

          // ── Phase: fetch ──────────────────────────────────────────────────

          result.beginPhase('fetch');
          let conversationData = null;
          let fetchAttempts    = 0;
          const MAX_FETCH_ATTEMPTS = 2;

          while (fetchAttempts < MAX_FETCH_ATTEMPTS && !conversationData) {
            fetchAttempts++;
            try {
              const fetchResp = await fetch(
                `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
                { credentials: 'include', headers: { Accept: 'application/json' } }
              );

              if (fetchResp.status === 429) {
                // Rate limited — wait and retry once
                OrbController.say('fetchFail', 'retrying', [conv.name, '429 rate limit'], []);
                result.retries++;
                await new Promise(r => setTimeout(r, 3000));
                continue;
              }

              if (!fetchResp.ok) {
                throw new Error(`HTTP ${fetchResp.status}`);
              }

              conversationData       = await fetchResp.json();
              conversationData.model = inferModel(conversationData);

            } catch (fetchErr) {
              if (fetchAttempts >= MAX_FETCH_ATTEMPTS) {
                result.endPhase('fetch', false, fetchErr.message);
                result.notes.push(`fetch failed after ${fetchAttempts} attempts: ${fetchErr.message}`);
                OrbController.say('fetchFail', 'fetchFail', [conv.name, fetchErr.message], []);
                result.seal(null);
                OrbController.logResult(result);
                // result already in session.results (added at loop start) — seal updates in place
                break;
              }
              OrbController.say('retrying', 'retrying', [conv.name, fetchAttempts + 1], []);
              result.retries++;
              await new Promise(r => setTimeout(r, 1500));
            }
          }

          if (!conversationData) {
            // fetch permanently failed — result already sealed above
            OrbController.setMeta(`❌ ${session.failedCount} failed so far`);
            await new Promise(r => setTimeout(r, 100));
            continue;
          }

          result.endPhase('fetch', true);
          populateResultMeta(result, conversationData);
          result.slug = generateChatSlug(conversationData.name);

          // Update orb with real metadata
          const model    = shortModelLabel(conversationData.model);
          const msgs     = result.meta.msgCount;
          const thinking = result.meta.thinkingCount;
          const arts     = result.meta.artifactCount;

          OrbController.setMeta(
            `${msgs} msgs · ${model}` +
            (thinking > 0 ? ` · 🧠 ${thinking}` : '') +
            (arts     > 0 ? ` · 🎨 ${arts}`     : '') +
            ` | ✅${session.successCount} ❌${session.failedCount}`
          );

          if (thinking > 30) OrbController.say('hasThink', 'hasThink', [thinking], [thinking]);
          else if (arts > 5)  OrbController.say('hasArts',  'hasArts',  [arts],     []);
          else                OrbController.say('pushing',  'pushing',  [conv.name, msgs, model], []);

          // ── Phase: push ────────────────────────────────────────────────────

          result.beginPhase('push');
          const conversationUrl = `https://claude.ai/chat/${conv.uuid}`;

          try {
            const serverResult = await pushToIncoming(conversationData, conv.uuid, conversationUrl);

            if (serverResult.success) {
              const outFile = serverResult.data && serverResult.data.jsonFilename
                ? serverResult.data.jsonFilename : conv.name;
              result.endPhase('push', true);
              result.meta.outputFilename = outFile;
              result.seal(serverResult.data && serverResult.data.jsonPath ? serverResult.data.jsonPath : null);
              OrbController.say('pushOk', 'pushOk', [], []);
            } else {
              result.endPhase('push', false, serverResult.error || 'Unknown server error');
              result.notes.push(`push error: ${serverResult.error}`);
              result.seal(null);
              OrbController.say('pushFail', 'pushFail', [conv.name], []);
            }

          } catch (pushErr) {
            result.endPhase('push', false, pushErr.message);
            result.notes.push(`push threw: ${pushErr.message}`);
            result.seal(null);
            OrbController.say('pushFail', 'pushFail', [conv.name], []);
          }

          OrbController.logResult(result);

          // Milestone commentary
          const processed = session.processedCount;
          if (processed === Math.floor(totalCount * 0.5)) {
            OrbController.say('halfway', 'halfway', [processed, totalCount], []);
          } else if (processed === totalCount - 3) {
            OrbController.say('nearEnd', 'nearEnd', [3], []);
          }

          // Brief yield — keeps UI responsive
          await new Promise(r => setTimeout(r, 60));
        }

        session.seal(isCancelled);
        console.log(session.toConsoleSummary());

        if (isCancelled) {
          OrbController.say('cancelled', 'cancelled', [], []);
          showToast(`Cancelled after ${session.processedCount} of ${totalCount}.`, true);
        } else {
          OrbController.say('done', 'done', [session.successCount, totalCount], [session.successCount, totalCount]);
          const msg = session.failedCount > 0
            ? `✅ ${session.successCount}  ⚡ ${session.partialCount}  ❌ ${session.failedCount} of ${totalCount} → ${BrowseState.piQuixProjectFolder}`
            : `All ${session.successCount} conversations → ${BrowseState.piQuixProjectFolder} 🎉`;
          showToast(msg, session.failedCount > 0);

          // Mark successful as exported
          const doneIds = session.results.filter(r => r.status === 'success').map(r => r.uuid);
          await BrowseState.saveTimestamps(doneIds);
          BrowseTable.render();
          BrowseTable.updateStats();
        }

      } catch (sessionErr) {
        console.error('PiQPull bulk incoming error:', sessionErr);
        showToast(`Session error: ${sessionErr.message}`, true);
      } finally {
        setTimeout(() => OrbController.hide(), 2500);
        exportAllBtn.disabled    = false;
        exportAllBtn.textContent = origBtnText;
      }
      return;
    }

    // ── PATH B: ZIP download (no project) ──────────────────────────────────────

    const zipArchive    = new JSZip();
    const allJsonlLines = [];

    try {
      OrbController.say('init', 'init', [totalCount, null], []);
      const batchSize = 3;

      for (let batchStart = 0; batchStart < totalCount; batchStart += batchSize) {
        if (isCancelled) break;

        const batch = conversationsToExport.slice(batchStart, Math.min(batchStart + batchSize, totalCount));

        await Promise.all(batch.map(async (conv) => {
          const result = new PiQExportResult(conv.uuid, conv.name);
          session.addResult(result);
          result.beginPhase('fetch');

          try {
            const fetchResp = await fetch(
              `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
              { credentials: 'include', headers: { Accept: 'application/json' } }
            );
            if (!fetchResp.ok) throw new Error(`HTTP ${fetchResp.status}`);

            const conversationData = await fetchResp.json();
            conversationData.model = inferModel(conversationData);

            result.endPhase('fetch', true);
            populateResultMeta(result, conversationData);

            OrbController.setCurrentName(conv.name);
            OrbController.say('pushing', 'pushing',
              [conv.name, result.meta.msgCount, shortModelLabel(conversationData.model)], []);

            result.beginPhase('zip');
            const safeName     = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');
            addConversationToZip(conversationData, opts, conv.uuid, zipArchive, safeName);
            result.endPhase('zip', true);

            if (opts.serverPush) allJsonlLines.push(convertToJSONL(conversationData, conv.uuid));
            result.seal('(zip)');

          } catch (convErr) {
            result.endPhase('fetch', false, convErr.message);
            result.seal(null);
            console.warn(`PiQPull ZIP: failed ${conv.name}:`, convErr);
          }

          OrbController.logResult(result);
          OrbController.setCount(session.processedCount, totalCount);
          OrbController.setMeta(`✅${session.successCount} ❌${session.failedCount} of ${totalCount}`);
        }));

        if (batchStart + batchSize < totalCount && !isCancelled) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (isCancelled) {
        showToast(`Cancelled — ${session.processedCount} packed into ZIP so far.`, true);
      } else {
        OrbController.say('zipping', 'zipping', [], []);

        const timestamp = getPiQTimestamp();
        const prefix    = opts.flattenArtifacts && !opts.extractArtifacts && opts.includeChats === false
          ? 'piqpull-claude-artifacts' : 'piqpull-claude-exports';

        const blob = await zipArchive.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `${prefix}-${timestamp}.zip`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (opts.serverPush && allJsonlLines.length > 0) {
          BrowseApi.pushToServer(`piqpull-claude-bulk-${timestamp}.jsonl`, allJsonlLines.join('\n'))
            .then(r => { if (!r.success) console.warn('PiQPull bulk push failed:', r.error); });
        }

        session.seal(false);
        OrbController.say('zipDone', 'zipDone', [], []);
        console.log(session.toConsoleSummary());

        const doneIds = session.results.filter(r => r.status === 'success').map(r => r.uuid);
        await BrowseState.saveTimestamps(doneIds);
        BrowseTable.render();
        BrowseTable.updateStats();

        showToast(session.failedCount > 0
          ? `ZIP: ${session.successCount} of ${totalCount} (${session.failedCount} failed)`
          : `All ${session.successCount} packed into ZIP 🎉`);
      }

    } catch (bulkErr) {
      console.error('PiQPull ZIP exportAll error:', bulkErr);
      showToast(`Export error: ${bulkErr.message}`, true);
    } finally {
      setTimeout(() => OrbController.hide(), 2500);
      exportAllBtn.disabled    = false;
      exportAllBtn.textContent = origBtnText;
    }
  }

  return { exportSingle, exportAll, showToast };
})();

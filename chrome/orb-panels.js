// PiQPull — Orb Panels v1.0.0
// ErrorPanel: persistent error list with copy-all.
// CompletionModal: done/error/cancel result card rendered inside the sphere.
// Depends on: nothing at module definition time (ErrorPanel is self-contained).
//             CompletionModal.show() calls ErrorPanel.getAll() at runtime.
// v1.0.0: extracted from orb-characters.js v1.9.0.

'use strict';

// ── ErrorPanel ────────────────────────────────────────────────────────────────

const ErrorPanel = (() => {
  const MAX_ERRORS = 20;
  const errors = /** @type {string[]} */ ([]);

  function _getEl()   { return document.getElementById('piqErrorPanel'); }
  function _getList() { return document.getElementById('piqErrorList'); }

  function _escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function addError(text) {
    if (!text) return;
    const ts = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    errors.push(`[${ts}] ${text}`);
    if (errors.length > MAX_ERRORS) errors.shift();

    const panel = _getEl();
    const list  = _getList();
    if (!panel || !list) return;
    panel.classList.remove('hidden');

    const entry = document.createElement('span');
    entry.className = 'piq-error-entry';
    entry.innerHTML = `<span class="piq-error-time">${ts}</span>${_escHtml(text)}`;
    list.appendChild(entry);
    list.scrollTop = list.scrollHeight;
  }

  function clear() {
    errors.length = 0;
    const list  = _getList();
    const panel = _getEl();
    if (list)  list.innerHTML = '';
    if (panel) panel.classList.add('hidden');
  }

  function copyAll() {
    if (errors.length === 0) return;
    navigator.clipboard.writeText(errors.join('\n')).catch(() => {});
  }

  /** Returns a defensive copy of the current error list. */
  function getAll() { return [...errors]; }

  function wire() {
    const copyBtn = document.getElementById('piqErrorCopy');
    if (copyBtn) copyBtn.addEventListener('click', copyAll);
  }

  return { addError, clear, wire, getAll };
})();

// ── CompletionModal ───────────────────────────────────────────────────────────
// Renders into #piqResultCard which lives inside .piq-orb-sphere.
// Triggered by OrbController.showResult(type, stats).

const CompletionModal = (() => {

  function _card() { return document.getElementById('piqResultCard'); }

  function _fmtMs(ms) {
    if (!ms || ms <= 0) return '0s';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(_toast._tid);
    _toast._tid = setTimeout(() => { el.style.display = 'none'; }, 2500);
  }

  /**
   * Show the result card.
   * @param {'done'|'cancel'} type
   * @param {{ ok: number, total: number, durationMs: number, path?: string }} stats
   */
  function show(type, stats) {
    const card = _card();
    if (!card) return;

    const errs    = ErrorPanel.getAll();
    const hasErrs = errs.length > 0;
    const ok      = stats.ok    || 0;
    const total   = stats.total || 0;
    const dur     = _fmtMs(stats.durationMs);

    let html = '<button class="piq-result-close" onclick="CompletionModal.hide()" aria-label="Close">\u2715</button>';

    if (type === 'cancel') {
      html += `
        <div class="piq-result-icon piq-result-icon--cancel">\u2715</div>
        <div class="piq-result-title">CANCELLED</div>
        <div class="piq-result-body">
          <div class="piq-result-stat">${ok} of ${total} completed</div>
          ${hasErrs ? `<div class="piq-result-stat piq-result-stat--err">${errs.length} error${errs.length !== 1 ? 's' : ''}</div>` : ''}
        </div>
        ${hasErrs ? '<div class="piq-result-actions"><button class="piq-result-btn" onclick="CompletionModal.copyErrors()">Copy Errors</button></div>' : ''}
      `;
    } else if (hasErrs) {
      // Auto-copy errors to clipboard on completion with errors
      navigator.clipboard.writeText(errs.join('\n'))
        .then(() => _toast('Errors copied to clipboard'))
        .catch(() => {});

      const errRows = errs.map(e => `<div class="piq-result-err-row">${_esc(e)}</div>`).join('');
      html += `
        <div class="piq-result-icon piq-result-icon--warn">\u26a0</div>
        <div class="piq-result-title">DONE WITH ERRORS</div>
        <div class="piq-result-body">
          <div class="piq-result-stat">${ok} of ${total} complete \u00b7 ${dur}</div>
          <div class="piq-result-stat piq-result-stat--err">${errs.length} error${errs.length !== 1 ? 's' : ''} \u2014 copied to clipboard</div>
        </div>
        <div class="piq-result-err-list">${errRows}</div>
        <div class="piq-result-actions">
          <button class="piq-result-btn" onclick="CompletionModal.copyErrors()">Copy Errors</button>
        </div>
      `;
    } else {
      html += `
        <div class="piq-result-icon piq-result-icon--ok">\ud83c\udf89</div>
        <div class="piq-result-title">ALL DONE</div>
        <div class="piq-result-body">
          <div class="piq-result-stat">${ok} of ${total} complete</div>
          <div class="piq-result-stat">${dur}</div>
          ${stats.path ? `<div class="piq-result-path">${_esc(stats.path)}</div>` : ''}
        </div>
      `;
    }

    card.innerHTML = html;
    card.classList.remove('hidden');
  }

  function hide() {
    const card = _card();
    if (card) card.classList.add('hidden');
  }

  function copyErrors() {
    const errs = ErrorPanel.getAll();
    if (errs.length === 0) return;
    navigator.clipboard.writeText(errs.join('\n'))
      .then(() => _toast('Errors copied'))
      .catch(() => {});
  }

  return { show, hide, copyErrors };
})();

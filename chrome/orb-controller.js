// PiQPull — Orb Controller v1.0.0
// OrbController: show/hide/say/announce/setCount/logResult.
// DevMode: calibration overlay + mock export sequence.
// refreshCalibration(): live-updates the dev SVG overlay from OrbTuning state.
// OrbCharacterConfig: character selector + tuning control panel (⚙ button).
// Depends on (load in this order): orb-phrases.js → orb-colors.js → orb-registry.js → orb-panels.js → THIS FILE.
// v1.0.0: extracted from orb-characters.js v1.9.0.
//         makeLineEl: color + font-size only set inline; all other styles via .piq-spray-line CSS class.

'use strict';

// ============================================================================
// OrbController
// ============================================================================

const OrbController = (() => {

  let cancelCb = null;
  const logBuf = /** @type {object[]} */ ([]);
  const LOG_MAX = 9;

  const elById  = (id) => document.getElementById(id);
  const setText = (id, t) => { const e = elById(id); if (e) e.textContent = t || ''; };

  // ── Slot mouth origins (pixels relative to modal/overlay) ─────────────────

  function getSlotOrigins() {
    const modal  = elById('piqOrbModal');
    const sphere = document.querySelector('.piq-orb-sphere');
    if (!modal || !sphere) return null;
    const mR = modal.getBoundingClientRect();
    const sR = sphere.getBoundingClientRect();
    const ox = sR.left - mR.left;
    const oy = sR.top  - mR.top;

    const result = {};
    for (const [slot, cfg] of Object.entries(SLOT_CONFIG)) {
      result[slot] = {
        x: ox + sR.width  * cfg.originPct.x,
        y: oy + sR.height * cfg.originPct.y,
      };
    }
    return result;
  }

  // ── Line animation ─────────────────────────────────────────────────────────

  function animateLine(el, ox, oy, vx, vy, duration, fontStart, fontEnd) {
    const start    = performance.now();
    const totalSec = duration / 1000;
    const growFont = (fontEnd !== undefined && fontEnd !== fontStart);

    function frame(now) {
      const elapsed  = (now - start) / 1000;
      const progress = elapsed / totalSec;
      if (progress >= 1 || !el.parentNode) { el.remove(); return; }

      const opacity = progress < 0.35 ? 1 : Math.max(0, 1 - (progress - 0.35) / 0.65);
      el.style.transform = `translate(${(ox + vx * elapsed).toFixed(1)}px, ${(oy + vy * elapsed).toFixed(1)}px)`;
      el.style.opacity   = opacity.toFixed(3);

      if (growFont) {
        el.style.fontSize = `${(fontStart + (fontEnd - fontStart) * progress).toFixed(1)}px`;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ── Line element factory ───────────────────────────────────────────────────
  // color and font-size are set via style; all structural/typographic props via .piq-spray-line CSS class.

  function makeLineEl(text, color, fontSize) {
    const el = document.createElement('div');
    el.className      = 'piq-spray-line';
    el.textContent    = text;
    el.style.color    = color || '#ffffff';
    el.style.fontSize = `${(fontSize || 12).toFixed(1)}px`;
    return el;
  }

  // ── Core spray ────────────────────────────────────────────────────────────

  /**
   * @param {'left'|'right'|'center'} slot
   * @param {string} text
   * @param {string} [colorOverride]
   */
  function sprayFromSlot(slot, text, colorOverride) {
    if (!text || !text.trim()) return;
    const sprayLayer = elById('piqSprayLayer');
    const origins    = getSlotOrigins();
    if (!sprayLayer || !origins || !origins[slot]) return;

    const slotCfg = SLOT_CONFIG[slot];
    const origin  = origins[slot];
    const speed   = OrbConfig.getSpeed();
    const lines   = splitIntoLines(text, OrbTuning.get().lineSoftMax);
    if (lines.length === 0) return;

    let color = colorOverride || null;
    if (!color && slot !== 'center') {
      const charSlot = slot === 'left' ? 'left' : 'right';
      const char = OrbConfig.getCharacter(charSlot);
      color = _pickColor(charSlot, char && char.colors, OrbConfig.getColorMode());
    }
    if (!color) color = '#40ff90';

    const quoteBaseAngle = slotCfg.angleCenter
      - slotCfg.spread * 0.5
      + Math.random() * slotCfg.spread;

    lines.forEach((line, i) => {
      setTimeout(() => {
        if (!sprayLayer.isConnected) return;

        const lineAngleDeg = quoteBaseAngle + (Math.random() - 0.5) * 20;
        const rad = (lineAngleDeg * Math.PI) / 180;
        const t   = OrbTuning.get();
        const px_s = (t.speedBase + Math.random() * t.speedVariance) * speed;
        const dur  = (t.wordDuration + Math.random() * t.wordDurVariance) / speed;

        const el = makeLineEl(line, color, slotCfg.fontStart);
        el.style.transform = `translate(${origin.x.toFixed(1)}px, ${origin.y.toFixed(1)}px)`;
        sprayLayer.appendChild(el);

        animateLine(
          el, origin.x, origin.y,
          Math.cos(rad) * px_s, Math.sin(rad) * px_s,
          dur,
          slotCfg.fontStart,
          slotCfg.perspective ? slotCfg.fontEnd : slotCfg.fontStart
        );

      }, i * Math.max(250, Math.round(OrbTuning.get().staggerFloor / speed)));
    });
  }

  // ── SVG face sync ──────────────────────────────────────────────────────────

  function applySvgFaces() {
    const lc   = OrbConfig.getCharacter('left');
    const rc   = OrbConfig.getCharacter('right');
    const lImg = document.getElementById('orbFaceLeft');
    const rImg = document.getElementById('orbFaceRight');
    if (lImg) lImg.setAttribute('href', lc ? lc.image : '');
    if (rImg) rImg.setAttribute('href', rc ? rc.image : '');
  }

  // ── Tangent injection ──────────────────────────────────────────────────────

  function maybeTangent() {
    if (Math.random() > OrbTuning.get().tangentProb) return;
    const char = OrbConfig.getCharacter('right');
    if (!char || !char.tangents || char.tangents.length === 0) return;
    const text = char.tangents[Math.floor(Math.random() * char.tangents.length)];
    if (text) setTimeout(() => sprayFromSlot('right', text), 500);
  }

  // ── Public interface ────────────────────────────────────────────────────────

  function show(total, project) {
    logBuf.length = 0;
    ErrorPanel.clear();
    const modal = elById('piqOrbModal');
    if (modal) modal.classList.remove('hidden');
    setText('piqOrbCount', `0 / ${total}`);
    setText('piqOrbPct', '0%');
    setText('piqOrbName', 'Initializing\u2026');
    setText('piqOrbMeta', '');
    const fill = elById('piqOrbFill');
    if (fill) fill.style.width = '0%';
    const spray = elById('piqSprayLayer');
    if (spray) spray.innerHTML = '';
    applySvgFaces();
  }

  function hide() {
    const modal = elById('piqOrbModal');
    if (modal) modal.classList.add('hidden');
    CompletionModal.hide();
    const spray = elById('piqSprayLayer');
    if (spray) spray.innerHTML = '';
  }

  function onCancel(cb) {
    cancelCb = cb;
    const btn = elById('piqOrbCancel');
    if (btn) btn.onclick = () => { if (cancelCb) cancelCb(); };
  }

  function say(key, leftArgs, rightArgs) {
    const lc = OrbConfig.getCharacter('left');
    const rc = OrbConfig.getCharacter('right');

    if (lc && lc.phrases) {
      const k   = key === 'done' ? 'done_all' : key;
      const val = lc.phrases[k];
      if (val) sprayFromSlot('left', resolveJsonPhrase(val, k, leftArgs || []));
    }

    setTimeout(() => {
      maybeTangent();
      if (rc && rc.phrases) {
        const k   = key === 'done' ? 'done_all' : key;
        const val = rc.phrases[k];
        if (val) sprayFromSlot('right', resolveJsonPhrase(val, k, rightArgs || []));
      }
    }, 320);
  }

  function announce(text, type) {
    const color = ANNOUNCE_COLORS[type || 'status'] || ANNOUNCE_COLORS.status;
    sprayFromSlot('center', text, color);
    if (type === 'error') ErrorPanel.addError(text);
  }

  function addError(text) { ErrorPanel.addError(text); }

  function setCount(current, total) {
    const pct = total > 0 ? Math.round(current / total * 100) : 0;
    setText('piqOrbCount', `${current} / ${total}`);
    setText('piqOrbPct',   `${pct}%`);
    const fill = elById('piqOrbFill');
    if (fill) fill.style.width = `${pct}%`;
  }

  function setCurrentName(name) { setText('piqOrbName', (name || '').substring(0, 52)); }
  function setMeta(text)        { setText('piqOrbMeta', text || ''); }

  function setDone() {
    cancelCb = null;
    const btn = elById('piqOrbCancel');
    if (btn) { btn.textContent = 'Done'; btn.classList.add('done-state'); btn.onclick = () => hide(); }
  }

  function logResult(result) {
    logBuf.push(result);
    if (logBuf.length > LOG_MAX) logBuf.shift();
    const logEl = elById('piqOrbLog');
    if (!logEl) return;
    logEl.innerHTML = logBuf.map(r => {
      const cls  = `piq-log-line piq-log-${r.status === 'success' ? 'ok' : r.status === 'partial' ? 'partial' : r.status === 'skipped' ? 'skip' : 'failed'}`;
      const icon = r.status === 'success' ? '\u2705' : r.status === 'partial' ? '\u26a1' : r.status === 'skipped' ? '\u2b1c' : '\u274c';
      const ph   = Object.entries(r.phases || {}).map(([k, v]) => `${k[0].toUpperCase()}:${v.ok ? '\u2713' : '\u2717'}`).join(' ');
      const ms   = r.durationMs ? `${r.durationMs}ms` : '';
      const nm   = (r.name || '').substring(0, 28).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="${cls}">${icon} ${nm} ${ph} ${ms}</div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function showResult(type, stats) { CompletionModal.show(type, stats); }

  return {
    show, hide, onCancel, setDone, say, announce, addError,
    setCount, setCurrentName, setMeta, logResult, applySvgFaces, showResult,
  };
})();

// ============================================================================
// DevMode — calibration overlay + mock export sequence
// ============================================================================

const DevMode = (() => {
  let active = false;
  let timers = /** @type {ReturnType<typeof setTimeout>[]} */ ([]);

  function clearTimers() { for (const t of timers) clearTimeout(t); timers = []; }
  function delay(ms)     { return new Promise(r => { timers.push(setTimeout(r, ms)); }); }

  function showCalib(on) {
    const el = document.getElementById('piqDevCalib');
    if (el) el.classList.toggle('hidden', !on);
    if (on) refreshCalibration();
  }

  async function runMockSequence() {
    OrbController.show(10, 'TestProject');
    showCalib(true);

    const steps = [
      () => OrbController.say('init', [10, 'TestProject'], [10, 'TestProject']),
      async () => {
        OrbController.setCount(1, 10);
        OrbController.setCurrentName('Optimizing Taco Bell order for best value');
        OrbController.say('fetching', ['Taco Bell order', 1, 10], ['Taco Bell order', 1, 10]);
      },
      () => { OrbController.say('callout', ['Optimizing Taco Bell order for best value'], ['Optimizing Taco Bell order for best value']); },
      () => { OrbController.say('hasThink', [47], [47]); },
      () => { OrbController.say('hasArts', [3], [3]); },
      () => { OrbController.setCount(2, 10); OrbController.say('pushOk', [], []); OrbController.announce('Saved: chat_2026.05.10-143022.json', 'status'); },
      () => {
        OrbController.setCount(3, 10);
        OrbController.say('fetchFail', ['Private conversation', '403 Forbidden'], ['Private conversation', '403 Forbidden']);
        OrbController.announce('HTTP 403 \u2014 "Private conversation" skipped', 'error');
      },
      () => { OrbController.setCount(5, 10); OrbController.say('halfway', [5, 10], [5, 10]); OrbController.announce('5 of 10 complete', 'status'); },
      () => { OrbController.setCount(4, 10); OrbController.announce('Rate limited \u2014 waiting 3s', 'warn'); OrbController.say('retrying', ['Some Chat', 2], ['Some Chat', 2]); },
      () => { OrbController.setCount(9, 10); OrbController.say('nearEnd', [1], [1]); },
      () => {
        OrbController.setCount(10, 10);
        OrbController.say('done_all', [9, 10], [9, 10]);
        OrbController.announce('9 of 10 complete. 1 error.', 'status');
        OrbController.announce('1 conversation failed \u2014 see error panel', 'error');
        OrbController.setDone();
        OrbController.showResult('done', { ok: 9, total: 10, durationMs: 24000 });
      },
    ];

    for (const step of steps) {
      if (!active) break;
      await step();
      await delay(2200);
    }

    if (active) { await delay(3000); if (active) runMockSequence(); }
  }

  function toggle() {
    const btn = document.getElementById('devBtn');
    if (active) {
      active = false; clearTimers(); showCalib(false); OrbController.hide();
      if (btn) btn.classList.remove('active');
    } else {
      active = true;
      if (btn) btn.classList.add('active');
      runMockSequence();
    }
  }

  function isActive() { return active; }
  return { toggle, isActive };
})();

// ============================================================================
// refreshCalibration — updates dev SVG overlay live from OrbTuning state
// Function declaration (hoisted) so OrbTuning.apply() can call it safely.
// ============================================================================

function refreshCalibration() {
  const calib = document.getElementById('piqDevCalib');
  if (!calib || calib.classList.contains('hidden')) return;

  const t        = OrbTuning.get();
  const S        = 500;
  const AXIS_LEN   = 70;
  const SPREAD_LEN = 52;
  const CROSS      = 11;
  const LABEL_GAP  = 6;

  function ray(ox, oy, deg, len) {
    const rad = (deg * Math.PI) / 180;
    return { x: ox + Math.cos(rad) * len, y: oy + Math.sin(rad) * len };
  }
  function line(id, x1, y1, x2, y2) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('x1', x1.toFixed(1)); el.setAttribute('y1', y1.toFixed(1));
    el.setAttribute('x2', x2.toFixed(1)); el.setAttribute('y2', y2.toFixed(1));
  }
  function circle(id, cx, cy) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('cx', cx.toFixed(1)); el.setAttribute('cy', cy.toFixed(1));
  }
  function label(id, ox, oy, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const below = oy < S / 2;
    el.setAttribute('x', (ox + LABEL_GAP).toFixed(1));
    el.setAttribute('y', (oy + (below ? LABEL_GAP + 9 : -LABEL_GAP)).toFixed(1));
    el.textContent = text;
  }

  // Butt-Head
  const bhX = t.leftOriginX * S, bhY = t.leftOriginY * S;
  circle('calibBHOrigin', bhX, bhY);
  line('calibBHCrossH',   bhX - CROSS, bhY,         bhX + CROSS, bhY);
  line('calibBHCrossV',   bhX,         bhY - CROSS,  bhX,         bhY + CROSS);
  line('calibBHAxis',     bhX, bhY, ...Object.values(ray(bhX, bhY, t.leftAngle, AXIS_LEN)));
  line('calibBHSpreadL',  bhX, bhY, ...Object.values(ray(bhX, bhY, t.leftAngle - t.leftSpread / 2, SPREAD_LEN)));
  line('calibBHSpreadR',  bhX, bhY, ...Object.values(ray(bhX, bhY, t.leftAngle + t.leftSpread / 2, SPREAD_LEN)));
  label('calibBHLabel',   bhX, bhY, `BH ${Math.round(t.leftOriginX * 100)}%,${Math.round(t.leftOriginY * 100)}% ${t.leftAngle}deg +/-${Math.round(t.leftSpread / 2)}`);

  // Beavis
  const bvX = t.rightOriginX * S, bvY = t.rightOriginY * S;
  circle('calibBVOrigin', bvX, bvY);
  line('calibBVCrossH',   bvX - CROSS, bvY,         bvX + CROSS, bvY);
  line('calibBVCrossV',   bvX,         bvY - CROSS,  bvX,         bvY + CROSS);
  line('calibBVAxis',     bvX, bvY, ...Object.values(ray(bvX, bvY, t.rightAngle, AXIS_LEN)));
  line('calibBVSpreadL',  bvX, bvY, ...Object.values(ray(bvX, bvY, t.rightAngle - t.rightSpread / 2, SPREAD_LEN)));
  line('calibBVSpreadR',  bvX, bvY, ...Object.values(ray(bvX, bvY, t.rightAngle + t.rightSpread / 2, SPREAD_LEN)));
  label('calibBVLabel',   bvX, bvY, `BV ${Math.round(t.rightOriginX * 100)}%,${Math.round(t.rightOriginY * 100)}% ${t.rightAngle}deg +/-${Math.round(t.rightSpread / 2)}`);

  // System
  const sX = t.centerOriginX * S, sY = t.centerOriginY * S;
  circle('calibSYSOrigin', sX, sY);
  line('calibSYSCrossH',   sX - CROSS, sY,        sX + CROSS, sY);
  line('calibSYSCrossV',   sX,         sY - CROSS, sX,         sY + CROSS);
  line('calibSYSAxis',     sX, sY, ...Object.values(ray(sX, sY, t.centerAngle, AXIS_LEN)));
  line('calibSYSSpreadL',  sX, sY, ...Object.values(ray(sX, sY, t.centerAngle - t.centerSpread / 2, SPREAD_LEN)));
  line('calibSYSSpreadR',  sX, sY, ...Object.values(ray(sX, sY, t.centerAngle + t.centerSpread / 2, SPREAD_LEN)));
  label('calibSYSLabel',   sX, sY, `SYS ${Math.round(t.centerOriginX * 100)}%,${Math.round(t.centerOriginY * 100)}% ${t.centerAngle}deg +/-${Math.round(t.centerSpread / 2)}`);
}

// ============================================================================
// OrbCharacterConfig — ⚙ panel: character selector + spray tuning controls
// ============================================================================

const OrbCharacterConfig = (() => {

  // Data-driven tuning control definitions. Defined once; not recreated per panel open.
  const TUNING_CONTROLS = [
    {
      id: 'origins', label: 'Spray Origins',
      hint: 'Start point of word spray as % of sphere. Y=0 is top, Y=100 is bottom.',
      rows: [
        { key: 'leftOriginX',   label: 'Left X',  min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'leftOriginY',   label: 'Left Y',  min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'rightOriginX',  label: 'Right X', min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'rightOriginY',  label: 'Right Y', min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'centerOriginX', label: 'Ctr X',   min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'centerOriginY', label: 'Ctr Y',   min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
      ],
    },
    {
      id: 'angles', label: 'Angles & Spread',
      hint: 'Screen coords: 270=up, 90=down, 0/360=right, 180=left. Spread = total cone width in degrees.',
      rows: [
        { key: 'leftAngle',    label: 'Left axis',   min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'leftSpread',   label: 'Left spread',  min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'rightAngle',   label: 'Right axis',  min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'rightSpread',  label: 'Right spread', min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'centerAngle',  label: 'Ctr axis',    min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'centerSpread', label: 'Ctr spread',  min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
      ],
    },
    {
      id: 'fonts', label: 'Font Sizes',
      hint: 'Start = spawn size. End = size at end of travel. Difference creates the perspective growth effect.',
      rows: [
        { key: 'leftFontStart',   label: 'Left start',  min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'leftFontEnd',     label: 'Left end',    min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'rightFontStart',  label: 'Right start', min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'rightFontEnd',    label: 'Right end',   min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'centerFontStart', label: 'Ctr start',   min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'centerFontEnd',   label: 'Ctr end',     min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
      ],
    },
    {
      id: 'physics', label: 'Word Physics',
      hint: 'All speed/duration values are scaled by the Speed multiplier above.',
      rows: [
        { key: 'speedBase',       label: 'Speed base',   min: 10,  max: 300,  step: 5,   scale: 1, unit: 'px/s' },
        { key: 'speedVariance',   label: 'Speed burst',  min: 0,   max: 200,  step: 5,   scale: 1, unit: 'px/s' },
        { key: 'wordDuration',    label: 'Duration',     min: 500, max: 8000, step: 100, scale: 1, unit: 'ms' },
        { key: 'wordDurVariance', label: 'Dur. variance',min: 0,   max: 5000, step: 100, scale: 1, unit: 'ms' },
        { key: 'staggerFloor',    label: 'Line stagger', min: 50,  max: 1500, step: 10,  scale: 1, unit: 'ms' },
      ],
    },
    {
      id: 'behavior', label: 'Text & Behavior',
      hint: 'Line wrap: soft char limit. Tangent: probability of a random off-topic Beavis line per say() call.',
      rows: [
        { key: 'lineSoftMax', label: 'Line wrap',  min: 10, max: 80,  step: 1, scale: 1,   unit: 'ch' },
        { key: 'tangentProb', label: 'Tangent %',  min: 0,  max: 100, step: 1, scale: 100, unit: '%' },
      ],
    },
  ];

  function buildUI() {
    const existing = document.getElementById('orbCharConfig');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'orbCharConfig';
    panel.className = 'orb-char-config';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Orb character configuration');

    const chars   = OrbConfig.getAllCharacters();
    const current = OrbConfig.getCurrent();
    const mode    = OrbConfig.getColorMode();
    const speed   = OrbConfig.getSpeed();

    const div  = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
    const span = (cls, t) => { const s = document.createElement('span'); s.className = cls; s.textContent = t; return s; };

    // Title row
    const titleRow = div('orb-char-title-row');
    const titleEl  = div('orb-char-config-title'); titleEl.textContent = 'Orb Characters';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'orb-char-close'; closeBtn.textContent = '\u2715';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.onclick = () => panel.remove();
    titleRow.append(titleEl, closeBtn);

    // Character slot selectors
    const slotsRow = div('orb-char-slots');
    const buildSlot = (slot, slotLabel) => {
      const wrapper  = div('orb-char-slot');
      const heading  = div('orb-char-slot-label'); heading.textContent = slotLabel;
      const preview  = document.createElement('img');
      preview.className = 'orb-char-preview'; preview.alt = 'Preview';
      const ic = CHARACTER_REGISTRY[current[slot]];
      if (ic && ic.image) preview.src = ic.image;
      const select = document.createElement('select'); select.className = 'orb-char-select';
      for (const ch of chars) {
        const opt = document.createElement('option');
        opt.value = ch.id; opt.textContent = ch.label || ch.name;
        if (ch.id === current[slot]) opt.selected = true;
        select.appendChild(opt);
      }
      const creditEl = div('orb-char-credit'); creditEl.textContent = ic ? (ic.credit || '') : '';
      select.addEventListener('change', async () => {
        const ch = CHARACTER_REGISTRY[select.value];
        if (ch) { preview.src = ch.image || ''; creditEl.textContent = ch.credit || ''; }
        await OrbConfig.setSlot(slot, select.value).catch(console.warn);
        OrbController.applySvgFaces();
      });
      wrapper.append(heading, preview, select, creditEl);
      return wrapper;
    };
    slotsRow.append(
      buildSlot('left',  '\u25c4 Left slot (Butt-Head \u2192 right spray)'),
      buildSlot('right', 'Right slot (Beavis \u2192 left spray) \u25ba')
    );

    // Color mode
    const colorRow   = div('orb-char-color-row');
    const colorLabel = div('orb-char-slot-label'); colorLabel.textContent = 'Spray color mode';
    const toggle     = div('orb-color-toggle');
    for (const m of [
      { v: 'psychedelic', t: '\ud83c\udf08 Psychedelic (HSL rotation)' },
      { v: 'theme',       t: '\ud83c\udfa8 Character theme colors' },
    ]) {
      const btn = document.createElement('button');
      btn.className = `orb-color-btn${mode === m.v ? ' active' : ''}`;
      btn.textContent = m.t;
      btn.addEventListener('click', async () => {
        toggle.querySelectorAll('.orb-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        await OrbConfig.setColorMode(m.v).catch(console.warn);
      });
      toggle.appendChild(btn);
    }
    const colorHint = div('orb-char-credit'); colorHint.textContent = 'Psychedelic: vivid rotating HSL. Theme: character palette.';
    colorRow.append(colorLabel, toggle, colorHint);

    // Speed slider
    const speedRow  = div('orb-char-color-row');
    const speedLabel = div('orb-char-slot-label'); speedLabel.textContent = 'Spray speed';
    const speedCtrl  = div('orb-speed-row');
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0.4'; slider.max = '2.5'; slider.step = '0.1';
    slider.value = String(speed); slider.className = 'orb-speed-slider';
    slider.setAttribute('aria-label', 'Spray speed');
    const speedVal = span('orb-speed-value', `${speed.toFixed(1)}\u00d7`);
    slider.addEventListener('input', async () => {
      speedVal.textContent = `${parseFloat(slider.value).toFixed(1)}\u00d7`;
      await OrbConfig.setSpeed(parseFloat(slider.value)).catch(console.warn);
    });
    speedCtrl.append(span('orb-speed-emoji', '\ud83d\udc22'), slider, span('orb-speed-emoji', '\ud83d\ude80'), speedVal);
    const speedHint = div('orb-char-credit'); speedHint.textContent = '0.4\u00d7 = slow/readable \u00b7 1.0\u00d7 = default \u00b7 2.5\u00d7 = rapid';
    speedRow.append(speedLabel, speedCtrl, speedHint);

    const hint = div('orb-char-hint'); hint.textContent = 'Add characters: drop folder in characters/ + add id to characters/index.json.';

    // Tuning section helpers
    function makeTuningRow(cfg, tuningVals) {
      const row  = div('orb-tuning-row');
      const lbl  = div('orb-tuning-label'); lbl.textContent = cfg.label;
      const displayVal = Math.round((tuningVals[cfg.key] || 0) * cfg.scale);

      const rangeEl = document.createElement('input');
      rangeEl.type = 'range'; rangeEl.className = 'orb-tuning-slider';
      rangeEl.min = String(cfg.min); rangeEl.max = String(cfg.max); rangeEl.step = String(cfg.step);
      rangeEl.value = String(displayVal);
      rangeEl.dataset.tuningKey   = cfg.key;
      rangeEl.dataset.tuningScale = String(cfg.scale);

      const numEl = document.createElement('input');
      numEl.type = 'number'; numEl.className = 'orb-tuning-value';
      numEl.min = String(cfg.min); numEl.max = String(cfg.max); numEl.step = String(cfg.step);
      numEl.value = String(displayVal);
      numEl.dataset.tuningNum = cfg.key;

      const unitEl = span('orb-tuning-unit', cfg.unit);

      rangeEl.addEventListener('input', () => {
        const v = parseFloat(rangeEl.value);
        numEl.value = String(v);
        OrbTuning.set(cfg.key, v / cfg.scale);
      });
      numEl.addEventListener('change', () => {
        const clamped = Math.max(cfg.min, Math.min(cfg.max, parseFloat(numEl.value) || 0));
        rangeEl.value = String(clamped); numEl.value = String(clamped);
        OrbTuning.set(cfg.key, clamped / cfg.scale);
      });

      row.append(lbl, rangeEl, numEl, unitEl);
      return row;
    }

    function refreshTuningInputs(container) {
      const vals = OrbTuning.get();
      container.querySelectorAll('[data-tuning-key]').forEach(rangeEl => {
        const key   = rangeEl.dataset.tuningKey;
        const scale = parseFloat(rangeEl.dataset.tuningScale) || 1;
        const dv    = Math.round((vals[key] || 0) * scale);
        rangeEl.value = String(dv);
        const numEl = container.querySelector(`[data-tuning-num="${key}"]`);
        if (numEl) numEl.value = String(dv);
      });
    }

    function buildTuningSection() {
      const tuningVals = OrbTuning.get();
      const wrapper    = div('orb-tuning-section');

      wrapper.appendChild(div('orb-tuning-divider'));
      const sectionLbl = div('orb-char-slot-label orb-tuning-section-title');
      sectionLbl.textContent = 'Spray Tuning';
      wrapper.appendChild(sectionLbl);

      for (const group of TUNING_CONTROLS) {
        const details  = document.createElement('details');
        details.className = 'orb-tuning-group'; details.open = false;
        const summary  = document.createElement('summary');
        summary.className = 'orb-tuning-group-title'; summary.textContent = group.label;
        details.appendChild(summary);
        const hintEl = div('orb-tuning-group-hint'); hintEl.textContent = group.hint;
        details.appendChild(hintEl);
        for (const rowCfg of group.rows) details.appendChild(makeTuningRow(rowCfg, tuningVals));
        wrapper.appendChild(details);
      }

      const footer = div('orb-tuning-footer');
      const resetBtn = document.createElement('button');
      resetBtn.className = 'orb-tuning-btn'; resetBtn.textContent = 'Reset All to Defaults';
      resetBtn.addEventListener('click', () => { OrbTuning.reset(); refreshTuningInputs(wrapper); });

      const testBtn = document.createElement('button');
      testBtn.className = 'orb-tuning-btn orb-tuning-btn--test'; testBtn.textContent = 'Test Spray';
      testBtn.title = 'Fire a test spray so you can see tuning changes immediately. Opens orb if not already showing.';
      testBtn.addEventListener('click', () => {
        const modal = document.getElementById('piqOrbModal');
        if (modal && modal.classList.contains('hidden')) OrbController.show(1, '');
        OrbController.say('pushing', ['Test Chat', 42, 'S4.6'], ['Test Chat']);
        setTimeout(() => OrbController.announce('Tuning test spray', 'status'), 200);
      });

      footer.append(resetBtn, testBtn);
      wrapper.appendChild(footer);
      return wrapper;
    }

    const tuningSection = buildTuningSection();
    const bodyWrap      = div('orb-char-config-body');
    bodyWrap.append(slotsRow, colorRow, speedRow, hint, tuningSection);
    panel.append(titleRow, bodyWrap);
    document.body.appendChild(panel);
    setTimeout(() => {
      document.addEventListener('click', function h() { panel.remove(); document.removeEventListener('click', h); });
    }, 0);
    panel.addEventListener('click', e => e.stopPropagation());
  }

  return { toggle: buildUI };
})();

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadCharacterRegistry();
  await OrbConfig.load();
  await OrbTuning.load();
  OrbController.applySvgFaces();
  ErrorPanel.wire();

  const gear = document.getElementById('piqOrbConfigBtn');
  if (gear) gear.addEventListener('click', e => { e.stopPropagation(); OrbCharacterConfig.toggle(); });

  const devBtn = document.getElementById('devBtn');
  if (devBtn) devBtn.addEventListener('click', () => DevMode.toggle());
});

// PiQPull — Orb Character System v1.3.0
// Spray directions match face orientation:
//   Butt-Head (left/top, faces right) → words fly RIGHT + UP-RIGHT, growing (perspective toward viewer)
//   Beavis (right/bottom, faces left) → words fly LEFT across his face
//   System announce → straight up from center
// Error panel: static red list top-left, copyable.
// Tangents: each character has random off-topic phrases mixed with status phrases.
// Dev mode: calibration grid overlaid on sphere for screenshot-based position tuning.

'use strict';

// ============================================================================
// CONSTANTS
// ============================================================================

const LINE_SOFT_MAX   = 44;
const LINE_HARD_MAX   = 52;

const ANNOUNCE_COLORS = {
  status: '#40ff90',
  error:  '#ff5040',
  warn:   '#ffc040',
};

const SPEED_KEY  = 'orbSpeed';
const COLOR_KEY  = 'orbColorMode';
const PAIR_KEY   = 'orbCharacterPair';
const SPEED_DEFAULT  = 1.0;
const COLOR_DEFAULT  = 'psychedelic';
const PAIR_DEFAULT   = { left: 'butthead', right: 'beavis' };

// Spray geometry: mouth positions as % of rendered sphere size
// Left slot (Butt-Head): mouth at SVG ~(125,230)/500 = 25%, 46%
//   → words fly RIGHT + slight up: angle center 335° (up-right), spread 50°
//   → perspective: font grows 9→20px (coming toward viewer)
// Right slot (Beavis): mouth at SVG ~(375,435)/500 = 75%, 87%
//   → words fly LEFT: angle center 172°, spread 55°
//   → normal font 11-14px
// Center (system): at 50%, 42% of sphere
//   → words fly UP: angle 270°, spread 70°

const SLOT_CONFIG = {
  left: {
    originPct:    { x: 0.25, y: 0.46 },   // Butt-Head mouth
    angleCenter:  335,                      // up + right (330-340° range)
    spread:       50,
    perspective:  true,                     // font grows as it travels
    fontStart:    9,
    fontEnd:      20,
  },
  right: {
    originPct:    { x: 0.75, y: 0.87 },   // Beavis mouth
    angleCenter:  172,                      // leftward, slight down
    spread:       55,
    perspective:  false,
    fontStart:    11,
    fontEnd:      14,
  },
  center: {
    originPct:    { x: 0.50, y: 0.42 },   // center of sphere
    angleCenter:  270,                      // straight up
    spread:       70,
    perspective:  false,
    fontStart:    10,
    fontEnd:      12,
  },
};

// ============================================================================
// LINE SPLITTING
// ============================================================================

/** @param {string} text @param {number} [softMax] @returns {string[]} */
function splitIntoLines(text, softMax) {
  const max   = (typeof softMax === 'number' && softMax > 0) ? softMax : LINE_SOFT_MAX;
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const safe = w.length > LINE_HARD_MAX ? `${w.slice(0, LINE_HARD_MAX)}…` : w;
    const tent = cur ? `${cur} ${safe}` : safe;
    if (tent.length <= max)         { cur = tent; }
    else if (cur)                   { lines.push(cur); cur = safe; }
    else                            { lines.push(safe); cur = ''; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ============================================================================
// PHRASE TEMPLATE RESOLVER
// ============================================================================

const ARG_MAPS = {
  init:         (a) => ({ n: a[0], proj: a[1] ? ` — routing to ${a[1]}` : '', t: a[0] }),
  fetching:     (a) => ({ name: cap(a[0]), n: a[1], t: a[2] }),
  hasThink:     (a) => ({ n: a[0] }),
  hasArts:      (a) => ({ n: a[0] }),
  pushing:      (a) => ({ name: cap(a[0]), msgs: a[1], model: a[2] }),
  pushOk:       ()  => ({}),
  fetchFail:    (a) => ({ name: cap(a[0]), err: a[1] || '' }),
  pushFail:     (a) => ({ name: cap(a[0]) }),
  retrying:     (a) => ({ name: cap(a[0]), n: a[1] }),
  halfway:      (a) => ({ n: a[0], t: a[1], pct: Math.round((a[0]/(a[1]||1))*100) }),
  nearEnd:      (a) => ({ left: a[0] }),
  done_all:     (a) => ({ ok: a[0], t: a[1] }),
  done_partial: (a) => ({ ok: a[0], t: a[1], missed: (a[1]||0)-(a[0]||0) }),
  tangent:      ()  => ({}),
  cancelled:    ()  => ({}),
  zipping:      ()  => ({}),
  zipDone:      ()  => ({}),
  log:          ()  => ({}),
};

const cap = (s) => (s || '').substring(0, 24);

function resolveJsonPhrase(phraseVal, key, args) {
  if (!phraseVal) return '';
  const raw = Array.isArray(phraseVal)
    ? phraseVal[Math.floor(Math.random() * phraseVal.length)] || ''
    : String(phraseVal);
  if (!raw) return '';
  const tokens = ARG_MAPS[key] ? ARG_MAPS[key](args || []) : {};
  return raw.replace(/\{(\w+)\}/g, (_, k) =>
    tokens[k] !== undefined && tokens[k] !== null ? String(tokens[k]) : `{${k}}`
  );
}

// ============================================================================
// COLOR SYSTEM
// ============================================================================

let _psychHue = Math.random() * 360;
const _lastColorIdx = { left: -1, right: -1 };

function _nextPsychColor() {
  _psychHue = (_psychHue + 52 + Math.random() * 23) % 360;
  return `hsl(${Math.round(_psychHue)}, 100%, ${Math.round(68 + Math.random() * 4)}%)`;
}

function _pickColor(slot, colors, mode) {
  if (mode === 'psychedelic' || !colors || colors.length === 0) return _nextPsychColor();
  if (colors.length === 1) return colors[0];
  let idx;
  do { idx = Math.floor(Math.random() * colors.length); }
  while (idx === _lastColorIdx[slot]);
  _lastColorIdx[slot] = idx;
  return colors[idx];
}

// ============================================================================
// CHARACTER REGISTRY
// ============================================================================

/** @type {Object.<string,object>} */
const CHARACTER_REGISTRY = {};

async function loadCharacterRegistry() {
  let ids = [];
  try {
    const res = await fetch(chrome.runtime.getURL('characters/index.json'));
    if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
    const parsed = await res.json();
    if (!Array.isArray(parsed)) throw new Error('index.json must be an array');
    ids = parsed.filter(id => typeof id === 'string' && id.trim().length > 0);
  } catch (e) {
    console.warn('PiQPull OrbCharacters: index.json load failed —', e.message);
    return;
  }

  const results = await Promise.allSettled(
    ids.map(id =>
      fetch(chrome.runtime.getURL(`characters/${id}/character.json`))
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(data => ({ id, data }))
    )
  );

  for (const result of results) {
    if (result.status === 'rejected') { console.warn('PiQPull: skip char —', result.reason); continue; }
    const { id, data } = result.value;
    if (!data || typeof data !== 'object') continue;
    CHARACTER_REGISTRY[id] = {
      id, name: data.name || id, label: data.label || data.name || id,
      image:   `characters/${id}/${id}.png`,
      colors:  Array.isArray(data.colors) && data.colors.length > 0 ? data.colors : ['#ffffff'],
      credit:  data.credit || '',
      phrases: data.phrases || {},
      tangents: Array.isArray(data.tangents) ? data.tangents : [],
    };
  }

  if (Object.keys(CHARACTER_REGISTRY).length === 0) {
    CHARACTER_REGISTRY['_fallback'] = {
      id: '_fallback', name: 'System', label: 'System', image: '',
      colors: ['#808080'], credit: '', phrases: {
        init: ['Exporting {n} conversations.'], pushOk: ['Saved.'],
        done_all: ['Complete.'], done_partial: ['{ok} of {t} done.'],
      }, tangents: [],
    };
  }
}

// ============================================================================
// ORB CONFIG
// ============================================================================

const OrbConfig = (() => {
  let current   = { ...PAIR_DEFAULT };
  let colorMode = COLOR_DEFAULT;
  let speedMult = SPEED_DEFAULT;

  async function load() {
    return new Promise(resolve => {
      chrome.storage.sync.get([PAIR_KEY, COLOR_KEY, SPEED_KEY], stored => {
        const saved = stored[PAIR_KEY];
        if (saved && saved.left && CHARACTER_REGISTRY[saved.left] &&
                     saved.right && CHARACTER_REGISTRY[saved.right]) {
          current = { left: saved.left, right: saved.right };
        } else {
          const keys = Object.keys(CHARACTER_REGISTRY);
          current = {
            left:  CHARACTER_REGISTRY[PAIR_DEFAULT.left]  ? PAIR_DEFAULT.left  : (keys[0] || '_fallback'),
            right: CHARACTER_REGISTRY[PAIR_DEFAULT.right] ? PAIR_DEFAULT.right : (keys[1] || keys[0] || '_fallback'),
          };
        }
        colorMode = stored[COLOR_KEY] === 'theme' ? 'theme' : 'psychedelic';
        const s   = parseFloat(stored[SPEED_KEY]);
        speedMult = (!isNaN(s) && s >= 0.4 && s <= 2.5) ? s : SPEED_DEFAULT;
        resolve();
      });
    });
  }

  async function setSlot(slot, id) {
    if (!CHARACTER_REGISTRY[id]) throw new Error(`Unknown id: ${id}`);
    current[slot] = id;
    return new Promise(r => chrome.storage.sync.set({ [PAIR_KEY]: { ...current } }, r));
  }

  async function setColorMode(mode) {
    colorMode = mode === 'theme' ? 'theme' : 'psychedelic';
    return new Promise(r => chrome.storage.sync.set({ [COLOR_KEY]: colorMode }, r));
  }

  async function setSpeed(val) {
    speedMult = Math.max(0.4, Math.min(2.5, parseFloat(val) || SPEED_DEFAULT));
    return new Promise(r => chrome.storage.sync.set({ [SPEED_KEY]: speedMult }, r));
  }

  function getCharacter(slot)   { return CHARACTER_REGISTRY[current[slot]] || Object.values(CHARACTER_REGISTRY)[0] || null; }
  function getCurrent()         { return { ...current }; }
  function getColorMode()       { return colorMode; }
  function getSpeed()           { return speedMult; }
  function getAllCharacters()    { return Object.values(CHARACTER_REGISTRY); }

  return { load, setSlot, setColorMode, setSpeed, getCharacter, getCurrent, getColorMode, getSpeed, getAllCharacters };
})();

// ============================================================================
// ERROR PANEL
// ============================================================================

const ErrorPanel = (() => {
  const MAX_ERRORS = 20;
  const errors = /** @type {string[]} */ ([]);

  function _getEl() { return document.getElementById('piqErrorPanel'); }
  function _getList() { return document.getElementById('piqErrorList'); }

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
    entry.innerHTML = `<span class="piq-error-time">${ts}</span>${escHtml(text)}`;
    list.appendChild(entry);
    list.scrollTop = list.scrollHeight;
  }

  function clear() {
    errors.length = 0;
    const list = _getList();
    if (list) list.innerHTML = '';
    const panel = _getEl();
    if (panel) panel.classList.add('hidden');
  }

  function copyAll() {
    if (errors.length === 0) return;
    navigator.clipboard.writeText(errors.join('\n')).catch(() => {});
  }

  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function wire() {
    const copyBtn  = document.getElementById('piqErrorCopy');
    const closeBtn = document.getElementById('piqErrorClose');
    if (copyBtn)  copyBtn.addEventListener('click', copyAll);
    if (closeBtn) closeBtn.addEventListener('click', clear);
  }

  return { addError, clear, wire };
})();

// ============================================================================
// ORB CONTROLLER
// ============================================================================

const OrbController = (() => {

  let cancelCb = null;
  const logBuf = /** @type {object[]} */ ([]);
  const LOG_MAX = 9;

  const elById  = (id) => document.getElementById(id);
  const setText  = (id, t) => { const e = elById(id); if (e) e.textContent = t || ''; };

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

  // ── Line animation (with optional perspective font growth) ─────────────────

  function animateLine(el, ox, oy, vx, vy, duration, fontStart, fontEnd) {
    const start    = performance.now();
    const totalSec = duration / 1000;
    const growFont = (fontEnd !== undefined && fontEnd !== fontStart);

    function frame(now) {
      const elapsed  = (now - start) / 1000;
      const progress = elapsed / totalSec;
      if (progress >= 1 || !el.parentNode) { el.remove(); return; }

      const opacity  = progress < 0.35 ? 1 : Math.max(0, 1 - (progress - 0.35) / 0.65);
      el.style.transform = `translate(${(ox + vx * elapsed).toFixed(1)}px, ${(oy + vy * elapsed).toFixed(1)}px)`;
      el.style.opacity   = opacity.toFixed(3);

      if (growFont) {
        const fs = fontStart + (fontEnd - fontStart) * progress;
        el.style.fontSize = `${fs.toFixed(1)}px`;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ── Line element factory ───────────────────────────────────────────────────

  function makeLineEl(text, color, fontSize) {
    const el = document.createElement('div');
    el.className   = 'piq-spray-line';
    el.textContent = text;
    el.style.cssText = [
      `color: ${color}`,
      `font-size: ${(fontSize || 12).toFixed(1)}px`,
      'white-space: nowrap',
      'position: absolute',
      'pointer-events: none',
      'will-change: transform, opacity',
      'font-family: "Comic Sans MS","Comic Sans","Segoe UI",system-ui,sans-serif',
      'font-style: italic',
      'font-weight: 700',
      'text-shadow: 0 0 7px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.85)',
      'user-select: none',
      'letter-spacing: 0.02em',
    ].join(';');
    return el;
  }

  // ── Core spray function ────────────────────────────────────────────────────

  /**
   * Spray a quote from a named origin slot.
   * @param {'left'|'right'|'center'} slot
   * @param {string} text
   * @param {string} [colorOverride] — for system announce colors
   */
  function sprayFromSlot(slot, text, colorOverride) {
    if (!text || !text.trim()) return;
    const sprayLayer = elById('piqSprayLayer');
    const origins    = getSlotOrigins();
    if (!sprayLayer || !origins || !origins[slot]) return;

    const slotCfg = SLOT_CONFIG[slot];
    const origin  = origins[slot];
    const speed   = OrbConfig.getSpeed();
    const lines   = splitIntoLines(text, LINE_SOFT_MAX);
    if (lines.length === 0) return;

    // Color: override for announces, character color for left/right
    let color = colorOverride || null;
    if (!color && slot !== 'center') {
      const charSlot = slot === 'left' ? 'left' : 'right';
      const char     = OrbConfig.getCharacter(charSlot);
      color = _pickColor(charSlot, char && char.colors, OrbConfig.getColorMode());
    }
    if (!color) color = '#40ff90';

    // Base angle for this quote (slight random within cluster)
    const quoteBaseAngle = slotCfg.angleCenter
      - slotCfg.spread * 0.3
      + Math.random() * slotCfg.spread * 0.6;

    lines.forEach((line, i) => {
      setTimeout(() => {
        if (!sprayLayer.isConnected) return;

        const lineAngleDeg = quoteBaseAngle + (Math.random() - 0.5) * 20;
        const rad = (lineAngleDeg * Math.PI) / 180;
        const px_s = (70 + Math.random() * 55) * speed;
        const dur  = (2800 + Math.random() * 1500) / speed;

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

      }, i * Math.round(200 / speed));
    });
  }

  // ── SVG face sync ──────────────────────────────────────────────────────────

  function applySvgFaces() {
    const lc = OrbConfig.getCharacter('left');
    const rc = OrbConfig.getCharacter('right');
    const lImg = document.getElementById('orbFaceLeft');
    const rImg = document.getElementById('orbFaceRight');
    if (lImg) lImg.setAttribute('href', lc ? lc.image : '');
    if (rImg) rImg.setAttribute('href', rc ? rc.image : '');
  }

  // ── Tangent injection (25% chance, right slot only) ────────────────────────

  function maybeTangent() {
    if (Math.random() > 0.25) return; // 75% skip
    const char = OrbConfig.getCharacter('right');
    if (!char || !char.tangents || char.tangents.length === 0) return;
    const text = char.tangents[Math.floor(Math.random() * char.tangents.length)];
    if (text) {
      setTimeout(() => sprayFromSlot('right', text), 500);
    }
  }

  // ── Public interface ────────────────────────────────────────────────────────

  function show(total, project) {
    logBuf.length = 0;
    ErrorPanel.clear();
    const modal = elById('piqOrbModal');
    if (modal) modal.classList.remove('hidden');
    setText('piqOrbCount', `0 / ${total}`);
    setText('piqOrbPct',   '0%');
    setText('piqOrbName',  'Initializing…');
    setText('piqOrbMeta',  '');
    const fill = elById('piqOrbFill');
    if (fill) fill.style.width = '0%';
    const spray = elById('piqSprayLayer');
    if (spray) spray.innerHTML = '';
    applySvgFaces();
  }

  function hide() {
    const modal = elById('piqOrbModal');
    if (modal) modal.classList.add('hidden');
    const spray = elById('piqSprayLayer');
    if (spray) spray.innerHTML = '';
  }

  function onCancel(cb) {
    cancelCb = cb;
    const btn = elById('piqOrbCancel');
    if (btn) btn.onclick = () => { if (cancelCb) cancelCb(); };
  }

  /**
   * Trigger both character slots to speak.
   * ~25% chance of a right-slot tangent mixed in.
   * @param {string} key
   * @param {unknown[]} leftArgs
   * @param {unknown[]} rightArgs
   */
  function say(key, leftArgs, rightArgs) {
    const lc = OrbConfig.getCharacter('left');
    const rc = OrbConfig.getCharacter('right');

    if (lc && lc.phrases) {
      const k   = key === 'done' ? 'done_all' : key;
      const val = lc.phrases[k];
      if (val) sprayFromSlot('left', resolveJsonPhrase(val, k, leftArgs || []));
    }

    setTimeout(() => {
      maybeTangent(); // maybe fire a tangent instead of or alongside status
      if (rc && rc.phrases) {
        const k   = key === 'done' ? 'done_all' : key;
        const val = rc.phrases[k];
        if (val) sprayFromSlot('right', resolveJsonPhrase(val, k, rightArgs || []));
      }
    }, 320);
  }

  /**
   * Spray a system message from center, upward.
   * @param {string} text
   * @param {'status'|'error'|'warn'} [type]
   */
  function announce(text, type) {
    const color = ANNOUNCE_COLORS[type || 'status'] || ANNOUNCE_COLORS.status;
    sprayFromSlot('center', text, color);
    if (type === 'error') ErrorPanel.addError(text);
  }

  /** @param {string} text — directly adds to error panel without spraying */
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

  function logResult(result) {
    logBuf.push(result);
    if (logBuf.length > LOG_MAX) logBuf.shift();
    const logEl = elById('piqOrbLog');
    if (!logEl) return;
    logEl.innerHTML = logBuf.map(r => {
      const cls  = `piq-log-line piq-log-${r.status === 'success' ? 'ok' : r.status === 'partial' ? 'partial' : r.status === 'skipped' ? 'skip' : 'failed'}`;
      const icon = r.status === 'success' ? '✅' : r.status === 'partial' ? '⚡' : r.status === 'skipped' ? '⬜' : '❌';
      const ph   = Object.entries(r.phases || {}).map(([k, v]) => `${k[0].toUpperCase()}:${v.ok ? '✓' : '✗'}`).join(' ');
      const ms   = r.durationMs ? `${r.durationMs}ms` : '';
      const nm   = (r.name || '').substring(0, 28).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="${cls}">${icon} ${nm} ${ph} ${ms}</div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  return { show, hide, onCancel, say, announce, addError, setCount, setCurrentName, setMeta, logResult, applySvgFaces };
})();

// ============================================================================
// DEV MODE — calibration overlay + mock export sequence
// ============================================================================

const DevMode = (() => {
  let active    = false;
  let timers    = /** @type {ReturnType<typeof setTimeout>[]} */ ([]);

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  function delay(ms) { return new Promise(r => { timers.push(setTimeout(r, ms)); }); }

  function showCalib(on) {
    const el = document.getElementById('piqDevCalib');
    if (el) el.classList.toggle('hidden', !on);
  }

  /** Run a mock export sequence to exercise all orb states. */
  async function runMockSequence() {
    OrbController.show(10, 'TestProject');
    showCalib(true);

    const steps = [
      () => OrbController.say('init',     [10, 'TestProject'], [10, 'TestProject']),
      async () => {
        OrbController.setCount(1, 10);
        OrbController.setCurrentName('Optimizing Taco Bell order for best value');
        OrbController.say('fetching', ['Taco Bell order', 1, 10], ['Taco Bell order', 1, 10]);
      },
      () => { OrbController.say('hasThink', [47], [47]); },
      () => { OrbController.say('hasArts',  [3],  [3]);  },
      () => { OrbController.setCount(2, 10); OrbController.say('pushOk', [], []); OrbController.announce('Saved: chat_2026.05.10-143022.json', 'status'); },
      () => {
        OrbController.setCount(3, 10);
        OrbController.say('fetchFail', ['Private conversation', '403 Forbidden'], ['Private conversation', '403 Forbidden']);
        OrbController.announce('HTTP 403 — "Private conversation" skipped', 'error');
      },
      () => { OrbController.setCount(5, 10); OrbController.say('halfway', [5, 10], [5, 10]); OrbController.announce('5 of 10 complete', 'status'); },
      () => { OrbController.setCount(4, 10); OrbController.announce('Rate limited — waiting 3s', 'warn'); OrbController.say('retrying', ['Some Chat', 2], ['Some Chat', 2]); },
      () => { OrbController.setCount(9, 10); OrbController.say('nearEnd', [1], [1]); },
      () => {
        OrbController.setCount(10, 10);
        OrbController.say('done_all', [9, 10], [9, 10]);
        OrbController.announce('9 of 10 complete. 1 error.', 'status');
        OrbController.announce('1 conversation failed — see error panel', 'error');
      },
    ];

    for (const step of steps) {
      if (!active) break;
      await step();
      await delay(2200);
    }

    // Loop back for continuous calibration
    if (active) {
      await delay(3000);
      if (active) runMockSequence();
    }
  }

  function toggle() {
    const btn = document.getElementById('devBtn');
    if (active) {
      active = false;
      clearTimers();
      showCalib(false);
      OrbController.hide();
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
// CHARACTER CONFIG UI
// ============================================================================

const OrbCharacterConfig = (() => {

  function buildUI() {
    const existing = document.getElementById('orbCharConfig');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id        = 'orbCharConfig';
    panel.className = 'orb-char-config';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Orb character configuration');

    const chars   = OrbConfig.getAllCharacters();
    const current = OrbConfig.getCurrent();
    const mode    = OrbConfig.getColorMode();
    const speed   = OrbConfig.getSpeed();

    const div  = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
    const span = (cls, t) => { const s = document.createElement('span'); s.className = cls; s.textContent = t; return s; };

    const titleRow = div('orb-char-title-row');
    const titleEl  = div('orb-char-config-title'); titleEl.textContent = 'Orb Characters';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'orb-char-close'; closeBtn.textContent = '✕'; closeBtn.setAttribute('aria-label','Close');
    closeBtn.onclick = () => panel.remove();
    titleRow.append(titleEl, closeBtn);

    const slotsRow = div('orb-char-slots');
    const buildSlot = (slot, label) => {
      const wrapper = div('orb-char-slot');
      const heading = div('orb-char-slot-label'); heading.textContent = label;
      const preview = document.createElement('img');
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
    slotsRow.append(buildSlot('left', '◀ Left slot (Butt-Head → right spray)'), buildSlot('right', 'Right slot (Beavis → left spray) ▶'));

    const colorRow   = div('orb-char-color-row');
    const colorLabel = div('orb-char-slot-label'); colorLabel.textContent = 'Spray color mode';
    const toggle     = div('orb-color-toggle');
    for (const m of [
      { v: 'psychedelic', t: '🌈 Psychedelic (HSL rotation)' },
      { v: 'theme',       t: '🎨 Character theme colors' },
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

    const speedRow   = div('orb-char-color-row');
    const speedLabel = div('orb-char-slot-label'); speedLabel.textContent = 'Spray speed';
    const speedCtrl  = div('orb-speed-row');
    const slider     = document.createElement('input');
    slider.type = 'range'; slider.min = '0.4'; slider.max = '2.5'; slider.step = '0.1';
    slider.value = String(speed); slider.className = 'orb-speed-slider';
    slider.setAttribute('aria-label','Spray speed');
    const speedVal = span('orb-speed-value', `${speed.toFixed(1)}×`);
    slider.addEventListener('input', async () => {
      speedVal.textContent = `${parseFloat(slider.value).toFixed(1)}×`;
      await OrbConfig.setSpeed(parseFloat(slider.value)).catch(console.warn);
    });
    speedCtrl.append(span('orb-speed-emoji','🐢'), slider, span('orb-speed-emoji','🚀'), speedVal);
    const speedHint = div('orb-char-credit'); speedHint.textContent = '0.4× = slow/readable · 1.0× = default · 2.5× = rapid';
    speedRow.append(speedLabel, speedCtrl, speedHint);

    const hint = div('orb-char-hint'); hint.textContent = 'Add characters: drop folder in characters/ + add id to characters/index.json.';

    panel.append(titleRow, slotsRow, colorRow, speedRow, hint);
    document.body.appendChild(panel);
    setTimeout(() => { document.addEventListener('click', function h() { panel.remove(); document.removeEventListener('click', h); }); }, 0);
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
  OrbController.applySvgFaces();
  ErrorPanel.wire();

  const gear = document.getElementById('piqOrbConfigBtn');
  if (gear) gear.addEventListener('click', e => { e.stopPropagation(); OrbCharacterConfig.toggle(); });

  const devBtn = document.getElementById('devBtn');
  if (devBtn) devBtn.addEventListener('click', () => DevMode.toggle());
});
// PiQPull — Orb Character System v1.8.1
// Spray geometry:
//   Butt-Head — origin (50%,22%), axis 345deg upper-right, spread 200deg (upper-left thru right thru lower-right)
//   Beavis    — origin (20%,80%), axis 180deg pure-left, spread 130deg (upper-left thru left thru lower-left)
//   System    — straight up 270deg from center (50%,42%)
// say() throttled in browse-export.js: fires every 8th conversation to reduce density.
// Error panel: persistent entire export session.
// setDone(): changes Cancel to Done when export completes.
// v1.8.0: OrbTuning module — runtime control panel for all spray/physics/behavior values.
//         25 tunable values. Auto-saves to chrome.storage.sync['orbTuning'].
//         Dev Mode and real export share identical tuning state.
// v1.7.0: resolveJsonPhrase supports {parts: string[][]} mix-and-match combinatorial phrases.

'use strict';

// ============================================================================
// CONSTANTS
// ============================================================================

const LINE_SOFT_MAX = 44;
const LINE_HARD_MAX = 52;

const ANNOUNCE_COLORS = {
  status: '#40ff90',
  error: '#ff5040',
  warn: '#ffc040',
};

const SPEED_KEY = 'orbSpeed';
const COLOR_KEY = 'orbColorMode';
const PAIR_KEY = 'orbCharacterPair';
const SPEED_DEFAULT = 1.0;
const COLOR_DEFAULT = 'psychedelic';
const PAIR_DEFAULT = { left: 'butthead', right: 'beavis' };

// Spray geometry — screen coords Y increases downward:
//   350deg = cos=0.985 sin=-0.174 = right+UP; 30deg = cos=0.866 sin=0.5 = right+down
// Left slot (Butt-Head): origin (50%,22%), axis 345deg, spread 200deg
//   Range: 245deg thru 85deg = upper-left, up, right, lower-right
//   perspective: font 10->22px
// Right slot (Beavis): origin (20%,80%), axis 170deg, spread 130deg
//   170deg = mostly left, slight down; Range 105deg-235deg = upper-left thru left thru lower-left
//   font 12->18px slight growth
// Center (system): (50%,42%), 270deg up, spread 70deg

const SLOT_CONFIG = {
  left: {
    originPct:   { x: 0.50, y: 0.22 },
    angleCenter: 345,                     // upper-right bias; range 245-85 includes lower-right
    spread:      200,
    perspective: true,
    fontStart:   10,
    fontEnd:     22,
  },
  right: {
    originPct:   { x: 0.20, y: 0.80 },
    angleCenter: 180,                     // pure left; range 115-245 = upper-left thru left thru lower-left
    spread:      130,                     // 115deg-245deg: upper-left thru left thru lower-left
    perspective: true,                    // slight growth so same visual weight as BH
    fontStart:   12,
    fontEnd:     18,
  },
  center: {
    originPct:   { x: 0.50, y: 0.42 },
    angleCenter: 270,
    spread:      70,
    perspective: false,
    fontStart:   10,
    fontEnd:     12,
  },
};

// ============================================================================
// TUNING — runtime-adjustable spray/physics/behavior values
// All values default-safe: the orb works correctly with TUNING_DEFAULTS alone.
// OrbTuning.apply() writes these into SLOT_CONFIG on every change.
// ============================================================================

const TUNING_KEY = 'orbTuning';

const TUNING_DEFAULTS = {
  // Spray origins (fraction of sphere size, 0.0 = left/top, 1.0 = right/bottom)
  leftOriginX:      0.50,
  leftOriginY:      0.22,
  rightOriginX:     0.20,
  rightOriginY:     0.80,
  centerOriginX:    0.50,
  centerOriginY:    0.42,

  // Spray axis angles (degrees, screen-space: 270 = up, 90 = down, 0/360 = right, 180 = left)
  leftAngle:        345,
  rightAngle:       180,
  centerAngle:      270,

  // Spray cone widths (degrees; full cone = leftAngle +/- leftSpread/2)
  leftSpread:       200,
  rightSpread:      130,
  centerSpread:     70,

  // Font sizes (px; start = spawn size, end = size at end of travel for perspective effect)
  leftFontStart:    10,
  leftFontEnd:      22,
  rightFontStart:   12,
  rightFontEnd:     18,
  centerFontStart:  10,
  centerFontEnd:    12,

  // Word travel physics (multiplied by OrbConfig speed multiplier)
  speedBase:        70,     // px/s base travel velocity
  speedVariance:    55,     // px/s random addition per word
  wordDuration:     2800,   // ms base word lifetime
  wordDurVariance:  1500,   // ms random addition per word
  staggerFloor:     380,    // ms: floor for Math.max(250, staggerFloor / speed)

  // Text & behavior
  lineSoftMax:      44,     // characters before soft line wrap
  tangentProb:      0.25,   // 0.0–1.0 probability of injecting a tangent on say()
};

// ============================================================================
// LINE SPLITTING
// ============================================================================

/** @param {string} text @param {number} [softMax] @returns {string[]} */
function splitIntoLines(text, softMax) {
  const max = (typeof softMax === 'number' && softMax > 0) ? softMax : LINE_SOFT_MAX;
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const safe = w.length > LINE_HARD_MAX ? `${w.slice(0, LINE_HARD_MAX)}…` : w;
    const tent = cur ? `${cur} ${safe}` : safe;
    if (tent.length <= max) { cur = tent; }
    else if (cur) { lines.push(cur); cur = safe; }
    else { lines.push(safe); cur = ''; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ============================================================================
// PHRASE TEMPLATE RESOLVER
// ============================================================================

const ARG_MAPS = {
  init: (a) => ({ n: a[0], proj: a[1] ? ` — routing to ${a[1]}` : '', t: a[0] }),
  fetching: (a) => ({ name: cap(a[0]), n: a[1], t: a[2] }),
  hasThink: (a) => ({ n: a[0] }),
  hasArts: (a) => ({ n: a[0] }),
  pushing: (a) => ({ name: cap(a[0]), msgs: a[1], model: a[2] }),
  pushOk: () => ({}),
  fetchFail: (a) => ({ name: cap(a[0]), err: a[1] || '' }),
  pushFail: (a) => ({ name: cap(a[0]) }),
  retrying: (a) => ({ name: cap(a[0]), n: a[1] }),
  halfway: (a) => ({ n: a[0], t: a[1], pct: Math.round((a[0] / (a[1] || 1)) * 100) }),
  nearEnd: (a) => ({ left: a[0] }),
  done_all: (a) => ({ ok: a[0], t: a[1] }),
  done_partial: (a) => ({ ok: a[0], t: a[1], missed: (a[1] || 0) - (a[0] || 0) }),
  tangent: () => ({}),
  cancelled: () => ({}),
  zipping: () => ({}),
  zipDone: () => ({}),
  log: () => ({}),
};

const cap = (s) => (s || '').substring(0, 24);

/**
 * Resolve a phrase value to a string. Supports three formats in character JSON:
 *   string       → used as-is
 *   string[]     → one picked at random
 *   mixed[]      → each element may be a string OR a {parts: string[][]} object;
 *                   when a {parts} object is picked, one item from each part-array is
 *                   joined with a space, giving combinatorial variety from small data.
 *
 * Example {parts} entry: {"parts": [["Uh,","Uh huh huh,"],["pushing","sending"],["huh huh.","now."]}
 * yields 2x2x2 = 8 unique sentences from one JSON entry.
 */
function resolveJsonPhrase(phraseVal, key, args) {
  if (!phraseVal) return '';

  function _pick(v) {
    if (!v && v !== 0) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      return _pick(v[Math.floor(Math.random() * v.length)]);
    }
    if (typeof v === 'object' && Array.isArray(v.parts)) {
      // Mix-and-match: pick one item from each part-array, join with space
      return v.parts
        .map(partArr => Array.isArray(partArr) && partArr.length > 0
          ? String(partArr[Math.floor(Math.random() * partArr.length)] || '')
          : '')
        .filter(Boolean)
        .join(' ');
    }
    return String(v);
  }

  const raw = _pick(phraseVal);
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
      image: `characters/${id}/${id}.png`,
      colors: Array.isArray(data.colors) && data.colors.length > 0 ? data.colors : ['#ffffff'],
      credit: data.credit || '',
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
  let current = { ...PAIR_DEFAULT };
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
            left: CHARACTER_REGISTRY[PAIR_DEFAULT.left] ? PAIR_DEFAULT.left : (keys[0] || '_fallback'),
            right: CHARACTER_REGISTRY[PAIR_DEFAULT.right] ? PAIR_DEFAULT.right : (keys[1] || keys[0] || '_fallback'),
          };
        }
        colorMode = stored[COLOR_KEY] === 'theme' ? 'theme' : 'psychedelic';
        const s = parseFloat(stored[SPEED_KEY]);
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

  function getCharacter(slot) { return CHARACTER_REGISTRY[current[slot]] || Object.values(CHARACTER_REGISTRY)[0] || null; }
  function getCurrent() { return { ...current }; }
  function getColorMode() { return colorMode; }
  function getSpeed() { return speedMult; }
  function getAllCharacters() { return Object.values(CHARACTER_REGISTRY); }

  return { load, setSlot, setColorMode, setSpeed, getCharacter, getCurrent, getColorMode, getSpeed, getAllCharacters };
})();

// ============================================================================
// ORB TUNING — runtime control of spray geometry, physics, and behavior
// Persists to chrome.storage.sync[TUNING_KEY]. Shared by Dev Mode + real export.
// ============================================================================

const OrbTuning = (() => {
  // Start with a full copy of hardcoded defaults — safe to call get() before load() completes.
  // _configDefaults is overwritten by tuning-defaults.json during load(); reset() restores to it.
  let current = Object.assign({}, TUNING_DEFAULTS);
  let _configDefaults = Object.assign({}, TUNING_DEFAULTS);
  let _saveTimer = null;

  /** Write current tuning values into SLOT_CONFIG. Takes effect on next sprayFromSlot() call. */
  function apply() {
    SLOT_CONFIG.left.originPct.x    = current.leftOriginX;
    SLOT_CONFIG.left.originPct.y    = current.leftOriginY;
    SLOT_CONFIG.left.angleCenter    = current.leftAngle;
    SLOT_CONFIG.left.spread         = current.leftSpread;
    SLOT_CONFIG.left.fontStart      = current.leftFontStart;
    SLOT_CONFIG.left.fontEnd        = current.leftFontEnd;

    SLOT_CONFIG.right.originPct.x   = current.rightOriginX;
    SLOT_CONFIG.right.originPct.y   = current.rightOriginY;
    SLOT_CONFIG.right.angleCenter   = current.rightAngle;
    SLOT_CONFIG.right.spread        = current.rightSpread;
    SLOT_CONFIG.right.fontStart     = current.rightFontStart;
    SLOT_CONFIG.right.fontEnd       = current.rightFontEnd;

    SLOT_CONFIG.center.originPct.x  = current.centerOriginX;
    SLOT_CONFIG.center.originPct.y  = current.centerOriginY;
    SLOT_CONFIG.center.angleCenter  = current.centerAngle;
    SLOT_CONFIG.center.spread       = current.centerSpread;
    SLOT_CONFIG.center.fontStart    = current.centerFontStart;
    SLOT_CONFIG.center.fontEnd      = current.centerFontEnd;
  }

  /** Debounced save — coalesces rapid slider drags into one write (500ms window). */
  function save() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      chrome.storage.sync.set({ [TUNING_KEY]: current }, () => {
        if (chrome.runtime.lastError) {
          console.warn('PiQPull OrbTuning: save failed —', chrome.runtime.lastError.message);
        }
      });
    }, 500);
  }

  /** Load saved values, merge over defaults, apply. Safe to await in DOMContentLoaded.
   *  Load order: TUNING_DEFAULTS → tuning-defaults.json (config) → chrome.storage.sync (user edits)
   *  reset() restores to the config-file level, not all the way to hardcoded TUNING_DEFAULTS.
   */
  async function load() {
    // Step 1: fetch tuning-defaults.json — builds _configDefaults (what Reset returns to)
    try {
      const cfgRes = await fetch(chrome.runtime.getURL('tuning-defaults.json'));
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg && typeof cfg === 'object') {
          // Merge known keys only — unknown keys (like _note) are silently skipped
          const merged = Object.assign({}, TUNING_DEFAULTS);
          for (const k of Object.keys(TUNING_DEFAULTS)) {
            if (k in cfg && typeof cfg[k] === 'number') merged[k] = cfg[k];
          }
          _configDefaults = merged;
        }
      }
    } catch (_e) {
      // Non-fatal — TUNING_DEFAULTS already set as fallback
      console.warn('PiQPull OrbTuning: tuning-defaults.json load failed —', _e.message);
    }

    // Step 2: load user overrides from chrome.storage.sync on top of config defaults
    return new Promise(resolve => {
      chrome.storage.sync.get([TUNING_KEY], stored => {
        const saved = stored[TUNING_KEY];
        if (saved && typeof saved === 'object') {
          current = Object.assign({}, _configDefaults, saved);
        } else {
          current = Object.assign({}, _configDefaults);
        }
        apply();
        resolve();
      });
    });
  }

  /** Restore to tuning-defaults.json values (or TUNING_DEFAULTS if file not loaded yet). */
  function reset() {
    current = Object.assign({}, _configDefaults);
    apply();
    save();
  }

  /**
   * Set a single tuning value, apply immediately, queue save.
   * @param {string} key
   * @param {number} value
   */
  function set(key, value) {
    if (!(key in TUNING_DEFAULTS)) {
      console.warn('PiQPull OrbTuning: unknown key', key);
      return;
    }
    current[key] = value;
    apply();
    save();
  }

  /** @returns {Readonly<typeof TUNING_DEFAULTS>} */
  function get() { return current; }

  return { load, reset, set, get };
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
    const list = _getList();
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
    navigator.clipboard.writeText(errors.join('\n')).catch(() => { });
  }

  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function wire() {
    const copyBtn = document.getElementById('piqErrorCopy');
    if (copyBtn) copyBtn.addEventListener('click', copyAll);
    // No dismiss — error panel persists entire export session
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

  const elById = (id) => document.getElementById(id);
  const setText = (id, t) => { const e = elById(id); if (e) e.textContent = t || ''; };

  // ── Slot mouth origins (pixels relative to modal/overlay) ─────────────────

  function getSlotOrigins() {
    const modal = elById('piqOrbModal');
    const sphere = document.querySelector('.piq-orb-sphere');
    if (!modal || !sphere) return null;
    const mR = modal.getBoundingClientRect();
    const sR = sphere.getBoundingClientRect();
    const ox = sR.left - mR.left;
    const oy = sR.top - mR.top;

    const result = {};
    for (const [slot, cfg] of Object.entries(SLOT_CONFIG)) {
      result[slot] = {
        x: ox + sR.width * cfg.originPct.x,
        y: oy + sR.height * cfg.originPct.y,
      };
    }
    return result;
  }

  // ── Line animation (with optional perspective font growth) ─────────────────

  function animateLine(el, ox, oy, vx, vy, duration, fontStart, fontEnd) {
    const start = performance.now();
    const totalSec = duration / 1000;
    const growFont = (fontEnd !== undefined && fontEnd !== fontStart);

    function frame(now) {
      const elapsed = (now - start) / 1000;
      const progress = elapsed / totalSec;
      if (progress >= 1 || !el.parentNode) { el.remove(); return; }

      const opacity = progress < 0.35 ? 1 : Math.max(0, 1 - (progress - 0.35) / 0.65);
      el.style.transform = `translate(${(ox + vx * elapsed).toFixed(1)}px, ${(oy + vy * elapsed).toFixed(1)}px)`;
      el.style.opacity = opacity.toFixed(3);

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
    el.className = 'piq-spray-line';
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
    const origins = getSlotOrigins();
    if (!sprayLayer || !origins || !origins[slot]) return;

    const slotCfg = SLOT_CONFIG[slot];
    const origin = origins[slot];
    const speed = OrbConfig.getSpeed();
    const lines = splitIntoLines(text, OrbTuning.get().lineSoftMax);
    if (lines.length === 0) return;

    // Color: override for announces, character color for left/right
    let color = colorOverride || null;
    if (!color && slot !== 'center') {
      const charSlot = slot === 'left' ? 'left' : 'right';
      const char = OrbConfig.getCharacter(charSlot);
      color = _pickColor(charSlot, char && char.colors, OrbConfig.getColorMode());
    }
    if (!color) color = '#40ff90';

    // Base angle for this quote — spread is exact degree range (±spread/2 from center)
    const quoteBaseAngle = slotCfg.angleCenter
      - slotCfg.spread * 0.5
      + Math.random() * slotCfg.spread;

    lines.forEach((line, i) => {
      setTimeout(() => {
        if (!sprayLayer.isConnected) return;

        const lineAngleDeg = quoteBaseAngle + (Math.random() - 0.5) * 20;
        const rad = (lineAngleDeg * Math.PI) / 180;
        const t    = OrbTuning.get();
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

      // Floor at 250ms so line 2 can never overtake line 1 at any speed setting
      }, i * Math.max(250, Math.round(OrbTuning.get().staggerFloor / speed)));
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
    if (Math.random() > OrbTuning.get().tangentProb) return; // skip based on tunable probability
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
    setText('piqOrbPct', '0%');
    setText('piqOrbName', 'Initializing…');
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
      const k = key === 'done' ? 'done_all' : key;
      const val = lc.phrases[k];
      if (val) sprayFromSlot('left', resolveJsonPhrase(val, k, leftArgs || []));
    }

    setTimeout(() => {
      maybeTangent(); // maybe fire a tangent instead of or alongside status
      if (rc && rc.phrases) {
        const k = key === 'done' ? 'done_all' : key;
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
    setText('piqOrbPct', `${pct}%`);
    const fill = elById('piqOrbFill');
    if (fill) fill.style.width = `${pct}%`;
  }

  function setCurrentName(name) { setText('piqOrbName', (name || '').substring(0, 52)); }
  function setMeta(text) { setText('piqOrbMeta', text || ''); }

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
      const cls = `piq-log-line piq-log-${r.status === 'success' ? 'ok' : r.status === 'partial' ? 'partial' : r.status === 'skipped' ? 'skip' : 'failed'}`;
      const icon = r.status === 'success' ? '✅' : r.status === 'partial' ? '⚡' : r.status === 'skipped' ? '⬜' : '❌';
      const ph = Object.entries(r.phases || {}).map(([k, v]) => `${k[0].toUpperCase()}:${v.ok ? '✓' : '✗'}`).join(' ');
      const ms = r.durationMs ? `${r.durationMs}ms` : '';
      const nm = (r.name || '').substring(0, 28).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="${cls}">${icon} ${nm} ${ph} ${ms}</div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  return { show, hide, onCancel, setDone, say, announce, addError, setCount, setCurrentName, setMeta, logResult, applySvgFaces };
})();

// ============================================================================
// DEV MODE — calibration overlay + mock export sequence
// ============================================================================

const DevMode = (() => {
  let active = false;
  let timers = /** @type {ReturnType<typeof setTimeout>[]} */ ([]);

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
      () => OrbController.say('init', [10, 'TestProject'], [10, 'TestProject']),
      async () => {
        OrbController.setCount(1, 10);
        OrbController.setCurrentName('Optimizing Taco Bell order for best value');
        OrbController.say('fetching', ['Taco Bell order', 1, 10], ['Taco Bell order', 1, 10]);
      },
      () => { OrbController.say('hasThink', [47], [47]); },
      () => { OrbController.say('hasArts', [3], [3]); },
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
// CALIBRATION REFRESH — updates the dev overlay SVG live as tuning values change
// Called from OrbTuning.apply() and DevMode.showCalib(true).
// Uses function declaration so it hoists and is available during apply().
// ============================================================================

function refreshCalibration() {
  const calib = document.getElementById('piqDevCalib');
  if (!calib || calib.classList.contains('hidden')) return; // only update when visible

  const t = OrbTuning.get();
  const S = 500; // SVG viewBox size matches sphere viewBox="0 0 500 500"
  const AXIS_LEN   = 70;  // px: main direction arrow length
  const SPREAD_LEN = 52;  // px: spread boundary line length (slightly shorter)
  const CROSS      = 11;  // px: crosshair half-length
  const LABEL_GAP  = 6;   // px: label offset from origin

  /** Endpoint of a ray from (ox,oy) in direction deg at length len. */
  function ray(ox, oy, deg, len) {
    const rad = (deg * Math.PI) / 180;
    return { x: ox + Math.cos(rad) * len, y: oy + Math.sin(rad) * len };
  }

  /** Update an SVG line element's endpoints. */
  function line(id, x1, y1, x2, y2) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('x1', x1.toFixed(1)); el.setAttribute('y1', y1.toFixed(1));
    el.setAttribute('x2', x2.toFixed(1)); el.setAttribute('y2', y2.toFixed(1));
  }

  /** Update an SVG circle element's center. */
  function circle(id, cx, cy) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('cx', cx.toFixed(1)); el.setAttribute('cy', cy.toFixed(1));
  }

  /** Update an SVG text element's position and content. */
  function label(id, ox, oy, text) {
    const el = document.getElementById(id);
    if (!el) return;
    // Push label below origin if in upper half, above if in lower half
    const below = oy < S / 2;
    el.setAttribute('x', (ox + LABEL_GAP).toFixed(1));
    el.setAttribute('y', (oy + (below ? LABEL_GAP + 9 : -LABEL_GAP)).toFixed(1));
    el.textContent = text;
  }

  // ── Butt-Head (left slot) ──────────────────────────────────────────────
  const bhX = t.leftOriginX * S;
  const bhY = t.leftOriginY * S;
  const bhAxis = ray(bhX, bhY, t.leftAngle, AXIS_LEN);
  const bhSL   = ray(bhX, bhY, t.leftAngle - t.leftSpread / 2, SPREAD_LEN);
  const bhSR   = ray(bhX, bhY, t.leftAngle + t.leftSpread / 2, SPREAD_LEN);

  circle('calibBHOrigin',  bhX, bhY);
  line('calibBHCrossH',    bhX - CROSS, bhY, bhX + CROSS, bhY);
  line('calibBHCrossV',    bhX, bhY - CROSS, bhX, bhY + CROSS);
  line('calibBHAxis',      bhX, bhY, bhAxis.x, bhAxis.y);
  line('calibBHSpreadL',   bhX, bhY, bhSL.x, bhSL.y);
  line('calibBHSpreadR',   bhX, bhY, bhSR.x, bhSR.y);
  label('calibBHLabel',    bhX, bhY,
    `BH ${Math.round(t.leftOriginX * 100)}%,${Math.round(t.leftOriginY * 100)}% ${t.leftAngle}deg +/-${Math.round(t.leftSpread / 2)}`);

  // ── Beavis (right slot) ─────────────────────────────────────────────
  const bvX = t.rightOriginX * S;
  const bvY = t.rightOriginY * S;
  const bvAxis = ray(bvX, bvY, t.rightAngle, AXIS_LEN);
  const bvSL   = ray(bvX, bvY, t.rightAngle - t.rightSpread / 2, SPREAD_LEN);
  const bvSR   = ray(bvX, bvY, t.rightAngle + t.rightSpread / 2, SPREAD_LEN);

  circle('calibBVOrigin',  bvX, bvY);
  line('calibBVCrossH',    bvX - CROSS, bvY, bvX + CROSS, bvY);
  line('calibBVCrossV',    bvX, bvY - CROSS, bvX, bvY + CROSS);
  line('calibBVAxis',      bvX, bvY, bvAxis.x, bvAxis.y);
  line('calibBVSpreadL',   bvX, bvY, bvSL.x, bvSL.y);
  line('calibBVSpreadR',   bvX, bvY, bvSR.x, bvSR.y);
  label('calibBVLabel',    bvX, bvY,
    `BV ${Math.round(t.rightOriginX * 100)}%,${Math.round(t.rightOriginY * 100)}% ${t.rightAngle}deg +/-${Math.round(t.rightSpread / 2)}`);

  // ── System / center ────────────────────────────────────────────────
  const sysX = t.centerOriginX * S;
  const sysY = t.centerOriginY * S;
  const sysAxis = ray(sysX, sysY, t.centerAngle, AXIS_LEN);
  const sysSL   = ray(sysX, sysY, t.centerAngle - t.centerSpread / 2, SPREAD_LEN);
  const sysSR   = ray(sysX, sysY, t.centerAngle + t.centerSpread / 2, SPREAD_LEN);

  circle('calibSYSOrigin', sysX, sysY);
  line('calibSYSCrossH',   sysX - CROSS, sysY, sysX + CROSS, sysY);
  line('calibSYSCrossV',   sysX, sysY - CROSS, sysX, sysY + CROSS);
  line('calibSYSAxis',     sysX, sysY, sysAxis.x, sysAxis.y);
  line('calibSYSSpreadL',  sysX, sysY, sysSL.x, sysSL.y);
  line('calibSYSSpreadR',  sysX, sysY, sysSR.x, sysSR.y);
  label('calibSYSLabel',   sysX, sysY,
    `SYS ${Math.round(t.centerOriginX * 100)}%,${Math.round(t.centerOriginY * 100)}% ${t.centerAngle}deg +/-${Math.round(t.centerSpread / 2)}`);
}

// ============================================================================
// CHARACTER CONFIG UI
// ============================================================================

const OrbCharacterConfig = (() => {

  // Data-driven tuning control definitions. Defined once at module scope, not recreated per panel open.
  // scale: multiply stored value for display (stored origins are 0.0-1.0, displayed as 0-100%)
  const TUNING_CONTROLS = [
    {
      id: 'origins', label: 'Spray Origins',
      hint: 'Start point of word spray as % of sphere. Y=0 is top, Y=100 is bottom.',
      rows: [
        { key: 'leftOriginX',   label: 'Left X',   min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'leftOriginY',   label: 'Left Y',   min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'rightOriginX',  label: 'Right X',  min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'rightOriginY',  label: 'Right Y',  min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'centerOriginX', label: 'Ctr X',    min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
        { key: 'centerOriginY', label: 'Ctr Y',    min: 0, max: 100, step: 1,  scale: 100, unit: '%' },
      ],
    },
    {
      id: 'angles', label: 'Angles & Spread',
      hint: 'Screen coords: 270=up, 90=down, 0/360=right, 180=left. Spread = total cone width in degrees.',
      rows: [
        { key: 'leftAngle',    label: 'Left axis',    min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'leftSpread',   label: 'Left spread',  min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'rightAngle',   label: 'Right axis',   min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'rightSpread',  label: 'Right spread', min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'centerAngle',  label: 'Ctr axis',     min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
        { key: 'centerSpread', label: 'Ctr spread',   min: 0, max: 360, step: 1, scale: 1, unit: 'deg' },
      ],
    },
    {
      id: 'fonts', label: 'Font Sizes',
      hint: 'Start = spawn size. End = size at end of travel. Difference creates the perspective growth effect.',
      rows: [
        { key: 'leftFontStart',   label: 'Left start',   min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'leftFontEnd',     label: 'Left end',     min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'rightFontStart',  label: 'Right start',  min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'rightFontEnd',    label: 'Right end',    min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'centerFontStart', label: 'Ctr start',    min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
        { key: 'centerFontEnd',   label: 'Ctr end',      min: 4, max: 48, step: 1, scale: 1, unit: 'px' },
      ],
    },
    {
      id: 'physics', label: 'Word Physics',
      hint: 'All speed/duration values are scaled by the Speed multiplier above.',
      rows: [
        { key: 'speedBase',       label: 'Speed base',    min: 10,  max: 300,  step: 5,   scale: 1, unit: 'px/s' },
        { key: 'speedVariance',   label: 'Speed burst',   min: 0,   max: 200,  step: 5,   scale: 1, unit: 'px/s' },
        { key: 'wordDuration',    label: 'Duration',      min: 500, max: 8000, step: 100, scale: 1, unit: 'ms' },
        { key: 'wordDurVariance', label: 'Dur. variance', min: 0,   max: 5000, step: 100, scale: 1, unit: 'ms' },
        { key: 'staggerFloor',    label: 'Line stagger',  min: 50,  max: 1500, step: 10,  scale: 1, unit: 'ms' },
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

    const chars = OrbConfig.getAllCharacters();
    const current = OrbConfig.getCurrent();
    const mode = OrbConfig.getColorMode();
    const speed = OrbConfig.getSpeed();

    const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
    const span = (cls, t) => { const s = document.createElement('span'); s.className = cls; s.textContent = t; return s; };

    const titleRow = div('orb-char-title-row');
    const titleEl = div('orb-char-config-title'); titleEl.textContent = 'Orb Characters';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'orb-char-close'; closeBtn.textContent = '✕'; closeBtn.setAttribute('aria-label', 'Close');
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

    const colorRow = div('orb-char-color-row');
    const colorLabel = div('orb-char-slot-label'); colorLabel.textContent = 'Spray color mode';
    const toggle = div('orb-color-toggle');
    for (const m of [
      { v: 'psychedelic', t: '🌈 Psychedelic (HSL rotation)' },
      { v: 'theme', t: '🎨 Character theme colors' },
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

    const speedRow = div('orb-char-color-row');
    const speedLabel = div('orb-char-slot-label'); speedLabel.textContent = 'Spray speed';
    const speedCtrl = div('orb-speed-row');
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0.4'; slider.max = '2.5'; slider.step = '0.1';
    slider.value = String(speed); slider.className = 'orb-speed-slider';
    slider.setAttribute('aria-label', 'Spray speed');
    const speedVal = span('orb-speed-value', `${speed.toFixed(1)}×`);
    slider.addEventListener('input', async () => {
      speedVal.textContent = `${parseFloat(slider.value).toFixed(1)}×`;
      await OrbConfig.setSpeed(parseFloat(slider.value)).catch(console.warn);
    });
    speedCtrl.append(span('orb-speed-emoji', '🐢'), slider, span('orb-speed-emoji', '🚀'), speedVal);
    const speedHint = div('orb-char-credit'); speedHint.textContent = '0.4× = slow/readable · 1.0× = default · 2.5× = rapid';
    speedRow.append(speedLabel, speedCtrl, speedHint);

    const hint = div('orb-char-hint'); hint.textContent = 'Add characters: drop folder in characters/ + add id to characters/index.json.';

    // ── Tuning section helpers (local to buildUI, closed over panel) ──────────────────────

    /** One slider+number+unit row for a tuning control. */
    function makeTuningRow(cfg, tuningVals) {
      const row = div('orb-tuning-row');
      const lbl = div('orb-tuning-label');
      lbl.textContent = cfg.label;

      const displayVal = Math.round((tuningVals[cfg.key] || 0) * cfg.scale);

      const rangeEl = document.createElement('input');
      rangeEl.type = 'range';
      rangeEl.className = 'orb-tuning-slider';
      rangeEl.min = String(cfg.min);
      rangeEl.max = String(cfg.max);
      rangeEl.step = String(cfg.step);
      rangeEl.value = String(displayVal);
      rangeEl.dataset.tuningKey = cfg.key;
      rangeEl.dataset.tuningScale = String(cfg.scale);

      const numEl = document.createElement('input');
      numEl.type = 'number';
      numEl.className = 'orb-tuning-value';
      numEl.min = String(cfg.min);
      numEl.max = String(cfg.max);
      numEl.step = String(cfg.step);
      numEl.value = String(displayVal);
      numEl.dataset.tuningNum = cfg.key;

      const unitEl = span('orb-tuning-unit', cfg.unit);

      // Bidirectional sync: range <-> number. Both call OrbTuning.set() which apply()s immediately.
      rangeEl.addEventListener('input', () => {
        const v = parseFloat(rangeEl.value);
        numEl.value = String(v);
        OrbTuning.set(cfg.key, v / cfg.scale);
      });
      numEl.addEventListener('change', () => {
        const clamped = Math.max(cfg.min, Math.min(cfg.max, parseFloat(numEl.value) || 0));
        rangeEl.value = String(clamped);
        numEl.value = String(clamped);
        OrbTuning.set(cfg.key, clamped / cfg.scale);
      });

      row.append(lbl, rangeEl, numEl, unitEl);
      return row;
    }

    /** Refresh all slider/number inputs from current OrbTuning state after Reset. */
    function refreshTuningInputs(container) {
      const vals = OrbTuning.get();
      container.querySelectorAll('[data-tuning-key]').forEach(rangeEl => {
        const key = rangeEl.dataset.tuningKey;
        const scale = parseFloat(rangeEl.dataset.tuningScale) || 1;
        const displayVal = Math.round((vals[key] || 0) * scale);
        rangeEl.value = String(displayVal);
        const numEl = container.querySelector('[data-tuning-num="' + key + '"]');
        if (numEl) numEl.value = String(displayVal);
      });
    }

    /** Build the full tuning section: groups + reset + test spray. */
    function buildTuningSection() {
      const tuningVals = OrbTuning.get();
      const wrapper = div('orb-tuning-section');

      wrapper.appendChild(div('orb-tuning-divider'));
      const sectionLbl = div('orb-char-slot-label orb-tuning-section-title');
      sectionLbl.textContent = 'Spray Tuning';
      wrapper.appendChild(sectionLbl);

      for (const group of TUNING_CONTROLS) {
        const details = document.createElement('details');
        details.className = 'orb-tuning-group';
        details.open = false; // collapsed by default; user opens what they need

        const summary = document.createElement('summary');
        summary.className = 'orb-tuning-group-title';
        summary.textContent = group.label;
        details.appendChild(summary);

        const hintEl = div('orb-tuning-group-hint');
        hintEl.textContent = group.hint;
        details.appendChild(hintEl);

        for (const rowCfg of group.rows) {
          details.appendChild(makeTuningRow(rowCfg, tuningVals));
        }
        wrapper.appendChild(details);
      }

      const footer = div('orb-tuning-footer');

      const resetBtn = document.createElement('button');
      resetBtn.className = 'orb-tuning-btn';
      resetBtn.textContent = 'Reset All to Defaults';
      resetBtn.addEventListener('click', () => {
        OrbTuning.reset();
        refreshTuningInputs(wrapper);
      });

      const testBtn = document.createElement('button');
      testBtn.className = 'orb-tuning-btn orb-tuning-btn--test';
      testBtn.textContent = 'Test Spray';
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
    panel.append(titleRow, slotsRow, colorRow, speedRow, hint, tuningSection);
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
  await OrbTuning.load(); // load saved tuning values and apply to SLOT_CONFIG
  OrbController.applySvgFaces();
  ErrorPanel.wire();

  const gear = document.getElementById('piqOrbConfigBtn');
  if (gear) gear.addEventListener('click', e => { e.stopPropagation(); OrbCharacterConfig.toggle(); });

  const devBtn = document.getElementById('devBtn');
  if (devBtn) devBtn.addEventListener('click', () => DevMode.toggle());
});
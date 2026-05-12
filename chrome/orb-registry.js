// PiQPull — Orb Registry v1.0.0
// Character loading, OrbConfig (pair/color/speed), OrbTuning (spray geometry + physics).
// Depends on: orb-phrases.js (resolveJsonPhrase via CHARACTER_REGISTRY — indirect only at call time).
//             No direct imports — all referenced symbols resolved at runtime.
// v1.0.0: extracted from orb-characters.js v1.9.0.
//         OrbTuning.apply() calls refreshCalibration() guarded by typeof check.

'use strict';

// ── Storage keys and defaults ─────────────────────────────────────────────────

const SPEED_KEY   = 'orbSpeed';
const COLOR_KEY   = 'orbColorMode';
const PAIR_KEY    = 'orbCharacterPair';
const TUNING_KEY  = 'orbTuning';

const SPEED_DEFAULT  = 1.0;
const COLOR_DEFAULT  = 'psychedelic';
const PAIR_DEFAULT   = { left: 'butthead', right: 'beavis' };

// ── SLOT_CONFIG — spray geometry ──────────────────────────────────────────────
// Values here are overwritten by OrbTuning.apply() on every load and config change.
// These serve as fallback defaults only.

const SLOT_CONFIG = {
  left: {
    originPct:   { x: 0.50, y: 0.22 },
    angleCenter: 345,
    spread:      200,
    perspective: true,
    fontStart:   10,
    fontEnd:     22,
  },
  right: {
    originPct:   { x: 0.20, y: 0.80 },
    angleCenter: 180,
    spread:      130,
    perspective: true,
    fontStart:   12,
    fontEnd:     18,
  },
  center: {
    originPct:   { x: 0.50, y: 0.42 },
    angleCenter: 0,
    spread:      70,
    perspective: false,
    fontStart:   10,
    fontEnd:     12,
  },
};

// ── TUNING_DEFAULTS — all tunable values with safe defaults ───────────────────

const TUNING_DEFAULTS = {
  leftOriginX:      0.50,
  leftOriginY:      0.22,
  rightOriginX:     0.20,
  rightOriginY:     0.80,
  centerOriginX:    0.50,
  centerOriginY:    0.42,

  leftAngle:        345,
  rightAngle:       180,
  centerAngle:      0,

  leftSpread:       200,
  rightSpread:      130,
  centerSpread:     70,

  leftFontStart:    10,
  leftFontEnd:      22,
  rightFontStart:   12,
  rightFontEnd:     18,
  centerFontStart:  10,
  centerFontEnd:    12,

  speedBase:        70,
  speedVariance:    55,
  wordDuration:     2800,
  wordDurVariance:  1500,
  staggerFloor:     380,

  lineSoftMax:      44,
  tangentProb:      0.25,
};

// ── CHARACTER_REGISTRY ────────────────────────────────────────────────────────

/** @type {Object.<string, object>} */
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

// ── OrbConfig — active character pair, color mode, speed ──────────────────────

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

  function getCharacter(slot)   { return CHARACTER_REGISTRY[current[slot]] || Object.values(CHARACTER_REGISTRY)[0] || null; }
  function getCurrent()         { return { ...current }; }
  function getColorMode()       { return colorMode; }
  function getSpeed()           { return speedMult; }
  function getAllCharacters()    { return Object.values(CHARACTER_REGISTRY); }

  return { load, setSlot, setColorMode, setSpeed, getCharacter, getCurrent, getColorMode, getSpeed, getAllCharacters };
})();

// ── OrbTuning — runtime spray/physics tuning with persistence ─────────────────

const OrbTuning = (() => {
  let current         = Object.assign({}, TUNING_DEFAULTS);
  let _configDefaults = Object.assign({}, TUNING_DEFAULTS);
  let _saveTimer      = null;

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

    // Refresh calibration overlay live when visible
    if (typeof refreshCalibration === 'function') refreshCalibration();
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

  /**
   * Load order: TUNING_DEFAULTS → tuning-defaults.json → chrome.storage.sync (user edits).
   * reset() restores to the config-file level.
   */
  async function load() {
    try {
      const cfgRes = await fetch(chrome.runtime.getURL('tuning-defaults.json'));
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg && typeof cfg === 'object') {
          const merged = Object.assign({}, TUNING_DEFAULTS);
          for (const k of Object.keys(TUNING_DEFAULTS)) {
            if (k in cfg && typeof cfg[k] === 'number') merged[k] = cfg[k];
          }
          _configDefaults = merged;
        }
      }
    } catch (_e) {
      console.warn('PiQPull OrbTuning: tuning-defaults.json load failed —', _e.message);
    }

    return new Promise(resolve => {
      chrome.storage.sync.get([TUNING_KEY], stored => {
        const saved = stored[TUNING_KEY];
        current = saved && typeof saved === 'object'
          ? Object.assign({}, _configDefaults, saved)
          : Object.assign({}, _configDefaults);
        apply();
        resolve();
      });
    });
  }

  function reset() {
    current = Object.assign({}, _configDefaults);
    apply();
    save();
  }

  function set(key, value) {
    if (!(key in TUNING_DEFAULTS)) { console.warn('PiQPull OrbTuning: unknown key', key); return; }
    current[key] = value;
    apply();
    save();
  }

  function get() { return current; }

  return { load, reset, set, get };
})();

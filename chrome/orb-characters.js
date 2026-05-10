// PiQPull — Orb Character System v1.2.0
// Convention-based discoverable character loading from characters/ folder.
// Multiline spray, per-quote color cohesion, system/error announcements, speed dial.
//
// ADDING A CHARACTER (no JS editing required):
//   1. Create characters/{id}/  folder
//   2. Add characters/{id}/{id}.png  (face image — same name as folder)
//   3. Add characters/{id}/character.json  (schema below)
//   4. Add "{id}" to characters/index.json  (ONE line, that's it)
//   5. Reload the extension — character appears in config UI
//
// CHARACTER.JSON SCHEMA:
//   { id, name, label, credit, colors[], phrases{}, _sources[] }
//   phrases keys: init, fetching, hasThink, hasArts, pushing, pushOk, fetchFail,
//                 pushFail, retrying, halfway, nearEnd, done_all, done_partial,
//                 cancelled, zipping, zipDone, log
//   Each value: string | string[] (random pick)
//   Template tokens: {n} {t} {name} {proj} {msgs} {model} {err} {left} {ok} {pct} {missed}
//   _sources[]: dev-only attribution. Fields: type, work, track, verse, artist, year,
//               publication, verified. Common schema across all character types.
//
// SYSTEM MESSAGES: OrbController.announce(text, 'status'|'error'|'warn')
//   status → green (#40ff90) — sprays upward from center
//   error  → red   (#ff5040) — sprays upward from center
//   warn   → amber (#ffc040) — sprays upward from center
//
// SPEED DIAL: OrbConfig.getSpeed() → number ∈ [0.4, 2.5]
//   Applied to animation duration and stagger. Persisted in chrome.storage.sync.

'use strict';

// ============================================================================
// CONSTANTS
// ============================================================================

const LINE_SOFT_MAX   = 46;    // chars — target max line length (word boundaries)
const LINE_HARD_MAX   = 52;    // chars — hard cap for a single oversized word

const ANNOUNCE_COLORS = {
  status: '#40ff90',           // vivid terminal green — system status
  error:  '#ff5040',           // vivid red            — errors
  warn:   '#ffc040',           // amber                — warnings
};

const SPEED_KEY   = 'orbSpeed';
const COLOR_KEY   = 'orbColorMode';
const PAIR_KEY    = 'orbCharacterPair';
const SPEED_DEFAULT = 1.0;
const COLOR_DEFAULT = 'psychedelic';
const PAIR_DEFAULT  = { left: 'butthead', right: 'beavis' };

// ============================================================================
// LINE SPLITTING — word-boundary only, never cuts a word in half
// ============================================================================

/**
 * @param {string} text
 * @param {number} [softMax]
 * @returns {string[]}
 */
function splitIntoLines(text, softMax) {
  const max   = (typeof softMax === 'number' && softMax > 0) ? softMax : LINE_SOFT_MAX;
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines   = [];
  let   current = '';

  for (const word of words) {
    const safeWord  = word.length > LINE_HARD_MAX ? `${word.slice(0, LINE_HARD_MAX)}…` : word;
    const tentative = current ? `${current} ${safeWord}` : safeWord;

    if (tentative.length <= max) {
      current = tentative;
    } else if (current) {
      lines.push(current);
      current = safeWord;
    } else {
      lines.push(safeWord);   // single word exceeds max — lone line
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ============================================================================
// PHRASE TEMPLATE RESOLVER
// ============================================================================

const ARG_MAPS = {
  init:         (args) => ({ n: args[0], proj: args[1] ? ` — routing to ${args[1]}` : '', t: args[0] }),
  fetching:     (args) => ({ name: capStr(args[0]), n: args[1], t: args[2] }),
  hasThink:     (args) => ({ n: args[0] }),
  hasArts:      (args) => ({ n: args[0] }),
  pushing:      (args) => ({ name: capStr(args[0]), msgs: args[1], model: args[2] }),
  pushOk:       ()     => ({}),
  fetchFail:    (args) => ({ name: capStr(args[0]), err: args[1] || '' }),
  pushFail:     (args) => ({ name: capStr(args[0]) }),
  retrying:     (args) => ({ name: capStr(args[0]), n: args[1] }),
  halfway:      (args) => ({ n: args[0], t: args[1], pct: Math.round((args[0] / (args[1] || 1)) * 100) }),
  nearEnd:      (args) => ({ left: args[0] }),
  done_all:     (args) => ({ ok: args[0], t: args[1] }),
  done_partial: (args) => ({ ok: args[0], t: args[1], missed: (args[1] || 0) - (args[0] || 0) }),
  cancelled:    ()     => ({}),
  zipping:      ()     => ({}),
  zipDone:      ()     => ({}),
  log:          ()     => ({}),
};

/** @param {string} s */
const capStr = (s) => (s || '').substring(0, 26);

/**
 * Pick a random item from a phrase value (string | string[]) and fill tokens.
 * @param {string | string[] | undefined} phraseVal
 * @param {string} key  — for ARG_MAPS lookup
 * @param {unknown[]} args
 * @returns {string}
 */
function resolveJsonPhrase(phraseVal, key, args) {
  if (!phraseVal) return '';
  const raw = Array.isArray(phraseVal)
    ? phraseVal[Math.floor(Math.random() * phraseVal.length)] || ''
    : String(phraseVal);
  if (!raw) return '';

  const mapFn = ARG_MAPS[key];
  const tokens = mapFn ? mapFn(args || []) : {};

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
  const l = 68 + Math.random() * 4;
  return `hsl(${Math.round(_psychHue)}, 100%, ${Math.round(l)}%)`;
}

/**
 * @param {'left'|'right'} slot
 * @param {string[] | undefined} charColors
 * @param {'theme'|'psychedelic'} mode
 */
function _pickColor(slot, charColors, mode) {
  if (mode === 'psychedelic' || !charColors || charColors.length === 0) {
    return _nextPsychColor();
  }
  if (charColors.length === 1) return charColors[0];
  let idx;
  do { idx = Math.floor(Math.random() * charColors.length); }
  while (idx === _lastColorIdx[slot]);
  _lastColorIdx[slot] = idx;
  return charColors[idx];
}

// ============================================================================
// CHARACTER REGISTRY — populated dynamically from characters/ folder
// ============================================================================

/** @type {Object.<string, object>} */
const CHARACTER_REGISTRY = {};

/**
 * Load characters from characters/index.json + each character/character.json.
 * Convention: characters/{id}/{id}.png + characters/{id}/character.json
 * Failures are logged and skipped — loading is always best-effort.
 * @returns {Promise<void>}
 */
async function loadCharacterRegistry() {
  // Step 1: fetch the index
  let ids = [];
  try {
    const indexUrl = chrome.runtime.getURL('characters/index.json');
    const res = await fetch(indexUrl);
    if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
    const parsed = await res.json();
    if (!Array.isArray(parsed)) throw new Error('index.json must be a JSON array of id strings');
    ids = parsed.filter(id => typeof id === 'string' && id.trim().length > 0);
  } catch (e) {
    console.warn('PiQPull OrbCharacters: could not load characters/index.json —', e.message);
    return;
  }

  // Step 2: fetch each character.json in parallel, skip failures gracefully
  const results = await Promise.allSettled(
    ids.map(id =>
      fetch(chrome.runtime.getURL(`characters/${id}/character.json`))
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(data => ({ id, data }))
    )
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('PiQPull OrbCharacters: skipping character —', result.reason);
      continue;
    }
    const { id, data } = result.value;
    if (!data || typeof data !== 'object') {
      console.warn(`PiQPull OrbCharacters: ${id}/character.json is not a valid object`);
      continue;
    }
    // Convention: image path = characters/{id}/{id}.png
    CHARACTER_REGISTRY[id] = {
      id:      id,
      name:    data.name   || id,
      label:   data.label  || data.name || id,
      image:   `characters/${id}/${id}.png`,
      colors:  Array.isArray(data.colors) && data.colors.length > 0 ? data.colors : ['#ffffff'],
      credit:  data.credit || '',
      phrases: data.phrases || {},
    };
  }

  // If nothing loaded, install an emergency fallback so the orb isn't empty
  if (Object.keys(CHARACTER_REGISTRY).length === 0) {
    console.warn('PiQPull OrbCharacters: no characters loaded — using built-in fallback');
    CHARACTER_REGISTRY['_fallback'] = {
      id: '_fallback', name: 'System', label: 'System', image: '',
      colors: ['#a0a0a0'], credit: '', phrases: {
        init: ['Exporting {n} conversations.'], pushOk: ['Saved.'],
        done_all: ['Complete.'], done_partial: ['{ok} of {t} done.'],
      },
    };
  }
}

// ============================================================================
// ORB CONFIG — slot assignments, color mode, speed — all in chrome.storage.sync
// ============================================================================

const OrbConfig = (() => {
  let current   = { ...PAIR_DEFAULT };
  let colorMode = COLOR_DEFAULT;
  let speedMult = SPEED_DEFAULT;

  async function load() {
    return new Promise(resolve => {
      chrome.storage.sync.get([PAIR_KEY, COLOR_KEY, SPEED_KEY], stored => {
        // Slots
        const saved = stored[PAIR_KEY];
        if (saved && saved.left && CHARACTER_REGISTRY[saved.left] &&
                     saved.right && CHARACTER_REGISTRY[saved.right]) {
          current = { left: saved.left, right: saved.right };
        } else {
          // Fall back to first two loaded characters if defaults aren't available
          const keys = Object.keys(CHARACTER_REGISTRY);
          current = {
            left:  CHARACTER_REGISTRY[PAIR_DEFAULT.left]  ? PAIR_DEFAULT.left  : (keys[0] || '_fallback'),
            right: CHARACTER_REGISTRY[PAIR_DEFAULT.right] ? PAIR_DEFAULT.right : (keys[1] || keys[0] || '_fallback'),
          };
        }
        // Color mode
        colorMode = stored[COLOR_KEY] === 'theme' ? 'theme' : 'psychedelic';
        // Speed
        const s = parseFloat(stored[SPEED_KEY]);
        speedMult = (!isNaN(s) && s >= 0.4 && s <= 2.5) ? s : SPEED_DEFAULT;
        resolve();
      });
    });
  }

  async function setSlot(slot, id) {
    if (!CHARACTER_REGISTRY[id]) throw new Error(`Unknown character id: ${id}`);
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

  function getCharacter(slot) {
    return CHARACTER_REGISTRY[current[slot]] || Object.values(CHARACTER_REGISTRY)[0] || null;
  }

  function getCurrent()      { return { ...current }; }
  function getColorMode()    { return colorMode; }
  function getSpeed()        { return speedMult; }
  function getAllCharacters() { return Object.values(CHARACTER_REGISTRY); }

  return { load, setSlot, setColorMode, setSpeed, getCharacter, getCurrent, getColorMode, getSpeed, getAllCharacters };
})();

// ============================================================================
// ORB CONTROLLER — spray engine
// ============================================================================

const OrbController = (() => {

  let cancelCb = null;
  const logBuf = [];
  const LOG_MAX = 9;

  const elById  = (id) => document.getElementById(id);
  const setText  = (id, t) => { const e = elById(id); if (e) e.textContent = t || ''; };

  // ── Slot origins (mouth positions relative to modal) ─────────────────────
  function getSlotOrigins() {
    const modal  = elById('piqOrbModal');
    const sphere = document.querySelector('.piq-orb-sphere');
    if (!modal || !sphere) return null;
    const mR = modal.getBoundingClientRect();
    const sR = sphere.getBoundingClientRect();
    return {
      left:   { x: sR.left - mR.left + sR.width * 0.33, y: sR.top - mR.top + sR.height * 0.53 },
      right:  { x: sR.left - mR.left + sR.width * 0.77, y: sR.top - mR.top + sR.height * 0.74 },
      center: { x: sR.left - mR.left + sR.width * 0.50, y: sR.top - mR.top + sR.height * 0.42 },
    };
  }

  // ── Line animation ─────────────────────────────────────────────────────────
  /**
   * @param {HTMLElement} el
   * @param {number} ox @param {number} oy
   * @param {number} vx @param {number} vy
   * @param {number} duration ms
   */
  function animateLine(el, ox, oy, vx, vy, duration) {
    const start    = performance.now();
    const totalSec = duration / 1000;

    function frame(now) {
      const elapsed  = (now - start) / 1000;
      const progress = elapsed / totalSec;
      if (progress >= 1 || !el.parentNode) { el.remove(); return; }
      const opacity = progress < 0.35 ? 1 : Math.max(0, 1 - (progress - 0.35) / 0.65);
      el.style.transform = `translate(${(ox + vx * elapsed).toFixed(1)}px, ${(oy + vy * elapsed).toFixed(1)}px)`;
      el.style.opacity   = opacity.toFixed(3);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ── Shared line element factory ────────────────────────────────────────────
  function makeLineEl(text, color) {
    const el = document.createElement('div');
    el.className   = 'piq-spray-line';
    el.textContent = text;
    el.style.cssText = [
      `color: ${color}`,
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

  // ── Character spray (left/right slot → mouth origin) ──────────────────────
  /**
   * Spray a quote from a character slot. Long quotes auto-wrap into line clusters.
   * ONE color per quote, shared across all its lines.
   * @param {'left'|'right'} slot
   * @param {string} text
   */
  function sprayQuote(slot, text) {
    if (!text || !text.trim()) return;
    const sprayLayer = elById('piqSprayLayer');
    const origins    = getSlotOrigins();
    if (!sprayLayer || !origins) return;

    const origin = origins[slot];
    const char   = OrbConfig.getCharacter(slot);
    const color  = _pickColor(slot, char && char.colors, OrbConfig.getColorMode());
    const speed  = OrbConfig.getSpeed();
    const lines  = splitIntoLines(text, LINE_SOFT_MAX);
    if (lines.length === 0) return;

    // Slot spray angles: left → upper-left (~210°), right → lower-right (~30°)
    const [angleCenterDeg, clusterSpread] = slot === 'left' ? [210, 90] : [30, 100];
    const quoteBaseAngle = angleCenterDeg - clusterSpread * 0.3 + Math.random() * clusterSpread * 0.6;
    const fontSize = 11.5 + Math.random() * 3.5;

    lines.forEach((line, i) => {
      setTimeout(() => {
        if (!sprayLayer.isConnected) return;
        const rad      = ((quoteBaseAngle + (Math.random() - 0.5) * 24) * Math.PI) / 180;
        const px_s     = (75 + Math.random() * 50) * speed;
        const dur      = (3000 + Math.random() * 1400) / speed;

        const el = makeLineEl(line, color);
        el.style.fontSize  = `${fontSize.toFixed(1)}px`;
        el.style.transform = `translate(${origin.x.toFixed(1)}px, ${origin.y.toFixed(1)}px)`;
        sprayLayer.appendChild(el);
        animateLine(el, origin.x, origin.y, Math.cos(rad) * px_s, Math.sin(rad) * px_s, dur);
      }, i * Math.round(210 / speed));
    });
  }

  // ── System / error announcements (center spray, upward) ───────────────────
  /**
   * Spray a system message from the orb center, upward fan.
   * Visually distinct from character speech (different origin, distinct colors).
   * @param {string} text
   * @param {'status'|'error'|'warn'} [type]
   */
  function announce(text, type) {
    if (!text || !text.trim()) return;
    const sprayLayer = elById('piqSprayLayer');
    const origins    = getSlotOrigins();
    if (!sprayLayer || !origins) return;

    const color  = ANNOUNCE_COLORS[type || 'status'] || ANNOUNCE_COLORS.status;
    const speed  = OrbConfig.getSpeed();
    const origin = origins.center;
    const lines  = splitIntoLines(text, LINE_SOFT_MAX);

    // Center spray: upward fan (270° center ± 40°, i.e., mostly upward)
    const centerAngle = 270;
    const fanSpread   = 80;

    lines.forEach((line, i) => {
      setTimeout(() => {
        if (!sprayLayer.isConnected) return;
        const angleDeg = centerAngle - fanSpread / 2 + Math.random() * fanSpread;
        const rad      = (angleDeg * Math.PI) / 180;
        const px_s     = (60 + Math.random() * 40) * speed;
        const dur      = (2500 + Math.random() * 1000) / speed;

        const el = makeLineEl(line, color);
        el.style.fontSize  = `${(10.5 + Math.random() * 2).toFixed(1)}px`;
        el.style.transform = `translate(${origin.x.toFixed(1)}px, ${origin.y.toFixed(1)}px)`;
        sprayLayer.appendChild(el);
        animateLine(el, origin.x, origin.y, Math.cos(rad) * px_s, Math.sin(rad) * px_s, dur);
      }, i * Math.round(180 / speed));
    });
  }

  // ── SVG face sync ──────────────────────────────────────────────────────────
  function applySvgFaces() {
    const leftChar  = OrbConfig.getCharacter('left');
    const rightChar = OrbConfig.getCharacter('right');
    const leftImg   = document.getElementById('orbFaceLeft');
    const rightImg  = document.getElementById('orbFaceRight');
    if (leftImg)  leftImg.setAttribute('href',  leftChar  ? leftChar.image  : '');
    if (rightImg) rightImg.setAttribute('href', rightChar ? rightChar.image : '');
  }

  // ── Public interface ────────────────────────────────────────────────────────
  function show(total, project) {
    logBuf.length = 0;
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
   * Trigger both character slots to speak for an event key.
   * Each slot independently resolves its phrase bank with its own args.
   * Right slot delayed 300ms so lines don't collide.
   * @param {string} key
   * @param {unknown[]} leftArgs
   * @param {unknown[]} rightArgs
   */
  function say(key, leftArgs, rightArgs) {
    const leftChar  = OrbConfig.getCharacter('left');
    const rightChar = OrbConfig.getCharacter('right');

    if (leftChar && leftChar.phrases) {
      const phraseKey = key === 'done' ? 'done_all' : key;
      const val = leftChar.phrases[phraseKey];
      const text = val ? resolveJsonPhrase(val, phraseKey, leftArgs || []) : '';
      if (text) sprayQuote('left', text);
    }

    setTimeout(() => {
      if (rightChar && rightChar.phrases) {
        const phraseKey = key === 'done' ? 'done_all' : key;
        const val = rightChar.phrases[phraseKey];
        const text = val ? resolveJsonPhrase(val, phraseKey, rightArgs || []) : '';
        if (text) sprayQuote('right', text);
      }
    }, 300);
  }

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
      const nm   = (r.name || '').substring(0, 30).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="${cls}">${icon} ${nm} ${ph} ${ms}</div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  return { show, hide, onCancel, say, announce, setCount, setCurrentName, setMeta, logResult, applySvgFaces };
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

    const characters = OrbConfig.getAllCharacters();
    const current    = OrbConfig.getCurrent();
    const colorMode  = OrbConfig.getColorMode();
    const speed      = OrbConfig.getSpeed();

    // ── Helpers ────────────────────────────────────────────────────────────
    const div  = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
    const span = (cls, txt) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; return s; };

    // ── Title row ──────────────────────────────────────────────────────────
    const titleRow  = div('orb-char-title-row');
    const titleEl   = div('orb-char-config-title'); titleEl.textContent = 'Orb Characters';
    const closeBtn  = document.createElement('button');
    closeBtn.className = 'orb-char-close'; closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.onclick = () => panel.remove();
    titleRow.append(titleEl, closeBtn);

    // ── Slot dropdowns ─────────────────────────────────────────────────────
    const slotsRow = div('orb-char-slots');

    const buildSlot = (slot, label) => {
      const wrapper  = div('orb-char-slot');
      const heading  = div('orb-char-slot-label'); heading.textContent = label;

      const preview  = document.createElement('img');
      preview.className = 'orb-char-preview'; preview.alt = 'Preview';
      const initChar = CHARACTER_REGISTRY[current[slot]];
      if (initChar && initChar.image) preview.src = initChar.image;

      const select  = document.createElement('select');
      select.className = 'orb-char-select';

      for (const ch of characters) {
        const opt = document.createElement('option');
        opt.value = ch.id; opt.textContent = ch.label || ch.name;
        if (ch.id === current[slot]) opt.selected = true;
        select.appendChild(opt);
      }

      const creditEl = div('orb-char-credit');
      creditEl.textContent = initChar ? (initChar.credit || '') : '';

      select.addEventListener('change', async () => {
        const ch = CHARACTER_REGISTRY[select.value];
        if (ch) { preview.src = ch.image || ''; creditEl.textContent = ch.credit || ''; }
        await OrbConfig.setSlot(slot, select.value).catch(console.warn);
        OrbController.applySvgFaces();
      });

      wrapper.append(heading, preview, select, creditEl);
      return wrapper;
    };

    slotsRow.append(buildSlot('left', '◀ Left slot'), buildSlot('right', 'Right slot ▶'));

    // ── Color mode ─────────────────────────────────────────────────────────
    const colorRow = div('orb-char-color-row');
    const colorLabel = div('orb-char-slot-label'); colorLabel.textContent = 'Spray color mode';

    const toggle = div('orb-color-toggle');
    for (const m of [
      { v: 'psychedelic', t: '🌈 Psychedelic (HSL rotation)' },
      { v: 'theme',       t: '🎨 Character theme colors'     },
    ]) {
      const btn = document.createElement('button');
      btn.className   = `orb-color-btn${colorMode === m.v ? ' active' : ''}`;
      btn.textContent = m.t;
      btn.addEventListener('click', async () => {
        toggle.querySelectorAll('.orb-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        await OrbConfig.setColorMode(m.v).catch(console.warn);
      });
      toggle.appendChild(btn);
    }

    const colorHint = div('orb-char-credit');
    colorHint.textContent = 'Psychedelic: vivid rotating HSL, always distinct. Theme: character palette.';
    colorRow.append(colorLabel, toggle, colorHint);

    // ── Speed dial ─────────────────────────────────────────────────────────
    const speedRow = div('orb-char-color-row');
    const speedLabel = div('orb-char-slot-label'); speedLabel.textContent = 'Spray speed';

    const speedControls = div('orb-speed-row');
    const turtle  = span('orb-speed-emoji', '🐢');
    const slider  = document.createElement('input');
    slider.type  = 'range'; slider.min = '0.4'; slider.max = '2.5';
    slider.step  = '0.1';   slider.value = String(speed);
    slider.className = 'orb-speed-slider';
    slider.setAttribute('aria-label', 'Spray speed');

    const rocketEl   = span('orb-speed-emoji', '🚀');
    const speedValue = span('orb-speed-value', `${speed.toFixed(1)}×`);

    slider.addEventListener('input', async () => {
      const v = parseFloat(slider.value);
      speedValue.textContent = `${v.toFixed(1)}×`;
      await OrbConfig.setSpeed(v).catch(console.warn);
    });

    speedControls.append(turtle, slider, rocketEl, speedValue);
    const speedHint = div('orb-char-credit');
    speedHint.textContent = '0.4× = slow + readable. 1.0× = default. 2.5× = rapid fire.';
    speedRow.append(speedLabel, speedControls, speedHint);

    // ── Dev hint ───────────────────────────────────────────────────────────
    const hint = div('orb-char-hint');
    hint.textContent = 'Add characters: drop folder in characters/ + add id to characters/index.json.';

    panel.append(titleRow, slotsRow, colorRow, speedRow, hint);
    document.body.appendChild(panel);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function handler() {
        panel.remove();
        document.removeEventListener('click', handler);
      });
    }, 0);
    panel.addEventListener('click', e => e.stopPropagation());
  }

  return { toggle: buildUI };
})();

// ============================================================================
// INIT — load characters, apply config, wire gear button
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load characters first, then config (config needs registry to validate slots)
  await loadCharacterRegistry();
  await OrbConfig.load();
  OrbController.applySvgFaces();

  const gearBtn = document.getElementById('piqOrbConfigBtn');
  if (gearBtn) {
    gearBtn.addEventListener('click', e => {
      e.stopPropagation();
      OrbCharacterConfig.toggle();
    });
  }
});

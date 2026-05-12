// PiQPull — Orb Phrases v1.0.0
// Pure phrase utilities: no DOM, no state, no side effects.
// Depends on: nothing. Load first.
// v1.0.0: extracted from orb-characters.js v1.9.0; callout key added to ARG_MAPS.

'use strict';

const LINE_SOFT_MAX = 44;
const LINE_HARD_MAX = 52;

// ── ARG_MAPS — token extractors for each phrase key ───────────────────────────
// Each function receives the args array passed to say(key, leftArgs, rightArgs)
// and returns a token object used by resolveJsonPhrase().

const ARG_MAPS = {
  init:        (a) => ({ n: a[0], proj: a[1] ? ` — routing to ${a[1]}` : '', t: a[0] }),
  fetching:    (a) => ({ name: cap(a[0]), n: a[1], t: a[2] }),
  callout:     (a) => ({ name: cap(a[0]) }),
  hasThink:    (a) => ({ n: a[0] }),
  hasArts:     (a) => ({ n: a[0] }),
  pushing:     (a) => ({ name: cap(a[0]), msgs: a[1], model: a[2] }),
  pushOk:      ()  => ({}),
  fetchFail:   (a) => ({ name: cap(a[0]), err: a[1] || '' }),
  pushFail:    (a) => ({ name: cap(a[0]) }),
  retrying:    (a) => ({ name: cap(a[0]), n: a[1] }),
  halfway:     (a) => ({ n: a[0], t: a[1], pct: Math.round((a[0] / (a[1] || 1)) * 100) }),
  nearEnd:     (a) => ({ left: a[0] }),
  done_all:    (a) => ({ ok: a[0], t: a[1] }),
  done_partial:(a) => ({ ok: a[0], t: a[1], missed: (a[1] || 0) - (a[0] || 0) }),
  tangent:     ()  => ({}),
  cancelled:   ()  => ({}),
  zipping:     ()  => ({}),
  zipDone:     ()  => ({}),
  log:         ()  => ({}),
};

/** Truncate to 24 chars — keeps phrase templates compact */
const cap = (s) => (s || '').substring(0, 24);

// ── Line splitting ────────────────────────────────────────────────────────────

/** @param {string} text @param {number} [softMax] @returns {string[]} */
function splitIntoLines(text, softMax) {
  const max = (typeof softMax === 'number' && softMax > 0) ? softMax : LINE_SOFT_MAX;
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const safe = w.length > LINE_HARD_MAX ? `${w.slice(0, LINE_HARD_MAX)}\u2026` : w;
    const tent = cur ? `${cur} ${safe}` : safe;
    if (tent.length <= max) { cur = tent; }
    else if (cur) { lines.push(cur); cur = safe; }
    else { lines.push(safe); cur = ''; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── Phrase template resolver ──────────────────────────────────────────────────

/**
 * Resolve a phrase value to a string. Supports three formats:
 *   string       → used as-is with token substitution
 *   string[]     → one picked at random
 *   mixed[]      → each element may be a string OR a {parts: string[][]} object;
 *                   when a {parts} object is picked, one item from each part-array is
 *                   joined with a space, giving combinatorial variety from small data.
 *
 * @param {unknown} phraseVal
 * @param {string} key
 * @param {unknown[]} args
 * @returns {string}
 */
function resolveJsonPhrase(phraseVal, key, args) {
  if (!phraseVal) return '';

  function _pick(v) {
    if (!v && v !== 0) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return _pick(v[Math.floor(Math.random() * v.length)]);
    if (typeof v === 'object' && Array.isArray(v.parts)) {
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

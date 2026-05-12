// PiQPull — Orb Colors v1.0.0
// Color system for spray words: psychedelic HSL rotation and character theme palettes.
// Depends on: nothing. Load after orb-phrases.js.
// v1.0.0: extracted from orb-characters.js v1.9.0.

'use strict';

const ANNOUNCE_COLORS = {
  status: '#40ff90',
  error:  '#ff5040',
  warn:   '#ffc040',
};

// ── Internal color state ──────────────────────────────────────────────────────

let _psychHue = Math.random() * 360;
const _lastColorIdx = { left: -1, right: -1 };

// ── Color generators ──────────────────────────────────────────────────────────

/** Returns next psychedelic HSL color, advancing hue by 52–75 degrees. */
function _nextPsychColor() {
  _psychHue = (_psychHue + 52 + Math.random() * 23) % 360;
  return `hsl(${Math.round(_psychHue)}, 100%, ${Math.round(68 + Math.random() * 4)}%)`;
}

/**
 * Pick a color for a slot.
 * @param {'left'|'right'} slot
 * @param {string[]|null} colors - character theme palette
 * @param {'psychedelic'|'theme'} mode
 * @returns {string}
 */
function _pickColor(slot, colors, mode) {
  if (mode === 'psychedelic' || !colors || colors.length === 0) return _nextPsychColor();
  if (colors.length === 1) return colors[0];
  let idx;
  do { idx = Math.floor(Math.random() * colors.length); }
  while (idx === _lastColorIdx[slot]);
  _lastColorIdx[slot] = idx;
  return colors[idx];
}

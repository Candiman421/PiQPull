// PiQPull — browse-voice-pool.js v1.0.0
// Pre-allocated letter object pool. No new/delete during the rAF loop.
// Pool size: 220 objects covers 4 sentences × ~30 chars × 2 characters.

'use strict';

const BBVoicePool = (() => {

  // Letter object fields (reset on acquire, never reallocated):
  //   live       — bool: in use
  //   ch         — string: single character
  //   t          — float [0,1]: travel progress
  //   rayEndX/Y  — float %: ray endpoint
  //   endCX/Y    — float %: end-circle center
  //   apexX/Y    — float %: mouth origin
  //   colorIdx   — int: index into character color palette
  //   which      — 'left'|'right': character slot
  //   minScale   — float
  //   maxScale   — float
  //   _sentence  — ref: back-reference for activeLetterCount decrement

  let _pool    = [];
  let _active  = 0;
  let _dropped = 0;

  function init(size) {
    _pool    = Array.from({ length: size }, () => ({ live: false }));
    _active  = 0;
    _dropped = 0;
  }

  function acquire() {
    for (let i = 0; i < _pool.length; i++) {
      if (!_pool[i].live) {
        _pool[i].live = true;
        _active++;
        return _pool[i];
      }
    }
    _dropped++;
    return null;   // pool exhausted — caller skips emission
  }

  function release(obj) {
    if (obj && obj.live) {
      obj.live      = false;
      obj._sentence = null;  // prevent GC-root retention
      _active--;
    }
  }

  function forEachActive(fn) {
    for (let i = 0; i < _pool.length; i++) {
      if (_pool[i].live) fn(_pool[i]);
    }
  }

  function releaseAll() {
    for (let i = 0; i < _pool.length; i++) {
      if (_pool[i].live) {
        _pool[i].live      = false;
        _pool[i]._sentence = null;
        _active--;
      }
    }
  }

  function stats() {
    return { active: _active, total: _pool.length, dropped: _dropped };
  }

  return { init, acquire, release, forEachActive, releaseAll, stats };
})();

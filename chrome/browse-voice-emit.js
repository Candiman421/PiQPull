// PiQPull — browse-voice-emit.js v1.0.0
// Sentence queue + letter emitter. One instance per character slot.
// Each sentence gets ONE fixed ray sampled at enqueue time.
// All letters of that sentence travel along the same ray, staggered by intervalMs.

'use strict';

/**
 * Creates a character emitter.
 * @param {'left'|'right'} which - character slot
 * @param {object} cfg - live VOICE_DEFAULTS reference (mutated by dev panel)
 */
function BBVoiceEmitter(which, cfg) {

  let _queue    = [];
  let _colorIdx = 0;

  function _cone()   { return which === 'left' ? cfg.bh : cfg.beavis; }
  function _colors() { return cfg.colors[which === 'left' ? 'bh' : 'beavis']; }

  function enqueue(text) {
    if (!text || !text.trim()) return;

    // Drop oldest if at capacity — keeps memory bounded
    if (_queue.length >= cfg.emit.maxSentences) _queue.shift();

    const cone = _cone();
    const endC = BBVoiceMath.endCenter(cone.apex, cone.xyAngle, cone.lengthPct);
    const ray  = BBVoiceMath.sampleRayEnd(cone.apex, cone.xyAngle, cone.lengthPct, cone.halfAngle);

    _queue.push({
      text:               text.toUpperCase(),
      letterIdx:          0,
      rayEndX:            ray.x,
      rayEndY:            ray.y,
      endCX:              endC.x,
      endCY:              endC.y,
      emitTimer:          0,
      colorIdx:           _colorIdx++ % _colors().length,
      complete:           false,
      activeLetterCount:  0,
    });
  }

  function update(deltaMs) {
    for (let s = 0; s < _queue.length; s++) {
      const sentence = _queue[s];
      if (sentence.complete) continue;

      sentence.emitTimer += deltaMs;
      if (sentence.emitTimer < cfg.emit.intervalMs) continue;

      sentence.emitTimer -= cfg.emit.intervalMs;

      // Skip spaces — advance letterIdx until non-space or end
      while (sentence.letterIdx < sentence.text.length &&
             sentence.text[sentence.letterIdx] === ' ') {
        sentence.letterIdx++;
      }

      if (sentence.letterIdx < sentence.text.length) {
        _emitLetter(sentence);
        sentence.letterIdx++;
      }

      if (sentence.letterIdx >= sentence.text.length) {
        sentence.complete = true;
      }
    }

    // Remove sentences whose letters have all finished
    _queue = _queue.filter(s => !(s.complete && s.activeLetterCount === 0));
  }

  function _emitLetter(sentence) {
    const obj = BBVoicePool.acquire();
    if (!obj) return;   // pool full — skip, don't crash

    sentence.activeLetterCount++;

    const cone     = _cone();
    obj.ch         = sentence.text[sentence.letterIdx];
    obj.t          = 0;
    obj.rayEndX    = sentence.rayEndX;
    obj.rayEndY    = sentence.rayEndY;
    obj.endCX      = sentence.endCX;
    obj.endCY      = sentence.endCY;
    obj.apexX      = cone.apex.x;
    obj.apexY      = cone.apex.y;
    obj.colorIdx   = sentence.colorIdx;
    obj.which      = which;
    obj.minScale   = cfg.emit.minScale;
    obj.maxScale   = cfg.emit.maxScale;
    obj._sentence  = sentence;
  }

  function flush() {
    _queue = [];
    // Live pool letters will release naturally when t >= 1 in the controller loop
  }

  function isTalking() { return _queue.length > 0; }

  return { enqueue, update, flush, isTalking };
}

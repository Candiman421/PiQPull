// PiQPull — browse-voice.js v2.0.0
// Controller. Canvas is position:fixed inset:0 — outside ALL stacking contexts.
// No clipping. No z-index interference from error panel or sphere children.
// v2.0.0: complete rewrite — px geometry, mode system (3d/cloud/simple),
//         sphere getBCR() per frame, curveFactor blend, testSpray(), flush().

'use strict';

const VOICE_DEFAULTS = {
  bh: {
    apex:       { x: 0.32, y: 0.38 },
    xyAngle:    -32,
    lengthPct:  0.42,
    halfAngle:  26,
  },
  beavis: {
    apex:       { x: 0.70, y: 0.62 },
    xyAngle:    -148,
    lengthPct:  0.42,
    halfAngle:  26,
  },
  emit: {
    intervalMs:   150,     // ms between letters
    letterLifeMs: 3500,    // total travel time
    maxSentences: 2,       // simultaneous sentences per character
    staggerDelay: 700,     // ms between sentence start times
    accel:        0.25,    // velocity acceleration factor
    curveFactor:  0.0,     // 0=straight, 1=full quadratic curve
    alphaIn:      0.10,    // t at which full opacity reached
    alphaOut:     0.88,    // t at which fade-out begins
    baseFontPx:   12,
    minScale:     0.7,
    maxScale:     7.5,
    poolSize:     160,
  },
  visual: {
    shadowBlur: 0,         // 0=crisp text, up to 8 for glow
  },
  colors: {
    bh:     ['#6aadff', '#44ddcc', '#ccddff', '#88aaee'],
    beavis: ['#ff8800', '#ffdd00', '#ff4422', '#ffaa00'],
  },
  perf: {
    mode:         '3d',    // '3d' | 'cloud' | 'simple'
    fpsThreshold: 15,
    fpsDuration:  5000,
  },
};

// ── Toast helpers (called from browse.html button onclick) ─────────────────────
function bbVoiceSwitch() {
  if (typeof BBVoice !== 'undefined') BBVoice.setMode('simple');
  var t = document.getElementById('bb-perf-toast');
  if (t) { t.dataset.dismissed = 'true'; t.style.display = 'none'; }
}
function bbVoiceKeep() {
  var t = document.getElementById('bb-perf-toast');
  if (t) { t.dataset.dismissed = 'true'; t.style.display = 'none'; }
}

const BBVoice = (() => {

  let _cfg        = null;
  let _leftEmit   = null;
  let _rightEmit  = null;
  let _rafId      = null;
  let _lastTime   = 0;
  let _fpsAccum   = 0;
  let _fpsCount   = 0;
  let _fps        = 60;
  let _slowMs     = 0;
  let _cvs        = null;
  let _devCvs     = null;
  let _devActive  = false;
  let _sphere     = null;
  let _sphereRect = null;   // cached, refreshed every 30 frames + on show/resize
  let _frameCount = 0;

  var suppressDOMSpray = false;   // set true in '3d' mode

  // ── Public API ─────────────────────────────────────────────────────────────

  function init(canvas, devCanvas, userCfg) {
    _cvs    = canvas;
    _devCvs = devCanvas;
    _cfg    = _deepMerge(JSON.parse(JSON.stringify(VOICE_DEFAULTS)), userCfg || {});

    BBVoicePool.init(_cfg.emit.poolSize);
    BBVoiceDraw.init(canvas);

    _sphere = document.querySelector('.piq-orb-sphere');

    const getSphereRect = () => _sphereRect || (_sphere ? _sphere.getBoundingClientRect() : null);

    _leftEmit  = BBVoiceEmitter('left',  _cfg, getSphereRect);
    _rightEmit = BBVoiceEmitter('right', _cfg, getSphereRect);

    // Watch orb modal visibility
    const modal = document.getElementById('piqOrbModal');
    if (modal && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        if (!modal.classList.contains('hidden')) setTimeout(_syncCanvas, 0);
      }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    window.addEventListener('resize', () => setTimeout(_syncCanvas, 0));

    _syncCanvas();
    _loadConfig();
  }

  function start() {
    if (_rafId) return;
    _lastTime = performance.now();
    _rafId    = requestAnimationFrame(_loop);
  }

  function stop() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  function resize() { setTimeout(_syncCanvas, 0); }

  function flush() {
    BBVoicePool.releaseAll();
    if (_leftEmit)  _leftEmit.flush();
    if (_rightEmit) _rightEmit.flush();
  }

  function onSay(slot, text) {
    if (!_cfg || _cfg.perf.mode !== '3d') return;
    if (!text || slot === 'center') return;
    if (slot === 'left')  _leftEmit.enqueue(text);
    if (slot === 'right') _rightEmit.enqueue(text);
  }

  function setMode(mode) {
    if (!_cfg) return;
    _cfg.perf.mode  = mode;
    suppressDOMSpray = (mode === '3d');

    if (mode === '3d') {
      if (_cvs) _cvs.style.display = '';
    } else if (mode === 'cloud') {
      flush();
      if (_cvs) { BBVoiceDraw.clear(); _cvs.style.display = 'none'; }
      if (_devCvs) _devCvs.style.display = 'none';
    } else {   // simple
      flush();
      if (_cvs) { BBVoiceDraw.clear(); _cvs.style.display = 'none'; }
      if (_devCvs) _devCvs.style.display = 'none';
    }
  }

  function enableDev(on) {
    _devActive = on;
    if (on) {
      setTimeout(_syncCanvas, 0);
      _devCvs.style.display       = '';
      _devCvs.style.pointerEvents = 'auto';
      BBVoiceDev.init(
        _devCvs,
        _cfg,
        _onConfChanged,
        () => _sphereRect
      );
    } else {
      _devCvs.style.display       = 'none';
      _devCvs.style.pointerEvents = 'none';
      BBVoiceDev.destroy();
    }
  }

  function saveConfig() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.sync.set({
      bbVoiceCfg:  { bh: _cfg.bh, beavis: _cfg.beavis },
      bbVoiceEmit: _cfg.emit,
      bbVoiceVisual: _cfg.visual,
      bbVoiceMode: _cfg.perf.mode,
    });
  }

  function resetConfig() {
    const def = JSON.parse(JSON.stringify(VOICE_DEFAULTS));
    _cfg.bh     = def.bh;
    _cfg.beavis = def.beavis;
    _cfg.emit   = def.emit;
    _cfg.visual = def.visual;
    if (_devActive) enableDev(true);
    saveConfig();
  }

  function testSpray() {
    // Fire a test sentence from both characters
    if (_cfg.perf.mode === '3d') {
      if (_leftEmit)  _leftEmit.enqueue('Uh huh huh! This is cool. Huh.');
      if (_rightEmit) _rightEmit.enqueue('Yeah yeah yeah! Heh heh heh! Fire!');
    }
  }

  // ── rAF Loop ───────────────────────────────────────────────────────────────

  function _loop(ts) {
    const deltaMs   = Math.min(ts - _lastTime, 100);
    _lastTime = ts;
    const deltaNorm = deltaMs / 16.667;

    _frameCount++;
    // Refresh sphere rect every 30 frames (~500ms) for smooth tracking
    if (_frameCount % 30 === 0 && _sphere) {
      _sphereRect = _sphere.getBoundingClientRect();
    }

    _trackFps(deltaMs);
    _checkPerf(deltaMs);

    const sr = _sphereRect;
    if (sr && sr.width) {
      if (_leftEmit)  _leftEmit.update(deltaMs, sr);
      if (_rightEmit) _rightEmit.update(deltaMs, sr);
    }

    BBVoiceDraw.clear();

    if (_cfg.perf.mode === '3d') {
      const sm = sr ? BBVoiceMath.sphereMin(sr) : 1;

      // Ghost cones (dev mode)
      if (_devActive && BBVoiceDev.showGhost() && sr) {
        BBVoiceDraw.drawConeGhost(_cfg.bh,     sr, 'rgba(100,180,255,0.65)');
        BBVoiceDraw.drawConeGhost(_cfg.beavis, sr, 'rgba(255,150,0,0.65)');
        BBVoiceDraw.drawDevHandles(BBVoiceDev.handles());
      }

      // Letter particles
      const cf = _cfg.emit.curveFactor;
      BBVoicePool.forEachActive(obj => {
        const vel = BBVoiceMath.letterVel(obj.t, _cfg.emit.letterLifeMs, _cfg.emit.accel);
        obj.t += vel * deltaNorm;

        if (obj.t >= 1.0) {
          if (obj._sentence) { obj._sentence.activeLetterCount--; }
          BBVoicePool.release(obj);
          return;
        }

        const pos = BBVoiceMath.letterPosPx(
          obj.apexX, obj.apexY,
          obj.rayX,  obj.rayY,
          obj.ecx,   obj.ecy,
          obj.t,     cf
        );
        obj.x     = pos.x;
        obj.y     = pos.y;
        obj.alpha = BBVoiceMath.letterAlpha(obj.t, _cfg.emit.alphaIn, _cfg.emit.alphaOut);
        obj.scale = BBVoiceMath.letterScale(obj.t, obj.minScale, obj.maxScale);

        BBVoiceDraw.drawLetter(obj, _cfg, _cfg.colors);
      });

      // HUD
      if (_devActive) {
        const s = BBVoicePool.stats();
        if (BBVoiceDev.showHUD()) BBVoiceDraw.drawHUD(s, _fps);
        BBVoiceDev.updateStats(s, _fps);
      }
    }

    _rafId = requestAnimationFrame(_loop);
  }

  // ── Canvas sync: fixed, full window, always above everything ──────────────

  function _syncCanvas() {
    if (!_cvs || !_devCvs) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (_cvs.width !== w || _cvs.height !== h) {
      _cvs.width     = w;
      _cvs.height    = h;
      _devCvs.width  = w;
      _devCvs.height = h;
      BBVoiceDraw.init(_cvs);   // re-init after canvas resize resets context
    }
    if (_sphere) {
      _sphereRect = _sphere.getBoundingClientRect();
    }
  }

  function _trackFps(deltaMs) {
    _fpsAccum += deltaMs; _fpsCount++;
    if (_fpsCount >= 60) {
      _fps = 1000 / (_fpsAccum / _fpsCount);
      _fpsAccum = 0; _fpsCount = 0;
    }
  }

  function _checkPerf(deltaMs) {
    if (_fps > 0 && _fps < _cfg.perf.fpsThreshold) {
      _slowMs += deltaMs;
      if (_slowMs >= _cfg.perf.fpsDuration) {
        _slowMs = 0;
        const t = document.getElementById('bb-perf-toast');
        if (t && t.dataset.dismissed !== 'true') t.style.display = 'flex';
      }
    } else { _slowMs = 0; }
  }

  function _onConfChanged(which, newConf) {
    if (which) _cfg[which] = newConf;
    // emit / visual are already mutated in-place by dev panel
  }

  function _loadConfig() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.sync.get(['bbVoiceCfg','bbVoiceEmit','bbVoiceVisual','bbVoiceMode'], result => {
      if (!result) return;
      if (result.bbVoiceCfg?.bh)     Object.assign(_cfg.bh,     result.bbVoiceCfg.bh);
      if (result.bbVoiceCfg?.beavis) Object.assign(_cfg.beavis, result.bbVoiceCfg.beavis);
      if (result.bbVoiceEmit)        Object.assign(_cfg.emit,   result.bbVoiceEmit);
      if (result.bbVoiceVisual)      Object.assign(_cfg.visual, result.bbVoiceVisual);
      if (result.bbVoiceMode)        setMode(result.bbVoiceMode);
    });
  }

  function _deepMerge(base, override) {
    for (const k of Object.keys(override)) {
      if (override[k] !== null && typeof override[k] === 'object' && !Array.isArray(override[k]) &&
          base[k]     !== null && typeof base[k]     === 'object') {
        _deepMerge(base[k], override[k]);
      } else { base[k] = override[k]; }
    }
    return base;
  }

  return {
    init, start, stop, onSay, setMode, flush, enableDev,
    saveConfig, resetConfig, resize, testSpray,
    get suppressDOMSpray() { return suppressDOMSpray; },
    set suppressDOMSpray(v) { suppressDOMSpray = v; },
  };
})();
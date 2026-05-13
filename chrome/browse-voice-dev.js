// PiQPull — browse-voice-dev.js v1.1.0
// Dev panel: floating config panel + drag handles on overlay canvas.
// v1.1.0: added "Suppress DOM spray" checkbox; wired to BBVoice.suppressDOMSpray flag.

'use strict';

const BBVoiceDev = (() => {

  let _devCvs, _onChanged, _confs;
  let _drag  = { active: false };
  let _panel = null;
  const HANDLE_R = 12;

  const CTRL_DEFS = [
    { key: 'apex.x',    label: 'Apex X',     min: 0,    max: 1,   step: 0.005 },
    { key: 'apex.y',    label: 'Apex Y',     min: 0,    max: 1,   step: 0.005 },
    { key: 'xyAngle',   label: 'Axis °',     min: -180, max: 180, step: 1     },
    { key: 'lengthPct', label: 'Length',     min: 0.05, max: 0.9, step: 0.01  },
    { key: 'halfAngle', label: 'Spread °',   min: 2,    max: 65,  step: 0.5   },
  ];

  function init(devCanvas, configs, onChanged) {
    _devCvs    = devCanvas;
    _confs     = configs;
    _onChanged = onChanged;
    _devCvs.style.pointerEvents = 'auto';
    _devCvs.addEventListener('pointerdown', _onDown);
    _devCvs.addEventListener('pointermove', _onMove);
    _devCvs.addEventListener('pointerup',   _onUp);
    if (!_panel) _buildPanel();
    _panel.style.display = '';
  }

  function destroy() {
    if (_devCvs) {
      _devCvs.removeEventListener('pointerdown', _onDown);
      _devCvs.removeEventListener('pointermove', _onMove);
      _devCvs.removeEventListener('pointerup',   _onUp);
      _devCvs.style.pointerEvents = 'none';
    }
    if (_panel) _panel.style.display = 'none';
  }

  function handles() {
    const result = [];
    [['left','bh'],['right','beavis']].forEach(([slot, key]) => {
      const c  = _confs[key];
      const ec = BBVoiceMath.endCenter(c.apex, c.xyAngle, c.lengthPct);
      const R  = BBVoiceMath.endRadius(c.lengthPct, c.halfAngle);
      const d  = BBVoiceMath.normDir(c.xyAngle);
      const p  = BBVoiceMath.perpVec(d.dx, d.dy);
      result.push({ x: c.apex.x,         y: c.apex.y,         type: 'apex',       which: key });
      result.push({ x: ec.x,             y: ec.y,             type: 'axisEnd',    which: key });
      result.push({ x: ec.x + p.dx * R,  y: ec.y + p.dy * R,  type: 'radiusEdge', which: key });
    });
    return result;
  }

  function _hitTest(px, py, vpW, vpH) {
    return handles().find(h =>
      Math.hypot(px - h.x * vpW, py - h.y * vpH) < HANDLE_R
    ) || null;
  }

  function _onDown(e) {
    const h = _hitTest(e.offsetX, e.offsetY, _devCvs.width, _devCvs.height);
    if (h) { _drag = { active: true, ...h }; _devCvs.setPointerCapture(e.pointerId); }
  }

  function _onMove(e) {
    if (!_drag.active) return;
    const vpW = _devCvs.width, vpH = _devCvs.height, vpMin = Math.min(vpW, vpH);
    const conf = _confs[_drag.which];

    if (_drag.type === 'apex') {
      conf.apex = BBVoiceMath.apexFromPointer(e.offsetX, e.offsetY, vpW, vpH);
    } else if (_drag.type === 'axisEnd') {
      const r       = BBVoiceMath.axisFromPointer(conf.apex, e.offsetX, e.offsetY, vpW, vpH, vpMin);
      conf.xyAngle  = r.xyAngle;
      conf.lengthPct = r.lengthPct;
    } else if (_drag.type === 'radiusEdge') {
      const ec = BBVoiceMath.endCenter(conf.apex, conf.xyAngle, conf.lengthPct);
      conf.halfAngle = BBVoiceMath.halfAngleFromPointer(ec, e.offsetX, e.offsetY, vpW, vpH, vpMin, conf.lengthPct);
    }
    _onChanged(_drag.which, conf);
    _syncPanel();
  }

  function _onUp() { _drag.active = false; }

  function _buildPanel() {
    _panel = document.createElement('div');
    _panel.id = 'bb-voice-dev-panel';
    _panel.innerHTML = `
      <div class="bvd-header" id="bvd-hdr">
        Voice Cone Dev
        <button onclick="BBVoiceDev.hide()" aria-label="Close">✕</button>
      </div>
      <div class="bvd-body">
        <div class="bvd-tabs">
          <button class="bvd-tab bvd-tab--active" data-which="bh">Butt-Head</button>
          <button class="bvd-tab" data-which="beavis">Beavis</button>
        </div>
        <div id="bvd-ctrls"></div>
        <div class="bvd-checks">
          <label title="Show ghost cone outline + handles on canvas"><input type="checkbox" id="bvd-ghost" checked> Ghost cone</label>
          <label title="Show pool/fps/drop stats on canvas"><input type="checkbox" id="bvd-hud"> HUD</label>
          <label title="Hide DOM word spray — show only canvas letters"><input type="checkbox" id="bvd-suppress" onchange="if(typeof BBVoice!=='undefined')BBVoice.suppressDOMSpray=this.checked"> Hide word spray</label>
        </div>
        <div class="bvd-actions">
          <button onclick="BBVoice.saveConfig()">Save</button>
          <button onclick="BBVoice.resetConfig()">Reset</button>
        </div>
        <div id="bvd-stats"></div>
        <div class="bvd-hint">
          Drag: ⬤=apex  →=direction+length  ⌀=spread<br>
          Coords: (0,0)=top-left  (1,1)=bottom-right<br>
          Axis: 0°=right  270°=up  180°=left  90°=down
        </div>
      </div>`;
    document.body.appendChild(_panel);

    _panel.querySelectorAll('.bvd-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _panel.querySelectorAll('.bvd-tab').forEach(b => b.classList.remove('bvd-tab--active'));
        btn.classList.add('bvd-tab--active');
        _renderControls(btn.dataset.which);
      });
    });

    // Panel dragging
    const hdr = _panel.querySelector('#bvd-hdr');
    let drag = false, ox = 0, oy = 0;
    hdr.addEventListener('mousedown', e => { drag = true; ox = e.clientX - _panel.offsetLeft; oy = e.clientY - _panel.offsetTop; });
    document.addEventListener('mousemove', e => { if (drag) { _panel.style.left = (e.clientX - ox) + 'px'; _panel.style.top = (e.clientY - oy) + 'px'; } });
    document.addEventListener('mouseup', () => { drag = false; });

    _renderControls('bh');
  }

  function _getVal(conf, key) {
    const p = key.split('.');
    return p.length === 2 ? conf[p[0]][p[1]] : conf[key];
  }
  function _setVal(conf, key, val) {
    const p = key.split('.');
    if (p.length === 2) conf[p[0]][p[1]] = val;
    else conf[key] = val;
  }

  function _renderControls(which) {
    const ctrl = document.getElementById('bvd-ctrls');
    if (!ctrl) return;
    const conf = _confs[which];
    ctrl.innerHTML = '';
    CTRL_DEFS.forEach(def => {
      const v   = _getVal(conf, def.key);
      const row = document.createElement('label');
      row.className = 'bvd-row';
      row.innerHTML = `<span>${def.label}</span>
        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${v}" data-key="${def.key}" data-which="${which}">
        <span class="bvd-val">${Number(v).toFixed(3)}</span>`;
      const slider = row.querySelector('input');
      slider.addEventListener('input', () => {
        const nv = parseFloat(slider.value);
        _setVal(_confs[which], def.key, nv);
        row.querySelector('.bvd-val').textContent = nv.toFixed(3);
        _onChanged(which, _confs[which]);
      });
      ctrl.appendChild(row);
    });
  }

  function _syncPanel() {
    const active = _panel && _panel.querySelector('.bvd-tab--active');
    if (active) _renderControls(active.dataset.which);
  }

  function updateStats(stats, fps) {
    const el = document.getElementById('bvd-stats');
    if (el) el.textContent = `Pool ${stats.active}/${stats.total}  FPS ${Math.round(fps)}  Drop ${stats.dropped}`;
  }

  function showGhost()  { const el = document.getElementById('bvd-ghost');  return el ? el.checked : true; }
  function showHUD()    { const el = document.getElementById('bvd-hud');    return el ? el.checked : false; }
  function hide()       { if (_panel) _panel.style.display = 'none'; }

  return { init, destroy, handles, updateStats, showGhost, showHUD, hide };
})();
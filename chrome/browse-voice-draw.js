// PiQPull — browse-voice-draw.js v1.1.0
// Canvas draw functions. Pure rendering — no state mutations.
// v1.1.0: added cone edge ghost lines (apex → end-circle rim × 2).

'use strict';

const BBVoiceDraw = (() => {

  let _cvs, _ctx;

  function init(canvas) {
    _cvs = canvas;
    _ctx = canvas.getContext('2d');
  }

  function clear() {
    _ctx.clearRect(0, 0, _cvs.width, _cvs.height);
  }

  function drawLetter(obj, colors, vpW, vpH, baseFontPx) {
    if (!obj.alpha || obj.alpha <= 0) return;
    const fs = baseFontPx * (obj.scale || 0);
    if (fs < 2) return;

    const px      = BBVoiceMath.toPx(obj.x, vpW);
    const py      = BBVoiceMath.toPx(obj.y, vpH);
    const palette = colors[obj.which === 'left' ? 'bh' : 'beavis'];
    const col     = palette[obj.colorIdx % palette.length];

    _ctx.save();
    _ctx.globalAlpha  = obj.alpha;
    _ctx.font         = `900 ${fs.toFixed(1)}px Impact,"Arial Black",sans-serif`;
    _ctx.textAlign    = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.shadowColor  = col;
    _ctx.shadowBlur   = fs * 0.3;
    _ctx.fillStyle    = col;
    _ctx.fillText(obj.ch, px, py);
    _ctx.restore();
  }

  /**
   * Ghost cone: apex dot + centerline + two edge lines + end circle.
   *
   * Edge lines go from apex to the two points at ±perpendicular from axis,
   * at the end-circle radius. This makes the cone shape fully visible.
   *
   *    apex●
   *         ╲─────────────────── edge line 1
   *          ──────────────────── centerline ──●endCenter
   *         ╱─────────────────── edge line 2
   *                              ○ end circle
   */
  function drawConeGhost(coneCfg, vpW, vpH, vpMin, color) {
    const ax   = BBVoiceMath.toPx(coneCfg.apex.x, vpW);
    const ay   = BBVoiceMath.toPx(coneCfg.apex.y, vpH);
    const ec   = BBVoiceMath.endCenter(coneCfg.apex, coneCfg.xyAngle, coneCfg.lengthPct);
    const ecx  = BBVoiceMath.toPx(ec.x, vpW);
    const ecy  = BBVoiceMath.toPx(ec.y, vpH);
    const R    = Math.max(6, BBVoiceMath.endRadius(coneCfg.lengthPct, coneCfg.halfAngle) * vpMin);

    const d    = BBVoiceMath.normDir(coneCfg.xyAngle);
    const perp = BBVoiceMath.perpVec(d.dx, d.dy);

    // End circle rim points (where edge lines terminate)
    const rim1x = ecx + perp.dx * R,  rim1y = ecy + perp.dy * R;
    const rim2x = ecx - perp.dx * R,  rim2y = ecy - perp.dy * R;

    const baseAlpha  = color || 'rgba(255,255,255,0.35)';
    const edgeAlpha  = color || 'rgba(255,255,255,0.55)';

    _ctx.save();

    // ── Edge lines (most useful for understanding cone shape) ────────────────
    _ctx.strokeStyle = edgeAlpha;
    _ctx.lineWidth   = 1.2;
    _ctx.setLineDash([4, 4]);

    _ctx.beginPath();
    _ctx.moveTo(ax, ay); _ctx.lineTo(rim1x, rim1y);
    _ctx.stroke();

    _ctx.beginPath();
    _ctx.moveTo(ax, ay); _ctx.lineTo(rim2x, rim2y);
    _ctx.stroke();

    // ── Centerline ────────────────────────────────────────────────────────────
    _ctx.strokeStyle = baseAlpha;
    _ctx.lineWidth   = 1.6;
    _ctx.setLineDash([6, 4]);

    _ctx.beginPath();
    _ctx.moveTo(ax, ay); _ctx.lineTo(ecx, ecy);
    _ctx.stroke();

    // ── End circle ────────────────────────────────────────────────────────────
    _ctx.lineWidth = 1.4;
    _ctx.beginPath();
    _ctx.arc(ecx, ecy, R, 0, Math.PI * 2);
    _ctx.stroke();

    _ctx.setLineDash([]);

    // ── Apex dot ──────────────────────────────────────────────────────────────
    _ctx.fillStyle = edgeAlpha;
    _ctx.beginPath();
    _ctx.arc(ax, ay, 6, 0, Math.PI * 2);
    _ctx.fill();

    // ── End center dot ────────────────────────────────────────────────────────
    _ctx.fillStyle = baseAlpha;
    _ctx.beginPath();
    _ctx.arc(ecx, ecy, 3, 0, Math.PI * 2);
    _ctx.fill();

    _ctx.restore();
  }

  function drawDevHandles(handles, vpW, vpH) {
    const LABELS = { apex: '⬤', axisEnd: '→', radiusEdge: '⌀' };
    handles.forEach(h => {
      const px = BBVoiceMath.toPx(h.x, vpW);
      const py = BBVoiceMath.toPx(h.y, vpH);
      _ctx.save();
      _ctx.strokeStyle = h.active ? '#fff' : 'rgba(255,255,255,0.5)';
      _ctx.lineWidth   = h.active ? 2.5 : 1.2;
      _ctx.fillStyle   = 'rgba(255,255,255,0.09)';
      _ctx.beginPath();
      _ctx.arc(px, py, 11, 0, Math.PI * 2);
      _ctx.fill(); _ctx.stroke();
      _ctx.fillStyle = 'rgba(255,255,255,0.55)';
      _ctx.font      = '9px monospace';
      _ctx.textAlign = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(LABELS[h.type] || '?', px, py);
      _ctx.restore();
    });
  }

  function drawHUD(stats, fps) {
    _ctx.save();
    _ctx.font = '10px monospace'; _ctx.textAlign = 'right';
    _ctx.fillStyle = 'rgba(255,255,255,0.45)';
    _ctx.fillText(`Pool:${stats.active}/${stats.total}  FPS:${Math.round(fps)}  Drop:${stats.dropped}`, _cvs.width - 6, 15);
    _ctx.restore();
  }

  return { init, clear, drawLetter, drawConeGhost, drawDevHandles, drawHUD };
})();
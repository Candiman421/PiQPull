// PiQPull — browse-voice-math.js v1.1.0
// Pure geometry for the cone letter system. No DOM. No state. No side effects.
// v1.1.0: letterAlpha extended — full opacity 10%→90%, fast fade last 10%.
// Angle convention: degrees, screen-space: 0=right, 90=down, 180=left, 270=up.

'use strict';

const BBVoiceMath = (() => {

  const toPx     = (pct, dim) => pct * dim;
  const fromPx   = (px,  dim) => px  / dim;
  const clamp    = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const perpVec  = (dx, dy)   => ({ dx: -dy, dy: dx });

  const normDir = (deg) => {
    const r = deg * Math.PI / 180;
    return { dx: Math.cos(r), dy: Math.sin(r) };
  };

  const endCenter = (apex, xyAngle, lengthPct) => {
    const d = normDir(xyAngle);
    return { x: apex.x + lengthPct * d.dx, y: apex.y + lengthPct * d.dy };
  };

  const endRadius = (lengthPct, halfAngle) =>
    lengthPct * Math.tan(halfAngle * Math.PI / 180);

  const sampleRayEnd = (apex, xyAngle, lengthPct, halfAngle) => {
    const ec  = endCenter(apex, xyAngle, lengthPct);
    const R   = endRadius(lengthPct, halfAngle);
    const psi = Math.random() * 2 * Math.PI;
    const r   = Math.sqrt(Math.random()) * R;
    return { x: ec.x + r * Math.cos(psi), y: ec.y + r * Math.sin(psi) };
  };

  const letterPos = (apex, rayEnd, endC, t) => ({
    x: apex.x + t * (endC.x - apex.x) + t * t * (rayEnd.x - endC.x),
    y: apex.y + t * (endC.y - apex.y) + t * t * (rayEnd.y - endC.y),
  });

  const letterScale = (t, minS, maxS) =>
    minS + Math.pow(t, 2.5) * (maxS - minS);

  /**
   * Alpha curve: ramp-in 0–10%, full opacity 10–90%, fast fade 90–100%.
   * Letters stay visible for 80% of their travel — only vanish at the very end.
   */
  const letterAlpha = (t) => {
    if (t < 0.10) return t / 0.10;
    if (t > 0.90) return Math.max(0, (1.0 - t) / 0.10);
    return 1.0;
  };

  const letterVel = (t, lifeMs) => {
    const base = 1 / (lifeMs / 16.667);
    return base + t * 0.4 * base;
  };

  const apexFromPointer = (px, py, vpW, vpH) =>
    ({ x: clamp(px / vpW, 0, 1), y: clamp(py / vpH, 0, 1) });

  const axisFromPointer = (apex, px, py, vpW, vpH, vpMin) => {
    const vx = px / vpW - apex.x;
    const vy = py / vpH - apex.y;
    return {
      xyAngle:   Math.atan2(vy * vpH, vx * vpW) * 180 / Math.PI,
      lengthPct: clamp(Math.hypot(vx * vpW, vy * vpH) / vpMin, 0.05, 0.9),
    };
  };

  const halfAngleFromPointer = (ecPct, px, py, vpW, vpH, vpMin, lengthPct) => {
    const dist = Math.hypot(px - ecPct.x * vpW, py - ecPct.y * vpH);
    return clamp(Math.atan(dist / (lengthPct * vpMin)) * 180 / Math.PI, 2, 65);
  };

  return {
    toPx, fromPx, clamp, perpVec, normDir,
    endCenter, endRadius, sampleRayEnd,
    letterPos, letterScale, letterAlpha, letterVel,
    apexFromPointer, axisFromPointer, halfAngleFromPointer,
  };
})();
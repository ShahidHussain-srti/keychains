/* Keychain Studio. Copyright (C) 2026 shahidhussain2k13@gmail.com
 * SPDX-License-Identifier: GPL-3.0-or-later — see LICENSE. */
/* raster.js — every design element, rendered to an anti-aliased alpha mask.
 *
 * Working in mask space buys three things at once: 2-D booleans (so colours
 * never overlap in the mesh), polygon offsetting via the distance transform
 * (so borders follow any outline), and one geometry path shared by text,
 * uploads and freehand drawings.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var gridTransform = WB.gridTransform, ctxFor = WB.rasterCtx;

  /* ── plate outline ──────────────────────────────────────────────── */
  KC.drawPlate = function (ctx, state, t) {
    var sz = KC.plateSize(state);
    var p = state.shape.preset;

    if (WB.isBitmapShape(p)) {
      var src = KC.assets.customShape;
      if (!src) { WB.shapePath(ctx, 'rect', sz.w, sz.h, state.shape.radius, t); return false; }
      if (src._bbox === undefined) src._bbox = WB.contentBBox(src);
      var bb = src._bbox || { x: 0, y: 0, w: src.width, h: src.height };
      var k = Math.min(sz.w * t.s / bb.w, sz.h * t.s / bb.h);
      ctx.save();
      ctx.translate(t.ox, t.oy);
      ctx.scale(k, k);
      ctx.drawImage(src, bb.x, bb.y, bb.w, bb.h, -bb.w / 2, -bb.h / 2, bb.w, bb.h);
      ctx.restore();
      return true;   // already painted; caller must not fill()
    }
    WB.shapePath(ctx, p, sz.w, sz.h, state.shape.radius, t);
    return false;
  };

  KC.plateMask = function (state, g) {
    var o = ctxFor('plate', g);
    o.ctx.fillStyle = '#fff';
    o.ctx.beginPath();
    var painted = KC.drawPlate(o.ctx, state, gridTransform(g));
    if (!painted) o.ctx.fill();
    var m = WB.mask.fromCanvas(o.canvas);
    return WB.mask.sealEdges(m, g);
  };

  /* ── keyring hole ───────────────────────────────────────────────── */
  /* The requested position is a corner of the bounding box, which for a circle,
     triangle or hand-drawn blob can sit outside the plate entirely. So we take
     it as a direction, then slide inwards along it until the distance field
     says there is a full margin of material all the way round the hole. */
  var holeCache = { key: null, val: null };

  KC.holeCentre = function (state) {
    var sz = KC.plateSize(state);
    var r = state.hole.diameter / 2, m = state.hole.margin;

    /* Dragged by hand: take the position as given and let the checker complain
       if it runs off the edge, rather than fighting the user's pointer. */
    if (state.hole.position === 'custom') {
      return { x: state.hole.x, y: state.hole.y, r: r };
    }

    var x = 0, y = 0;
    switch (state.hole.position) {
      case 'tl': x = -sz.w / 2 + m + r; y = sz.h / 2 - m - r; break;
      case 'tc': x = 0;                 y = sz.h / 2 - m - r; break;
      case 'tr': x = sz.w / 2 - m - r;  y = sz.h / 2 - m - r; break;
      case 'lc': x = -sz.w / 2 + m + r; y = 0; break;
      case 'rc': x = sz.w / 2 - m - r;  y = 0; break;
    }

    // Rectangles always fit at the anchor; skip the distance field entirely.
    if (state.shape.preset === 'rect' || state.shape.preset === 'square') {
      return { x: x, y: y, r: r };
    }

    var key = [state.shape.preset, sz.w, sz.h, state.shape.radius, r, m, state.hole.position,
               (KC.assets.customShape && KC.assets.customShape._rev) || 0].join('|');
    if (holeCache.key === key) return holeCache.val;

    var val = fitHole(state, x, y, r, m);
    holeCache = { key: key, val: val };
    return val;
  };

  function fitHole(state, ax, ay, r, margin) {
    var g = KC.makeGrid(state, 6);          // coarse is plenty for placement
    var d = WB.sdf(KC.plateMask(state, g), g, true);   // only room inside matters
    var need = r + margin;

    function clearance(x, y) {
      var px = Math.round(g.px(x)), py = Math.round(g.py(y));
      if (px < 0 || py < 0 || px >= g.cols || py >= g.rows) return -999;
      return d[py * g.cols + px];
    }

    if (clearance(ax, ay) >= need) return { x: ax, y: ay, r: r };

    for (var i = 1; i <= 64; i++) {         // slide towards the centre
      var t = i / 64, x = ax * (1 - t), y = ay * (1 - t);
      if (clearance(x, y) >= need) {
        return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, r: r };
      }
    }
    return { x: 0, y: 0, r: r };            // nothing fits; the checker will flag it
  }

  KC.holeMask = function (state, g) {
    if (!state.hole.enabled) return null;
    var h = KC.holeCentre(state);
    var o = ctxFor('hole', g);
    o.ctx.fillStyle = '#fff';
    o.ctx.beginPath();
    o.ctx.arc(g.px(h.x), g.py(h.y), h.r * g.ppmm, 0, Math.PI * 2);
    o.ctx.fill();
    return WB.mask.fromCanvas(o.canvas);
  };

})(window.KC);

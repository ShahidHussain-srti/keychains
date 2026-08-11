/* shapes.js — parametric outlines.
 *
 * Every preset is expressed as a path in a canvas context using a caller
 * supplied mm→device transform, so the exact same code draws the export
 * raster, the preview, and the clipping region.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var TAU = Math.PI * 2;

  /* Regular n-gon inscribed in the unit box, point-up. */
  function ngon(n, rot) {
    var p = [];
    for (var i = 0; i < n; i++) {
      var a = rot + i * TAU / n;
      p.push([Math.cos(a), Math.sin(a)]);
    }
    return normalize(p);
  }

  function star(points, inner) {
    var p = [];
    for (var i = 0; i < points * 2; i++) {
      var a = -Math.PI / 2 + i * Math.PI / points;
      var r = i % 2 ? inner : 1;
      p.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return normalize(p);
  }

  function heart() {
    var p = [];
    for (var i = 0; i < 160; i++) {
      var t = i / 160 * TAU;
      var s = Math.sin(t);
      p.push([16 * s * s * s,
              13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
    }
    return normalize(p);
  }

  function shield() {
    // Right half: down the flank, then a quadratic sweep into the bottom tip.
    var right = [[1, 1], [1, 0.1]];
    for (var i = 1; i <= 24; i++) {
      var t = i / 24, mt = 1 - t;
      right.push([mt * mt + 2 * mt * t,
                  mt * mt * 0.1 + 2 * mt * t * -0.75 + t * t * -1]);
    }
    var p = [[-1, 1]].concat(right);
    for (var j = right.length - 2; j >= 1; j--) p.push([-right[j][0], right[j][1]]);
    return normalize(p);
  }

  /* Fit a point cloud into [-0.5,0.5]² preserving nothing — the caller scales
     each axis to the requested width/height. */
  function normalize(p) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < p.length; i++) {
      if (p[i][0] < minX) minX = p[i][0];
      if (p[i][0] > maxX) maxX = p[i][0];
      if (p[i][1] < minY) minY = p[i][1];
      if (p[i][1] > maxY) maxY = p[i][1];
    }
    var sx = 1 / (maxX - minX), sy = 1 / (maxY - minY);
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return p.map(function (q) { return [(q[0] - cx) * sx, (q[1] - cy) * sy]; });
  }

  var POLY = {
    tri:    function () { return ngon(3, Math.PI / 2); },
    pent:   function () { return ngon(5, Math.PI / 2); },
    hex:    function () { return ngon(6, Math.PI / 2); },
    oct:    function () { return ngon(8, Math.PI / 8); },
    star:   function () { return star(5, 0.44); },
    heart:  heart,
    shield: shield
  };

  /* Trace `pts` (device coords) with filleted corners of radius r. */
  function roundedPoly(ctx, pts, r) {
    var n = pts.length, i;
    if (r > 0.01) {
      var minEdge = Infinity;
      for (i = 0; i < n; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        var d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (d < minEdge) minEdge = d;
      }
      r = Math.min(r, minEdge * 0.499);
    }
    if (r <= 0.01) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      return;
    }
    var mid = function (a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    var start = mid(pts[n - 1], pts[0]);
    ctx.moveTo(start[0], start[1]);
    for (i = 0; i < n; i++) {
      var cur = pts[i], nxt = pts[(i + 1) % n], m = mid(cur, nxt);
      ctx.arcTo(cur[0], cur[1], m[0], m[1], r);
    }
    ctx.closePath();
  }

  function roundedRect(ctx, cx, cy, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.moveTo(cx - w / 2 + r, cy - h / 2);
    ctx.lineTo(cx + w / 2 - r, cy - h / 2);
    ctx.arcTo(cx + w / 2, cy - h / 2, cx + w / 2, cy - h / 2 + r, r);
    ctx.lineTo(cx + w / 2, cy + h / 2 - r);
    ctx.arcTo(cx + w / 2, cy + h / 2, cx + w / 2 - r, cy + h / 2, r);
    ctx.lineTo(cx - w / 2 + r, cy + h / 2);
    ctx.arcTo(cx - w / 2, cy + h / 2, cx - w / 2, cy + h / 2 - r, r);
    ctx.lineTo(cx - w / 2, cy - h / 2 + r);
    ctx.arcTo(cx - w / 2, cy - h / 2, cx - w / 2 + r, cy - h / 2, r);
    ctx.closePath();
  }

  /* Add `preset` to the current path, sized w×h mm and centred on (0,0) mm.
     `t` converts mm to device: {s, ox, oy} with y flipped. */
  KC.shapePath = function (ctx, preset, w, h, radius, t) {
    var s = t.s, cx = t.ox, cy = t.oy;
    var W = Math.abs(w * s), H = Math.abs(h * s), R = Math.max(0, (radius || 0) * s);
    if (W < 0.01 || H < 0.01) return;   // nothing sensible to draw

    switch (preset) {
      case 'square': H = W; roundedRect(ctx, cx, cy, W, H, R); return;
      case 'rect':   roundedRect(ctx, cx, cy, W, H, R); return;
      case 'pill':   roundedRect(ctx, cx, cy, W, H, Math.min(W, H) / 2); return;
      case 'circle': ctx.ellipse(cx, cy, W / 2, W / 2, 0, 0, TAU); return;
      case 'ellipse':ctx.ellipse(cx, cy, W / 2, H / 2, 0, 0, TAU); return;
      default: {
        var gen = POLY[preset];
        if (!gen) { roundedRect(ctx, cx, cy, W, H, R); return; }
        var unit = gen();
        var pts = unit.map(function (p) { return [cx + p[0] * W, cy - p[1] * H]; });
        // Organic outlines are already smooth; filleting them looks wrong.
        var fillet = (preset === 'heart') ? 0 : R;
        roundedPoly(ctx, pts, fillet);
        return;
      }
    }
  };

  /* Shapes whose silhouette comes from a user bitmap rather than a formula. */
  KC.isBitmapShape = function (preset) { return preset === 'custom'; };

  /* Tight bounding box of the opaque pixels of a canvas. */
  KC.contentBBox = function (canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    var minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (var y = 0; y < canvas.height; y++) {
      for (var x = 0; x < canvas.width; x++) {
        if (d[(y * canvas.width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };

})(window.KC);

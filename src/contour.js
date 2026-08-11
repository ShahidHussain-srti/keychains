/* contour.js — mask → polygons.
 *
 * Marching squares at iso 0.5 with linear interpolation along cell edges, so
 * the anti-aliased mask yields smooth sub-pixel outlines rather than stair
 * steps. Segments are stitched into closed loops by edge identity (never by
 * float coordinates), simplified with Douglas–Peucker, then nested so that
 * loops inside loops become holes.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var ISO = 0.5;

  /* Segment table, keyed by the 4-corner bitmask (8=TL 4=TR 2=BR 1=BL).
     Edges: 0=top 1=right 2=bottom 3=left. Each pair is [from, to], oriented so
     the filled region always lies to the right of travel. */
  var TABLE = [
    [],                 // 0
    [[3, 2]],           // 1  BL
    [[2, 1]],           // 2  BR
    [[3, 1]],           // 3  BL BR
    [[1, 0]],           // 4  TR
    null,               // 5  saddle
    [[2, 0]],           // 6  TR BR
    [[3, 0]],           // 7  TR BR BL
    [[0, 3]],           // 8  TL
    [[0, 2]],           // 9  TL BL
    null,               // 10 saddle
    [[0, 1]],           // 11 TL BL BR
    [[1, 3]],           // 12 TL TR
    [[1, 2]],           // 13 TL TR BL
    [[2, 3]],           // 14 TL TR BR
    []                  // 15
  ];

  /* Extract loops as arrays of {x,y} in millimetres. */
  function trace(mask, g) {
    var cols = g.cols, rows = g.rows;
    var segs = [];                 // {a, b, ax, ay, bx, by} — a/b are edge ids
    var edgesH = (rows) * (cols);  // id space for horizontal edges

    function hid(r, c) { return r * cols + c; }              // top edge of cell(r,c)
    function vid(r, c) { return edgesH + r * (cols + 1) + c; } // left edge of cell(r,c)

    // Position of a crossing on each of the four cell edges.
    var pt = [null, null, null, null];

    for (var r = 0; r < rows - 1; r++) {
      var row0 = r * cols, row1 = (r + 1) * cols;
      for (var c = 0; c < cols - 1; c++) {
        var tl = mask[row0 + c], tr = mask[row0 + c + 1],
            br = mask[row1 + c + 1], bl = mask[row1 + c];

        var idx = (tl >= ISO ? 8 : 0) | (tr >= ISO ? 4 : 0) | (br >= ISO ? 2 : 0) | (bl >= ISO ? 1 : 0);
        if (idx === 0 || idx === 15) continue;

        var list = TABLE[idx];
        if (list === null) {
          var center = (tl + tr + br + bl) * 0.25;
          if (idx === 5) list = center >= ISO ? [[3, 0], [1, 2]] : [[3, 2], [1, 0]];
          else           list = center >= ISO ? [[0, 1], [2, 3]] : [[0, 3], [2, 1]];
        }

        // Interpolated crossings (pixel coords).
        pt[0] = [c + frac(tl, tr), r];
        pt[1] = [c + 1, r + frac(tr, br)];
        pt[2] = [c + frac(bl, br), r + 1];
        pt[3] = [c, r + frac(tl, bl)];

        var ids = [hid(r, c), vid(r, c + 1), hid(r + 1, c), vid(r, c)];

        for (var s = 0; s < list.length; s++) {
          var e0 = list[s][0], e1 = list[s][1];
          segs.push({
            a: ids[e0], b: ids[e1],
            ax: pt[e0][0], ay: pt[e0][1],
            bx: pt[e1][0], by: pt[e1][1]
          });
        }
      }
    }

    if (!segs.length) return [];

    // Stitch: each crossing is the end of exactly one segment and the start of
    // exactly one other, so following `end → start` walks a closed loop.
    var byStart = new Map();
    for (var i = 0; i < segs.length; i++) {
      if (!byStart.has(segs[i].a)) byStart.set(segs[i].a, i);
    }

    var used = new Uint8Array(segs.length);
    var loops = [];

    for (var k = 0; k < segs.length; k++) {
      if (used[k]) continue;
      var loop = [];
      var cur = k, guard = 0;
      while (cur !== undefined && !used[cur] && guard++ < segs.length + 4) {
        used[cur] = 1;
        var sg = segs[cur];
        loop.push({ x: g.mmx(sg.ax), y: g.mmy(sg.ay) });
        cur = byStart.get(sg.b);
      }
      if (loop.length >= 3) loops.push(loop);
    }

    return loops;
  }

  function frac(a, b) {
    var d = b - a;
    if (Math.abs(d) < 1e-9) return 0.5;
    var t = (ISO - a) / d;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /* ── Douglas–Peucker on a closed ring ───────────────────────────── */
  function simplifyRing(pts, eps) {
    var n = pts.length;
    if (n < 8) return pts;

    // Anchor on the point farthest from pts[0] so the split is stable.
    var far = 0, fd = -1;
    for (var i = 1; i < n; i++) {
      var dx = pts[i].x - pts[0].x, dy = pts[i].y - pts[0].y, d = dx * dx + dy * dy;
      if (d > fd) { fd = d; far = i; }
    }

    var a = pts.slice(0, far + 1);
    var b = pts.slice(far).concat([pts[0]]);
    var ra = dp(a, eps), rb = dp(b, eps);
    var out = ra.concat(rb.slice(1, rb.length - 1));
    return out.length >= 3 ? out : pts;
  }

  function dp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    var keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]];

    while (stack.length) {
      var seg = stack.pop(), i0 = seg[0], i1 = seg[1];
      var p0 = pts[i0], p1 = pts[i1];
      var dx = p1.x - p0.x, dy = p1.y - p0.y;
      var len2 = dx * dx + dy * dy;
      var best = -1, bi = -1;

      for (var i = i0 + 1; i < i1; i++) {
        var p = pts[i], d;
        if (len2 < 1e-18) {
          var ex = p.x - p0.x, ey = p.y - p0.y;
          d = ex * ex + ey * ey;
        } else {
          var t = ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var qx = p0.x + t * dx - p.x, qy = p0.y + t * dy - p.y;
          d = qx * qx + qy * qy;
        }
        if (d > best) { best = d; bi = i; }
      }

      if (best > eps * eps && bi > 0) {
        keep[bi] = 1;
        stack.push([i0, bi], [bi, i1]);
      }
    }

    var out = [];
    for (var j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j]);
    return out;
  }

  function ringArea(r) {
    var s = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      s += (r[j].x * r[i].y - r[i].x * r[j].y);
    }
    return s / 2;   // >0 = counter-clockwise
  }

  function pointInRing(px, py, r) {
    var inside = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var yi = r[i].y, yj = r[j].y;
      if ((yi > py) !== (yj > py)) {
        var x = (r[j].x - r[i].x) * (py - yi) / (yj - yi) + r[i].x;
        if (px < x) inside = !inside;
      }
    }
    return inside;
  }

  /* mask → [{outer:[pts], holes:[[pts],…]}, …], outer CCW and holes CW. */
  KC.contours = function (mask, g, opts) {
    opts = opts || {};
    var eps = opts.eps != null ? opts.eps : 0.55 / g.ppmm;
    var minArea = opts.minArea != null ? opts.minArea : 0.02;   // mm²

    var loops = trace(mask, g);
    if (!loops.length) return [];

    var rings = [];
    for (var i = 0; i < loops.length; i++) {
      var r = simplifyRing(loops[i], eps);
      // Guard the triangulator against pathological loop sizes.
      var bump = eps;
      while (r.length > 4000) { bump *= 1.8; r = simplifyRing(loops[i], bump); }
      if (r.length < 3) continue;
      var a = ringArea(r);
      if (Math.abs(a) < minArea) continue;
      rings.push({ pts: r, area: a, abs: Math.abs(a) });
    }
    if (!rings.length) return [];

    // Nesting depth by containment count: even = solid, odd = hole.
    for (var m = 0; m < rings.length; m++) {
      var depth = 0, p = rings[m].pts[0];
      for (var n = 0; n < rings.length; n++) {
        if (n === m) continue;
        if (rings[n].abs > rings[m].abs && pointInRing(p.x, p.y, rings[n].pts)) depth++;
      }
      rings[m].depth = depth;
    }

    var polys = [], byRing = new Map();
    for (var q = 0; q < rings.length; q++) {
      if (rings[q].depth % 2 === 0) {
        orient(rings[q], true);                       // outer → CCW
        var poly = { outer: rings[q].pts, holes: [] };
        polys.push(poly);
        byRing.set(rings[q], poly);
      }
    }
    for (var h = 0; h < rings.length; h++) {
      if (rings[h].depth % 2 === 0) continue;
      // Parent = smallest even-depth ring that contains this one.
      var parent = null, pt0 = rings[h].pts[0];
      for (var t = 0; t < rings.length; t++) {
        if (rings[t].depth !== rings[h].depth - 1) continue;
        if (!pointInRing(pt0.x, pt0.y, rings[t].pts)) continue;
        if (!parent || rings[t].abs < parent.abs) parent = rings[t];
      }
      if (!parent) continue;
      orient(rings[h], false);                        // hole → CW
      byRing.get(parent).holes.push(rings[h].pts);
    }

    return polys;
  };

  function orient(ring, ccw) {
    if ((ring.area > 0) !== ccw) { ring.pts.reverse(); ring.area = -ring.area; }
  }

  KC.ringArea = ringArea;
})(window.KC);

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

  /* Transform passed to shape/preview drawing routines. */
  function gridTransform(g) { return { s: g.ppmm, ox: g.ox, oy: g.oy }; }
  KC.gridTransform = gridTransform;

  function ctxFor(key, g) {
    var c = KC.scratch(key, g.cols, g.rows);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, g.cols, g.rows);
    return { canvas: c, ctx: ctx };
  }

  /* ── plate outline ──────────────────────────────────────────────── */
  KC.drawPlate = function (ctx, state, t) {
    var sz = KC.plateSize(state);
    var p = state.shape.preset;

    if (KC.isBitmapShape(p)) {
      var src = KC.assets.customShape;
      if (!src) { KC.shapePath(ctx, 'rect', sz.w, sz.h, state.shape.radius, t); return false; }
      if (src._bbox === undefined) src._bbox = KC.contentBBox(src);
      var bb = src._bbox || { x: 0, y: 0, w: src.width, h: src.height };
      var k = Math.min(sz.w * t.s / bb.w, sz.h * t.s / bb.h);
      ctx.save();
      ctx.translate(t.ox, t.oy);
      ctx.scale(k, k);
      ctx.drawImage(src, bb.x, bb.y, bb.w, bb.h, -bb.w / 2, -bb.h / 2, bb.w, bb.h);
      ctx.restore();
      return true;   // already painted; caller must not fill()
    }
    KC.shapePath(ctx, p, sz.w, sz.h, state.shape.radius, t);
    return false;
  };

  KC.plateMask = function (state, g) {
    var o = ctxFor('plate', g);
    o.ctx.fillStyle = '#fff';
    o.ctx.beginPath();
    var painted = KC.drawPlate(o.ctx, state, gridTransform(g));
    if (!painted) o.ctx.fill();
    var m = KC.mask.fromCanvas(o.canvas);
    return KC.mask.sealEdges(m, g);
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
    var d = KC.sdf(KC.plateMask(state, g), g);
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
    return KC.mask.fromCanvas(o.canvas);
  };

  /* ── border ───────────────────────────────────────────────────────
     Built from a signed distance field so it hugs whatever outline it is given —
     including hand-drawn ones — with naturally rounded corners.

     Solid styles are distance bands. Broken styles (dashes, dots, ticks) are
     stroked along the traced centreline instead, because spacing them by angle
     from the plate centre bunches them at the corners of anything that isn't a
     circle. Canvas dash patterns run on arc length, which is what we want. */

  /* Each style is a list of [from, to] distances inward from the outline,
     expressed in multiples of the line width and the gap. */
  KC.BORDER_STYLES = [
    ['none',      'None'],
    ['single',    'Single line'],
    ['double',    'Double line'],
    ['triple',    'Triple line'],
    ['thinthick', 'Thick + thin'],
    ['groove',    'Groove'],
    ['band',      'Thick band'],
    ['dashed',    'Dashed'],
    ['dotted',    'Dotted'],
    ['dashdot',   'Dash-dot'],
    ['beads',     'Beads'],
    ['ticks',     'Ticks'],
    ['wave',      'Wave'],
    ['zigzag',    'Zigzag'],
    ['scallop',   'Scallop'],
    ['braid',     'Braid'],
    ['wavedash',  'Wavy dashes']
  ];

  var STROKED = { dashed: 1, dotted: 1, dashdot: 1, beads: 1, ticks: 1,
                  wave: 1, zigzag: 1, scallop: 1, braid: 1, wavedash: 1 };
  var WAVY = { wave: 'wave', zigzag: 'zigzag', scallop: 'scallop',
               braid: 'wave', wavedash: 'wave' };
  KC.isWavyBorder = function (style) { return !!WAVY[style]; };
  KC.isStrokedBorder = function (style) { return !!STROKED[style]; };

  /* Distance bands for the solid styles, measured inward from the outline. */
  function bandsFor(b) {
    var w = b.width, gap = b.gap, i0 = b.inset, out = [];
    switch (b.style) {
      case 'single': out.push([i0, i0 + w]); break;
      case 'double':
        out.push([i0, i0 + w], [i0 + w + gap, i0 + 2 * w + gap]);
        break;
      case 'triple':
        out.push([i0, i0 + w],
                 [i0 + w + gap, i0 + 2 * w + gap],
                 [i0 + 2 * w + 2 * gap, i0 + 3 * w + 2 * gap]);
        break;
      case 'thinthick':
        out.push([i0, i0 + w * 1.8], [i0 + w * 1.8 + gap, i0 + w * 2.4 + gap]);
        break;
      case 'groove':
        out.push([i0, i0 + w * 0.45],
                 [i0 + w * 0.45 + gap * 0.6, i0 + w * 0.9 + gap * 0.6]);
        break;
      case 'band': out.push([i0, i0 + w * 2.4]); break;
      default: out.push([i0, i0 + w]);
    }
    return out;
  }

  /* Trace the isoline of a signed distance field at `dist` mm inside. */
  function isoline(d, g, dist) {
    var m = new Float32Array(d.length), aa = 1 / g.ppmm;
    for (var i = 0; i < d.length; i++) m[i] = KC.clamp((d[i] - dist) / aa + 0.5, 0, 1);
    KC.mask.sealEdges(m, g);
    return KC.contours(m, g, { eps: 0.3 / g.ppmm, minArea: 0.4 });
  }

  function ringPerimeter(r) {
    var p = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      p += Math.hypot(r[i].x - r[j].x, r[i].y - r[j].y);
    }
    return p;
  }

  /* Walk a closed ring at fixed arc-length steps, calling back with the point
     and unit tangent. Used for ticks, which canvas dashes can't draw. */
  function walkRing(r, step, fn) {
    var acc = 0, next = step / 2;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var ax = r[j].x, ay = r[j].y, bx = r[i].x, by = r[i].y;
      var len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-9) continue;
      while (next <= acc + len) {
        var t = (next - acc) / len;
        fn(ax + (bx - ax) * t, ay + (by - ay) * t,
           (bx - ax) / len, (by - ay) / len, next);
        next += step;
      }
      acc += len;
    }
  }

  /* Periodic profiles, all normalised to [-1, 1] over one cycle. */
  function profile(kind, ph) {
    switch (kind) {
      case 'zigzag':  return 4 * Math.abs(ph - Math.floor(ph + 0.5)) - 1;
      case 'scallop': return 2 * Math.abs(Math.sin(Math.PI * ph)) - 1;
      default:        return Math.sin(2 * Math.PI * ph);
    }
  }

  /* Push a ring sideways by a periodic amount to make a wave. The cycle count
     is a whole number per loop, so the pattern closes seamlessly instead of
     showing a step where the phase wraps. */
  function displaceRing(ring, cycles, amp, kind, flip) {
    var per = ringPerimeter(ring);
    if (per < 1) return ring;
    var step = Math.max(0.08, per / 700);
    var pts = [];
    walkRing(ring, step, function (x, y, tx, ty, sAt) {
      var f = profile(kind, (sAt / per) * cycles) * (flip ? -1 : 1);
      pts.push({ x: x - ty * amp * f, y: y + tx * amp * f });
    });
    return pts.length > 3 ? pts : ring;
  }

  function strokedBorder(state, g, d, dist) {
    var b = state.border;
    var polys = isoline(d, g, dist);
    if (!polys.length) return null;

    var o = ctxFor('bstroke', g);
    var ctx = o.ctx;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineJoin = 'round';

    var count = Math.max(2, Math.round(b.dashes));

    polys.forEach(function (poly) {
      [poly.outer].concat(poly.holes).forEach(function (ring) {
        if (ring.length < 3) return;
        var per = ringPerimeter(ring);
        if (per < 1) return;
        var pitch = per / count;                   // one repeat per dash

        if (b.style === 'ticks') {
          // short strokes across the outline, at right angles to it
          ctx.lineCap = 'butt';
          ctx.lineWidth = Math.max(0.35, b.width * 0.7) * g.ppmm;
          var half = Math.max(b.width, b.gap * 1.2) * 0.5 * g.ppmm;
          ctx.beginPath();
          walkRing(ring, pitch, function (x, y, tx, ty) {
            var nx = -ty, ny = tx;                 // outward-ish normal
            var px = g.px(x), py = g.py(y);
            // tangent is in mm space with y up; flip y for pixels
            var dx = nx * half, dy = -ny * half;
            ctx.moveTo(px - dx, py - dy);
            ctx.lineTo(px + dx, py + dy);
          });
          ctx.stroke();
          return;
        }

        if (WAVY[b.style]) {
          var cycles = Math.max(3, Math.round(count));
          var amp = Math.max(0.2, b.gap);
          ctx.lineCap = 'round';
          ctx.lineWidth = b.width * g.ppmm;
          // a braid is the same wave twice, in antiphase
          var passes = b.style === 'braid' ? [false, true] : [false];
          passes.forEach(function (flip) {
            var w = displaceRing(ring, cycles, amp, WAVY[b.style], flip);
            if (b.style === 'wavedash') {
              ctx.setLineDash([Math.max(0.001, pitch * 0.55 * g.ppmm),
                               Math.max(0.001, pitch * 0.45 * g.ppmm)]);
            }
            ctx.beginPath();
            ctx.moveTo(g.px(w[0].x), g.py(w[0].y));
            for (var q = 1; q < w.length; q++) ctx.lineTo(g.px(w[q].x), g.py(w[q].y));
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
          });
          return;
        }

        // everything else is an arc-length dash pattern along the centreline
        var lw, pattern, cap;
        if (b.style === 'dotted') {
          lw = b.width; cap = 'round';
          pattern = [0.001, pitch];                // round caps make the dots
        } else if (b.style === 'beads') {
          lw = b.width * 1.7; cap = 'round';
          pattern = [0.001, pitch];
        } else if (b.style === 'dashdot') {
          lw = b.width; cap = 'butt';
          var dash = pitch * 0.44, dot = Math.min(lw, pitch * 0.08), sp = (pitch - dash - dot) / 2;
          pattern = [dash, sp, dot, sp];
        } else {                                    // dashed
          lw = b.width; cap = 'butt';
          pattern = [pitch * 0.6, pitch * 0.4];
        }

        ctx.lineCap = cap;
        ctx.lineWidth = lw * g.ppmm;
        ctx.setLineDash(pattern.map(function (v) { return Math.max(0.001, v * g.ppmm); }));
        ctx.beginPath();
        ctx.moveTo(g.px(ring[0].x), g.py(ring[0].y));
        for (var k = 1; k < ring.length; k++) ctx.lineTo(g.px(ring[k].x), g.py(ring[k].y));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      });
    });

    return KC.mask.sealEdges(KC.mask.fromCanvas(o.canvas), g);
  }

  KC.borderMask = function (state, g, plate) {
    var b = state.border;
    if (b.style === 'none') return null;

    var follow = b.shape === 'follow';
    var src, centred;

    if (follow) {
      src = plate;
      centred = false;
    } else {
      var sz = KC.plateSize(state);
      var w = Math.max(2, sz.w - 2 * b.inset), h = Math.max(2, sz.h - 2 * b.inset);
      var o = ctxFor('bshape', g);
      o.ctx.fillStyle = '#fff';
      o.ctx.beginPath();
      KC.shapePath(o.ctx, b.shape, w, h, b.radius, gridTransform(g));
      o.ctx.fill();
      src = KC.mask.sealEdges(KC.mask.fromCanvas(o.canvas), g);
      centred = true;     // bands straddle the outline instead of insetting
    }

    var d = KC.sdf(src, g);

    if (STROKED[b.style]) {
      // centreline sits half a line width inside the nominal inset, plus the
      // wave amplitude so the crests stay on the plate rather than clipping off
      var room = b.width / 2 + (WAVY[b.style] ? Math.max(0.2, b.gap) : 0);
      return strokedBorder(state, g, d, centred ? 0 : b.inset + room);
    }

    var bands = bandsFor(b);
    var n = d.length, out = new Float32Array(n), aa = 1 / g.ppmm;

    for (var i = 0; i < n; i++) {
      var v = 0, dv = centred ? Math.abs(d[i]) : d[i];
      for (var k = 0; k < bands.length; k++) {
        var lo = bands[k][0], hi = bands[k][1];
        if (centred) { lo = Math.max(0, lo - b.inset); hi = hi - b.inset; }
        var t = KC.band(dv, lo, hi, aa);
        if (t > v) v = t;
      }
      out[i] = v;
    }
    return out;
  };

  /* ── text ───────────────────────────────────────────────────────── */
  /* Also used by the preview, hence the colour/stroke parameters. */
  KC.drawText = function (ctx, state, t, style) {
    var tx = state.text;
    var content = (tx.content || '');
    if (!content.trim()) return null;

    var lines = content.split('\n');
    var px = tx.size * t.s;
    if (px < 1) return null;

    ctx.save();
    ctx.translate(t.ox + tx.x * t.s, t.oy - tx.y * t.s);
    ctx.rotate(-tx.rotation * Math.PI / 180);
    ctx.font = (tx.italic ? 'italic ' : '') + (tx.bold ? '700 ' : '400 ') + px + 'px ' +
               KC.fontByKey(KC.fontKey(tx.font)).css;
    ctx.textBaseline = 'middle';
    ctx.textAlign = tx.align;
    ctx.fillStyle = style.fill || '#fff';
    ctx.strokeStyle = style.fill || '#fff';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = tx.strokeWidth * t.s;

    var outline = tx.style === 'outline';
    var lh = px * tx.lineHeight;
    var top = -(lines.length - 1) * lh / 2;
    var track = tx.tracking * t.s;

    for (var i = 0; i < lines.length; i++) {
      var y = top + i * lh;
      if (Math.abs(track) < 0.01) {
        if (outline) ctx.strokeText(lines[i], 0, y); else ctx.fillText(lines[i], 0, y);
      } else {
        drawTracked(ctx, lines[i], y, track, tx.align, outline);
      }
    }
    ctx.restore();
    return true;
  };

  /* Letter-spacing done by hand so it behaves identically everywhere. */
  function drawTracked(ctx, line, y, track, align, outline) {
    var chars = Array.from(line);
    var widths = [], total = 0, i;
    for (i = 0; i < chars.length; i++) {
      widths[i] = ctx.measureText(chars[i]).width;
      total += widths[i];
    }
    total += track * Math.max(0, chars.length - 1);

    var x = align === 'center' ? -total / 2 : align === 'right' ? -total : 0;
    var prev = ctx.textAlign;
    ctx.textAlign = 'left';
    for (i = 0; i < chars.length; i++) {
      if (outline) ctx.strokeText(chars[i], x, y); else ctx.fillText(chars[i], x, y);
      x += widths[i] + track;
    }
    ctx.textAlign = prev;
  }

  KC.textMask = function (state, g) {
    if (!(state.text.content || '').trim()) return null;
    var o = ctxFor('text', g);
    var ok = KC.drawText(o.ctx, state, gridTransform(g), { fill: '#fff' });
    if (!ok) return null;
    return KC.mask.sealEdges(KC.mask.fromCanvas(o.canvas), g);
  };

  /* ── picture / drawing ──────────────────────────────────────────── */
  KC.artSource = function (state) {
    var a = state._assets || KC.assets.front;
    if (state.art.source === 'image') return a.image;
    if (state.art.source === 'draw') return a.drawing;
    return null;
  };

  /* Places the bitmap; returns the device-space box it occupies. */
  KC.artPlacement = function (state, t) {
    var src = KC.artSource(state);
    if (!src) return null;
    if (src._bbox === undefined) src._bbox = KC.contentBBox(src);
    var bb = src._bbox;
    if (!bb) return null;
    var k = state.art.size * t.s / Math.max(bb.w, bb.h);
    return { src: src, bb: bb, k: k,
             w: bb.w * k, h: bb.h * k,
             cx: t.ox + state.art.x * t.s, cy: t.oy - state.art.y * t.s };
  };

  KC.drawArt = function (ctx, state, t) {
    var p = KC.artPlacement(state, t);
    if (!p) return false;
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate(-state.art.rotation * Math.PI / 180);
    ctx.scale(state.art.mirror ? -p.k : p.k, p.k);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(p.src, p.bb.x, p.bb.y, p.bb.w, p.bb.h, -p.bb.w / 2, -p.bb.h / 2, p.bb.w, p.bb.h);
    ctx.restore();
    return true;
  };

  /* Decide how to turn pixels into a silhouette. Uploaded logos are usually
     either transparent PNGs or dark-on-white line art. */
  function resolveMode(state) {
    var mode = state.art.mode;
    if (state.art.source === 'draw') return 'alpha';
    if (mode !== 'auto') return mode;
    var src = (state._assets || KC.assets.front).image;
    if (!src) return 'alpha';
    if (src._hasAlpha == null) {
      var c = document.createElement('canvas');
      var w = c.width = Math.min(160, src.width), h = c.height = Math.min(160, src.height);
      var cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(src, 0, 0, w, h);
      var d = cx.getImageData(0, 0, w, h).data, transparent = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] < 240) transparent++;
      src._hasAlpha = transparent > (w * h) * 0.02;
    }
    return src._hasAlpha ? 'alpha' : 'dark';
  }
  KC.resolveArtMode = resolveMode;

  KC.artMask = function (state, g) {
    var src = KC.artSource(state);
    if (!src) return null;

    var o = ctxFor('art', g);
    if (!KC.drawArt(o.ctx, state, gridTransform(g))) return null;

    var mode = resolveMode(state);
    var img = o.ctx.getImageData(0, 0, g.cols, g.rows).data;
    var n = g.cols * g.rows, out = new Float32Array(n);

    if (mode === 'alpha') {
      for (var i = 0; i < n; i++) out[i] = img[i * 4 + 3] / 255;
    } else {
      var thr = state.art.threshold, soft = 0.09, dark = (mode === 'dark');
      for (var j = 0; j < n; j++) {
        var a = img[j * 4 + 3] / 255;
        if (a <= 0.004) { out[j] = 0; continue; }
        var lum = (0.2126 * img[j * 4] + 0.7152 * img[j * 4 + 1] + 0.0722 * img[j * 4 + 2]) / 255;
        var v = dark ? (thr - lum) : (lum - thr);
        out[j] = a * KC.clamp(v / soft + 0.5, 0, 1);
      }
    }
    return KC.mask.sealEdges(out, g);
  };

})(window.KC);

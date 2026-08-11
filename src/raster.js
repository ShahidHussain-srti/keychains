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

  /* ── border ─────────────────────────────────────────────────────── */
  /* Built from a signed distance field so it hugs whatever outline it is
     given — including hand-drawn ones — with naturally rounded corners. */
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
      centred = true;     // band straddles the outline instead of insetting
    }

    var d = KC.sdf(src, g);
    var n = d.length, out = new Float32Array(n);
    var aa = 1 / g.ppmm;
    var w1 = b.width;

    var lo1, hi1, lo2, hi2, two = false;
    if (centred) {
      lo1 = -w1 / 2; hi1 = w1 / 2;
      if (b.style === 'double') {
        two = true;                                  // one ring either side
        lo1 = b.gap / 2; hi1 = b.gap / 2 + w1;
        lo2 = -(b.gap / 2 + w1); hi2 = -b.gap / 2;
      }
    } else {
      lo1 = b.inset; hi1 = b.inset + w1;
      if (b.style === 'double') {
        two = true;
        lo2 = b.inset + w1 + b.gap; hi2 = b.inset + w1 + b.gap + w1;
      }
    }
    if (b.style === 'band') { hi1 = lo1 + Math.max(w1, b.width * 2.2); }

    for (var i = 0; i < n; i++) {
      var v = KC.band(d[i], lo1, hi1, aa);
      if (two) v = Math.max(v, KC.band(d[i], lo2, hi2, aa));
      out[i] = v;
    }

    // Dashes / dots are cut out by an angular comb around the plate centre.
    if (b.style === 'dashed' || b.style === 'dotted') {
      var duty = b.style === 'dotted' ? 0.34 : 0.62;
      var cnt = b.dashes;
      for (var y = 0, k = 0; y < g.rows; y++) {
        for (var x = 0; x < g.cols; x++, k++) {
          if (out[k] <= 0) continue;
          var mx = g.mmx(x), my = g.mmy(y);
          var ph = (Math.atan2(my, mx) / (Math.PI * 2) + 1) % 1;
          var f = (ph * cnt) % 1;
          // soft edges on the dash so the traced contour stays smooth
          var e = 0.07;
          var a = Math.min(f / e, (duty - f) / e, 1);
          out[k] *= KC.clamp(a, 0, 1);
        }
      }
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
               KC.FONTS[tx.font % KC.FONTS.length].css;
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
    if (state.art.source === 'image') return KC.assets.image;
    if (state.art.source === 'draw') return KC.assets.drawing;
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
    var src = KC.assets.image;
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

/* preview.js — the Layout view: a crisp, vector-drawn top-down render you can
 * drag elements around in. Redraws on every keystroke, so it never touches the
 * mesh pipeline; the border ring is the one exception and is cached.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  function Preview(canvas, state, onChange) {
    this.canvas = canvas;
    this.state = state;
    this.onChange = onChange;
    this.hot = null;        // element under the cursor
    this.drag = null;
    this._ringCache = null;
    this._bind();
  }

  /* mm → CSS px for the current canvas size. */
  Preview.prototype.transform = function () {
    var sz = KC.plateSize(this.state);
    var W = Math.max(1, this.canvas.clientWidth), H = Math.max(1, this.canvas.clientHeight);
    // Padding has to shrink with the viewport, or a small canvas yields a
    // negative scale and every arcTo/ellipse downstream throws.
    var pad = Math.min(56, W * 0.12, H * 0.12);
    var s = Math.min((W - pad * 2) / Math.max(sz.w, 1), (H - pad * 2) / Math.max(sz.h, 1));
    s = KC.clamp(s, 0.2, 18);   // never negative; never blown up past legibility
    return { s: s, ox: W / 2, oy: H / 2 };
  };

  Preview.prototype.draw = function () {
    var canvas = this.canvas, state = this.state;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = canvas.clientWidth, H = canvas.clientHeight;
    if (W < 8 || H < 8) return;      // not laid out yet
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var t = this.transform();
    var pal = state.colors.palette;

    this._grid(ctx, W, H, t);

    // Compose the plate on its own layer so features can be clipped to it and
    // the keyring hole punched through everything at once.
    var lay = KC.scratch('prevlayer', Math.round(W * dpr), Math.round(H * dpr));
    var lc = lay.getContext('2d');
    lc.setTransform(dpr, 0, 0, dpr, 0, 0);
    lc.clearRect(0, 0, W, H);

    lc.fillStyle = pal[state.colors.base];
    lc.beginPath();
    var painted = KC.drawPlate(lc, state, t);
    if (painted) {
      // Bitmap outline: recolour the silhouette to the plate colour.
      lc.globalCompositeOperation = 'source-in';
      lc.fillStyle = pal[state.colors.base];
      lc.fillRect(0, 0, W, H);
      lc.globalCompositeOperation = 'source-over';
    } else {
      lc.fill();
    }

    // Features on a second layer, masked down to the plate silhouette.
    var feat = KC.scratch('prevfeat', Math.round(W * dpr), Math.round(H * dpr));
    var fc = feat.getContext('2d');
    fc.setTransform(dpr, 0, 0, dpr, 0, 0);
    fc.clearRect(0, 0, W, H);

    this._border(fc, t, W, H, dpr);
    if (state.art.source !== 'none') {
      var tint = pal[state.colors.art];
      var art = KC.scratch('prevart', Math.round(W * dpr), Math.round(H * dpr));
      var ac = art.getContext('2d');
      ac.setTransform(dpr, 0, 0, dpr, 0, 0);
      ac.clearRect(0, 0, W, H);
      if (KC.drawArt(ac, state, t)) {
        var mode = KC.resolveArtMode(state);
        if (mode !== 'alpha') {
          // Keep the picture readable while it is being thresholded.
          ac.globalCompositeOperation = 'source-atop';
          ac.fillStyle = tint;
          ac.globalAlpha = 0.55;
          ac.fillRect(0, 0, W, H);
          ac.globalAlpha = 1;
        } else {
          ac.globalCompositeOperation = 'source-in';
          ac.fillStyle = tint;
          ac.fillRect(0, 0, W, H);
        }
        ac.globalCompositeOperation = 'source-over';
        fc.drawImage(art, 0, 0, W, H);
      }
    }
    KC.drawText(fc, state, t, { fill: pal[state.colors.text] });

    fc.globalCompositeOperation = 'destination-in';
    fc.drawImage(lay, 0, 0, W, H);
    fc.globalCompositeOperation = 'source-over';

    lc.drawImage(feat, 0, 0, W, H);

    // Engraved details read as shadow, not as a second colour.
    if (state.shape.relief === 'engraved') {
      lc.globalCompositeOperation = 'source-atop';
      lc.fillStyle = 'rgba(0,0,0,0.22)';
      lc.fillRect(0, 0, W, H);
      lc.globalCompositeOperation = 'source-over';
    }

    if (state.hole.enabled) {
      var h = KC.holeCentre(state);
      lc.globalCompositeOperation = 'destination-out';
      lc.beginPath();
      lc.arc(t.ox + h.x * t.s, t.oy - h.y * t.s, h.r * t.s, 0, Math.PI * 2);
      lc.fill();
      lc.globalCompositeOperation = 'source-over';
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(lay, 0, 0, W, H);
    ctx.restore();

    this._handles(ctx, t);
    this._dims(ctx, t, W, H);
  };

  /* Background millimetre grid. */
  Preview.prototype._grid = function (ctx, W, H, t) {
    var step = t.s * 5;
    if (step < 8) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(128,142,164,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = t.ox % step; x < W; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (var y = t.oy % step; y < H; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
    ctx.restore();
  };

  /* Border ring, rasterised through the same SDF the exporter uses. Cached on
     the parameters that affect it so slider drags stay smooth. */
  Preview.prototype._border = function (ctx, t, W, H) {
    var state = this.state;
    if (state.border.style === 'none') return;

    var sz = KC.plateSize(state);
    var key = JSON.stringify([state.shape.preset, sz.w, sz.h, state.shape.radius,
                              state.border, state.colors.palette[state.colors.border],
                              state.shape.preset === 'custom' && KC.assets.customShape ? KC.assets.customShape._rev : 0]);

    if (!this._ringCache || this._ringCache.key !== key) {
      // Roughly matches the on-screen scale, so the ring isn't upscaled and soft.
      var ppmm = KC.clamp(900 / Math.max(sz.w, sz.h), 8, 18);
      var g = KC.makeGrid(state, ppmm);
      var plate = KC.plateMask(state, g);
      var ring = KC.borderMask(state, g, plate);
      var cv = document.createElement('canvas');
      cv.width = g.cols; cv.height = g.rows;
      if (ring) {
        var ictx = cv.getContext('2d');
        var img = ictx.createImageData(g.cols, g.rows);
        var rgb = KC.hexToRgb(state.colors.palette[state.colors.border]);
        var r = rgb[0] * 255, gg = rgb[1] * 255, b = rgb[2] * 255;
        for (var i = 0; i < ring.length; i++) {
          img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b;
          img.data[i * 4 + 3] = Math.round(ring[i] * 255);
        }
        ictx.putImageData(img, 0, 0);
      }
      this._ringCache = { key: key, canvas: cv, g: g };
    }

    var c = this._ringCache;
    var w = c.g.cols / c.g.ppmm * t.s, h = c.g.rows / c.g.ppmm * t.s;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c.canvas, t.ox - w / 2, t.oy - h / 2, w, h);
    ctx.restore();
    void W; void H;
  };

  /* ── hit boxes & drag ───────────────────────────────────────────── */
  Preview.prototype.boxes = function (t) {
    var state = this.state, out = [];

    if ((state.text.content || '').trim()) {
      var m = this._textMetrics(t);
      if (m) out.push({ key: 'text', cx: t.ox + state.text.x * t.s, cy: t.oy - state.text.y * t.s,
                        w: m.w, h: m.h, rot: -state.text.rotation * Math.PI / 180 });
    }
    var p = KC.artPlacement(state, t);
    if (p) out.push({ key: 'art', cx: p.cx, cy: p.cy, w: p.w, h: p.h,
                      rot: -state.art.rotation * Math.PI / 180 });
    return out;
  };

  Preview.prototype._textMetrics = function (t) {
    var tx = this.state.text;
    var lines = (tx.content || '').split('\n');
    var ctx = this.canvas.getContext('2d');
    var px = tx.size * t.s;
    ctx.save();
    ctx.font = (tx.italic ? 'italic ' : '') + (tx.bold ? '700 ' : '400 ') + px + 'px ' +
               KC.FONTS[tx.font % KC.FONTS.length].css;
    var w = 0;
    for (var i = 0; i < lines.length; i++) {
      var lw = ctx.measureText(lines[i]).width + tx.tracking * t.s * Math.max(0, lines[i].length - 1);
      if (lw > w) w = lw;
    }
    ctx.restore();
    var h = px * tx.lineHeight * lines.length;
    if (w < 4) return null;
    // Alignment shifts the box relative to the anchor point.
    var shift = tx.align === 'center' ? 0 : tx.align === 'right' ? -w / 2 : w / 2;
    return { w: w + 6, h: h + 4, shift: shift };
  };

  Preview.prototype.hitTest = function (x, y) {
    var t = this.transform();
    var boxes = this.boxes(t);
    for (var i = boxes.length - 1; i >= 0; i--) {
      var b = boxes[i];
      var dx = x - b.cx, dy = y - b.cy;
      var c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      var lx = dx * c - dy * s, ly = dx * s + dy * c;
      var extra = b.key === 'text' && this.state.text.align !== 'center'
        ? (this.state.text.align === 'left' ? b.w / 2 : -b.w / 2) : 0;
      if (Math.abs(lx - extra) <= b.w / 2 + 3 && Math.abs(ly) <= b.h / 2 + 3) return b.key;
    }
    return null;
  };

  Preview.prototype._handles = function (ctx, t) {
    var active = this.drag ? this.drag.key : this.hot;
    if (!active) return;
    var boxes = this.boxes(t);
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b.key !== active) continue;
      var off = b.key === 'text' && this.state.text.align !== 'center'
        ? (this.state.text.align === 'left' ? b.w / 2 : -b.w / 2) : 0;
      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.rotate(b.rot);
      ctx.strokeStyle = 'rgba(90,169,255,0.95)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(off - b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
  };

  Preview.prototype._dims = function (ctx, t, W, H) {
    var sz = KC.plateSize(this.state);
    ctx.save();
    ctx.fillStyle = 'rgba(140,155,175,0.75)';
    ctx.font = '11px "SF Mono",ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(sz.w.toFixed(1) + ' mm', t.ox, t.oy + sz.h / 2 * t.s + 24);
    ctx.translate(t.ox - sz.w / 2 * t.s - 20, t.oy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(sz.h.toFixed(1) + ' mm', 0, 0);
    ctx.restore();
    void W; void H;
  };

  Preview.prototype._bind = function () {
    var self = this, canvas = this.canvas;

    function local(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', function (e) {
      var p = local(e);
      var key = self.hitTest(p.x, p.y);
      if (!key) return;
      var t = self.transform();
      var el = self.state[key];
      self.drag = { key: key, dx: el.x - (p.x - t.ox) / t.s, dy: el.y + (p.y - t.oy) / t.s };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = local(e);
      if (!self.drag) {
        var h = self.hitTest(p.x, p.y);
        canvas.style.cursor = h ? 'grab' : 'default';
        if (h !== self.hot) { self.hot = h; self.draw(); }
        return;
      }
      var t = self.transform();
      var el = self.state[self.drag.key];
      var nx = (p.x - t.ox) / t.s + self.drag.dx;
      var ny = -(p.y - t.oy) / t.s + self.drag.dy;
      if (!e.altKey) {                        // snap to the centre lines
        if (Math.abs(nx) < 0.6) nx = 0;
        if (Math.abs(ny) < 0.6) ny = 0;
      }
      el.x = Math.round(nx * 20) / 20;
      el.y = Math.round(ny * 20) / 20;
      canvas.style.cursor = 'grabbing';
      self.draw();
      self.onChange(true);
    });

    var end = function (e) {
      if (!self.drag) return;
      self.drag = null;
      canvas.style.cursor = 'grab';
      if (e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      self.draw();
      self.onChange(false);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', function () {
      if (!self.drag && self.hot) { self.hot = null; self.draw(); }
    });
  };

  Preview.prototype.invalidateBorder = function () { this._ringCache = null; };

  KC.Preview = Preview;
})(window.KC);

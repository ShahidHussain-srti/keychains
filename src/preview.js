/* preview.js — the Layout view: a crisp, vector-drawn top-down render you can
 * drag elements around in. Redraws on every keystroke, so it never touches the
 * mesh pipeline; the border ring is the one exception and is cached.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  function Preview(canvas, state, onChange, onBeginEdit) {
    this.canvas = canvas;
    this.state = state;
    this.onChange = onChange;
    this.onBeginEdit = onBeginEdit || function () {};
    this.hot = null;        // element under the cursor
    this.selected = null;   // element clicked, movable with arrow keys
    this.drag = null;
    this.resize = null;
    this._ringCache = null;
    this._bind();
  }

  /* Elements that currently exist and can be picked. */
  Preview.prototype.movable = function (key) {
    if (key === 'hole') return this.state.hole.enabled;   // belongs to the plate
    var f = this.state.sides[this.state.activeSide];
    if (!f.enabled) return false;
    if (key === 'text') return !!(f.text.content || '').trim();
    if (key === 'art') return f.art.source !== 'none';
    return false;
  };

  /* Decoration lives on the active face; the hole is shared by both. */
  Preview.prototype.el = function (key) {
    return key === 'hole' ? this.state.hole : this.state.sides[this.state.activeSide][key];
  };

  /* Resizing writes to a different field per element, with the same limits the
     sliders use so the two can never disagree. */
  var SIZE = {
    text: { field: 'size',     min: 2, max: 40 },
    art:  { field: 'size',     min: 3, max: 120 },
    hole: { field: 'diameter', min: 2, max: 10 }
  };
  Preview.prototype.sizeSpec = function (key) { return SIZE[key]; };

  /* The back view mirrors the plate, so the hole drawn on it moves the opposite
     way to the pointer. Decoration is drawn unmirrored, so it is unaffected. */
  Preview.prototype.xSign = function (key) {
    return (key === 'hole' && this.state.activeSide === 'back') ? -1 : 1;
  };

  /* Dragging a preset hole switches it to a free position, seeded where it
     already sits so it doesn't jump under the cursor. */
  Preview.prototype.freeHole = function () {
    var h = this.state.hole;
    if (h.position === 'custom') return;
    var c = KC.holeCentre(this.state);
    h.x = Math.round(c.x * 100) / 100;
    h.y = Math.round(c.y * 100) / 100;
    h.position = 'custom';
  };

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

  /* The face currently being edited, as a state-shaped view. */
  Preview.prototype.face = function () {
    return KC.faceState(this.state, this.state.activeSide);
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
    var back = state.activeSide === 'back';
    var px = Math.round(W * dpr), py = Math.round(H * dpr);

    /* A through-cut inlay is a void right through the plate, so it shows on the
       undecorated face too — mirrored, since you are looking at it from behind. */
    var cut = this._throughOwner();
    var decorSide = cut || state.activeSide;
    var mirrorDecor = !!cut;
    var fs = KC.faceState(state, decorSide);
    var showDecor = !!cut || state.sides[state.activeSide].enabled;

    this._grid(ctx, W, H, t);

    var layer = function (key) {
      var c = KC.scratch(key, px, py);
      var g2 = c.getContext('2d');
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.clearRect(0, 0, W, H);
      return { c: c, g: g2 };
    };

    /* Plate silhouette with the keyring hole already punched, so decoration
       masked against it can never bridge the hole. */
    var plate = layer('prevplate');
    plate.g.fillStyle = pal[state.colors.base];
    plate.g.beginPath();
    if (KC.drawPlate(plate.g, state, t)) {
      plate.g.globalCompositeOperation = 'source-in';   // recolour a bitmap outline
      plate.g.fillStyle = pal[state.colors.base];
      plate.g.fillRect(0, 0, W, H);
      plate.g.globalCompositeOperation = 'source-over';
    } else {
      plate.g.fill();
    }
    if (state.hole.enabled) {
      var h = KC.holeCentre(state);
      plate.g.globalCompositeOperation = 'destination-out';
      plate.g.beginPath();
      plate.g.arc(t.ox + h.x * t.s, t.oy - h.y * t.s, h.r * t.s, 0, Math.PI * 2);
      plate.g.fill();
      plate.g.globalCompositeOperation = 'source-over';
    }

    /* Looking at the back of the real object flips the plate left-to-right (the
       keyring hole swaps sides), while the decoration for that face reads the
       right way up — which is exactly how the mesh mirrors it. */
    var plateCanvas = plate.c;
    if (back) {
      var mir = layer('prevmirror');
      mir.g.setTransform(1, 0, 0, 1, 0, 0);
      mir.g.translate(px, 0);
      mir.g.scale(-1, 1);
      mir.g.drawImage(plate.c, 0, 0);
      mir.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      plateCanvas = mir.c;
    }

    /* Decoration for whichever face owns it. */
    var feat = layer('prevfeat');
    if (showDecor) {
      this._border(feat.g, t, W, H, fs);

      if (fs.art.source !== 'none') {
        var tint = pal[state.colors.art];
        var art = layer('prevart');
        if (KC.drawArt(art.g, fs, t)) {
          if (KC.resolveArtMode(fs) !== 'alpha') {
            // Keep a thresholded photo readable while it is being tuned.
            art.g.globalCompositeOperation = 'source-atop';
            art.g.fillStyle = tint;
            art.g.globalAlpha = 0.55;
            art.g.fillRect(0, 0, W, H);
            art.g.globalAlpha = 1;
          } else {
            art.g.globalCompositeOperation = 'source-in';
            art.g.fillStyle = tint;
            art.g.fillRect(0, 0, W, H);
          }
          art.g.globalCompositeOperation = 'source-over';
          feat.g.drawImage(art.c, 0, 0, W, H);
        }
      }
      KC.drawText(feat.g, fs, t, { fill: pal[state.colors.text] });

      if (mirrorDecor) {
        var fm = layer('prevfeatmirror');
        fm.g.setTransform(1, 0, 0, 1, 0, 0);
        fm.g.translate(px, 0);
        fm.g.scale(-1, 1);
        fm.g.drawImage(feat.c, 0, 0);
        fm.g.setTransform(dpr, 0, 0, dpr, 0, 0);
        feat = fm;
      }

      feat.g.globalCompositeOperation = 'destination-in';
      feat.g.drawImage(plateCanvas, 0, 0, W, H);
      feat.g.globalCompositeOperation = 'source-over';
    }

    /* Compose: plate, then decoration, then the engraved shading pass. */
    var out = layer('prevout');
    out.g.drawImage(plateCanvas, 0, 0, W, H);
    out.g.drawImage(feat.c, 0, 0, W, H);
    if (state.shape.relief === 'engraved') {
      out.g.globalCompositeOperation = 'source-atop';
      out.g.fillStyle = 'rgba(0,0,0,0.22)';
      out.g.fillRect(0, 0, W, H);
      out.g.globalCompositeOperation = 'source-over';
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(out.c, 0, 0, W, H);
    ctx.restore();

    this._handles(ctx, t);
    this._dims(ctx, t, W, H);
    this._sideBadge(ctx, W);
  };

  /* When a through-cut inlay is owned by the *other* face, returns that face —
     its artwork is visible from here because the cut goes all the way through. */
  Preview.prototype._throughOwner = function () {
    var s = this.state;
    if (s.shape.relief !== 'inlay' || !s.shape.inlayThrough) return null;
    var side = s.activeSide, o = side === 'front' ? 'back' : 'front';
    if (s.sides[side].enabled) return null;      // this face owns its own design
    return s.sides[o].enabled ? o : null;
  };

  /* Which face you are looking at, and whether it is switched on. */
  Preview.prototype._sideBadge = function (ctx, W) {
    var state = this.state;
    var on = state.sides[state.activeSide].enabled;
    var cut = this._throughOwner();
    var txt = (state.activeSide === 'back' ? 'Back' : 'Front') +
              (on ? '' : (cut ? ' — cut through from the ' + cut : ' — off'));
    ctx.save();
    ctx.font = '600 11px -apple-system,system-ui,sans-serif';
    var w = ctx.measureText(txt).width + 18;
    ctx.fillStyle = on ? 'rgba(43,111,209,0.9)'
                       : (cut ? 'rgba(90,120,160,0.9)' : 'rgba(120,132,150,0.85)');
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(W / 2 - w / 2, 12, w, 20, 10)
                  : ctx.rect(W / 2 - w / 2, 12, w, 20);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, W / 2, 22);
    ctx.restore();
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
  Preview.prototype._border = function (ctx, t, W, H, forFace) {
    var state = this.state;
    var fs = forFace || this.face();
    if (fs.border.style === 'none') return;

    var sz = KC.plateSize(state);
    var key = JSON.stringify([state.shape.preset, sz.w, sz.h, state.shape.radius,
                              fs._side, fs.border, state.colors.palette[state.colors.border],
                              state.shape.preset === 'custom' && KC.assets.customShape ? KC.assets.customShape._rev : 0]);

    if (!this._ringCache || this._ringCache.key !== key) {
      // Roughly matches the on-screen scale, so the ring isn't upscaled and soft.
      var ppmm = KC.clamp(900 / Math.max(sz.w, sz.h), 8, 18);
      var g = KC.makeGrid(state, ppmm);
      var plate = KC.plateMask(state, g);
      var ring = KC.borderMask(fs, g, plate);
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
  /* Listed back-to-front, so a reverse scan picks whatever is drawn on top. */
  Preview.prototype.boxes = function (t) {
    var state = this.state, out = [];

    var fs = this.face();

    if (this.movable('hole')) {
      var hc = KC.holeCentre(this.state), d = hc.r * 2 * t.s;
      out.push({ key: 'hole', label: 'Keyring hole', round: true,
                 cx: t.ox + this.xSign('hole') * hc.x * t.s, cy: t.oy - hc.y * t.s,
                 w: d, h: d, rot: 0 });
    }

    var p = KC.artPlacement(fs, t);
    if (p && this.movable('art')) {
      out.push({ key: 'art', label: 'Picture', cx: p.cx, cy: p.cy, w: p.w, h: p.h,
                 rot: -fs.art.rotation * Math.PI / 180 });
    }
    if (this.movable('text')) {
      var m = this._textMetrics(t);
      if (m) out.push({ key: 'text', label: 'Text',
                        cx: t.ox + fs.text.x * t.s, cy: t.oy - fs.text.y * t.s,
                        w: m.w, h: m.h, rot: -fs.text.rotation * Math.PI / 180 });
    }
    void state;
    return out;
  };

  Preview.prototype._textMetrics = function (t) {
    var tx = this.el('text');
    var lines = (tx.content || '').split('\n');
    var ctx = this.canvas.getContext('2d');
    var px = tx.size * t.s;
    ctx.save();
    ctx.font = (tx.italic ? 'italic ' : '') + (tx.bold ? '700 ' : '400 ') + px + 'px ' +
               KC.fontByKey(KC.fontKey(tx.font)).css;
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

  /* Is (x, y) on a resize handle of the current selection? */
  Preview.prototype.hitHandle = function (x, y) {
    var key = this.selected;
    if (!key || !this.movable(key) || !SIZE[key]) return null;
    var t = this.transform();
    var boxes = this.boxes(t);
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b.key !== key) continue;
      var dx = x - b.cx, dy = y - b.cy;
      var c = Math.cos(-b.rot), sn = Math.sin(-b.rot);
      var lx = dx * c - dy * sn, ly = dx * sn + dy * c;
      var al = b.key === 'text' ? this.el('text').align : 'center';
      var off = b.key === 'text' && al !== 'center' ? (al === 'left' ? b.w / 2 : -b.w / 2) : 0;
      var L = off - b.w / 2, R = off + b.w / 2, T2 = -b.h / 2, B = b.h / 2;
      var pts = b.round ? [[R + 3, 0]] : [[L, T2], [R, T2], [L, B], [R, B]];
      for (var k = 0; k < pts.length; k++) {
        if (Math.abs(lx - pts[k][0]) <= 7 && Math.abs(ly - pts[k][1]) <= 7) {
          return { key: b.key, cx: b.cx, cy: b.cy };
        }
      }
    }
    return null;
  };

  Preview.prototype.hitTest = function (x, y) {
    var t = this.transform();
    var boxes = this.boxes(t);
    for (var i = boxes.length - 1; i >= 0; i--) {
      var b = boxes[i];
      var dx = x - b.cx, dy = y - b.cy;
      var c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      var lx = dx * c - dy * s, ly = dx * s + dy * c;
      var al = this.el('text').align;
      var extra = b.key === 'text' && al !== 'center' ? (al === 'left' ? b.w / 2 : -b.w / 2) : 0;
      if (Math.abs(lx - extra) <= b.w / 2 + 3 && Math.abs(ly) <= b.h / 2 + 3) return b.key;
    }
    return null;
  };

  Preview.prototype._handles = function (ctx, t) {
    // Selection persists (so arrow keys have a target); hover is transient.
    var sel = this.selected && this.movable(this.selected) ? this.selected : null;
    var hov = this.drag ? this.drag.key : this.hot;
    if (!sel && !hov) return;

    var boxes = this.boxes(t);
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var isSel = b.key === sel, isHot = b.key === hov;
      if (!isSel && !isHot) continue;

      var al2 = this.el('text').align;
      var off = b.key === 'text' && al2 !== 'center' ? (al2 === 'left' ? b.w / 2 : -b.w / 2) : 0;

      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.rotate(b.rot);
      ctx.strokeStyle = isSel ? 'rgba(90,169,255,1)' : 'rgba(90,169,255,0.6)';
      ctx.lineWidth = isSel ? 1.5 : 1;
      ctx.setLineDash(isSel ? [] : [4, 3]);
      if (b.round) {
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2 + 3, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(off - b.w / 2, -b.h / 2, b.w, b.h);
      }

      if (isSel) {
        ctx.setLineDash([]);
        var L = off - b.w / 2, R = off + b.w / 2, T2 = -b.h / 2, B = b.h / 2;

        // square grab handles at the corners — drag one to resize
        var hs = 4;
        ctx.fillStyle = 'rgba(90,169,255,1)';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1;
        var corners = b.round ? [[R + 3, 0]] : [[L, T2], [R, T2], [L, B], [R, B]];
        corners.forEach(function (k) {
          ctx.fillRect(k[0] - hs, k[1] - hs, hs * 2, hs * 2);
          ctx.strokeRect(k[0] - hs, k[1] - hs, hs * 2, hs * 2);
        });
        ctx.strokeStyle = 'rgba(90,169,255,1)';

        ctx.font = '10px -apple-system,system-ui,sans-serif';
        var tw = ctx.measureText(b.label).width + 10;
        ctx.fillStyle = 'rgba(43,111,209,0.95)';
        ctx.fillRect(off - b.w / 2, T2 - 16, tw, 14);
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, off - b.w / 2 + 5, T2 - 9);
      }
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
      canvas.focus();                      // so arrow keys reach us

      // grabbing a corner handle resizes instead of moving
      var h = self.hitHandle(p.x, p.y);
      if (h) {
        var spec = SIZE[h.key];
        self.onBeginEdit();
        if (h.key === 'hole') self.freeHole();
        self.resize = {
          key: h.key, field: spec.field, spec: spec,
          start: self.el(h.key)[spec.field],
          dist: Math.max(4, Math.hypot(p.x - h.cx, p.y - h.cy))
        };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      var key = self.hitTest(p.x, p.y);
      if (!key) {
        if (self.selected) { self.selected = null; self.draw(); }
        return;
      }
      self.selected = key;
      if (key === 'hole') { self.onBeginEdit(); self.freeHole(); }
      var t = self.transform();
      var el = self.el(key);
      var sx = self.xSign(key);
      self.drag = { key: key, sx: sx,
                    dx: sx * el.x - (p.x - t.ox) / t.s,
                    dy: el.y + (p.y - t.oy) / t.s, moved: false };
      canvas.setPointerCapture(e.pointerId);
      self.draw();
      e.preventDefault();
    });

    /* Arrow keys nudge the selection; shift moves in bigger steps. */
    canvas.addEventListener('keydown', function (e) {
      if (!self.selected || !self.movable(self.selected)) return;
      var step = e.shiftKey ? 2 : 0.25;
      var dx = 0, dy = 0;
      switch (e.key) {
        case 'ArrowLeft':  dx = -step; break;
        case 'ArrowRight': dx =  step; break;
        case 'ArrowUp':    dy =  step; break;
        case 'ArrowDown':  dy = -step; break;
        case 'Escape':     self.selected = null; self.draw(); return;
        default: return;
      }
      e.preventDefault();
      self.onBeginEdit();
      if (self.selected === 'hole') self.freeHole();
      var el = self.el(self.selected);
      dx *= self.xSign(self.selected);
      el.x = Math.round((el.x + dx) * 100) / 100;
      el.y = Math.round((el.y + dy) * 100) / 100;
      self.draw();
      self.onChange(false);
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = local(e);

      if (self.resize) {
        var r = self.resize;
        var b = self.boxes(self.transform()).filter(function (q) { return q.key === r.key; })[0];
        if (!b) return;
        var d = Math.max(4, Math.hypot(p.x - b.cx, p.y - b.cy));
        var v = KC.clamp(r.start * (d / r.dist), r.spec.min, r.spec.max);
        self.el(r.key)[r.field] = Math.round(v * 4) / 4;      // 0.25 mm steps
        canvas.style.cursor = 'nwse-resize';
        self.draw();
        self.onChange(true);
        return;
      }

      if (!self.drag) {
        if (self.hitHandle(p.x, p.y)) { canvas.style.cursor = 'nwse-resize'; return; }
        var hv = self.hitTest(p.x, p.y);
        canvas.style.cursor = hv ? 'grab' : 'default';
        if (hv !== self.hot) { self.hot = hv; self.draw(); }
        return;
      }
      if (!self.drag.moved) { self.drag.moved = true; self.onBeginEdit(); }
      var t = self.transform();
      var el = self.el(self.drag.key);
      var nx = self.drag.sx * ((p.x - t.ox) / t.s + self.drag.dx);
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
      if (self.resize) {
        self.resize = null;
        canvas.style.cursor = 'default';
        if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
        self.draw();
        self.onChange(false);        // …which saves and resyncs the sliders
        return;
      }
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

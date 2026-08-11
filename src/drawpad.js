/* drawpad.js — freehand editor, shared by "custom outline" and "picture".
 * For outlines it flood-fills enclosed regions on apply, so a sketched loop
 * becomes a solid silhouette.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var SIZE = 540;

  function DrawPad(root) {
    this.root = root;
    this.canvas = root.querySelector('#drawcanvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.tool = 'brush';
    this.size = 14;
    this.undoStack = [];
    this.target = null;
    this.onApply = null;
    this._bind();
  }

  DrawPad.prototype.open = function (target, existing, onApply) {
    this.target = target;
    this.onApply = onApply;
    this.undoStack = [];

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, SIZE, SIZE);
    if (existing) this.ctx.drawImage(existing, 0, 0, SIZE, SIZE);

    var isShape = target === 'shape';
    this.root.querySelector('#draw-title').textContent =
      isShape ? 'Draw the keychain outline' : 'Draw a picture';
    this.root.querySelector('#draw-hint').textContent = isShape
      ? 'Sketch a closed loop. On apply it is filled in and scaled to your width and height.'
      : 'Anything you draw is embossed onto the plate. Enclosed areas can be filled or left open.';
    this.root.querySelector('#draw-fill').checked = isShape;
    this.root.hidden = false;
  };

  DrawPad.prototype.close = function () { this.root.hidden = true; };

  DrawPad.prototype._push = function () {
    if (this.undoStack.length > 24) this.undoStack.shift();
    this.undoStack.push(this.ctx.getImageData(0, 0, SIZE, SIZE));
  };

  DrawPad.prototype.undo = function () {
    var s = this.undoStack.pop();
    if (s) this.ctx.putImageData(s, 0, 0);
  };

  DrawPad.prototype.clear = function () {
    this._push();
    this.ctx.clearRect(0, 0, SIZE, SIZE);
  };

  DrawPad.prototype._bind = function () {
    var self = this, canvas = this.canvas, ctx = this.ctx;
    var drawing = false, last = null, start = null, snapshot = null;

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * SIZE / r.width, y: (e.clientY - r.top) * SIZE / r.height };
    }

    function stroke(a, b) {
      ctx.globalCompositeOperation = self.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = '#111';
      ctx.fillStyle = '#111';
      ctx.lineWidth = self.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    canvas.addEventListener('pointerdown', function (e) {
      drawing = true;
      last = start = pos(e);
      self._push();
      snapshot = ctx.getImageData(0, 0, SIZE, SIZE);
      if (self.tool === 'brush' || self.tool === 'eraser') stroke(last, last);
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pos(e);
      if (self.tool === 'brush' || self.tool === 'eraser') {
        stroke(last, p);
        last = p;
      } else {
        ctx.putImageData(snapshot, 0, 0);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = self.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (self.tool === 'line') {
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(p.x, p.y);
        } else if (self.tool === 'rect') {
          ctx.rect(Math.min(start.x, p.x), Math.min(start.y, p.y),
                   Math.abs(p.x - start.x), Math.abs(p.y - start.y));
        } else {
          ctx.ellipse((start.x + p.x) / 2, (start.y + p.y) / 2,
                      Math.abs(p.x - start.x) / 2, Math.abs(p.y - start.y) / 2, 0, 0, Math.PI * 2);
        }
        ctx.stroke();
      }
    });

    var end = function (e) {
      drawing = false;
      if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  };

  /* Fill every region not reachable from the canvas border — i.e. the inside
     of any closed stroke. Scanline-free BFS over a byte grid. */
  function fillEnclosed(ctx) {
    var img = ctx.getImageData(0, 0, SIZE, SIZE);
    var d = img.data, n = SIZE * SIZE;
    var outside = new Uint8Array(n);
    var stack = [];

    for (var x = 0; x < SIZE; x++) {
      stack.push(x, x + (SIZE - 1) * SIZE);
    }
    for (var y = 0; y < SIZE; y++) {
      stack.push(y * SIZE, y * SIZE + SIZE - 1);
    }

    while (stack.length) {
      var i = stack.pop();
      if (outside[i]) continue;
      if (d[i * 4 + 3] > 40) continue;      // stroke blocks the flood
      outside[i] = 1;
      var px = i % SIZE, py = (i / SIZE) | 0;
      if (px > 0) stack.push(i - 1);
      if (px < SIZE - 1) stack.push(i + 1);
      if (py > 0) stack.push(i - SIZE);
      if (py < SIZE - 1) stack.push(i + SIZE);
    }

    for (var k = 0; k < n; k++) {
      if (!outside[k] && d[k * 4 + 3] <= 40) {
        d[k * 4] = 17; d[k * 4 + 1] = 17; d[k * 4 + 2] = 17; d[k * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  DrawPad.prototype.result = function (doFill) {
    var out = document.createElement('canvas');
    out.width = out.height = SIZE;
    var octx = out.getContext('2d', { willReadFrequently: true });
    octx.drawImage(this.canvas, 0, 0);
    if (doFill) fillEnclosed(octx);
    out._rev = Date.now();
    return out;
  };

  KC.DrawPad = DrawPad;
})(window.KC);

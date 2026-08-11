/* util.js — namespace, defaults, small helpers shared by every module. */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  /* Fonts are resolved from the system; each entry is a stack with fallbacks
     so the app still works if a face is missing. */
  KC.FONTS = [
    { name: 'Grotesk',     css: '"Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif' },
    { name: 'Neue Sans',   css: '"Helvetica Neue",Helvetica,Arial,sans-serif' },
    { name: 'Rounded',     css: '"Arial Rounded MT Bold",Nunito,"Trebuchet MS",sans-serif' },
    { name: 'Wide Black',  css: '"Arial Black","Arial Bold",Gadget,sans-serif' },
    { name: 'Condensed',   css: '"Arial Narrow","Avenir Next Condensed","Helvetica Neue",sans-serif' },
    { name: 'Serif',       css: 'Georgia,"Times New Roman",serif' },
    { name: 'Slab',        css: 'Rockwell,"Courier New",Georgia,serif' },
    { name: 'Elegant',     css: 'Didot,"Bodoni 72","Playfair Display",Georgia,serif' },
    { name: 'Monospace',   css: '"SF Mono",Menlo,Consolas,"Courier New",monospace' },
    { name: 'Impact',      css: 'Impact,Haettenschweiler,"Arial Black",sans-serif' },
    { name: 'Script',      css: '"Snell Roundhand","Brush Script MT",cursive' },
    { name: 'Handwriting', css: '"Bradley Hand","Comic Sans MS",cursive' },
    { name: 'Chalk',       css: 'Chalkduster,"Comic Sans MS",fantasy' },
    { name: 'Typewriter',  css: '"American Typewriter","Courier New",monospace' },
    { name: 'Copperplate', css: 'Copperplate,"Copperplate Gothic Light",Optima,serif' },
    { name: 'Marker',      css: '"Marker Felt","Comic Sans MS",cursive' }
  ];

  KC.SHAPES = [
    ['rect', 'Rectangle'], ['square', 'Square'], ['circle', 'Circle'], ['ellipse', 'Ellipse'],
    ['pill', 'Capsule'], ['tri', 'Triangle'], ['pent', 'Pentagon'], ['hex', 'Hexagon'],
    ['oct', 'Octagon'], ['star', 'Star'], ['heart', 'Heart'], ['shield', 'Shield'],
    ['custom', 'Custom drawing']
  ];

  /* Which parts can be tinted, in the order they are listed in the colour panel. */
  KC.PARTS = [
    ['base', 'Keychain'], ['border', 'Border'], ['text', 'Text'], ['art', 'Picture']
  ];

  KC.defaults = function () {
    return {
      shape:  { preset: 'rect', width: 58, height: 30, radius: 6, thickness: 3,
                relief: 'raised', reliefHeight: 0.8 },
      hole:   { enabled: true, diameter: 4, margin: 4, position: 'tl' },
      border: { style: 'single', shape: 'follow', inset: 2, width: 1.2, gap: 1.2,
                dashes: 24, radius: 4 },
      text:   { content: 'HELLO', font: 0, bold: true, italic: false, style: 'fill',
                strokeWidth: 0.8, size: 8, tracking: 0.4, lineHeight: 1.15, rotation: 0,
                align: 'center', x: 0, y: 0 },
      art:    { source: 'none', mode: 'auto', threshold: 0.5, size: 15, rotation: 0,
                mirror: false, x: -17, y: 0 },
      colors: { palette: ['#e9edf2', '#16181d', '#e0a63a', '#4b8ef0'],
                base: 0, border: 1, text: 1, art: 2 },
      quality: 14,
      name: 'keychain'
    };
  };

  /* Bitmaps live outside the serialisable state. */
  KC.assets = { image: null, drawing: null, customShape: null };

  /* ── tiny helpers ───────────────────────────────────────────────── */
  KC.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  KC.lerp = function (a, b, t) { return a + (b - a) * t; };

  KC.get = function (obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  };
  KC.set = function (obj, path, val) {
    var ks = path.split('.'), last = ks.pop();
    var o = ks.reduce(function (o, k) { return o[k]; }, obj);
    o[last] = val;
  };

  KC.debounce = function (fn, ms) {
    var t = 0;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  KC.hexToRgb = function (hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  };

  /* Reusable offscreen canvas pool — avoids reallocating big buffers on every
     keystroke while the user drags a slider. */
  var pool = {};
  KC.scratch = function (key, w, h) {
    var c = pool[key];
    if (!c) { c = pool[key] = document.createElement('canvas'); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    else { c.getContext('2d').clearRect(0, 0, w, h); }
    return c;
  };

  /* Grid: maps millimetres (origin at plate centre, +y up) to raster pixels. */
  KC.makeGrid = function (state, ppmm) {
    var pad = 4; // mm of empty margin so contours never touch the raster edge
    var w = state.shape.width, h = state.shape.height;
    if (state.shape.preset === 'square' || state.shape.preset === 'circle') h = w;
    var cols = Math.max(16, Math.ceil((w + pad * 2) * ppmm));
    var rows = Math.max(16, Math.ceil((h + pad * 2) * ppmm));
    return {
      ppmm: ppmm, cols: cols, rows: rows,
      ox: cols / 2, oy: rows / 2,
      w: w, h: h,
      px: function (mm) { return this.ox + mm * this.ppmm; },
      py: function (mm) { return this.oy - mm * this.ppmm; },
      mmx: function (px) { return (px - this.ox) / this.ppmm; },
      mmy: function (py) { return (this.oy - py) / this.ppmm; }
    };
  };

  /* Effective plate size honouring the "locked" presets. */
  KC.plateSize = function (state) {
    var w = state.shape.width, h = state.shape.height;
    if (state.shape.preset === 'square' || state.shape.preset === 'circle') h = w;
    return { w: w, h: h };
  };

  /* ── mask algebra (alpha 0..1 Float32Array) ─────────────────────── */
  KC.mask = {
    make: function (g) { return new Float32Array(g.cols * g.rows); },
    union: function (a, b) {
      if (!a) return b; if (!b) return a;
      var o = new Float32Array(a.length);
      for (var i = 0; i < a.length; i++) o[i] = a[i] > b[i] ? a[i] : b[i];
      return o;
    },
    sub: function (a, b) {           // a AND NOT b
      if (!a) return null; if (!b) return a;
      var o = new Float32Array(a.length);
      for (var i = 0; i < a.length; i++) o[i] = a[i] * (1 - b[i]);
      return o;
    },
    and: function (a, b) {
      if (!a || !b) return null;
      var o = new Float32Array(a.length);
      for (var i = 0; i < a.length; i++) o[i] = a[i] * b[i];
      return o;
    },
    empty: function (m) {
      if (!m) return true;
      for (var i = 0; i < m.length; i++) if (m[i] > 0.5) return false;
      return true;
    },
    /* Coverage in mm², handy for volume estimates and sanity checks. */
    area: function (m, g) {
      if (!m) return 0;
      var s = 0;
      for (var i = 0; i < m.length; i++) s += m[i];
      return s / (g.ppmm * g.ppmm);
    },
    /* Read the alpha channel of a canvas into a mask. */
    fromCanvas: function (canvas) {
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var n = canvas.width * canvas.height, out = new Float32Array(n);
      for (var i = 0; i < n; i++) out[i] = d[i * 4 + 3] / 255;
      return out;
    },
    /* Zero the outermost ring so marching squares always yields closed loops. */
    sealEdges: function (m, g) {
      var c = g.cols, r = g.rows, i;
      for (i = 0; i < c; i++) { m[i] = 0; m[(r - 1) * c + i] = 0; }
      for (i = 0; i < r; i++) { m[i * c] = 0; m[i * c + c - 1] = 0; }
      return m;
    }
  };

})(window.KC);

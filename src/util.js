/* util.js — namespace, defaults, small helpers shared by every module. */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  /* Fonts are resolved from the system; each entry is a stack with fallbacks so
     the app still works where a face is missing. Identified by `key`, not by
     position, so the list can grow without changing anyone's saved design. */
  KC.FONTS = [
    // clean
    { key: 'grotesk',   name: 'Grotesk',     group: 'Clean',  css: '"Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif' },
    { key: 'neue',      name: 'Neue Sans',   group: 'Clean',  css: '"Helvetica Neue",Helvetica,Arial,sans-serif' },
    { key: 'futura',    name: 'Futura',      group: 'Clean',  css: 'Futura,"Century Gothic","Avenir Next",sans-serif' },
    { key: 'optima',    name: 'Optima',      group: 'Clean',  css: 'Optima,Candara,"Gill Sans","Trebuchet MS",sans-serif' },
    { key: 'rounded',   name: 'Rounded',     group: 'Clean',  css: '"Arial Rounded MT Bold",Nunito,"Trebuchet MS",sans-serif' },
    { key: 'condensed', name: 'Condensed',   group: 'Clean',  css: '"Arial Narrow","Avenir Next Condensed","Helvetica Neue",sans-serif' },
    { key: 'wideblack', name: 'Wide Black',  group: 'Clean',  css: '"Arial Black","Arial Bold",Gadget,sans-serif' },

    // serif
    { key: 'serif',     name: 'Serif',       group: 'Serif',  css: 'Georgia,"Times New Roman",serif' },
    { key: 'baskerville', name: 'Baskerville', group: 'Serif', css: 'Baskerville,"Libre Baskerville",Georgia,serif' },
    { key: 'cochin',    name: 'Cochin',      group: 'Serif',  css: 'Cochin,"Hoefler Text",Georgia,serif' },
    { key: 'elegant',   name: 'Elegant',     group: 'Serif',  css: 'Didot,"Bodoni 72","Playfair Display",Georgia,serif' },
    { key: 'slab',      name: 'Slab',        group: 'Serif',  css: 'Rockwell,"Courier New",Georgia,serif' },
    { key: 'clarendon', name: 'Fat Slab',    group: 'Serif',  css: 'Superclarendon,"Rockwell Extra Bold",Rockwell,Georgia,serif' },
    { key: 'copperplate', name: 'Copperplate', group: 'Serif', css: 'Copperplate,"Copperplate Gothic Light",Optima,serif' },

    // display / fun
    { key: 'impact',    name: 'Impact',      group: 'Display', css: 'Impact,Haettenschweiler,"Arial Black",sans-serif' },
    { key: 'stencil',   name: 'Stencil',     group: 'Display', css: 'Stencil,"Stencil Std","Arial Black",fantasy' },
    { key: 'phosphate', name: 'Phosphate',   group: 'Display', css: 'Phosphate,"Arial Narrow Bold",Impact,sans-serif' },
    { key: 'playbill',  name: 'Playbill',    group: 'Display', css: 'Playbill,Rockwell,"Arial Black",fantasy' },
    { key: 'luminari',  name: 'Luminari',    group: 'Display', css: 'Luminari,Herculanum,Papyrus,fantasy' },
    { key: 'herculanum',name: 'Herculanum',  group: 'Display', css: 'Herculanum,Luminari,Copperplate,fantasy' },
    { key: 'papyrus',   name: 'Papyrus',     group: 'Display', css: 'Papyrus,Herculanum,fantasy' },
    { key: 'jazz',      name: 'Jazz',        group: 'Display', css: '"Jazz LET","Party LET",Impact,fantasy' },
    { key: 'party',     name: 'Party',       group: 'Display', css: '"Party LET","Jazz LET","Comic Sans MS",fantasy' },
    { key: 'krungthep', name: 'Techno',      group: 'Display', css: 'Krungthep,"Silom","Courier New",monospace' },
    { key: 'bauhaus',   name: 'Geometric',   group: 'Display', css: '"Bauhaus 93","Century Gothic",Futura,sans-serif' },

    // script + hand
    { key: 'script',    name: 'Script',      group: 'Script & hand', css: '"Snell Roundhand","Brush Script MT",cursive' },
    { key: 'savoye',    name: 'Savoye',      group: 'Script & hand', css: '"Savoye LET","Snell Roundhand","Brush Script MT",cursive' },
    { key: 'zapfino',   name: 'Flourish',    group: 'Script & hand', css: 'Zapfino,"Savoye LET","Snell Roundhand",cursive' },
    { key: 'signpainter', name: 'Sign Painter', group: 'Script & hand', css: 'SignPainter,"Brush Script MT","Marker Felt",cursive' },
    { key: 'trattatello', name: 'Quill',     group: 'Script & hand', css: 'Trattatello,Herculanum,Papyrus,fantasy' },
    { key: 'hand',      name: 'Handwriting', group: 'Script & hand', css: '"Bradley Hand","Comic Sans MS",cursive' },
    { key: 'noteworthy',name: 'Noteworthy',  group: 'Script & hand', css: 'Noteworthy,"Bradley Hand","Comic Sans MS",cursive' },
    { key: 'marker',    name: 'Marker',      group: 'Script & hand', css: '"Marker Felt","Comic Sans MS",cursive' },
    { key: 'chalk',     name: 'Chalk',       group: 'Script & hand', css: 'Chalkduster,"Chalkboard SE","Comic Sans MS",fantasy' },
    { key: 'chalkboard',name: 'Chalkboard',  group: 'Script & hand', css: '"Chalkboard SE",Chalkboard,"Comic Sans MS",sans-serif' },
    { key: 'comic',     name: 'Comic',       group: 'Script & hand', css: '"Comic Sans MS","Chalkboard SE",cursive' },
    { key: 'skia',      name: 'Skia',        group: 'Script & hand', css: 'Skia,"Gill Sans","Trebuchet MS",sans-serif' },

    // mono
    { key: 'mono',      name: 'Monospace',   group: 'Mono',   css: '"SF Mono",Menlo,Consolas,"Courier New",monospace' },
    { key: 'typewriter',name: 'Typewriter',  group: 'Mono',   css: '"American Typewriter","Courier New",monospace' }
  ];

  /* v1/v2 designs stored the font as an index into this exact order. */
  var LEGACY_FONTS = ['grotesk', 'neue', 'rounded', 'wideblack', 'condensed', 'serif',
                      'slab', 'elegant', 'mono', 'impact', 'script', 'hand', 'chalk',
                      'typewriter', 'copperplate', 'marker'];

  KC.fontByKey = function (key) {
    for (var i = 0; i < KC.FONTS.length; i++) if (KC.FONTS[i].key === key) return KC.FONTS[i];
    return KC.FONTS[0];
  };

  /* Accepts a key, or a legacy numeric index, and always returns a key. */
  KC.fontKey = function (v) {
    if (typeof v === 'number') return LEGACY_FONTS[v] || LEGACY_FONTS[0];
    return KC.fontByKey(v).key;
  };

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

  /* One face's worth of decoration. Both sides of the keychain hold one of
     these, edited independently. */
  KC.faceDefaults = function (which) {
    return {
      enabled: which === 'front',
      relief: 'raised', reliefHeight: 0.6,
      // Recessed by default: a through cut shows on both faces, which is
      // surprising when only one face is decorated.
      inlayThrough: false, inlayDepth: 1.2,
      border: { style: 'single', shape: 'follow', inset: 2, width: 1.2, gap: 1.2,
                dashes: 24, radius: 4 },
      text:   { content: which === 'front' ? 'HELLO' : '', font: 'grotesk', bold: true,
                italic: false, style: 'fill', strokeWidth: 0.8, size: 8, tracking: 0.4,
                lineHeight: 1.15, rotation: 0, align: 'center', x: 0, y: 0 },
      art:    { source: 'none', mode: 'auto', threshold: 0.5, size: 15, rotation: 0,
                mirror: false, x: -17, y: 0 }
    };
  };

  KC.defaults = function () {
    return {
      shape:  { preset: 'rect', width: 58, height: 30, radius: 6, thickness: 3 },
      layerHeight: 0.2,
      hole:   { enabled: true, diameter: 4, margin: 4, position: 'tl', x: 0, y: 0 },
      sides:  { front: KC.faceDefaults('front'), back: KC.faceDefaults('back') },
      activeSide: 'front',
      colors: { palette: ['#e9edf2', '#16181d', '#e0a63a', '#4b8ef0'],
                base: 0, border: 1, text: 1, art: 2 },
      quality: 14,
      name: 'keychain'
    };
  };

  /* Bitmaps live outside the serialisable state. The plate outline is shared;
     pictures and doodles belong to one face. */
  KC.assets = {
    customShape: null,
    front: { image: null, drawing: null },
    back:  { image: null, drawing: null }
  };

  /* A state-shaped view of one face: `shape`, `hole` and `colors` fall through
     to the real state, while `text`/`art`/`border` come from that side. Lets
     every rasteriser stay face-agnostic. */
  KC.faceState = function (state, which) {
    var f = state.sides[which];
    var v = Object.create(state);
    v.border = f.border;
    v.text = f.text;
    v.art = f.art;
    v.relief = f.relief;
    v.reliefHeight = f.reliefHeight;
    v.inlayThrough = f.inlayThrough;
    v.inlayDepth = f.inlayDepth;
    v._assets = KC.assets[which];
    v._side = which;
    return v;
  };

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

  /* Anything that carries colour needs real depth to read as solid: one or two
     layers is translucent and fragile, so 3 is the floor everywhere — raised
     text, engraved recesses and colour inlays alike. Depths snap up to whole
     layers so they land on slice boundaries. */
  KC.MIN_LAYERS = 3;
  KC.MIN_INLAY_LAYERS = KC.MIN_LAYERS;   // kept for readability at call sites

  KC.layerHeightOf = function (state) { return Math.max(0.02, state.layerHeight || 0.2); };

  /* Layer arithmetic is done in floats, where 3 * 0.2 is 0.6000000000000001.
     Rounding keeps that noise out of state and off the sliders. */
  function tidy(v) { return Math.round(v * 1e6) / 1e6; }
  KC.tidyDepth = tidy;
  KC.minDepthOf = function (state) { return tidy(KC.MIN_LAYERS * KC.layerHeightOf(state)); };

  /* Snap `requested` up to a whole number of layers, never below the 3-layer
     floor and never past `maxDepth` (which is itself rounded down to layers). */
  KC.snapDepth = function (state, requested, maxDepth) {
    var lh = KC.layerHeightOf(state);
    var floor = tidy(KC.MIN_LAYERS * lh);
    var d = tidy(Math.ceil(Math.max(floor, requested) / lh - 1e-6) * lh);
    if (maxDepth != null && d > maxDepth) d = tidy(Math.floor(maxDepth / lh + 1e-6) * lh);
    if (d < 0) d = 0;
    return { depth: d, floor: floor, lh: lh, layers: Math.round(d / lh),
             tooThin: d < floor - 1e-6 };
  };

  /* Depth of raised/engraved detail. Engraving must leave the floor's worth of
     plate underneath, so it can't eat the whole thickness. */
  /* Both take a face view (KC.faceState) — relief is a per-side choice. */
  KC.reliefDepthOf = function (fs) {
    var T = fs.shape.thickness;
    var max = fs.relief === 'engraved' ? T - KC.minDepthOf(fs) : null;
    var r = KC.snapDepth(fs, fs.reliefHeight, max);
    r.through = false;
    return r;
  };

  KC.inlayDepthOf = function (state) {
    var T = state.shape.thickness;
    var lh = KC.layerHeightOf(state);

    /* A through cut is defined by the plate, not by layer boundaries — snapping
       it would quietly leave a floor behind on any thickness that isn't a whole
       number of layers (2.5 mm at 0.2 mm, say). */
    if (state.inlayThrough) {
      return { depth: T, floor: KC.minDepthOf(state), lh: lh,
               layers: Math.round(T / lh), through: true,
               tooThin: T < KC.minDepthOf(state) - 1e-6 };
    }

    var r = KC.snapDepth(state, state.inlayDepth, T);
    r.through = false;
    return r;
  };

  /* What a face does to the plate, resolved to z-extents. `cut` is how far it
     eats into the plate from its own surface; raised relief eats nothing. */
  KC.faceRelief = function (fs) {
    var T = fs.shape.thickness;
    var rel = KC.reliefDepthOf(fs);
    var inl = KC.inlayDepthOf(fs);
    var style = fs.relief;
    if (style === 'raised')   return { style: style, depth: rel.depth, cut: 0,
                                       through: false, rel: rel, inl: inl };
    if (style === 'engraved') return { style: style, depth: rel.depth, cut: rel.depth,
                                       through: false, rel: rel, inl: inl };
    return { style: 'inlay', depth: inl.depth, cut: inl.through ? T : inl.depth,
             through: inl.through, rel: rel, inl: inl };
  };

  /* Mirror a mask about the plate's vertical centre line — how the back face is
     turned around so its text reads the right way when you flip the keychain. */
  KC.mirrorMaskX = function (m, g) {
    if (!m) return null;
    var out = new Float32Array(m.length);
    for (var y = 0; y < g.rows; y++) {
      var row = y * g.cols, last = row + g.cols - 1;
      for (var x = 0; x < g.cols; x++) out[row + x] = m[last - x];
    }
    return out;
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

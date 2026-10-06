/* Keychain Studio. Copyright (C) 2026 shahidhussain2k13@gmail.com
 * SPDX-License-Identifier: GPL-3.0-or-later — see LICENSE. */
/* util.js — namespace, defaults, small helpers shared by every module. */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  KC.SHAPES = [
    ['rect', 'Rectangle'], ['square', 'Square'], ['circle', 'Circle'], ['ellipse', 'Ellipse'],
    ['pill', 'Capsule'], ['tri', 'Triangle'], ['pent', 'Pentagon'], ['hex', 'Hexagon'],
    ['oct', 'Octagon'], ['star', 'Star'], ['heart', 'Heart'], ['shield', 'Shield'],
    ['custom', 'Custom drawing']
  ];

  /* ── element defaults ───────────────────────────────────────────── */
  KC.newText = function (opts) {
    return Object.assign({
      id: WB.newId('t'), content: 'HELLO', font: 'grotesk', bold: true, italic: false,
      style: 'fill', strokeWidth: 0.8, size: 8, tracking: 0.4, lineHeight: 1.15,
      rotation: 0, align: 'center', x: 0, y: 0, color: '#16181d'
    }, opts || {});
  };

  KC.newArt = function (opts) {
    return Object.assign({
      id: WB.newId('a'), source: 'none', mode: 'auto', threshold: 0.5, size: 15,
      rotation: 0, mirror: false, x: -17, y: 0, color: '#4b8ef0'
    }, opts || {});
  };

  /* One face's worth of decoration: any number of text boxes and pictures, each
     carrying its own colour. How many colours a design needs is therefore up to
     whoever makes it — one per body, at most. */
  KC.faceDefaults = function (which) {
    return {
      enabled: which === 'front',
      relief: 'raised', reliefHeight: 0.6,
      // Recessed by default: a through cut shows on both faces, which is
      // surprising when only one face is decorated.
      inlayThrough: false, inlayDepth: 1.2,
      border: { style: 'single', shape: 'follow', inset: 2, width: 1.2, gap: 1.2,
                dashes: 24, radius: 4, color: '#16181d' },
      texts: which === 'front' ? [KC.newText()] : [],
      arts: [],
      textIdx: 0, artIdx: 0
    };
  };

  KC.defaults = function () {
    return {
      shape:  { preset: 'rect', width: 58, height: 30, radius: 6, thickness: 3 },
      plateColor: '#e9edf2',
      layerHeight: 0.2,
      hole:   { enabled: true, diameter: 4, margin: 4, position: 'tl', x: 0, y: 0 },
      sides:  { front: KC.faceDefaults('front'), back: KC.faceDefaults('back') },
      activeSide: 'front',
      quality: 14,
      name: 'keychain'
    };
  };

  /* Bitmaps live outside the serialisable state, keyed by the picture's id.
     The plate outline is shared by both faces. */
  KC.assets = { customShape: null, images: {}, drawings: {} };

  KC.artBitmap = function (art) {
    if (!art) return null;
    if (art.source === 'image') return KC.assets.images[art.id] || null;
    if (art.source === 'draw') return KC.assets.drawings[art.id] || null;
    return null;
  };

  /* Every element on a face, bottom to top: the border first, then pictures,
     then text. Later entries win where they overlap. */
  KC.faceItems = function (face) {
    var out = [];
    if (face.border.style !== 'none') out.push({ kind: 'border', item: face.border });
    (face.arts || []).forEach(function (a, i) { out.push({ kind: 'art', item: a, index: i }); });
    (face.texts || []).forEach(function (t, i) { out.push({ kind: 'text', item: t, index: i }); });
    return out;
  };

  /* Colours actually used by a design, in a stable order. */
  KC.coloursUsed = function (state) {
    var seen = [], add = function (c) {
      c = (c || '#000000').toUpperCase();
      if (seen.indexOf(c) < 0) seen.push(c);
    };
    add(state.plateColor);
    ['front', 'back'].forEach(function (w) {
      var f = state.sides[w];
      if (!f.enabled || f.relief === 'engraved') return;
      KC.faceItems(f).forEach(function (e) {
        if (e.kind === 'text' && !(e.item.content || '').trim()) return;
        if (e.kind === 'art' && e.item.source === 'none') return;
        add(e.item.color);
      });
    });
    return seen;
  };

  /* A state-shaped view of one face:  /* A state-shaped view of one face: `shape`, `hole` and `colors` fall through
     to the real state, while `text`/`art`/`border` come from that side. Lets
     every rasteriser stay face-agnostic. */
  KC.faceState = function (state, which) {
    var f = state.sides[which];
    var v = Object.create(state);
    v.border = f.border;
    v.relief = f.relief;
    v.reliefHeight = f.reliefHeight;
    v.inlayThrough = f.inlayThrough;
    v.inlayDepth = f.inlayDepth;
    v._side = which;
    return v;
  };

  /* Grid sized to the plate: maps millimetres to raster pixels. */
  KC.makeGrid = function (state, ppmm) {
    var sz = KC.plateSize(state);
    return WB.makeGrid(sz.w, sz.h, ppmm);
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
  var tidy = WB.tidy;
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

  /* Effective plate size honouring the "locked" presets. */
  KC.plateSize = function (state) {
    var w = state.shape.width, h = state.shape.height;
    if (state.shape.preset === 'square' || state.shape.preset === 'circle') h = w;
    return { w: w, h: h };
  };

})(window.KC);

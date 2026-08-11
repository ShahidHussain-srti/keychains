/* mesh.js — masks → colour-separated, watertight extrusions.
 *
 * Colour regions are made mutually exclusive in 2-D before anything is
 * extruded (text wins over picture wins over border), so no two filaments ever
 * claim the same voxel and the slicer never sees overlapping solids.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  /* Accumulates triangles for one colour. */
  function Acc(key, label, colorIndex, color) {
    this.key = key; this.label = label;
    this.colorIndex = colorIndex; this.color = color;
    this.pos = []; this.idx = [];
  }

  Acc.prototype.addPolys = function (polys, z0, z1) {
    for (var p = 0; p < polys.length; p++) extrude(this, polys[p], z0, z1);
  };

  Acc.prototype.finish = function () {
    return {
      key: this.key, label: this.label,
      colorIndex: this.colorIndex, color: this.color,
      positions: new Float32Array(this.pos),
      indices: new Uint32Array(this.idx)
    };
  };

  /* One polygon (CCW outer + CW holes) → prism between z0 and z1. */
  function extrude(acc, poly, z0, z1) {
    var rings = [poly.outer].concat(poly.holes);
    var flat = [], holeIdx = [], count = 0, i, j;

    for (i = 0; i < rings.length; i++) {
      if (i > 0) holeIdx.push(count);
      var r = rings[i];
      for (j = 0; j < r.length; j++) { flat.push(r[j].x, r[j].y); count++; }
    }

    var tris = KC.earcut(flat, holeIdx, 2);
    if (!tris.length) return;

    var base = acc.pos.length / 3;
    var nPts = count;

    // Two vertex layers: [0 .. n) bottom at z0, [n .. 2n) top at z1.
    for (i = 0; i < nPts; i++) acc.pos.push(flat[i * 2], flat[i * 2 + 1], z0);
    for (i = 0; i < nPts; i++) acc.pos.push(flat[i * 2], flat[i * 2 + 1], z1);

    // Caps: top keeps earcut's winding (CCW → +Z), bottom is reversed.
    for (i = 0; i < tris.length; i += 3) {
      var a = tris[i], b = tris[i + 1], c = tris[i + 2];
      acc.idx.push(base + nPts + a, base + nPts + b, base + nPts + c);
      acc.idx.push(base + c, base + b, base + a);
    }

    // Walls. For a CCW outer ring the outward normal is to the right of travel,
    // which the same winding also gives for CW hole rings — pointing into the
    // hole, i.e. out of the material.
    var off = 0;
    for (i = 0; i < rings.length; i++) {
      var ring = rings[i], n = ring.length;
      for (j = 0; j < n; j++) {
        var v0 = base + off + j, v1 = base + off + (j + 1) % n;
        var u0 = v0 + nPts, u1 = v1 + nPts;
        acc.idx.push(v0, v1, u1);
        acc.idx.push(v0, u1, u0);
      }
      off += n;
    }
  }

  function volumeOf(part) {
    var p = part.positions, ix = part.indices, v = 0;
    for (var i = 0; i < ix.length; i += 3) {
      var a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
      var ax = p[a], ay = p[a + 1], az = p[a + 2];
      var bx = p[b], by = p[b + 1], bz = p[b + 2];
      var cx = p[c], cy = p[c + 1], cz = p[c + 2];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return Math.abs(v) / 6;   // mm³
  }

  /* ── the whole model ────────────────────────────────────────────── */
  KC.buildModel = function (state, ppmm) {
    var g = KC.makeGrid(state, ppmm);
    var sh = state.shape;
    var T = sh.thickness;
    var warn = [];

    var plate = KC.plateMask(state, g);
    if (KC.mask.empty(plate)) {
      return { parts: [], stats: { tris: 0, vol: 0 }, grid: g,
               warnings: [{ level: 'bad', msg: 'The keychain outline is empty — pick a preset or draw a custom outline.' }] };
    }

    var hole = KC.holeMask(state, g);
    var plateSolid = KC.mask.sub(plate, hole);

    // Raw element masks, each clipped to the plate.
    var border = KC.borderMask(state, g, plate);
    var text   = KC.textMask(state, g);
    var art    = KC.artMask(state, g);

    var textRaw = text, artRaw = art;
    if (border) border = KC.mask.and(border, plateSolid);
    if (text)   text   = KC.mask.and(text, plateSolid);
    if (art)    art    = KC.mask.and(art, plateSolid);

    // Priority so colours never share a pixel: text > picture > border.
    if (art && text)    art    = KC.mask.sub(art, text);
    if (border && text) border = KC.mask.sub(border, text);
    if (border && art)  border = KC.mask.sub(border, art);

    var features = null;
    features = KC.mask.union(features, border);
    features = KC.mask.union(features, art);
    features = KC.mask.union(features, text);

    var pal = state.colors.palette;
    var parts = [];
    var eps = 0.55 / g.ppmm;
    var copts = { eps: eps, minArea: 0.03 };

    var relief = sh.relief;
    var e = KC.clamp(sh.reliefHeight, 0.1, Math.max(0.1, T - 0.2));
    if (relief !== 'inlay' && sh.reliefHeight > T - 0.2) {
      warn.push({ level: 'warn', msg: 'Relief depth was clamped to ' + e.toFixed(1) +
        ' mm so it stays thinner than the ' + T.toFixed(1) + ' mm plate.' });
    }

    /* Base plate. */
    var baseAcc = new Acc('base', 'Keychain', state.colors.base, pal[state.colors.base]);
    if (relief === 'raised') {
      baseAcc.addPolys(KC.contours(plateSolid, g, copts), 0, T);
    } else if (relief === 'inlay') {
      var cut = features ? KC.mask.sub(plateSolid, features) : plateSolid;
      baseAcc.addPolys(KC.contours(cut, g, copts), 0, T);
    } else { // engraved
      baseAcc.addPolys(KC.contours(plateSolid, g, copts), 0, T - e);
      var top = features ? KC.mask.sub(plateSolid, features) : plateSolid;
      baseAcc.addPolys(KC.contours(top, g, copts), T - e, T);
    }
    if (baseAcc.idx.length) parts.push(baseAcc.finish());

    /* Detail parts — omitted when engraved, since a recess has no body. */
    if (relief !== 'engraved') {
      var fz0 = relief === 'raised' ? T : 0;
      var fz1 = relief === 'raised' ? T + e : T;

      [['border', 'Border', border, state.colors.border],
       ['art', 'Picture', art, state.colors.art],
       ['text', 'Text', text, state.colors.text]].forEach(function (row) {
        if (!row[2] || KC.mask.empty(row[2])) return;
        var acc = new Acc(row[0], row[1], row[3], pal[row[3]]);
        acc.addPolys(KC.contours(row[2], g, copts), fz0, fz1);
        if (acc.idx.length) parts.push(acc.finish());
      });
    }

    /* ── stats ──────────────────────────────────────────────────── */
    var tris = 0, vol = 0;
    for (var i = 0; i < parts.length; i++) {
      tris += parts[i].indices.length / 3;
      parts[i].volume = volumeOf(parts[i]);
      vol += parts[i].volume;
    }

    var sz = KC.plateSize(state);
    var height = relief === 'raised' ? T + e : T;

    /* ── printability checks ────────────────────────────────────── */
    if (!state.hole.enabled) {
      warn.push({ level: 'warn', msg: 'No keyring hole — add one, or plan to glue on a bail.' });
    } else {
      var hc = KC.holeCentre(state);
      var wall = KC.mask.and(plate, discMask(state, g, hc, hc.r + 1.2));
      var ideal = Math.PI * (Math.pow(hc.r + 1.2, 2) - hc.r * hc.r) + Math.PI * hc.r * hc.r;
      if (KC.mask.area(wall, g) < ideal * 0.93) {
        warn.push({ level: 'bad', msg: 'The keyring hole breaks the edge of the plate. Reduce its diameter or increase the edge margin.' });
      }
    }

    if (features) {
      var thin = KC.maxInscribed(features, g) * 2;
      if (thin > 0 && thin < 0.8) {
        warn.push({ level: 'warn', msg: 'Thinnest detail is about ' + thin.toFixed(2) +
          ' mm wide — under two 0.4 mm extrusion widths, so it may print poorly. Try a bolder font or a thicker border.' });
      }
    }

    if (textRaw && !KC.mask.empty(textRaw) && (!text || KC.mask.empty(text))) {
      warn.push({ level: 'bad', msg: 'The text sits entirely off the plate.' });
    } else if (textRaw && text && KC.mask.area(text, g) < KC.mask.area(textRaw, g) * 0.97) {
      warn.push({ level: 'warn', msg: 'Some of the text is clipped by the plate edge or the keyring hole.' });
    }

    if (artRaw && !KC.mask.empty(artRaw) && (!art || KC.mask.empty(art))) {
      warn.push({ level: 'bad', msg: 'The picture sits entirely off the plate.' });
    }

    if ((state.text.content || '').trim() && (!textRaw || KC.mask.empty(textRaw))) {
      warn.push({ level: 'warn', msg: 'Text is too small to render at this size.' });
    }

    if (relief === 'inlay') {
      var used = {};
      parts.forEach(function (p) { used[p.colorIndex] = 1; });
      if (Object.keys(used).length > 1) {
        warn.push({ level: 'ok', msg: 'Inlay mode cuts details clean through the plate — needs a multi-material printer (AMS / MMU) or a manual filament swap.' });
      }
    }
    if (T < 1.2) {
      warn.push({ level: 'warn', msg: 'A ' + T.toFixed(1) + ' mm plate is quite flexible; 1.5–3 mm is a good range for keychains.' });
    }

    return {
      parts: parts, grid: g, warnings: warn,
      stats: { tris: tris, vol: vol, w: sz.w, h: sz.h, z: height, colors: countColors(parts) }
    };
  };

  function discMask(state, g, c, r) {
    var cv = KC.scratch('disc', g.cols, g.rows);
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, g.cols, g.rows);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(g.px(c.x), g.py(c.y), r * g.ppmm, 0, Math.PI * 2);
    ctx.fill();
    return KC.mask.fromCanvas(cv);
  }

  function countColors(parts) {
    var s = {};
    parts.forEach(function (p) { s[p.colorIndex] = 1; });
    return Object.keys(s).length;
  }

})(window.KC);

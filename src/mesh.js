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

  /* Decoration masks for one face, colour-separated and clipped to the plate.
     The back face is mirrored so its artwork reads correctly once flipped. */
  function faceMasks(state, which, g, plateSolid) {
    var fs = KC.faceState(state, which);
    if (!state.sides[which].enabled) {
      return { border: null, text: null, art: null, all: null, raw: {} };
    }

    var plate = KC.plateMask(fs, g);
    var border = KC.borderMask(fs, g, plate);
    var text = KC.textMask(fs, g);
    var art = KC.artMask(fs, g);

    if (which === 'back') {
      border = KC.mirrorMaskX(border, g);
      text = KC.mirrorMaskX(text, g);
      art = KC.mirrorMaskX(art, g);
    }

    var raw = { text: text, art: art };
    if (border) border = KC.mask.and(border, plateSolid);
    if (text) text = KC.mask.and(text, plateSolid);
    if (art) art = KC.mask.and(art, plateSolid);

    // Priority so colours never share a pixel: text > picture > border.
    if (art && text) art = KC.mask.sub(art, text);
    if (border && text) border = KC.mask.sub(border, text);
    if (border && art) border = KC.mask.sub(border, art);

    var all = null;
    all = KC.mask.union(all, border);
    all = KC.mask.union(all, art);
    all = KC.mask.union(all, text);

    return { border: border, text: text, art: art, all: all, raw: raw };
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
    var pal = state.colors.palette;
    var parts = [];
    var copts = { eps: 0.55 / g.ppmm, minArea: 0.03 };
    var relief = sh.relief;

    /* Decoration for each face, independently configured. */
    var F = { front: faceMasks(state, 'front', g, plateSolid),
              back:  faceMasks(state, 'back',  g, plateSolid) };
    var live = { front: !!F.front.all, back: !!F.back.all };

    var rel = KC.reliefDepthOf(state);
    var inl = KC.inlayDepthOf(state);

    /* A through-cut is a single void passing clean through the plate, so only one
       design can own it. If both faces are decorated we recess each into its own
       surface instead — otherwise one face's artwork would show on the other. */
    var through = relief === 'inlay' && inl.through;
    var dualThrough = false;
    if (through && live.front && live.back) { through = false; dualThrough = true; }
    var cutFace = live.front ? 'front' : 'back';

    /* How deep each side's detail goes. Two recessed faces must not meet in the
       middle, so their combined depth is capped. */
    var partial = KC.snapDepth(state, sh.inlayDepth, T);
    var unit = relief === 'inlay' ? (through ? inl : partial) : rel;
    var depth = { front: live.front ? unit.depth : 0, back: live.back ? unit.depth : 0 };

    var eatsPlate = (relief === 'engraved') || (relief === 'inlay' && !through);
    var squeezed = false;
    if (eatsPlate && live.front && live.back) {
      var room = T - (relief === 'engraved' ? KC.minDepthOf(state) : 0);
      if (depth.front + depth.back > room) {
        depth.front = depth.back = KC.snapDepth(state, 0, room / 2).depth;
        squeezed = true;
      }
    }

    /* Z extent of each face's detail bodies. */
    var span = {
      front: relief === 'raised' ? [T, T + depth.front] : [T - depth.front, T],
      back:  relief === 'raised' ? [-depth.back, 0]     : [0, depth.back]
    };
    if (through) span[cutFace] = [0, T];

    /* ── base plate, as a stack of z-bands ──────────────────────── */
    var baseAcc = new Acc('base', 'Keychain', state.colors.base, pal[state.colors.base]);
    var minus = function (m) { return m ? KC.mask.sub(plateSolid, m) : plateSolid; };

    if (relief === 'raised') {
      baseAcc.addPolys(KC.contours(plateSolid, g, copts), 0, T);
    } else if (through) {
      baseAcc.addPolys(KC.contours(minus(F[cutFace].all), g, copts), 0, T);
    } else {
      // bottom recess (back), solid middle, top recess (front)
      var lo = live.back ? depth.back : 0;
      var hi = T - (live.front ? depth.front : 0);
      if (lo > 1e-6) baseAcc.addPolys(KC.contours(minus(F.back.all), g, copts), 0, lo);
      if (hi - lo > 1e-6) baseAcc.addPolys(KC.contours(plateSolid, g, copts), lo, hi);
      if (T - hi > 1e-6) baseAcc.addPolys(KC.contours(minus(F.front.all), g, copts), hi, T);
    }
    if (baseAcc.idx.length) parts.push(baseAcc.finish());

    /* ── detail bodies — a recess has no body, so engraving emits none ── */
    if (relief !== 'engraved') {
      // A through-cut belongs to the one decorated face; otherwise each face has
      // its own bodies.
      (through ? [cutFace] : ['front', 'back']).forEach(function (which) {
        if (!live[which]) return;
        var m = F[which], z = span[which];
        [['border', 'Border', m.border, state.colors.border],
         ['art', 'Picture', m.art, state.colors.art],
         ['text', 'Text', m.text, state.colors.text]].forEach(function (row) {
          if (!row[2] || KC.mask.empty(row[2])) return;
          var label = row[1] + (live.front && live.back ? ' (' + which + ')' : '');
          var acc = new Acc(row[0] + '-' + which, label, row[3], pal[row[3]]);
          acc.addPolys(KC.contours(row[2], g, copts), z[0], z[1]);
          if (acc.idx.length) parts.push(acc.finish());
        });
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
    var totalUp = relief === 'raised' && live.front ? depth.front : 0;
    var totalDown = relief === 'raised' && live.back ? depth.back : 0;
    var height = T + totalUp + totalDown;

    /* ── printability checks ────────────────────────────────────── */
    if (!state.hole.enabled) {
      warn.push({ level: 'warn', msg: 'No keyring hole — add one, or plan to glue on a bail.' });
    } else {
      var hc = KC.holeCentre(state);
      var wall = KC.mask.and(plate, discMask(state, g, hc, hc.r + 1.2));
      var ideal = Math.PI * Math.pow(hc.r + 1.2, 2);
      if (KC.mask.area(wall, g) < ideal * 0.93) {
        warn.push({ level: 'bad', msg: 'The keyring hole breaks the edge of the plate. Reduce its diameter or increase the edge margin.' });
      }
    }

    if (!live.front && !live.back) {
      warn.push({ level: 'warn', msg: 'Both faces are blank — the keychain is a plain plate.' });
    }

    ['front', 'back'].forEach(function (which) {
      if (!live[which]) return;
      var m = F[which], tag = (live.front && live.back) ? ' on the ' + which : '';

      var thin = KC.maxInscribed(m.all, g) * 2;
      if (thin > 0 && thin < 0.8) {
        warn.push({ level: 'warn', msg: 'Thinnest detail' + tag + ' is about ' + thin.toFixed(2) +
          ' mm wide — under two 0.4 mm extrusion widths, so it may print poorly. Try a bolder font or a thicker border.' });
      }

      var face = state.sides[which];
      var tr = m.raw.text, ar = m.raw.art;
      if (tr && !KC.mask.empty(tr) && (!m.text || KC.mask.empty(m.text))) {
        warn.push({ level: 'bad', msg: 'The text' + tag + ' sits entirely off the plate.' });
      } else if (tr && m.text && KC.mask.area(m.text, g) < KC.mask.area(tr, g) * 0.97) {
        warn.push({ level: 'warn', msg: 'Some of the text' + tag + ' is clipped by the plate edge or the keyring hole.' });
      }
      if (ar && !KC.mask.empty(ar) && (!m.art || KC.mask.empty(m.art))) {
        warn.push({ level: 'bad', msg: 'The picture' + tag + ' sits entirely off the plate.' });
      }
      if ((face.text.content || '').trim() && (!tr || KC.mask.empty(tr))) {
        warn.push({ level: 'warn', msg: 'Text' + tag + ' is too small to render at this size.' });
      }
    });

    /* Depth / layer checks. */
    var min = KC.minDepthOf(state), lh = KC.layerHeightOf(state);
    if (relief === 'inlay') {
      if (dualThrough) {
        warn.push({ level: 'warn', msg: 'Both faces are decorated, so the inlay is recessed ' +
          depth.front.toFixed(1) + ' mm into each surface rather than cut through — a single ' +
          'through-cut can only carry one design. Turn one face off to cut all the way through.' });
      }
      if (inl.tooThin) {
        warn.push({ level: 'bad', msg: 'The plate is only ' + T.toFixed(1) + ' mm, so the inlay is ' +
          inl.layers + ' layer' + (inl.layers === 1 ? '' : 's') + ' deep at ' + lh.toFixed(2) +
          ' mm. Colour needs at least ' + KC.MIN_LAYERS + ' layers (' + min.toFixed(1) +
          ' mm) to look solid — increase the thickness.' });
      } else if (countColors(parts) > 1) {
        warn.push({ level: 'ok', msg: 'Inlay is ' + depth.front.toFixed(1) + ' mm — ' +
          Math.round(depth.front / lh) + ' layers at ' + lh.toFixed(2) + ' mm' +
          (through ? ', cut all the way through' : ', recessed into the face') +
          '. Needs a multi-material printer (AMS / MMU) or a manual filament swap.' });
      }
    } else if (relief === 'raised' || relief === 'engraved') {
      if (rel.tooThin) {
        warn.push({ level: 'bad', msg: 'Relief depth is only ' + rel.layers + ' layer' +
          (rel.layers === 1 ? '' : 's') + ' at ' + lh.toFixed(2) + ' mm. Detail needs at least ' +
          KC.MIN_LAYERS + ' layers (' + min.toFixed(1) + ' mm) to read cleanly.' });
      } else if (Math.abs(rel.depth - sh.reliefHeight) > lh * 0.5) {
        warn.push({ level: 'ok', msg: 'Relief depth snapped to ' + rel.depth.toFixed(2) + ' mm — ' +
          rel.layers + ' whole layers at ' + lh.toFixed(2) + ' mm.' });
      }
    }
    if (squeezed) {
      warn.push({ level: 'warn', msg: 'Both faces are ' +
        (relief === 'engraved' ? 'engraved' : 'inlaid') + ', so each was limited to ' +
        depth.front.toFixed(1) + ' mm to leave material in between. A thicker plate gives more room.' });
    }
    if (T < min * 2) {
      warn.push({ level: 'warn', msg: 'A ' + T.toFixed(1) + ' mm plate is quite flexible; ' +
        '1.5–3 mm is a good range for keychains.' });
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

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
    this.colorIndex = (colorIndex || color || '#000000').toUpperCase();
    this.color = color;
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

  /* Every element on one face, colour-separated and clipped to the plate. The
     back face is mirrored so its artwork reads correctly once flipped.
     Where elements overlap, the one drawn on top keeps the pixel. */
  function faceElements(state, which, g, plateSolid) {
    var face = state.sides[which];
    var out = { list: [], all: null, raw: [] };
    if (!face.enabled) return out;

    var mirror = which === 'back';
    var plate = KC.plateMask(KC.faceState(state, which), g);

    KC.faceItems(face).forEach(function (e) {
      var m = null;
      if (e.kind === 'border') m = KC.borderMask(KC.faceState(state, which), g, plate);
      else if (e.kind === 'text') m = KC.textMask(e.item, g);
      else m = KC.artMask(e.item, g);
      if (!m) return;
      if (mirror) m = KC.mirrorMaskX(m, g);
      out.raw.push({ kind: e.kind, index: e.index, mask: m });
      out.list.push({ kind: e.kind, index: e.index, item: e.item,
                      color: e.item.color, mask: KC.mask.and(m, plateSolid) });
    });

    /* Topmost wins: walk down the stack subtracting everything above. */
    var claimed = null;
    for (var i = out.list.length - 1; i >= 0; i--) {
      var full = out.list[i].mask;
      out.list[i].mask = KC.mask.sub(full, claimed);
      claimed = KC.mask.union(claimed, full);
    }
    out.list = out.list.filter(function (e) { return e.mask && !KC.mask.empty(e.mask); });

    out.list.forEach(function (e) { out.all = KC.mask.union(out.all, e.mask); });
    return out;
  }

  /* ── the whole model ────────────────────────────────────────────── */  /* ── the whole model ────────────────────────────────────────────── */
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
    var parts = [];
    var copts = { eps: 0.55 / g.ppmm, minArea: 0.03 };

    /* Decoration and relief style are both per face now. */
    var F = { front: faceElements(state, 'front', g, plateSolid),
              back:  faceElements(state, 'back',  g, plateSolid) };
    var live = { front: !!F.front.all, back: !!F.back.all };
    var FS = { front: KC.faceState(state, 'front'), back: KC.faceState(state, 'back') };
    var R = { front: KC.faceRelief(FS.front), back: KC.faceRelief(FS.back) };

    /* A through cut is one void through the plate, so only one design can own
       it; the second face falls back to a recess. Its depth has to be derived
       from the face's own inlayDepth — the through reading is the full
       thickness, which would recess the entire plate. */
    var dualThrough = false;
    if (live.front && live.back && R.front.through && R.back.through) {
      var partial = KC.snapDepth(FS.back, FS.back.inlayDepth, T);
      R.back = { style: 'inlay', depth: partial.depth, cut: partial.depth,
                 through: false, rel: R.back.rel, inl: partial };
      dualThrough = true;
    }

    /* A through cut owns its column of the plate from face to face, so the other
       side has nothing left to recess into there. Clip the other face's artwork
       out of that region, or the two bodies would occupy the same space. */
    ['front', 'back'].forEach(function (w) {
      var o = w === 'front' ? 'back' : 'front';
      if (!(live[w] && R[w].through && live[o])) return;
      F[o].list.forEach(function (e) { e.mask = KC.mask.sub(e.mask, F[w].all); });
      F[o].list = F[o].list.filter(function (e) { return !KC.mask.empty(e.mask); });
      F[o].all = null;
      F[o].list.forEach(function (e) { F[o].all = KC.mask.union(F[o].all, e.mask); });
      if (!F[o].all) live[o] = false;
    });

    var cut = { front: live.front ? R.front.cut : 0, back: live.back ? R.back.cut : 0 };

    /* Two faces cutting inwards must leave material between them. */
    var squeezed = false;
    var eats = function (w) { return live[w] && cut[w] > 0 && !R[w].through; };
    if (eats('front') && eats('back')) {
      var keep = (R.front.style === 'engraved' || R.back.style === 'engraved')
        ? KC.minDepthOf(state) : 0;
      if (cut.front + cut.back > T - keep) {
        var each = KC.snapDepth(state, 0, (T - keep) / 2).depth;
        cut.front = Math.min(cut.front, each);
        cut.back = Math.min(cut.back, each);
        squeezed = true;
      }
    }

    /* Where each face's coloured body sits, and which slab of plate it removes. */
    var span = {}, remove = [];
    ['front', 'back'].forEach(function (w) {
      if (!live[w]) return;
      var r = R[w], d = r.depth, c = cut[w];
      if (r.style === 'raised') {
        span[w] = w === 'front' ? [T, T + d] : [-d, 0];
      } else if (r.through) {
        span[w] = [0, T];
        remove.push({ lo: 0, hi: T, mask: F[w].all });
      } else {
        span[w] = w === 'front' ? [T - c, T] : [0, c];
        remove.push({ lo: span[w][0], hi: span[w][1], mask: F[w].all });
        if (r.style === 'engraved') delete span[w];      // a recess has no body
      }
    });

    /* ── base plate, as bands between every z where something changes ── */
    var baseAcc = new Acc('base', 'Keychain', state.plateColor, state.plateColor);
    var cuts = [0, T];
    remove.forEach(function (r) { cuts.push(r.lo, r.hi); });
    cuts = cuts.filter(function (z) { return z >= -1e-9 && z <= T + 1e-9; })
               .sort(function (a, b) { return a - b; })
               .filter(function (z, i, a) { return i === 0 || z - a[i - 1] > 1e-6; });

    for (var bi = 0; bi < cuts.length - 1; bi++) {
      var lo = cuts[bi], hi = cuts[bi + 1];
      if (hi - lo < 1e-6) continue;
      var mid = (lo + hi) / 2, m = plateSolid;
      remove.forEach(function (r) {
        if (mid > r.lo + 1e-9 && mid < r.hi - 1e-9) m = KC.mask.sub(m, r.mask);
      });
      baseAcc.addPolys(KC.contours(m, g, copts), lo, hi);
    }
    if (baseAcc.idx.length) parts.push(baseAcc.finish());

    /* ── coloured detail bodies, one per element ────────────────────── */
    var NAME = { border: 'Border', text: 'Text', art: 'Picture' };
    ['front', 'back'].forEach(function (w) {
      if (!live[w] || !span[w]) return;
      var z = span[w];
      F[w].list.forEach(function (e) {
        var n = e.kind === 'border' ? '' : ' ' + (e.index + 1);
        var label = NAME[e.kind] + n + (live.front && live.back ? ' (' + w + ')' : '');
        var key = e.kind + (e.kind === 'border' ? '' : (e.index + 1)) + '-' + w;
        var acc = new Acc(key, label, e.color, e.color);
        acc.addPolys(KC.contours(e.mask, g, copts), z[0], z[1]);
        if (acc.idx.length) parts.push(acc.finish());
      });
    });

    /* ── stats ──────────────────────────────────────────────────── */
    var tris = 0, vol = 0;
    for (var i = 0; i < parts.length; i++) {
      tris += parts[i].indices.length / 3;
      parts[i].volume = volumeOf(parts[i]);
      vol += parts[i].volume;
    }

    var sz = KC.plateSize(state);
    var up   = (live.front && R.front.style === 'raised') ? R.front.depth : 0;
    var down = (live.back  && R.back.style  === 'raised') ? R.back.depth  : 0;
    var height = T + up + down;

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

      /* Per element: is it off the plate, clipped, or too small to render? */
      var face = state.sides[which];
      var placed = {};
      m.list.forEach(function (e) { placed[e.kind + (e.index || 0)] = e.mask; });

      m.raw.forEach(function (r) {
        var live2 = placed[r.kind + (r.index || 0)];
        var what = r.kind === 'text' ? 'Text' : r.kind === 'art' ? 'Picture' : 'The border';
        var n = r.kind === 'border' ? '' : ' ' + ((r.index || 0) + 1);
        if (!live2 || KC.mask.empty(live2)) {
          if (r.kind !== 'border') {
            warn.push({ level: 'bad', msg: what + n + tag +
              ' sits entirely off the plate, or is hidden behind something on top of it.' });
          }
        } else if (KC.mask.area(live2, g) < KC.mask.area(r.mask, g) * 0.97) {
          warn.push({ level: 'warn', msg: what + n + tag +
            ' is partly clipped by the plate edge, the keyring hole, or an element above it.' });
        }
      });

      (face.texts || []).forEach(function (tx, i) {
        if (!(tx.content || '').trim()) return;
        var got = m.raw.some(function (r) { return r.kind === 'text' && r.index === i; });
        if (!got) {
          warn.push({ level: 'warn', msg: 'Text ' + (i + 1) + tag +
            ' is too small to render at this size.' });
        }
      });
    });

    /* Depth / layer checks, per face. */
    var min = KC.minDepthOf(state), lh = KC.layerHeightOf(state);

    if (dualThrough) {
      warn.push({ level: 'warn', msg: 'Both faces asked to cut all the way through, but a ' +
        'through cut is a single void that can only carry one design — the back was ' +
        'recessed ' + cut.back.toFixed(1) + ' mm into its own surface instead.' });
    }
    if (squeezed) {
      warn.push({ level: 'warn', msg: 'Both faces cut into the plate, so each was limited to ' +
        cut.front.toFixed(1) + ' mm to leave material in between. A thicker plate gives more room.' });
    }

    ['front', 'back'].forEach(function (w) {
      if (!live[w]) return;
      var r = R[w], tag = (live.front && live.back) ? ' on the ' + w : '';
      var layers = Math.round(r.depth / lh);

      if (r.style === 'inlay') {
        if (r.inl.tooThin) {
          warn.push({ level: 'bad', msg: 'The inlay' + tag + ' is only ' + layers + ' layer' +
            (layers === 1 ? '' : 's') + ' deep at ' + lh.toFixed(2) + ' mm. Colour needs at ' +
            'least ' + KC.MIN_LAYERS + ' layers (' + min.toFixed(1) + ' mm) to look solid.' });
        }
      } else if (r.rel.tooThin) {
        warn.push({ level: 'bad', msg: 'Relief depth' + tag + ' is only ' + layers + ' layer' +
          (layers === 1 ? '' : 's') + ' at ' + lh.toFixed(2) + ' mm. Detail needs at least ' +
          KC.MIN_LAYERS + ' layers (' + min.toFixed(1) + ' mm) to read cleanly.' });
      }
    });

    if (countColors(parts) > 1) {
      var styles = ['front', 'back'].filter(function (w) { return live[w]; })
        .map(function (w) { return w + ' ' + R[w].style + (R[w].through ? ' (through)' : ''); });
      warn.push({ level: 'ok', msg: 'Colour needs a multi-material printer (AMS / CFS / MMU) — ' +
        styles.join(', ') + '.' });
    }

    /* A single-extruder machine maps every part to extruder 1, so the print
       preview comes out one colour. Raised relief puts each colour in its own
       band of layers, so a filament change at the right layer does it by hand. */
    var raisedFront = live.front && R.front.style === 'raised';
    var raisedBack = live.back && R.back.style === 'raised';
    if (countColors(parts) > 1 && (raisedFront || raisedBack)) {
      var atLayer = function (z) { return Math.round(z / lh) + 1; };
      var base0 = raisedBack ? R.back.depth : 0;
      var stops = [];
      if (raisedBack) stops.push('layer ' + atLayer(base0) + ' (Z ' + base0.toFixed(1) + ' mm) for the plate');
      if (raisedFront) stops.push('layer ' + atLayer(base0 + T) + ' (Z ' + (base0 + T).toFixed(1) +
                                  ' mm) for the front detail');
      if (stops.length) {
        warn.push({ level: 'ok', msg: 'Single extruder? Every thickness is a whole number of ' +
          lh.toFixed(2) + ' mm layers, so a filament change at ' + stops.join(', then ') +
          ' gives the same result by hand.' });
      }
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

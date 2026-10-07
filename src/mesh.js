/* Keychain Studio. Copyright (C) 2026 shahidhussain2k13@gmail.com
 * SPDX-License-Identifier: GPL-3.0-or-later — see LICENSE. */
/* mesh.js — masks → colour-separated, watertight solids.
 *
 * Every element is traced from its mask and extruded with Manifold, whose
 * booleans always return closed, consistently oriented meshes. Colour regions
 * are made mutually exclusive (text wins over picture wins over border), first
 * in 2-D and then exactly as solids, so no two filaments ever claim the same
 * space. A recess is cut with the very bodies that fill it, so inlays fit with
 * no gap or overlap.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var WASM = null;
  KC.setManifold = function (w) { WASM = w; };
  KC.engineReady = function () { return !!WASM; };

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
      if (e.kind === 'border') m = WB.borderMask(state.sides[which].border, KC.faceOutline(state), g, plate);
      else if (e.kind === 'text') m = WB.textMask(e.item, g);
      else m = WB.artMask(e.item, g);
      if (!m) return;
      // Text and pictures read the right way round from the back; the border
      // follows the plate's own outline, which is not mirrored.
      if (mirror && e.kind !== 'border') m = WB.mirrorMaskX(m, g);
      out.raw.push({ kind: e.kind, index: e.index, mask: m });
      out.list.push({ kind: e.kind, index: e.index, item: e.item,
                      color: e.item.color, mask: WB.mask.and(m, plateSolid) });
    });

    /* Topmost wins: walk down the stack subtracting everything above. */
    var claimed = null;
    for (var i = out.list.length - 1; i >= 0; i--) {
      var full = out.list[i].mask;
      out.list[i].mask = WB.mask.sub(full, claimed);
      claimed = WB.mask.union(claimed, full);
    }
    out.list = out.list.filter(function (e) { return e.mask && !WB.mask.empty(e.mask); });

    out.list.forEach(function (e) { out.all = WB.mask.union(out.all, e.mask); });
    return out;
  }

  /* ── the whole model ────────────────────────────────────────────── */  /* ── the whole model ────────────────────────────────────────────── */
  KC.buildModel = function (state, ppmm) {
    var g = KC.makeGrid(state, ppmm);
    var sh = state.shape;
    var T = sh.thickness;
    var warn = [];

    var plate = KC.plateMask(state, g);
    if (WB.mask.empty(plate)) {
      return { parts: [], stats: { tris: 0, vol: 0 }, grid: g,
               warnings: [{ level: 'bad', msg: 'The keychain outline is empty — pick a preset or draw a custom outline.' }] };
    }

    var hole = KC.holeMask(state, g);
    var plateSolid = WB.mask.sub(plate, hole);

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
      F[o].list.forEach(function (e) { e.mask = WB.mask.sub(e.mask, F[w].all); });
      F[o].list = F[o].list.filter(function (e) { return !WB.mask.empty(e.mask); });
      F[o].all = null;
      F[o].list.forEach(function (e) { F[o].all = WB.mask.union(F[o].all, e.mask); });
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

    /* ── solids ─────────────────────────────────────────────────────
       Every Manifold object made here goes on `made` and is freed at the end. */
    var made = [];
    var keep = function (o) { made.push(o); return o; };
    var prism = function (mask, z0, z1) {
      if (!mask || z1 - z0 < 1e-6) return null;
      var rings = [];
      WB.contours(mask, g, copts).forEach(function (poly) {
        rings.push(poly.outer.map(function (q) { return [q.x, q.y]; }));
        poly.holes.forEach(function (h) { rings.push(h.map(function (q) { return [q.x, q.y]; })); });
      });
      if (!rings.length) return null;
      var cs = keep(new WASM.CrossSection(rings, 'EvenOdd'));
      if (cs.isEmpty()) return null;
      var m = keep(keep(cs.extrude(z1 - z0)).translate([0, 0, z0]));
      return m.isEmpty() ? null : m;
    };
    var unite = function (list) {
      list = list.filter(Boolean);
      if (!list.length) return null;
      return list.length === 1 ? list[0] : keep(WASM.Manifold.union(list));
    };
    var toPart = function (solid, key, label, color) {
      var mesh = WB.meshOf(solid);
      return { key: key, label: label, color: color,
               colorIndex: (color || '#000000').toUpperCase(),
               positions: mesh.positions, indices: mesh.indices };
    };

    try {
      /* Coloured detail bodies, one per element, topmost first claiming its
         space exactly (the masks already agree; this settles the last hair
         where two traced outlines meet). */
      var NAME = { border: 'Border', text: 'Text', art: 'Picture' };
      var bodies = { front: [], back: [] };
      ['front', 'back'].forEach(function (w) {
        if (!live[w] || !span[w]) return;
        var z = span[w], above = null;
        var list = F[w].list.map(function (e) { return { e: e, m: prism(e.mask, z[0], z[1]) }; })
                            .filter(function (b) { return b.m; });
        for (var i = list.length - 1; i >= 0; i--) {
          var full = list[i].m;
          if (above) list[i].m = keep(full.subtract(above));
          above = above ? keep(above.add(full)) : full;
        }
        bodies[w] = list.filter(function (b) { return !b.m.isEmpty(); });
      });
      /* Across faces too: where a through cut on the front shares the column
         with artwork on the back, the front keeps it. */
      var frontAll = unite(bodies.front.map(function (b) { return b.m; }));
      if (frontAll && bodies.back.length) {
        bodies.back = bodies.back.map(function (b) { return { e: b.e, m: keep(b.m.subtract(frontAll)) }; })
                                 .filter(function (b) { return !b.m.isEmpty(); });
      }

      /* The plate, less every recess: an inlay or through cut is removed with
         its own bodies; an engraving, which has none, with its outline. */
      var plateBody = prism(plateSolid, 0, T);
      var cutters = [];
      ['front', 'back'].forEach(function (w) {
        if (!live[w]) return;
        var r = R[w];
        if (r.style === 'raised') return;
        if (span[w]) cutters.push(unite(bodies[w].map(function (b) { return b.m; })));
        else {
          var rm = remove.filter(function (q) { return q.mask === F[w].all; })[0];
          if (rm) cutters.push(prism(rm.mask, rm.lo, rm.hi));
        }
      });
      var cutAll = unite(cutters);
      if (plateBody && cutAll) plateBody = keep(plateBody.subtract(cutAll));
      if (plateBody && !plateBody.isEmpty()) parts.push(toPart(plateBody, 'base', 'Keychain', state.plateColor));

      ['front', 'back'].forEach(function (w) {
        bodies[w].forEach(function (b) {
          var e = b.e;
          var n = e.kind === 'border' ? '' : ' ' + (e.index + 1);
          var label = NAME[e.kind] + n + (live.front && live.back ? ' (' + w + ')' : '');
          var key = e.kind + (e.kind === 'border' ? '' : (e.index + 1)) + '-' + w;
          parts.push(toPart(b.m, key, label, e.color));
        });
      });
    } finally {
      made.forEach(function (o) { try { o.delete(); } catch (err) { /* already freed */ } });
    }

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
      var wall = WB.mask.and(plate, discMask(state, g, hc, hc.r + 1.2));
      var ideal = Math.PI * Math.pow(hc.r + 1.2, 2);
      if (WB.mask.area(wall, g) < ideal * 0.93) {
        warn.push({ level: 'bad', msg: 'The keyring hole breaks the edge of the plate. Reduce its diameter or increase the edge margin.' });
      }
    }

    if (!live.front && !live.back) {
      warn.push({ level: 'warn', msg: 'Both faces are blank — the keychain is a plain plate.' });
    }

    ['front', 'back'].forEach(function (which) {
      if (!live[which]) return;
      var m = F[which], tag = (live.front && live.back) ? ' on the ' + which : '';

      var thin = WB.maxInscribed(m.all, g) * 2;
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
        if (!live2 || WB.mask.empty(live2)) {
          if (r.kind !== 'border') {
            warn.push({ level: 'bad', msg: what + n + tag +
              ' sits entirely off the plate, or is hidden behind something on top of it.' });
          }
        } else if (WB.mask.area(live2, g) < WB.mask.area(r.mask, g) * 0.97) {
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
    var cv = WB.scratch('disc', g.cols, g.rows);
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, g.cols, g.rows);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(g.px(c.x), g.py(c.y), r * g.ppmm, 0, Math.PI * 2);
    ctx.fill();
    return WB.mask.fromCanvas(cv);
  }

  function countColors(parts) {
    var s = {};
    parts.forEach(function (p) { s[p.colorIndex] = 1; });
    return Object.keys(s).length;
  }

})(window.KC);

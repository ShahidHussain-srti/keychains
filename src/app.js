/* Keychain Studio. Copyright (C) 2026 shahidhussain2k13@gmail.com
 * SPDX-License-Identifier: GPL-3.0-or-later — see LICENSE. */
/* app.js — UI wiring: declarative bindings, live preview, export. */
(function (KC) {
  'use strict';

  var state = KC.defaults();
  var preview, viewer, drawpad;
  var lastModel = null;
  var view = 'both';
  function show3d() { return view !== '2d'; }
  function show2d() { return view !== '3d'; }

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── option lists ───────────────────────────────────────────────── */
  function populate() {
    var sp = $('#shape-preset');
    KC.SHAPES.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s[0]; o.textContent = s[1];
      sp.appendChild(o);
    });

    var bs = $('#f-b-style');
    WB.BORDER_STYLES.forEach(function (st) {
      var o = document.createElement('option');
      o.value = st[0]; o.textContent = st[1];
      bs.appendChild(o);
    });

    var fs = $('#font-select'), groups = {};
    WB.FONTS.forEach(function (f) {
      var g = groups[f.group];
      if (!g) {
        g = groups[f.group] = document.createElement('optgroup');
        g.label = f.group;
        fs.appendChild(g);
      }
      var o = document.createElement('option');
      o.value = f.key; o.textContent = f.name;
      o.style.fontFamily = f.css;      // preview the face in the dropdown
      g.appendChild(o);
    });

  }

  /* One colour per element, so the count is whatever the design needs. */
  function paintColours() {
    var used = KC.coloursUsed(state);
    var box = $('#used-colours');
    if (box) {
      box.innerHTML = '';
      used.forEach(function (c) {
        var d = document.createElement('div');
        d.className = 's';
        d.style.background = c;
        d.title = c;
        box.appendChild(d);
      });
    }
    var n = used.length;
    $('#color-count').textContent = n + (n === 1 ? ' colour' : ' colours') + ' in use — ' +
      (n === 1 ? 'prints on any machine.'
               : n + ' filaments, or ' + (n - 1) + ' manual swap' + (n === 2 ? '' : 's') + '.');
  }

  /* ── element lists ──────────────────────────────────────────────── */
  function faceNow() { return state.sides[state.activeSide]; }

  function paintLists() {
    var f = faceNow();
    [['text', '#text-list', f.texts, f.textIdx],
     ['art', '#art-list', f.arts, f.artIdx]].forEach(function (row) {
      var box = $(row[1]);
      if (!box) return;
      box.innerHTML = '';
      (row[2] || []).forEach(function (item, i) {
        var b = document.createElement('button');
        b.className = 'itemrow' + (i === row[3] ? ' on' : '');
        b.type = 'button';
        var label = row[0] === 'text'
          ? ((item.content || '').split('\n')[0] || '(empty)')
          : (item.source === 'none' ? '(empty)' : item.source === 'draw' ? 'drawing' : 'image');
        b.innerHTML = '<span class="dot"></span><span class="txt"></span>' +
                      '<span class="num">' + (i + 1) + '</span>';
        $('.dot', b).style.background = item.color;
        $('.txt', b).textContent = label;
        b.addEventListener('click', function () {
          f[row[0] === 'text' ? 'textIdx' : 'artIdx'] = i;
          preview.selected = row[0] + ':' + i;
          refresh();
          apply();
        });
        box.appendChild(b);
      });
    });

    var f2 = faceNow();
    var te = $('#text-editor'), ae = $('#art-editor');
    if (te) te.hidden = !(f2.texts || []).length;
    if (ae) ae.hidden = !(f2.arts || []).length;
    $('#btn-del-text').disabled = !(f2.texts || []).length;
    $('#btn-del-art').disabled = !(f2.arts || []).length;
  }

  function bindLists() {
    $('#btn-add-text').addEventListener('click', function () {
      beginEdit(0);
      var f = faceNow();
      var last = f.texts[f.texts.length - 1];
      f.texts.push(KC.newText(last ? { content: '', font: last.font, size: last.size,
                                       color: last.color, x: last.x,
                                       y: last.y - last.size * 1.4 } : null));
      f.textIdx = f.texts.length - 1;
      preview.selected = 'text:' + f.textIdx;
      refresh(); apply();
    });

    $('#btn-del-text').addEventListener('click', function () {
      var f = faceNow();
      if (!f.texts.length) return;
      beginEdit(0);
      f.texts.splice(f.textIdx, 1);
      f.textIdx = Math.max(0, Math.min(f.textIdx, f.texts.length - 1));
      preview.selected = null;
      refresh(); apply();
    });

    $('#btn-add-art').addEventListener('click', function () {
      beginEdit(0);
      var f = faceNow();
      f.arts.push(KC.newArt());
      f.artIdx = f.arts.length - 1;
      preview.selected = 'art:' + f.artIdx;
      refresh(); apply();
    });

    $('#btn-del-art').addEventListener('click', function () {
      var f = faceNow();
      if (!f.arts.length) return;
      beginEdit(0);
      var gone = f.arts.splice(f.artIdx, 1)[0];
      if (gone) { delete KC.assets.images[gone.id]; delete KC.assets.drawings[gone.id]; }
      f.artIdx = Math.max(0, Math.min(f.artIdx, f.arts.length - 1));
      preview.selected = null;
      refresh(); apply();
    });
  }

  /* ── undo / redo ─  /* ── undo / redo ────────────────────────────────────────────────────
     The whole design is small and JSON-safe, so history is just a stack of
     snapshots. A burst of changes from dragging one slider is coalesced into a
     single step: the pre-edit snapshot is captured once at the start of the
     burst and only committed after things go quiet. */

  function snapshot() {
    return {
      state: JSON.stringify(state),
      assets: { customShape: KC.assets.customShape,
                images: Object.assign({}, KC.assets.images),
                drawings: Object.assign({}, KC.assets.drawings) }
    };
  }


  function restore(snap) {
    var s = JSON.parse(snap.state);
    // Assign in place so anything holding a reference to `state` stays valid.
    Object.keys(state).forEach(function (k) { if (!(k in s)) delete state[k]; });
    Object.keys(s).forEach(function (k) { state[k] = s[k]; });
    KC.assets.customShape = snap.assets.customShape;
    KC.assets.images = Object.assign({}, snap.assets.images);
    KC.assets.drawings = Object.assign({}, snap.assets.drawings);
    preview.drag = preview.resize = null;
    preview.invalidateBorder();
    refresh();
    apply();
  }

  /* Call immediately BEFORE mutating state. */
  var undoHistory = null;           // set up in init(), once the buttons exist
  /* Call immediately BEFORE changing the design. */
  function beginEdit(coalesceMs) { if (undoHistory) undoHistory.begin(coalesceMs); }
  /* Load a design as one undo step. Loading can wait on pictures, so the step
     stays open until it is in. */
  function loadAsStep(payload, after) {
    if (undoHistory) undoHistory.commit();             // close any edit still pending first
    beginEdit(600000);
    loadPayload(payload, function () { after(); if (undoHistory) undoHistory.commit(); });
  }





  /* Text fields have their own native undo; leave those alone. */

  function bindHistory() {
    undoHistory = new WB.History({ snapshot: snapshot, restore: restore,
                               undoButton: $('#btn-undo'), redoButton: $('#btn-redo') });
    undoHistory.bind();
  }

  /* ── declarative two-way binding ──────────────────────────────────
     A `~.` prefix means "the side currently being edited", so one set of
     controls drives whichever face is selected. */
  function P(path) {
    var side = state.activeSide, f = state.sides[side];
    if (path.indexOf('~t.') === 0) {
      return 'sides.' + side + '.texts.' + (f.textIdx || 0) + '.' + path.slice(3);
    }
    if (path.indexOf('~a.') === 0) {
      return 'sides.' + side + '.arts.' + (f.artIdx || 0) + '.' + path.slice(3);
    }
    return path.charAt(0) === '~' ? 'sides.' + side + path.slice(1) : path;
  }

  /* ── drag to change a number ────────────────────────────────────────
     As in Unity's inspector: the label, and the left and right edges of the
     box, are drag handles. Drag sideways to change the value — Shift for big
     steps, Alt for fine ones; click the middle of the box to type. */



  /* ── exact numbers beside the sliders ─────────────────────────────
     Each slider's readout becomes a box you can type into or drag (above).
     It writes the setting itself, so percentages can be shown as 0–100 while
     the design stores 0–1; layer snapping still happens in updateRanges(). */
  var NUM_UNITS = { mm: ['mm', 1], n: ['', 1], deg: ['°', 1], pct: ['%', 100], x: ['×', 1] };

  function enhanceNumbers() {
    $$('.row b[data-val]').forEach(function (b) {
      var row = b.closest('.row'), path = b.dataset.val;
      var num = $('input[type=range][data-bind="' + path + '"]', row);
      if (!num) return;
      var u = NUM_UNITS[b.dataset.fmt || 'mm'] || NUM_UNITS.mm, k = u[1];
      var label = b.parentNode;
      b.remove();
      label.textContent = label.textContent.trim();
      // The slider becomes the number box: same id, so the code that moves its
      // limits (updateRanges) keeps working. Limits stay in design units
      // unless shown scaled (percentages), which are converted once here.
      num.type = 'number';
      delete num.dataset.bind;
      num.dataset.numfor = path; num.dataset.scale = k;
      if (k !== 1) { num.min = num.min * k; num.max = num.max * k; num.step = num.step * k; }
      var nf = document.createElement('span');
      nf.className = 'nf'; nf.dataset.unit = u[0];
      row.classList.add('num');
      row.insertBefore(nf, num);
      nf.appendChild(num);

      num.addEventListener('input', function () {
        if (WB.get(state, P(path)) === undefined) return;
        var v = parseFloat(num.value);
        if (!isFinite(v)) return;                        // half-typed
        var lo = parseFloat(num.min), hi = parseFloat(num.max);
        if (v < lo) return;                              // may still be typing ("1" on the way to "12")
        if (v > hi) v = hi;
        beginEdit(450);
        WB.set(state, P(path), v / k);
        onEdit(path);
      });
      num.addEventListener('change', function () {
        var v = parseFloat(num.value), lo = parseFloat(num.min), hi = parseFloat(num.max);
        if (isFinite(v) && WB.get(state, P(path)) !== undefined) {
          v = WB.clamp(v, lo, hi);
          if (Math.abs(v / k - WB.get(state, P(path))) > 1e-9) { beginEdit(0); WB.set(state, P(path), v / k); onEdit(path); }
        }
        syncNumbers(true);
      });
      WB.scrubbable(num, label);
    });
  }

  function syncNumbers(force) {
    $$('input[data-numfor]').forEach(function (num) {
      var k = +num.dataset.scale, v = WB.get(state, P(num.dataset.numfor));
      if (v === undefined) { num.value = ''; return; }
      if (!force && document.activeElement === num) return;   // don't fight typing
      var dp = Math.min(4, (String(+(+num.step).toFixed(6)).split('.')[1] || '').length);
      num.value = (v * k).toFixed(dp).replace(/\.0+$|(\.\d*?)0+$/, '$1') || '0';
    });
  }

  function coerce(path, raw) {
    var cur = WB.get(state, P(path));
    if (typeof cur === 'number') return parseFloat(raw);
    if (typeof cur === 'boolean') return !!raw;
    return raw;
  }

  function bind() {
    $$('[data-bind]').forEach(function (el) {
      var path = el.dataset.bind;

      if (el.classList.contains('seg')) {
        $$('button', el).forEach(function (b) {
          b.addEventListener('click', function () {
            beginEdit(0);
            WB.set(state, P(path), coerce(path, b.value));
            syncSeg(el, path);
            onEdit(path);
          });
        });
        return;
      }

      var ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color')
        ? 'change' : 'input';
      el.addEventListener(ev, function () {
        if (WB.get(state, P(path)) === undefined) return;   // no such element selected
        // Sliders and typing coalesce into one undo step; discrete pickers don't.
        var continuous = el.type === 'range' || el.tagName === 'TEXTAREA' ||
                         el.type === 'text' || el.type === 'color';
        beginEdit(continuous ? 450 : 0);
        var v = el.type === 'checkbox' ? el.checked : el.value;
        WB.set(state, P(path), coerce(path, v));
        onEdit(path);
      });
      // Range inputs also need the live drag, which 'input' already gives us.
    });
  }

  /* ── reset a section ────────────────────────────────────────────────
     Every setting the panel shows goes back to its default; what you typed
     or uploaded is kept. */
  // activeSide only says which face the panel edits; resetting it would send
  // the rest of the reset to the other face.
  var KEEP = /^~t\.content$|^~a\.(source|id)$|^name$|^activeSide$/;
  function defaultFor(path) {
    if (path.indexOf('~t.') === 0) return WB.get(KC.newText(), path.slice(3));
    if (path.indexOf('~a.') === 0) return WB.get(KC.newArt(), path.slice(3));
    return WB.get(KC.defaults(), P(path));
  }
  function resetPanel(panel) {
    var paths = WB.panelPaths(panel).filter(function (p) { return !KEEP.test(p) && WB.get(state, P(p)) !== undefined; });
    var changed = paths.filter(function (p) {
      var d = defaultFor(p);
      return d !== undefined && JSON.stringify(d) !== JSON.stringify(WB.get(state, P(p)));
    });
    if (!changed.length) return;
    beginEdit(0);
    changed.forEach(function (p) {
      var d = defaultFor(p);
      WB.set(state, P(p), d && typeof d === 'object' ? JSON.parse(JSON.stringify(d)) : d);
    });
    preview.invalidateBorder();
    refresh();
    paintSide();
    apply();
  }

  function syncSeg(el, path) {
    var v = String(WB.get(state, P(path)));
    $$('button', el).forEach(function (b) { b.classList.toggle('on', b.value === v); });
  }

  /* Push state → DOM (used on load / reset). */
  function refresh() {
    updateRanges();
    $$('[data-bind]').forEach(function (el) {
      var path = el.dataset.bind;
      var v = WB.get(state, P(path));
      if (el.classList.contains('seg')) { syncSeg(el, path); return; }
      if (v === undefined) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    paintColours();
  }

  /* Value read-outs. */
  var FMT = {
    mm:  function (v) { return (Math.round(v * 100) / 100) + ' mm'; },
    n:   function (v) { return String(Math.round(v)); },
    x:   function (v) { return v.toFixed(2) + '×'; },
    deg: function (v) { return Math.round(v) + '°'; },
    pct: function (v) { return Math.round(v * 100) + '%'; }
  };
  function labels() {
    syncNumbers();
    $$('[data-val]').forEach(function (el) {
      var v = WB.get(state, P(el.dataset.val));
      if (v === undefined) { el.textContent = ''; return; }
      var f = FMT[el.dataset.fmt || 'mm'] || FMT.mm;
      el.textContent = typeof v === 'number' ? f(v) : String(v);
    });
  }

  /* Position sliders track the plate size; inlay depth tracks thickness and
     layer height, so it can only land on whole layers. */
  function updateRanges() {
    var sz = KC.plateSize(state);
    var lim = Math.max(20, Math.ceil(Math.max(sz.w, sz.h) / 2) + 8);
    ['#f-t-x', '#f-t-y', '#f-a-x', '#f-a-y', '#f-hole-x', '#f-hole-y'].forEach(function (sel) {
      var el = $(sel);
      if (el) { el.min = -lim; el.max = lim; }
    });

    /* Depth limits all follow from thickness and layer height, so they move
       whenever either does — and any value left outside the new range is pulled
       back in, otherwise the slider and the mesh would disagree. */
    var T = state.shape.thickness, lh = KC.layerHeightOf(state), minD = KC.minDepthOf(state);

    /* Every thickness in the model is a whole number of layers — the plate as
       well as the detail depths — so nothing ever asks the slicer for a partial
       layer. The slider's own min is layer-aligned, so with step = layer height
       every reachable value is a multiple. */
    var lay = function (v) { return WB.tidy(Math.round(v / lh) * lh); };
    var minT = Math.max(minD, WB.tidy(Math.ceil(0.6 / lh - 1e-6) * lh));
    var maxT = WB.tidy(minT + Math.floor((5 - minT) / lh + 1e-6) * lh);

    var snappedT = WB.clamp(lay(state.shape.thickness), minT, maxT);
    if (Math.abs(snappedT - state.shape.thickness) > 1e-9) state.shape.thickness = snappedT;
    T = state.shape.thickness;

    var th = $('#f-shape-thickness');
    if (th) {
      th.min = minT.toFixed(2);
      th.max = maxT.toFixed(2);
      th.step = lh.toFixed(2);
      th.value = T;
    }

    var face = state.sides[state.activeSide];

    var maxInlay = Math.max(minD, T);
    face.inlayDepth = WB.clamp(lay(face.inlayDepth), Math.min(minD, maxInlay), maxInlay);
    var d = $('#f-inlayDepth');
    if (d) {
      d.min = Math.min(minD, maxInlay).toFixed(2);
      d.max = maxInlay.toFixed(2);
      d.step = lh.toFixed(2);
      d.value = face.inlayDepth;
    }

    var maxRelief = face.relief === 'engraved' ? Math.max(minD, T - minD) : 3;
    face.reliefHeight = WB.clamp(lay(face.reliefHeight), minD, Math.max(minD, maxRelief));
    var rh = $('#f-reliefHeight');
    if (rh) {
      rh.min = minD.toFixed(2);
      rh.max = Math.max(minD, maxRelief).toFixed(2);
      rh.step = lh.toFixed(2);
      rh.value = face.reliefHeight;
    }

    var inl = KC.inlayDepthOf(state);
    /* The two shared border numbers mean different things per style. */
    var bstyle = state.sides[state.activeSide].border.style;
    var wavy = WB.isWavyBorder(bstyle);
    var gl = $('#lbl-b-gap'), dl = $('#lbl-b-dashes');
    if (gl) gl.textContent = wavy ? 'Wave depth' : 'Gap';
    if (dl) dl.textContent = wavy ? 'Waves' : 'Count';

    var lbl = $('#inlay-layers');
    if (lbl) {
      lbl.textContent = inl.depth.toFixed(2) + ' mm deep = ' + inl.layers + ' layer' +
        (inl.layers === 1 ? '' : 's') + ' at ' + inl.lh.toFixed(2) + ' mm' +
        (inl.tooThin ? ' \u2014 under the ' + KC.MIN_INLAY_LAYERS + '-layer minimum' : '');
    }
  }

  /* Conditional rows. */
  function visibility() {
    $$('[data-show],[data-hide]').forEach(function (el) {
      var show = true;
      if (el.dataset.show) show = match(el.dataset.show);
      if (el.dataset.hide && match(el.dataset.hide)) show = false;
      el.style.display = show ? '' : 'none';
    });
  }
  function match(rule) {
    var i = rule.indexOf(':');
    var path = rule.slice(0, i), vals = rule.slice(i + 1).split('|');
    var cur = String(WB.get(state, P(path)));
    return vals.indexOf(cur) >= 0;
  }

  /* ── build / render ─────────────────────────────────────────────── */
  function capPpmm(ppmm, maxCells) {
    var sz = KC.plateSize(state);
    var cells = (sz.w + 8) * (sz.h + 8) * ppmm * ppmm;
    if (cells <= maxCells) return ppmm;
    return Math.max(5, ppmm * Math.sqrt(maxCells / cells));
  }

  var rebuild = WB.debounce(function () {
    if (!KC.engineReady()) return;          // loadEngine() rebuilds once it's up
    var ppmm = capPpmm(Math.min(state.quality, 18), 3.2e6);
    var t0 = performance.now();
    var model;
    try {
      model = KC.buildModel(state, ppmm);
    } catch (err) {
      showWarnings([{ level: 'bad', msg: 'Could not build the mesh: ' + err.message }]);
      return;
    }
    lastModel = model;

    if (viewer && !viewer.failed) {
      var first = !viewer.count;
      viewer.setModel(model.parts);
      if (first) viewer.frame();
      if (show3d()) viewer.draw();
    }

    stats(model, performance.now() - t0);
    showWarnings(model.warnings);
  }, 220);

  function stats(model, ms) {
    var s = model.stats;
    $('#stat-dims').innerHTML = '<b>' + s.w.toFixed(1) + ' × ' + s.h.toFixed(1) +
      ' × ' + s.z.toFixed(1) + '</b> mm';
    $('#stat-tris').innerHTML = '<b>' + s.tris.toLocaleString() + '</b> triangles';
    var grams = s.vol / 1000 * 1.24;   // PLA
    $('#stat-mass').innerHTML = '<b>' + grams.toFixed(2) + '</b> g · ' + Math.round(ms) + ' ms';
  }

  /* Notices stay above the build warnings until dismissed, since those are
     redrawn on every rebuild. */

  var warnings = null;
  function warningsStrip() { return warnings || (warnings = new WB.Warnings($('#warnings'))); }
  function showWarnings(list) { warningsStrip().show(list); }
  function notice(level, msg) { warningsStrip().notice(level, msg); }

  function apply() {
    updateRanges();
    visibility();
    labels();
    paintLists();
    // Keep segmented toggles honest even if state changed without a refresh().
    // Safe to do on every pass: they are buttons, so there is no caret or
    // in-progress input to disturb.
    $$('[data-bind]').forEach(function (el) {
      if (el.classList.contains('seg')) syncSeg(el, el.dataset.bind);
    });
    paintColours();
    paintSide();
    // The preview and the mesh are independent; a hiccup in one must not stop
    // the other, or the exported file silently stops tracking the design.
    try { preview.draw(); }
    catch (e) { console.error('preview draw failed', e); }
    rebuild();
    persist();
  }

  function onEdit(path) {
    if (path === 'activeSide') {
      preview.selected = null;
      preview.invalidateBorder();
      refresh();
      paintSide();
    }
    // Border and shape edits need no invalidating: the ring's cache key holds
    // them, and leaving the cache lets a drag reuse the last ring.
    apply();
  }

  /* ── front / back ───────────────────────────────────────────────── */
  function other(which) { return which === 'front' ? 'back' : 'front'; }

  function paintSide() {
    var side = state.activeSide, o = other(side);
    var f = state.sides[side], of_ = state.sides[o];

    $('#side-enabled').checked = f.enabled;
    $('#btn-clear-side').textContent = of_.enabled
      ? 'Turn off the ' + o + ' side' : 'Turn on the ' + o + ' side';
    $('#btn-dup-side').textContent = 'Copy this side to the ' + o;

    // The per-face panels are meaningless while the face is off.
    ['#cap-border', '#cap-text', '#cap-art'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.textContent = side;
    });
    $$('.panel').forEach(function (pnl) {
      var h = $('h2', pnl);
      if (!h) return;
      var perFace = /^(Border|Text|Pictures?)/.test(h.textContent);
      if (perFace) pnl.style.opacity = f.enabled ? '' : '0.45';
    });

    $('#side-hint').textContent = f.enabled
      ? 'Artwork here is mirrored automatically, so it reads the right way round on the ' +
        side + ' of the finished print.'
      : 'This side is a plain surface. Switch it on to add a border, text or a picture.';
  }

  function bindSides() {
    $('#side-enabled').addEventListener('change', function (e) {
      beginEdit(0);
      state.sides[state.activeSide].enabled = e.target.checked;
      paintSide();
      apply();
    });

    /* Copy verbatim: the build mirrors the back face, so an identical config
       reads correctly on whichever side you are looking at. */
    $('#btn-dup-side').addEventListener('click', function () {
      beginEdit(0);
      var from = state.activeSide, to = other(from);
      var copy = JSON.parse(JSON.stringify(state.sides[from]));
      copy.enabled = true;

      /* Fresh ids for the copies, and their bitmaps copied across with them —
         otherwise both sides would share one picture and deleting either would
         take the other's artwork with it. */
      (copy.texts || []).forEach(function (t) { t.id = WB.newId('t'); });
      (copy.arts || []).forEach(function (a, i) {
        var origin = state.sides[from].arts[i];
        a.id = WB.newId('a');
        if (origin) {
          if (KC.assets.images[origin.id]) KC.assets.images[a.id] = KC.assets.images[origin.id];
          if (KC.assets.drawings[origin.id]) KC.assets.drawings[a.id] = KC.assets.drawings[origin.id];
        }
      });
      state.sides[to] = copy;
      preview.invalidateBorder();
      refresh();
      paintSide();
      apply();
    });

    $('#btn-clear-side').addEventListener('click', function () {
      beginEdit(0);
      var o = other(state.activeSide);
      state.sides[o].enabled = !state.sides[o].enabled;
      paintSide();
      apply();
    });
  }

  /* ── panels, tabs ───────────────────────────────────────────────── */
  function chrome() {
    $$('.panel > h2').forEach(function (h) {
      h.addEventListener('click', function () { h.parentNode.classList.toggle('open'); });
    });

    $$('#viewtabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        view = b.value;
        $$('#viewtabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
        $('#panes').dataset.pane = view;
        // Panes change size with the view, so draw once layout has settled.
        requestAnimationFrame(function () {
          if (show2d()) preview.draw();
          if (show3d() && viewer && !viewer.failed) viewer.draw();
        });
      });
    });

    $$('[data-center]').forEach(function (b) {
      b.addEventListener('click', function () {
        beginEdit(0);
        var f = faceNow();
        var el = b.dataset.center === 'text' ? f.texts[f.textIdx] : f.arts[f.artIdx];
        if (!el) return;
        el.x = 0; el.y = 0;
        apply();
      });
    });
  }

  /* ── assets ─────────────────────────────────────────────────────── */
  function loadImageFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        // Normalise to a canvas so bbox/threshold work uniformly.
        var max = 1200;
        var k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c._rev = Date.now();
        var f = faceNow();
        var art = f.arts[f.artIdx];
        if (!art) return;
        beginEdit(0);
        KC.assets.images[art.id] = c;
        art.source = 'image';
        refresh();
        apply();
      };
      img.onerror = function () {
        showWarnings([{ level: 'bad', msg: 'That image could not be read.' }]);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function assets() {
    $('#art-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadImageFile(e.target.files[0]);
    });

    drawpad = new WB.DrawPad($('#drawmodal'));

    $$('[data-draw]').forEach(function (b) {
      b.addEventListener('click', function () {
        var target = b.dataset.draw;
        var f = faceNow();
        var art = f.arts[f.artIdx];
        var existing = target === 'shape' ? KC.assets.customShape
                                         : (art ? KC.assets.drawings[art.id] : null);
        drawpad.open(target, existing, null, target === 'shape' ? {
          title: 'Draw the keychain outline', fill: true,
          hint: 'Sketch a closed loop. On apply it is filled in and scaled to your width and height.'
        } : {
          title: 'Draw a picture',
          hint: 'Anything you draw is embossed onto the plate. Enclosed areas can be filled or left open.'
        });
      });
    });

    $('#draw-cancel').addEventListener('click', function () { drawpad.close(); });
    $('#draw-apply').addEventListener('click', function () {
      beginEdit(0);
      var fill = $('#draw-fill').checked;
      var out = drawpad.result(fill);
      if (drawpad.target === 'shape') {
        KC.assets.customShape = out;
        state.shape.preset = 'custom';
        preview.invalidateBorder();
      } else {
        var fD = faceNow();
        var artD = fD.arts[fD.artIdx];
        if (artD) { KC.assets.drawings[artD.id] = out; artD.source = 'draw'; }
      }
      drawpad.close();
      refresh();
      apply();
    });

    $$('#draw-tool button').forEach(function (b) {
      b.addEventListener('click', function () {
        drawpad.tool = b.value;
        $$('#draw-tool button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    $('#draw-size').addEventListener('input', function (e) {
      drawpad.size = +e.target.value;
      $('#draw-size-val').textContent = e.target.value;
    });
    $('#draw-undo').addEventListener('click', function () { drawpad.undo(); });
    $('#draw-clear').addEventListener('click', function () { drawpad.clear(); });
  }

  /* ── export ─────────────────────────────────────────────────────── */
  function busy(on, text) {
    $('#busy').hidden = !on;
    if (text) $('#busy-text').textContent = text;
  }

  function buildForExport() {
    var ppmm = capPpmm(state.quality, 1.4e7);
    if (!KC.engineReady()) throw new Error('the geometry engine is still loading');
    return KC.buildModel(state, ppmm);
  }

  function safeName() {
    var n = (state.name || 'keychain').replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '');
    return n || 'keychain';
  }

  function exports_() {
    $('#btn-3mf').addEventListener('click', function () {
      busy(true, 'Building mesh…');
      setTimeout(function () {
        var model;
        try { model = buildForExport(); }
        catch (e) { busy(false); showWarnings([{ level: 'bad', msg: 'Build failed: ' + e.message }]); return; }

        if (!model.parts.length) {
          busy(false);
          showWarnings([{ level: 'bad', msg: 'Nothing to export — the model is empty.' }]);
          return;
        }
        busy(true, 'Packing 3MF…');
        KC.exportThreeMF(model, state).then(function (blob) {
          WB.download(blob, safeName() + '.3mf');
          busy(false);
          var n = model.stats.colors;
          showWarnings(model.warnings.concat([{
            level: 'ok',
            msg: 'Exported ' + safeName() + '.3mf — ' + model.parts.length + ' bodies, ' +
                 n + ' colour' + (n === 1 ? '' : 's') + ', ' +
                 model.stats.tris.toLocaleString() + ' triangles.'
          }]));
        }).catch(function (e) {
          busy(false);
          showWarnings([{ level: 'bad', msg: 'Export failed: ' + e.message }]);
        });
      }, 30);
    });

    $('#btn-stl').addEventListener('click', function () {
      busy(true, 'Building mesh…');
      setTimeout(function () {
        try {
          var model = buildForExport();
          var blob = KC.exportSTL(model);
          busy(false);
          if (!blob) { showWarnings([{ level: 'bad', msg: 'Nothing to export.' }]); return; }
          WB.download(blob, safeName() + '.stl');
        } catch (e) {
          busy(false);
          showWarnings([{ level: 'bad', msg: 'Export failed: ' + e.message }]);
        }
      }, 30);
    });

    $('#btn-save').addEventListener('click', function () {
      WB.download(new Blob([JSON.stringify(buildPayload())], { type: 'application/json' }),
                  safeName() + '.keychain.json');
    });

    $('#btn-share').addEventListener('click', shareLink);
    $('#btn-load').addEventListener('click', function () { $('#loadfile').click(); });
    $('#loadfile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          session.duplicate();                 // a new design; the one on screen stays in the list
          loadAsStep(JSON.parse(fr.result), function () { state.name = session.uniqueName(state.name); afterLoad(); });
        } catch (err) {
          showWarnings([{ level: 'bad', msg: 'That file could not be loaded: ' + err.message }]);
        }
      };
      fr.readAsText(f);
      e.target.value = '';
    });

    $('#btn-reset').addEventListener('click', function () {
      if (!window.confirm('Discard this design and start from the defaults?')) return;
      beginEdit(0);
      var name = state.name;
      toDefaults();
      state.name = name;                    // still the same design, by the same name
      clearSession();
      afterLoad();
    });

    $('#btn-designs').addEventListener('click', function (e) {
      WB.designsMenu({ anchor: e.currentTarget, session: session, open: openDesign, create: newDesign,
                       duplicate: duplicateDesign, wipe: wipeDesigns });
    });
  }

  function toDefaults() {
    var d = KC.defaults();
    Object.keys(state).forEach(function (k) { if (!(k in d)) delete state[k]; });
    Object.keys(d).forEach(function (k) { state[k] = d[k]; });
    KC.assets.customShape = null;
    KC.assets.images = {};
    KC.assets.drawings = {};
  }

  /* ── designs kept in this browser (WB.Session) ── */
  function openDesign(id) {
    session.open(id, function (note) {
      afterLoad();
      if (undoHistory) undoHistory.clear();   // undo stays with the design it was made in
      if (note) notice('warn', note);
    });
  }
  function newDesign() {
    session.saveNow();
    session.startNew();                     // first, so the open design's name counts as taken
    toDefaults();
    state.name = session.uniqueName(KC.defaults().name);
    afterLoad();
    if (undoHistory) undoHistory.clear();
    session.settled();
    setTimeout(function () { session.settled(); }, 0);
  }
  function duplicateDesign() {
    session.duplicate();
    state.name = session.uniqueName(state.name + ' copy');
    refresh();
    persist();
    notice('ok', 'You are now working on "' + state.name + '", a copy; the original is kept as it was.');
  }
  function wipeDesigns() {
    session.wipe();
    toDefaults();
    afterLoad();
    if (undoHistory) undoHistory.clear();
    session.startNew();
    setTimeout(function () { session.settled(); }, 0);
    notice('ok', 'Every design this app kept in this browser has been deleted.');
  }

  function afterLoad() {
    preview.state = state;
    preview.selected = null;
    preview.drag = preview.resize = null;     // a drag in progress belonged to the old design
    preview.invalidateBorder();
    refresh();
    paintSide();
    apply();
  }

  /* ── share links ──────────────────────────────────────────────────
     The settings travel in the link; pictures and a drawn outline do not, as
     they would make it far too long. */
  function pictureCount() {
    return Object.keys(KC.assets.images).length + Object.keys(KC.assets.drawings).length +
           (KC.assets.customShape ? 1 : 0);
  }
  function plural(n, one, many) { return n === 1 ? one : n + ' ' + many; }
  function shareLink() {
    var pics = pictureCount(), btn = $('#btn-share');
    // Only the changes from the defaults travel, which keeps links short.
    var full = JSON.parse(JSON.stringify(state)), base = JSON.parse(JSON.stringify(KC.defaults()));
    // Texts and pictures keep only what differs from a fresh one; loading
    // fills the rest back in.
    ['front', 'back'].forEach(function (w) {
      var f = full.sides && full.sides[w];
      if (!f) return;
      f.texts = (f.texts || []).map(function (t) { return WB.shareTrim(t, KC.newText(), ['id']); });
      f.arts = (f.arts || []).map(function (a) { return WB.shareTrim(a, KC.newArt(), ['id']); });
    });
    var payload = { version: 2, diff: 1, state: WB.shareDiff(base, full) || {} };
    if (pics) payload.picturesLeftOut = pics;
    WB.shareEncode(payload).then(function (hash) {
      var url = WB.shareBase() + hash;
      return WB.copyText(url).then(function (ok) {
        if (ok) WB.flashButton(btn, 'Copied ✓');
        var body = [];
        body.push(ok ? 'Anyone with this link can open the design and carry on editing their own copy.'
                     : 'Your browser blocked the clipboard here; copy the link above.');
        if (url.length > 8000) body.push('It is a long link, so some chat apps may cut it short.');
        if (pics) {
          body.push({ warn: true, text: 'Not included: ' + plural(pics, 'a picture or drawn outline', 'pictures or drawn outlines') +
                     '. Links cannot carry those — to share the design complete, send the file from Save (.keychain.json) or the exported 3MF.' });
        }
        WB.sharePopup({ anchor: btn, title: ok ? 'Link copied' : 'Share this link', link: url, linkCopied: ok, body: body });
      });
    }).catch(function (err) {
      WB.sharePopup({ anchor: btn, kind: 'warn', title: 'Could not make a link', body: [err.message] });
    });
  }

  /* Opens a design from the link, if it carries one. Returns whether it does;
     done() runs once the design is in place. */
  /* inTab: a link pasted into an open tab; if it fails, the design on screen
     stays as it is rather than falling back to the saved session. */
  function openSharedLink(done, inTab) {
    if (location.hash.indexOf('#d=') !== 0) return false;
    // Only a link that won't decode counts as damaged; a problem after it has
    // loaded is not the link's fault and must not load a second time.
    WB.shareDecode(location.hash).then(function (p) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('not a design');
      if (p.state != null && (typeof p.state !== 'object' || Array.isArray(p.state))) throw new Error('not a design');
      // A short link holds only the changes from the defaults.
      if (p.diff) p.state = WB.sharePatch(JSON.parse(JSON.stringify(KC.defaults())), p.state || {});
      return p;
    }).then(function (p) {
      history.replaceState(null, '', WB.shareBase());   // later refreshes use the session
      // Into a tab that already has a design: a new one, so that one stays in the list.
      if (inTab) session.duplicate();
      loadPayload(p, function () {
        if (inTab) state.name = session.uniqueName(state.name);
        done();
        var n = p.picturesLeftOut;
        WB.sharePopup({ title: 'Opened a shared design', kind: n ? 'warn' : 'ok', body: n
          ? [{ warn: true, text: 'It had ' + plural(n, 'a picture or drawn outline', 'pictures or drawn outlines') +
               ' that links cannot carry. Ask the sender for the design file to get ' + (n === 1 ? 'it' : 'them') + '.' }]
          : ['Changes you make stay in your own copy.'] });
      });
    }, function () {
      history.replaceState(null, '', WB.shareBase());
      WB.sharePopup({ kind: 'warn', title: 'That link could not be opened',
        body: ['It looks damaged or cut short. Ask for it again, or for the design file.'] });
      if (inTab || !restoreSession(done)) done();
    });
    return true;
  }

  /* ── design payload (shared by file save/load and session storage) ── */
  function buildPayload() {
    var payload = { version: 2, state: state, assets: {} };
    var put = function (k, cv) { if (cv) payload.assets[k] = cv.toDataURL('image/png'); };
    put('customShape', KC.assets.customShape);
    Object.keys(KC.assets.images).forEach(function (k) { put('img:' + k, KC.assets.images[k]); });
    Object.keys(KC.assets.drawings).forEach(function (k) { put('draw:' + k, KC.assets.drawings[k]); });
    return payload;
  }

  /* A setting path inside each object of a list kept within its field's
     limits: 'pocket.corner' on every compartment, say. */
  function clampAll(list, sub, L, fresh) {
    var parts = sub.split('.'), key = parts.pop(), at = parts.join('.');
    list.forEach(function (o) {
      var tgt = at ? WB.get(o, at) : o;
      WB.clampField(tgt, key, L.min, L.max, fresh ? WB.get(fresh, sub) : undefined);
    });
  }

  /* A design from a file, a link or storage, kept to what the app can build:
     hex colours only, every number inside its field's limits, and lists of a
     sane length, so a crafted link can't hang the page (and stay saved). */
  var MAX_ITEMS = 40;
  function sanitize(d) {
    WB.cleanColours(d, KC.defaults());
    var sides = [d.sides.front, d.sides.back];
    sides.forEach(function (f) {
      f.texts = f.texts.slice(0, MAX_ITEMS); f.arts = f.arts.slice(0, MAX_ITEMS);
      f.textIdx = WB.clamp(f.textIdx || 0, 0, Math.max(0, f.texts.length - 1));
      f.artIdx = WB.clamp(f.artIdx || 0, 0, Math.max(0, f.arts.length - 1));
    });
    var texts = [].concat(sides[0].texts, sides[1].texts), arts = [].concat(sides[0].arts, sides[1].arts);
    var fresh = KC.defaults();
    WB.fieldLimits(document, ['f-t-x', 'f-t-y', 'f-a-x', 'f-a-y', 'f-hole-x', 'f-hole-y', 'f-shape-thickness', 'f-inlayDepth', 'f-reliefHeight']).forEach(function (L) {
      var p = L.path;
      if (p.indexOf('~t.') === 0) clampAll(texts, p.slice(3), L, KC.newText());
      else if (p.indexOf('~a.') === 0) clampAll(arts, p.slice(3), L, KC.newArt());
      else if (p.indexOf('~.') === 0) clampAll(sides, p.slice(2), L, fresh.sides.front);
      else clampAll([d], p, L, fresh);
    });
  }

  function loadPayload(p, done) {
    var ps = p.state || {};
    var assets = p.assets || {};
    var legacyArt = [];      // [{ id, imageKey, drawKey }] built while migrating

    /* v1 kept a single face at the state root. */
    if (!ps.sides) {
      ps.sides = {
        front: { enabled: true, border: ps.border, text: ps.text, art: ps.art },
        back: { enabled: false }
      };
      if (assets.image) assets['front.image'] = assets.image;
      if (assets.drawing) assets['front.drawing'] = assets.drawing;
    }

    /* Relief used to live on the plate; give both faces the old setting. */
    if (ps.shape) {
      ['front', 'back'].forEach(function (w) {
        if (!ps.sides[w]) return;
        ['relief', 'reliefHeight', 'inlayThrough', 'inlayDepth'].forEach(function (k) {
          if (ps.sides[w][k] === undefined && ps.shape[k] !== undefined) {
            ps.sides[w][k] = ps.shape[k];
          }
        });
      });
    }

    /* Colour used to be four palette slots referenced by index; it is now a
       property of each element. Resolve the old indices to real colours. */
    var pal = (ps.colors && ps.colors.palette) || ['#e9edf2', '#16181d', '#e0a63a', '#4b8ef0'];
    var hex = function (i, fallback) {
      return (typeof i === 'number' && pal[i]) ? pal[i] : fallback;
    };
    if (ps.colors && ps.plateColor === undefined) {
      ps.plateColor = hex(ps.colors.base, '#e9edf2');
    }

    /* A face used to hold exactly one text and one picture. */
    ['front', 'back'].forEach(function (w) {
      var f = ps.sides && ps.sides[w];
      if (!f || typeof f !== 'object') return;
      if (!f.texts) {
        f.texts = [];
        if (f.text) {
          var t = Object.assign({}, f.text);
          t.id = WB.newId('t');
          t.font = WB.fontKey(t.font);
          if (t.color === undefined) t.color = hex(ps.colors && ps.colors.text, '#16181d');
          f.texts.push(t);
        }
        delete f.text;
      }
      if (!f.arts) {
        f.arts = [];
        if (f.art) {
          var a = Object.assign({}, f.art);
          a.id = WB.newId('a');
          if (a.color === undefined) a.color = hex(ps.colors && ps.colors.art, '#4b8ef0');
          f.arts.push(a);
          legacyArt.push({ id: a.id, imageKey: w + '.image', drawKey: w + '.drawing' });
        }
        delete f.art;
      }
      // Drop anything that isn't a text or picture a broken link might carry.
      f.texts = (Array.isArray(f.texts) ? f.texts : []).filter(function (t) { return t && typeof t === 'object'; });
      f.arts = (Array.isArray(f.arts) ? f.arts : []).filter(function (a) { return a && typeof a === 'object'; });
      f.texts.forEach(function (t) { t.font = WB.fontKey(t.font); });
      if (f.border && f.border.color === undefined) {
        f.border.color = hex(ps.colors && ps.colors.border, '#16181d');
      }
      if (f.textIdx === undefined) f.textIdx = 0;
      if (f.artIdx === undefined) f.artIdx = 0;
    });
    delete ps.colors;

    /* Merge onto defaults, replacing arrays outright rather than blending. */
    var d = KC.defaults();
    // A saved or shared value only replaces a default of the same kind, so a
    // damaged link can't leave, say, text where a number belongs.
    var sameKind = function (a, b) {
      if (a === null || a === undefined) return true;
      if (typeof a === 'number') return typeof b === 'number' && isFinite(b);
      if (Array.isArray(a)) return Array.isArray(b);
      if (typeof a === 'object') return !!b && typeof b === 'object' && !Array.isArray(b);
      return typeof a === typeof b;
    };
    (function merge(dst, src) {
      Object.keys(dst).forEach(function (k) {
        if (src[k] === undefined) return;
        if (dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k]) &&
            src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
          merge(dst[k], src[k]);
        } else if (sameKind(dst[k], src[k])) { dst[k] = src[k]; }
      });
    })(d, ps);
    if (d.activeSide !== 'front' && d.activeSide !== 'back') d.activeSide = 'front';
    ['front', 'back'].forEach(function (w) {
      // Each text and picture filled out over its defaults, so a partial one still works.
      var isObj = function (o) { return !!o && typeof o === 'object' && !Array.isArray(o); };
      if (ps.sides && ps.sides[w] && Array.isArray(ps.sides[w].texts)) d.sides[w].texts = ps.sides[w].texts.filter(isObj).map(function (t) { return KC.newText(t); });
      if (ps.sides && ps.sides[w] && Array.isArray(ps.sides[w].arts)) d.sides[w].arts = ps.sides[w].arts.filter(isObj).map(function (a) { return KC.newArt(a); });
      d.sides[w].texts.forEach(function (t) { if (!t.id) t.id = WB.newId('t'); });
      d.sides[w].arts.forEach(function (a) { if (!a.id) a.id = WB.newId('a'); });
      d.sides[w].textIdx = WB.clamp(d.sides[w].textIdx || 0, 0,
                                    Math.max(0, d.sides[w].texts.length - 1));
      d.sides[w].artIdx = WB.clamp(d.sides[w].artIdx || 0, 0,
                                   Math.max(0, d.sides[w].arts.length - 1));
    });

    sanitize(d);

    Object.keys(state).forEach(function (k) { if (!(k in d)) delete state[k]; });
    Object.keys(d).forEach(function (k) { state[k] = d[k]; });

    KC.assets.customShape = null;
    KC.assets.images = {};
    KC.assets.drawings = {};

    /* Bitmaps: current saves key them by picture id; older ones by face. */
    var jobs = [];
    if (assets.customShape) jobs.push({ data: assets.customShape, put: function (c) { KC.assets.customShape = c; } });
    Object.keys(assets).forEach(function (k) {
      if (k.indexOf('img:') === 0) {
        jobs.push({ data: assets[k], put: function (c) { KC.assets.images[k.slice(4)] = c; } });
      } else if (k.indexOf('draw:') === 0) {
        jobs.push({ data: assets[k], put: function (c) { KC.assets.drawings[k.slice(5)] = c; } });
      }
    });
    legacyArt.forEach(function (m) {
      if (assets[m.imageKey]) {
        jobs.push({ data: assets[m.imageKey], put: function (c) { KC.assets.images[m.id] = c; } });
      }
      if (assets[m.drawKey]) {
        jobs.push({ data: assets[m.drawKey], put: function (c) { KC.assets.drawings[m.id] = c; } });
      }
    });

    jobs = jobs.filter(function (j) { return WB.isImageData(j.data); });   // inline pictures only
    var pending = jobs.length;
    if (!pending) { done(); return; }
    jobs.forEach(function (job) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        c._rev = Date.now();
        job.put(c);
        if (!--pending) done();
      };
      img.onerror = function () { if (!--pending) done(); };
      img.src = job.data;
    });
  }

  /* ── session persistence ─  /* ── session persistence ────────────────────────────────────────────
     The design survives a refresh via localStorage. Artwork is stored too, but
     dropped rather than losing the design if the quota is hit. */
  function clearSession() { session.clear(); }
  /* Returns true when a stored design is being restored. */
  function restoreSession(done) { return session.restore(done); }
  var session = new WB.Session({ key: 'keychain-studio.session.v2', build: buildPayload, load: loadPayload,
    // A copy made because another tab had written the design meanwhile.
    rename: function (name) { state.name = name; refresh(); },
    failed: function (msg) { notice('warn', msg); } });
  var storageOK = session.ok;
  function persist() { session.save(); }


  /* Returns true when a stored session is being restored. */

  /* ── boot ───────────────────────────────────────────────────────── */
  function init() {
    populate();

    preview = new KC.Preview($('#c2d'), state,
      function (dragging) {
        // Dragging mutates state directly rather than through the binder, so it
        // has to save explicitly — otherwise a dragged position is lost on
        // refresh while the same change made with a slider survives.
        if (dragging) { labels(); rebuild(); persist(); return; }   // number boxes follow the drag
        refresh();      // a finished drag can change a <select> (hole → custom)
        apply();        // …and apply() is what saves the session
      },
      function () { beginEdit(450); });     // drag / arrow-key nudge = one undo step
    try {
      viewer = new WB.Viewer($('#c3d'), { view: { az: -0.62, el: 0.78 } });
    } catch (e) {
      viewer = { failed: true, setModel: function () {}, draw: function () {}, frame: function () {} };
    }

    enhanceNumbers();
    bind();
    bindHistory();
    WB.addResetButtons($$('.sidebar .panel'), resetPanel);
    WB.addCollapseAll($('#sidebar'));
    bindSides();
    bindLists();
    chrome();
    assets();
    exports_();

    // A link pasted into a tab that already has the app open.
    window.addEventListener('hashchange', function () {
      if (location.hash.indexOf('#d=') !== 0) return;
      if (undoHistory) undoHistory.commit();           // close any edit still pending first
      beginEdit(600000);
      openSharedLink(function () { afterLoad(); if (undoHistory) undoHistory.commit(); }, true);
    });
    var restoring = openSharedLink(afterLoad) ||
      restoreSession(function (note) {
        afterLoad();
        if (note) notice('warn', note);
      });
    refresh();

    var ro = new ResizeObserver(function () {
      preview.draw();
      if (viewer && !viewer.failed) viewer.draw();
    });
    ro.observe($('#stage'));
    ro.observe($('#stage3d'));

    if (viewer && viewer.failed) {
      showWarnings([{ level: 'warn', msg: 'WebGL is unavailable, so the 3D preview is disabled. Export still works.' }]);
    }
    if (!storageOK) {
      showWarnings([{ level: 'warn', msg: 'This browser will not keep the design across refreshes here — ' +
        'localStorage is blocked. Use Save to keep a copy.' }]);
    }

    paintSide();
    if (!restoring) apply();
    session.settled();
    loadEngine();
  }

  /* ── geometry engine ────────────────────────────────────────────── */
  function loadEngine() {
    busy(true, 'Loading the geometry engine…');
    WB.loadManifold().then(function (w) {
      KC.setManifold(w);
      busy(false);
      rebuild.now();                        // nothing to wait for: show the first model at once
    }, function (err) {
      busy(false);
      showWarnings([{ level: 'bad', msg: err.message }]);
    });
  }

  /* Live handles, for console poking and automated checks. */
  KC.getState = function () { return state; };
  KC.getViewer = function () { return viewer; };
  KC.getPreview = function () { return preview; };
  KC.undo = function () { undoHistory.undo(); };
  KC.redo = function () { undoHistory.redo(); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window.KC);

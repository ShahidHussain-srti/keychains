/* app.js — UI wiring: declarative bindings, live preview, export. */
(function (KC) {
  'use strict';

  var state = KC.defaults();
  var preview, viewer, drawpad;
  var lastModel = null;
  var view = '2d';

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

    var fs = $('#font-select');
    KC.FONTS.forEach(function (f, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = f.name;
      o.style.fontFamily = f.css;      // preview the face in the dropdown
      fs.appendChild(o);
    });

    var sw = $('#swatches');
    state.colors.palette.forEach(function (c, i) {
      var d = document.createElement('div');
      d.className = 'sw';
      d.innerHTML = '<input type="color" aria-label="Filament colour ' + (i + 1) +
                    '" value="' + c + '"><span>' + (i + 1) + '</span>';
      $('input', d).addEventListener('input', function (e) {
        beginEdit(450);
        state.colors.palette[i] = e.target.value;
        paintAssign();
        preview.invalidateBorder();
        apply();
      });
      sw.appendChild(d);
    });

    var as = $('#assign');
    KC.PARTS.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'arow';
      row.innerHTML = '<span>' + p[1] + '</span><div class="pick"></div>';
      var pick = $('.pick', row);
      for (var i = 0; i < 4; i++) {
        (function (idx) {
          var b = document.createElement('button');
          b.dataset.part = p[0];
          b.dataset.idx = idx;
          b.title = 'Colour ' + (idx + 1);
          b.addEventListener('click', function () {
            beginEdit(0);
            state.colors[p[0]] = idx;
            paintAssign();
            preview.invalidateBorder();
            apply();
          });
          pick.appendChild(b);
        })(i);
      }
      as.appendChild(row);
    });
    paintAssign();
  }

  function paintAssign() {
    $$('#assign .pick button').forEach(function (b) {
      var idx = +b.dataset.idx;
      b.style.background = state.colors.palette[idx];
      b.classList.toggle('on', state.colors[b.dataset.part] === idx);
    });
    $$('#swatches .sw input').forEach(function (inp, i) { inp.value = state.colors.palette[i]; });

    // Count what is in use across both faces, not just the one on screen.
    var used = {};
    used[state.colors.base] = 1;
    if (state.shape.relief !== 'engraved') {
      ['front', 'back'].forEach(function (w) {
        var f = state.sides[w];
        if (!f.enabled) return;
        if (f.border.style !== 'none') used[state.colors.border] = 1;
        if ((f.text.content || '').trim()) used[state.colors.text] = 1;
        if (f.art.source !== 'none') used[state.colors.art] = 1;
      });
    }
    var n = Object.keys(used).length;
    $('#color-count').textContent = n + (n === 1 ? ' filament' : ' filaments') +
      ' in use' + (n > 1 ? ' — needs a multi-material printer or manual swaps.' : '.');
  }

  /* ── undo / redo ────────────────────────────────────────────────────
     The whole design is small and JSON-safe, so history is just a stack of
     snapshots. A burst of changes from dragging one slider is coalesced into a
     single step: the pre-edit snapshot is captured once at the start of the
     burst and only committed after things go quiet. */
  var undoStack = [], redoStack = [], pendingBefore = null, pendingTimer = 0;
  var HISTORY_LIMIT = 120;

  function snapshot() {
    return {
      state: JSON.stringify(state),
      assets: { customShape: KC.assets.customShape,
                fImage: KC.assets.front.image, fDraw: KC.assets.front.drawing,
                bImage: KC.assets.back.image,  bDraw: KC.assets.back.drawing }
    };
  }

  function assetsEqual(a) {
    return a.customShape === KC.assets.customShape &&
           a.fImage === KC.assets.front.image && a.fDraw === KC.assets.front.drawing &&
           a.bImage === KC.assets.back.image  && a.bDraw === KC.assets.back.drawing;
  }

  function restore(snap) {
    var s = JSON.parse(snap.state);
    // Assign in place so anything holding a reference to `state` stays valid.
    Object.keys(state).forEach(function (k) { if (!(k in s)) delete state[k]; });
    Object.keys(s).forEach(function (k) { state[k] = s[k]; });
    KC.assets.customShape = snap.assets.customShape;
    KC.assets.front.image = snap.assets.fImage;
    KC.assets.front.drawing = snap.assets.fDraw;
    KC.assets.back.image = snap.assets.bImage;
    KC.assets.back.drawing = snap.assets.bDraw;
    preview.invalidateBorder();
    refresh();
    apply();
  }

  /* Call immediately BEFORE mutating state. */
  function beginEdit(coalesceMs) {
    if (pendingBefore === null) pendingBefore = snapshot();
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(commitEdit, coalesceMs == null ? 450 : coalesceMs);
  }

  function commitEdit() {
    clearTimeout(pendingTimer);
    if (pendingBefore === null) return;
    // Nothing actually changed (e.g. slider returned to its original value).
    if (pendingBefore.state !== JSON.stringify(state) || !assetsEqual(pendingBefore.assets)) {
      undoStack.push(pendingBefore);
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
    pendingBefore = null;
    paintHistory();
  }

  function undo() {
    commitEdit();                     // fold any in-flight burst in first
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    paintHistory();
  }

  function redo() {
    commitEdit();
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    paintHistory();
  }

  function paintHistory() {
    var u = $('#btn-undo'), r = $('#btn-redo');
    if (!u || !r) return;
    var pend = pendingBefore !== null ? 1 : 0;
    u.disabled = !(undoStack.length + pend);
    r.disabled = !redoStack.length;
    u.title = 'Undo (⌘Z / Ctrl+Z)' + (undoStack.length + pend ? ' — ' + (undoStack.length + pend) + ' step(s)' : '');
    r.title = 'Redo (⇧⌘Z / Ctrl+Y)' + (redoStack.length ? ' — ' + redoStack.length + ' step(s)' : '');
  }

  /* Text fields have their own native undo; leave those alone. */
  function inTextEntry() {
    var el = document.activeElement;
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && /^(text|number|search|email|url|password)$/.test(el.type);
  }

  function bindHistory() {
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-redo').addEventListener('click', redo);

    document.addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      var k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        if (inTextEntry()) return;
        e.preventDefault(); undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        if (inTextEntry() && k === 'z') return;
        e.preventDefault(); redo();
      }
    });
    paintHistory();
  }

  /* ── declarative two-way binding ──────────────────────────────────
     A `~.` prefix means "the side currently being edited", so one set of
     controls drives whichever face is selected. */
  function P(path) {
    return path.charAt(0) === '~' ? 'sides.' + state.activeSide + path.slice(1) : path;
  }

  function coerce(path, raw) {
    var cur = KC.get(state, P(path));
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
            KC.set(state, P(path), coerce(path, b.value));
            syncSeg(el, path);
            onEdit(path);
          });
        });
        return;
      }

      var ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color')
        ? 'change' : 'input';
      el.addEventListener(ev, function () {
        // Sliders and typing coalesce into one undo step; discrete pickers don't.
        var continuous = el.type === 'range' || el.tagName === 'TEXTAREA' || el.type === 'text';
        beginEdit(continuous ? 450 : 0);
        var v = el.type === 'checkbox' ? el.checked : el.value;
        KC.set(state, P(path), coerce(path, v));
        onEdit(path);
      });
      // Range inputs also need the live drag, which 'input' already gives us.
    });
  }

  function syncSeg(el, path) {
    var v = String(KC.get(state, P(path)));
    $$('button', el).forEach(function (b) { b.classList.toggle('on', b.value === v); });
  }

  /* Push state → DOM (used on load / reset). */
  function refresh() {
    updateRanges();
    $$('[data-bind]').forEach(function (el) {
      var path = el.dataset.bind;
      var v = KC.get(state, P(path));
      if (el.classList.contains('seg')) { syncSeg(el, path); return; }
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    paintAssign();
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
    $$('[data-val]').forEach(function (el) {
      var v = KC.get(state, P(el.dataset.val));
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
    var lay = function (v) { return KC.tidyDepth(Math.round(v / lh) * lh); };
    var minT = Math.max(minD, KC.tidyDepth(Math.ceil(0.6 / lh - 1e-6) * lh));
    var maxT = KC.tidyDepth(minT + Math.floor((5 - minT) / lh + 1e-6) * lh);

    var snappedT = KC.clamp(lay(state.shape.thickness), minT, maxT);
    if (Math.abs(snappedT - state.shape.thickness) > 1e-9) state.shape.thickness = snappedT;
    T = state.shape.thickness;

    var th = $('#f-shape-thickness');
    if (th) {
      th.min = minT.toFixed(2);
      th.max = maxT.toFixed(2);
      th.step = lh.toFixed(2);
      th.value = T;
    }

    var maxInlay = Math.max(minD, T);
    state.shape.inlayDepth =
      KC.clamp(lay(state.shape.inlayDepth), Math.min(minD, maxInlay), maxInlay);
    var d = $('#f-shape-inlayDepth');
    if (d) {
      d.min = Math.min(minD, maxInlay).toFixed(2);
      d.max = maxInlay.toFixed(2);
      d.step = lh.toFixed(2);
      d.value = state.shape.inlayDepth;
    }

    var maxRelief = state.shape.relief === 'engraved' ? Math.max(minD, T - minD) : 3;
    state.shape.reliefHeight =
      KC.clamp(lay(state.shape.reliefHeight), minD, Math.max(minD, maxRelief));
    var rh = $('#f-shape-reliefHeight');
    if (rh) {
      rh.min = minD.toFixed(2);
      rh.max = Math.max(minD, maxRelief).toFixed(2);
      rh.step = lh.toFixed(2);
      rh.value = state.shape.reliefHeight;
    }

    var inl = KC.inlayDepthOf(state);
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
    var cur = String(KC.get(state, P(path)));
    return vals.indexOf(cur) >= 0;
  }

  /* ── build / render ─────────────────────────────────────────────── */
  function capPpmm(ppmm, maxCells) {
    var sz = KC.plateSize(state);
    var cells = (sz.w + 8) * (sz.h + 8) * ppmm * ppmm;
    if (cells <= maxCells) return ppmm;
    return Math.max(5, ppmm * Math.sqrt(maxCells / cells));
  }

  var rebuild = KC.debounce(function () {
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
      if (view === '3d') viewer.draw();
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

  function showWarnings(list) {
    var box = $('#warnings');
    box.innerHTML = '';
    (list || []).forEach(function (w) {
      var d = document.createElement('div');
      d.className = 'w ' + w.level;
      d.innerHTML = '<span class="ic">' +
        (w.level === 'bad' ? '●' : w.level === 'warn' ? '▲' : 'ⓘ') +
        '</span><span>' + w.msg + '</span>';
      box.appendChild(d);
    });
  }

  function apply() {
    updateRanges();
    visibility();
    labels();
    // Keep segmented toggles honest even if state changed without a refresh().
    // Safe to do on every pass: they are buttons, so there is no caret or
    // in-progress input to disturb.
    $$('[data-bind]').forEach(function (el) {
      if (el.classList.contains('seg')) syncSeg(el, el.dataset.bind);
    });
    paintAssign();
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
    } else if (path && (path.indexOf('~.border') === 0 || path.indexOf('shape') === 0)) {
      preview.invalidateBorder();
    }
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
      var perFace = /^(Border|Text|Picture)/.test(h.textContent);
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
      var src = state.sides[from];
      state.sides[to] = JSON.parse(JSON.stringify(src));
      state.sides[to].enabled = true;
      KC.assets[to].image = KC.assets[from].image;
      KC.assets[to].drawing = KC.assets[from].drawing;
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
        $('#c2d').hidden = view !== '2d';
        $('#c3d').hidden = view !== '3d';
        $('#hud3d').hidden = view !== '3d';
        if (view === '3d' && viewer) { viewer.draw(); }
        else preview.draw();
      });
    });

    $$('[data-center]').forEach(function (b) {
      b.addEventListener('click', function () {
        beginEdit(0);
        var el = state.sides[state.activeSide][b.dataset.center];
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
        beginEdit(0);
        KC.assets[state.activeSide].image = c;
        state.sides[state.activeSide].art.source = 'image';
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

    drawpad = new KC.DrawPad($('#drawmodal'));

    $$('[data-draw]').forEach(function (b) {
      b.addEventListener('click', function () {
        var target = b.dataset.draw;
        var existing = target === 'shape' ? KC.assets.customShape : KC.assets[state.activeSide].drawing;
        drawpad.open(target, existing, null);
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
        KC.assets[state.activeSide].drawing = out;
        state.sides[state.activeSide].art.source = 'draw';
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
          KC.download(blob, safeName() + '.3mf');
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
          KC.download(blob, safeName() + '.stl');
        } catch (e) {
          busy(false);
          showWarnings([{ level: 'bad', msg: 'Export failed: ' + e.message }]);
        }
      }, 30);
    });

    $('#btn-save').addEventListener('click', function () {
      KC.download(new Blob([JSON.stringify(buildPayload())], { type: 'application/json' }),
                  safeName() + '.keychain.json');
    });

    $('#btn-load').addEventListener('click', function () { $('#loadfile').click(); });
    $('#loadfile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          loadPayload(JSON.parse(fr.result), function () {
            beginEdit(0);
            afterLoad();
          });
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
      var d = KC.defaults();
      Object.keys(state).forEach(function (k) { if (!(k in d)) delete state[k]; });
      Object.keys(d).forEach(function (k) { state[k] = d[k]; });
      KC.assets.customShape = null;
      KC.assets.front = { image: null, drawing: null };
      KC.assets.back = { image: null, drawing: null };
      clearSession();
      afterLoad();
    });
  }

  function afterLoad() {
    preview.state = state;
    preview.selected = null;
    preview.invalidateBorder();
    refresh();
    paintSide();
    apply();
  }

  /* ── design payload (shared by file save/load and session storage) ── */
  function buildPayload() {
    var payload = { version: 2, state: state, assets: {} };
    var put = function (k, cv) { if (cv) payload.assets[k] = cv.toDataURL('image/png'); };
    put('customShape', KC.assets.customShape);
    put('front.image', KC.assets.front.image);
    put('front.drawing', KC.assets.front.drawing);
    put('back.image', KC.assets.back.image);
    put('back.drawing', KC.assets.back.drawing);
    return payload;
  }

  function loadPayload(p, done) {
    var ps = p.state || {};
    var assets = p.assets || {};

    /* Version 1 kept a single face at the state root; fold it into the front
       side so older saves keep working. */
    if (!ps.sides) {
      ps.sides = {
        front: { enabled: true,
                 border: ps.border || KC.faceDefaults('front').border,
                 text: ps.text || KC.faceDefaults('front').text,
                 art: ps.art || KC.faceDefaults('front').art },
        back: KC.faceDefaults('back')
      };
      if (assets.image) assets['front.image'] = assets.image;
      if (assets.drawing) assets['front.drawing'] = assets.drawing;
    }

    var d = KC.defaults();
    (function merge(dst, src) {          // deep merge onto defaults
      Object.keys(dst).forEach(function (k) {
        if (src[k] === undefined) return;
        if (dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k]) &&
            src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
          merge(dst[k], src[k]);
        } else { dst[k] = src[k]; }
      });
    })(d, ps);

    Object.keys(state).forEach(function (k) { if (!(k in d)) delete state[k]; });
    Object.keys(d).forEach(function (k) { state[k] = d[k]; });

    KC.assets.customShape = null;
    KC.assets.front = { image: null, drawing: null };
    KC.assets.back = { image: null, drawing: null };

    var slots = ['customShape', 'front.image', 'front.drawing', 'back.image', 'back.drawing'];
    var pending = 0;
    slots.forEach(function (key) {
      if (!assets[key]) return;
      pending++;
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        c._rev = Date.now();
        if (key === 'customShape') KC.assets.customShape = c;
        else { var b = key.split('.'); KC.assets[b[0]][b[1]] = c; }
        if (!--pending) done();
      };
      img.onerror = function () { if (!--pending) done(); };
      img.src = assets[key];
    });
    if (!pending) done();
  }

  /* ── session persistence ────────────────────────────────────────────
     The design survives a refresh via localStorage. Artwork is stored too, but
     dropped rather than losing the design if the quota is hit. */
  var STORE_KEY = 'keychain-studio.session.v2';
  var storageOK = (function () {
    try {
      localStorage.setItem('kc.probe', '1');
      localStorage.removeItem('kc.probe');
      return true;
    } catch (e) { return false; }
  })();

  var persist = KC.debounce(function () {
    if (!storageOK) return;
    var payload = buildPayload();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch (e) {
      try {                                   // over quota: keep the design at least
        payload.assets = {};
        payload.assetsDropped = true;
        localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch (e2) { /* give up silently; the design is still on screen */ }
    }
  }, 900);

  function clearSession() {
    if (!storageOK) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to undo */ }
  }

  /* Returns true when a stored session is being restored. */
  function restoreSession(done) {
    if (!storageOK) return false;
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var p = JSON.parse(raw);
      loadPayload(p, function () {
        done(p.assetsDropped ? 'Restored your last session, but the artwork was too large to keep.' : null);
      });
      return true;
    } catch (e) {
      clearSession();
      return false;
    }
  }

  /* ── boot ───────────────────────────────────────────────────────── */
  function init() {
    populate();

    preview = new KC.Preview($('#c2d'), state,
      function (dragging) { if (!dragging) refresh(); rebuild(); },
      function () { beginEdit(450); });     // drag / arrow-key nudge = one undo step
    try {
      viewer = new KC.Viewer($('#c3d'));
    } catch (e) {
      viewer = { failed: true, setModel: function () {}, draw: function () {}, frame: function () {} };
    }

    bind();
    bindHistory();
    bindSides();
    chrome();
    assets();
    exports_();

    var restoring = restoreSession(function (note) {
      afterLoad();
      if (note) showWarnings([{ level: 'warn', msg: note }]);
    });
    refresh();

    var ro = new ResizeObserver(function () {
      preview.draw();
      if (viewer && !viewer.failed) viewer.draw();
    });
    ro.observe($('#stage'));

    if (viewer && viewer.failed) {
      showWarnings([{ level: 'warn', msg: 'WebGL is unavailable, so the 3D preview is disabled. Export still works.' }]);
    }
    if (!storageOK) {
      showWarnings([{ level: 'warn', msg: 'This browser will not keep the design across refreshes here — ' +
        'localStorage is blocked. Use Save to keep a copy.' }]);
    }

    paintSide();
    if (!restoring) apply();
  }

  /* Live handles, for console poking and automated checks. */
  KC.getState = function () { return state; };
  KC.getViewer = function () { return viewer; };
  KC.getPreview = function () { return preview; };
  KC.undo = undo;
  KC.redo = redo;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window.KC);

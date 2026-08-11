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

    var used = {};
    KC.PARTS.forEach(function (p) {
      if (p[0] === 'border' && state.border.style === 'none') return;
      if (p[0] === 'text' && !(state.text.content || '').trim()) return;
      if (p[0] === 'art' && state.art.source === 'none') return;
      if (state.shape.relief === 'engraved' && p[0] !== 'base') return;
      used[state.colors[p[0]]] = 1;
    });
    var n = Object.keys(used).length;
    $('#color-count').textContent = n + (n === 1 ? ' filament' : ' filaments') +
      ' in use' + (n > 1 ? ' — needs a multi-material printer or manual swaps.' : '.');
  }

  /* ── declarative two-way binding ────────────────────────────────── */
  function coerce(path, raw) {
    var cur = KC.get(state, path);
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
            KC.set(state, path, coerce(path, b.value));
            syncSeg(el, path);
            onEdit(path);
          });
        });
        return;
      }

      var ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color')
        ? 'change' : 'input';
      el.addEventListener(ev, function () {
        var v = el.type === 'checkbox' ? el.checked : el.value;
        KC.set(state, path, coerce(path, v));
        onEdit(path);
      });
      // Range inputs also need the live drag, which 'input' already gives us.
    });
  }

  function syncSeg(el, path) {
    var v = String(KC.get(state, path));
    $$('button', el).forEach(function (b) { b.classList.toggle('on', b.value === v); });
  }

  /* Push state → DOM (used on load / reset). */
  function refresh() {
    $$('[data-bind]').forEach(function (el) {
      var path = el.dataset.bind;
      var v = KC.get(state, path);
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
      var v = KC.get(state, el.dataset.val);
      var f = FMT[el.dataset.fmt || 'mm'] || FMT.mm;
      el.textContent = typeof v === 'number' ? f(v) : String(v);
    });
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
    var cur = String(KC.get(state, path));
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
    visibility();
    labels();
    paintAssign();
    // The preview and the mesh are independent; a hiccup in one must not stop
    // the other, or the exported file silently stops tracking the design.
    try { preview.draw(); }
    catch (e) { console.error('preview draw failed', e); }
    rebuild();
  }

  function onEdit(path) {
    if (path && (path.indexOf('border') === 0 || path.indexOf('shape') === 0)) {
      preview.invalidateBorder();
    }
    apply();
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
        var el = state[b.dataset.center];
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
        KC.assets.image = c;
        state.art.source = 'image';
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
        var existing = target === 'shape' ? KC.assets.customShape : KC.assets.drawing;
        drawpad.open(target, existing, null);
      });
    });

    $('#draw-cancel').addEventListener('click', function () { drawpad.close(); });
    $('#draw-apply').addEventListener('click', function () {
      var fill = $('#draw-fill').checked;
      var out = drawpad.result(fill);
      if (drawpad.target === 'shape') {
        KC.assets.customShape = out;
        state.shape.preset = 'custom';
        preview.invalidateBorder();
      } else {
        KC.assets.drawing = out;
        state.art.source = 'draw';
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
      var payload = { version: 1, state: state, assets: {} };
      ['image', 'drawing', 'customShape'].forEach(function (k) {
        if (KC.assets[k]) payload.assets[k] = KC.assets[k].toDataURL('image/png');
      });
      KC.download(new Blob([JSON.stringify(payload)], { type: 'application/json' }),
                  safeName() + '.keychain.json');
    });

    $('#btn-load').addEventListener('click', function () { $('#loadfile').click(); });
    $('#loadfile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var p = JSON.parse(fr.result);
          var d = KC.defaults();
          // Merge so designs saved by older versions still load.
          Object.keys(d).forEach(function (k) {
            if (p.state[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) {
              Object.keys(d[k]).forEach(function (j) {
                if (p.state[k][j] !== undefined) d[k][j] = p.state[k][j];
              });
            } else if (p.state[k] !== undefined) { d[k] = p.state[k]; }
          });
          state = d;
          var pending = 0;
          ['image', 'drawing', 'customShape'].forEach(function (k) {
            KC.assets[k] = null;
            if (!p.assets || !p.assets[k]) return;
            pending++;
            var img = new Image();
            img.onload = function () {
              var c = document.createElement('canvas');
              c.width = img.width; c.height = img.height;
              c.getContext('2d').drawImage(img, 0, 0);
              c._rev = Date.now();
              KC.assets[k] = c;
              if (!--pending) done();
            };
            img.src = p.assets[k];
          });
          if (!pending) done();
        } catch (err) {
          showWarnings([{ level: 'bad', msg: 'That file could not be loaded: ' + err.message }]);
        }
        function done() {
          preview.state = state;
          preview.invalidateBorder();
          refresh();
          apply();
        }
      };
      fr.readAsText(f);
      e.target.value = '';
    });
  }

  /* ── boot ───────────────────────────────────────────────────────── */
  function init() {
    populate();

    preview = new KC.Preview($('#c2d'), state, function () { rebuild(); });
    try {
      viewer = new KC.Viewer($('#c3d'));
    } catch (e) {
      viewer = { failed: true, setModel: function () {}, draw: function () {}, frame: function () {} };
    }

    bind();
    chrome();
    assets();
    exports_();
    refresh();

    var ro = new ResizeObserver(function () {
      preview.draw();
      if (viewer && !viewer.failed) viewer.draw();
    });
    ro.observe($('#stage'));

    if (viewer && viewer.failed) {
      showWarnings([{ level: 'warn', msg: 'WebGL is unavailable, so the 3D preview is disabled. Export still works.' }]);
    }

    apply();
  }

  /* Live handles, for console poking and automated checks. */
  KC.getState = function () { return state; };
  KC.getViewer = function () { return viewer; };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window.KC);

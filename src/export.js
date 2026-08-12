/* export.js — 3MF (multi-colour) and STL (single body) writers.
 *
 * The 3MF is one mesh object whose triangles are grouped into contiguous runs,
 * one per colour. Colour is declared three ways, because slicers disagree about
 * where to look and core 3MF materials alone import as a single colour:
 *
 *   <basematerials> + per-triangle pid/p1   spec-correct; viewers and thumbnails
 *   Metadata/Slic3r_PE_model.config         PrusaSlicer, SuperSlicer, OrcaSlicer
 *   Metadata/model_settings.config          Bambu Studio, OrcaSlicer, Creality Print
 *   Metadata/project_settings.config        filament swatches for the above
 *
 * The last three map each triangle run to an extruder number, which is what
 * actually drives a multi-material print.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
  var MAT  = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  var num = function (v) {
    var s = v.toFixed(4);
    // trim trailing zeros — meaningfully smaller files on big meshes
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  };

  /* Merge duplicate vertices so shared edges reference one index. */
  function dedupe(part) {
    var p = part.positions, ix = part.indices;
    var map = new Map(), verts = [], remap = new Int32Array(p.length / 3);
    for (var i = 0; i < p.length / 3; i++) {
      var x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      var key = num(x) + '|' + num(y) + '|' + num(z);
      var at = map.get(key);
      if (at === undefined) { at = verts.length / 3; map.set(key, at); verts.push(x, y, z); }
      remap[i] = at;
    }
    var tris = [];
    for (var t = 0; t < ix.length; t += 3) {
      var a = remap[ix[t]], b = remap[ix[t + 1]], c = remap[ix[t + 2]];
      if (a === b || b === c || a === c) continue;   // collapsed by the merge
      tris.push(a, b, c);
    }
    return { verts: verts, tris: tris };
  }

  function bounds(parts) {
    var b = { minX: Infinity, minY: Infinity, minZ: Infinity };
    parts.forEach(function (part) {
      var p = part.positions;
      for (var i = 0; i < p.length; i += 3) {
        if (p[i] < b.minX) b.minX = p[i];
        if (p[i + 1] < b.minY) b.minY = p[i + 1];
        if (p[i + 2] < b.minZ) b.minZ = p[i + 2];
      }
    });
    if (!isFinite(b.minX)) { b.minX = b.minY = b.minZ = 0; }
    return b;
  }

  KC.exportThreeMF = function (model, state) {
    var parts = model.parts.filter(function (p) { return p.indices.length; });
    if (!parts.length) return Promise.reject(new Error('Nothing to export.'));

    /* One base material per distinct colour actually used. */
    var slots = [], slotOf = {};
    parts.forEach(function (p) {
      if (slotOf[p.colorIndex] === undefined) {
        slotOf[p.colorIndex] = slots.length;
        slots.push({ index: p.colorIndex, color: p.color });
      }
    });

    var MATGROUP = 1, OBJ = 2;
    var name = state.name || 'keychain';

    /* Everything goes into ONE mesh, with each colour recorded as a contiguous
       run of triangles. Slicers read those runs from their own metadata files
       below — core <basematerials> alone is not what they use to pick an
       extruder, which is why a materials-only file imports as a single colour. */
    var verts = [], tris = [], volumes = [], vBase = 0;

    parts.forEach(function (part) {
      var m = dedupe(part);                    // welded per part, never across
      var first = tris.length / 3;
      for (var i = 0; i < m.verts.length; i += 3) {
        verts.push(m.verts[i], m.verts[i + 1], m.verts[i + 2]);
      }
      for (var t = 0; t < m.tris.length; t++) tris.push(m.tris[t] + vBase);
      vBase += m.verts.length / 3;
      volumes.push({
        first: first, last: tris.length / 3 - 1,
        label: part.label, slot: slotOf[part.colorIndex],
        extruder: part.colorIndex + 1        // palette slot 1..4 -> extruder 1..4
      });
    });

    var defaultSlot = volumes.length ? volumes[0].slot : 0;

    var xml = [];
    xml.push('<?xml version="1.0" encoding="UTF-8"?>');
    xml.push('<model unit="millimeter" xml:lang="en-US" xmlns="' + CORE + '" xmlns:m="' + MAT + '">');
    xml.push('<metadata name="Application">Keychain Studio</metadata>');
    xml.push('<metadata name="Title">' + esc(name) + '</metadata>');
    xml.push('<metadata name="CreationDate">' + new Date().toISOString().slice(0, 10) + '</metadata>');
    xml.push('<resources>');

    xml.push('<basematerials id="' + MATGROUP + '">');
    slots.forEach(function (sl) {
      xml.push('<base name="Colour ' + (sl.index + 1) + '" displaycolor="' +
               sl.color.toUpperCase() + 'FF"/>');
    });
    xml.push('</basematerials>');

    xml.push('<object id="' + OBJ + '" type="model" name="' + esc(name) +
             '" pid="' + MATGROUP + '" pindex="' + defaultSlot + '">');
    xml.push('<mesh><vertices>');
    for (var v = 0; v < verts.length; v += 3) {
      xml.push('<vertex x="' + num(verts[v]) + '" y="' + num(verts[v + 1]) +
               '" z="' + num(verts[v + 2]) + '"/>');
    }
    xml.push('</vertices><triangles>');
    volumes.forEach(function (vol) {
      // the object-level material covers the first run, so only the others need
      // a per-triangle override
      var over = vol.slot === defaultSlot ? ''
        : ' pid="' + MATGROUP + '" p1="' + vol.slot + '"';
      for (var f = vol.first; f <= vol.last; f++) {
        xml.push('<triangle v1="' + tris[f * 3] + '" v2="' + tris[f * 3 + 1] +
                 '" v3="' + tris[f * 3 + 2] + '"' + over + '/>');
      }
    });
    xml.push('</triangles></mesh></object>');
    xml.push('</resources>');

    var b = bounds(parts);
    xml.push('<build><item objectid="' + OBJ + '" transform="1 0 0 0 1 0 0 0 1 ' +
             num(-b.minX) + ' ' + num(-b.minY) + ' ' + num(-b.minZ) + '"/></build>');
    xml.push('</model>');

    /* PrusaSlicer / SuperSlicer / OrcaSlicer: volumes by triangle range, each
       pinned to an extruder. This is the file those slicers actually consult. */
    var pe = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
    pe.push(' <object id="' + OBJ + '">');
    pe.push('  <metadata type="object" key="name" value="' + esc(name) + '"/>');
    volumes.forEach(function (vol) {
      pe.push('  <volume firstid="' + vol.first + '" lastid="' + vol.last + '">');
      pe.push('   <metadata type="volume" key="name" value="' + esc(vol.label) + '"/>');
      pe.push('   <metadata type="volume" key="volume_type" value="ModelPart"/>');
      pe.push('   <metadata type="volume" key="extruder" value="' + vol.extruder + '"/>');
      pe.push('  </volume>');
    });
    pe.push(' </object>', '</config>');

    /* Bambu Studio / OrcaSlicer read this one instead. */
    var ms = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
    ms.push('  <object id="' + OBJ + '">');
    ms.push('    <metadata key="name" value="' + esc(name) + '"/>');
    volumes.forEach(function (vol, i) {
      ms.push('    <part id="' + (i + 1) + '" subtype="normal_part" firstid="' +
              vol.first + '" lastid="' + vol.last + '">');
      ms.push('      <metadata key="name" value="' + esc(vol.label) + '"/>');
      ms.push('      <metadata key="extruder" value="' + vol.extruder + '"/>');
      ms.push('    </part>');
    });
    ms.push('  </object>', '</config>');

    /* …and this makes their filament swatches match the design. */
    var pal = state.colors.palette.map(function (c) { return c.toUpperCase(); });
    var proj = JSON.stringify({ filament_colour: pal, filament_type: pal.map(function () { return 'PLA'; }) });

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
      '<Default Extension="config" ContentType="application/xml"/>' +
      '</Types>';

    var rels =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rel0" Target="/3D/3dmodel.model" ' +
      'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
      '</Relationships>';

    var enc = new TextEncoder();
    return KC.zip([
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels',         data: enc.encode(rels) },
      { name: '3D/3dmodel.model',    data: enc.encode(xml.join('\n')) },
      { name: 'Metadata/Slic3r_PE_model.config', data: enc.encode(pe.join('\n')) },
      { name: 'Metadata/model_settings.config',  data: enc.encode(ms.join('\n')) },
      { name: 'Metadata/project_settings.config', data: enc.encode(proj) }
    ]);
  };

  /* Binary STL — every part merged, colour information dropped. */
  KC.exportSTL = function (model) {
    var total = 0;
    model.parts.forEach(function (p) { total += p.indices.length / 3; });
    if (!total) return null;

    var buf = new ArrayBuffer(84 + total * 50);
    var dv = new DataView(buf);
    var header = 'Keychain Studio';
    for (var h = 0; h < header.length; h++) dv.setUint8(h, header.charCodeAt(h));
    dv.setUint32(80, total, true);

    var off = 84;
    model.parts.forEach(function (part) {
      var p = part.positions, ix = part.indices;
      for (var i = 0; i < ix.length; i += 3) {
        var a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
        var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        var vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        var len = Math.hypot(nx, ny, nz) || 1;

        dv.setFloat32(off, nx / len, true);
        dv.setFloat32(off + 4, ny / len, true);
        dv.setFloat32(off + 8, nz / len, true);
        var o = off + 12;
        [a, b, c].forEach(function (v) {
          dv.setFloat32(o, p[v], true);
          dv.setFloat32(o + 4, p[v + 1], true);
          dv.setFloat32(o + 8, p[v + 2], true);
          o += 12;
        });
        dv.setUint16(off + 48, 0, true);
        off += 50;
      }
    });

    return new Blob([buf], { type: 'model/stl' });
  };

  KC.download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

})(window.KC);

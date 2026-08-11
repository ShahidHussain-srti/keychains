/* export.js — 3MF (multi-colour) and STL (single body) writers.
 *
 * The 3MF holds one mesh object per colour, each tagged with a base material,
 * assembled through a component object so the parts land pre-aligned as a
 * single build item. PrusaSlicer, OrcaSlicer, Bambu Studio and Cura all read
 * that arrangement and keep the colours separable.
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

    // One base material per distinct colour actually used.
    var slots = [], slotOf = {};
    parts.forEach(function (p) {
      if (slotOf[p.colorIndex] === undefined) {
        slotOf[p.colorIndex] = slots.length;
        slots.push({ index: p.colorIndex, color: p.color });
      }
    });

    var MATGROUP = 1;
    var xml = [];
    xml.push('<?xml version="1.0" encoding="UTF-8"?>');
    xml.push('<model unit="millimeter" xml:lang="en-US" xmlns="' + CORE + '" xmlns:m="' + MAT + '">');
    xml.push('<metadata name="Application">Keychain Studio</metadata>');
    xml.push('<metadata name="Title">' + esc(state.name || 'keychain') + '</metadata>');
    xml.push('<metadata name="CreationDate">' + new Date().toISOString().slice(0, 10) + '</metadata>');
    xml.push('<resources>');

    xml.push('<basematerials id="' + MATGROUP + '">');
    slots.forEach(function (s) {
      xml.push('<base name="Colour ' + (s.index + 1) + '" displaycolor="' +
               s.color.toUpperCase() + 'FF"/>');
    });
    xml.push('</basematerials>');

    var nextId = MATGROUP + 1;
    var componentIds = [];

    parts.forEach(function (part) {
      var m = dedupe(part);
      var id = nextId++;
      componentIds.push({ id: id, name: part.label });

      xml.push('<object id="' + id + '" type="model" name="' + esc(part.label) +
               '" pid="' + MATGROUP + '" pindex="' + slotOf[part.colorIndex] + '">');
      xml.push('<mesh><vertices>');
      for (var i = 0; i < m.verts.length; i += 3) {
        xml.push('<vertex x="' + num(m.verts[i]) + '" y="' + num(m.verts[i + 1]) +
                 '" z="' + num(m.verts[i + 2]) + '"/>');
      }
      xml.push('</vertices><triangles>');
      for (var t = 0; t < m.tris.length; t += 3) {
        xml.push('<triangle v1="' + m.tris[t] + '" v2="' + m.tris[t + 1] +
                 '" v3="' + m.tris[t + 2] + '"/>');
      }
      xml.push('</triangles></mesh></object>');
    });

    var assemblyId = nextId++;
    xml.push('<object id="' + assemblyId + '" type="model" name="' + esc(state.name || 'keychain') + '">');
    xml.push('<components>');
    componentIds.forEach(function (c) {
      xml.push('<component objectid="' + c.id + '"/>');
    });
    xml.push('</components></object>');
    xml.push('</resources>');

    // The mesh is modelled around the origin; the build item shifts it into the
    // positive octant, which is where 3MF expects content to sit.
    var b = bounds(parts);
    xml.push('<build><item objectid="' + assemblyId + '" transform="1 0 0 0 1 0 0 0 1 ' +
             num(-b.minX) + ' ' + num(-b.minY) + ' ' + num(-b.minZ) + '"/></build>');
    xml.push('</model>');

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
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
      { name: '3D/3dmodel.model',    data: enc.encode(xml.join('\n')) }
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

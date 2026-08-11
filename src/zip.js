/* zip.js — minimal ZIP writer (a 3MF is an OPC package, i.e. a zip).
 * Deflates through the platform CompressionStream when available and falls
 * back to stored entries, which stay perfectly valid.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  /* files: [{name, data: Uint8Array}] → Blob */
  KC.zip = function (files) {
    var enc = new TextEncoder();
    var prepared = files.map(function (f) {
      return { name: enc.encode(f.name), raw: f.data, crc: crc32(f.data) };
    });

    return Promise.all(prepared.map(function (p) {
      return deflateRaw(p.raw).then(function (def) {
        if (def && def.length < p.raw.length) { p.body = def; p.method = 8; }
        else { p.body = p.raw; p.method = 0; }
        return p;
      });
    })).then(function (list) {
      var chunks = [], offset = 0, central = [];

      list.forEach(function (p) {
        var lh = new Uint8Array(30 + p.name.length);
        var dv = new DataView(lh.buffer);
        dv.setUint32(0, 0x04034B50, true);
        dv.setUint16(4, 20, true);          // version needed
        dv.setUint16(6, 0, true);           // flags
        dv.setUint16(8, p.method, true);
        dv.setUint16(10, 0, true);          // time
        dv.setUint16(12, 0x21, true);       // date = 1980-01-01
        dv.setUint32(14, p.crc, true);
        dv.setUint32(18, p.body.length, true);
        dv.setUint32(22, p.raw.length, true);
        dv.setUint16(26, p.name.length, true);
        dv.setUint16(28, 0, true);
        lh.set(p.name, 30);

        chunks.push(lh, p.body);
        central.push({ p: p, offset: offset });
        offset += lh.length + p.body.length;
      });

      var cdStart = offset, cdSize = 0;
      central.forEach(function (c) {
        var p = c.p;
        var ch = new Uint8Array(46 + p.name.length);
        var dv = new DataView(ch.buffer);
        dv.setUint32(0, 0x02014B50, true);
        dv.setUint16(4, 20, true);          // version made by
        dv.setUint16(6, 20, true);          // version needed
        dv.setUint16(8, 0, true);
        dv.setUint16(10, p.method, true);
        dv.setUint16(12, 0, true);
        dv.setUint16(14, 0x21, true);
        dv.setUint32(16, p.crc, true);
        dv.setUint32(20, p.body.length, true);
        dv.setUint32(24, p.raw.length, true);
        dv.setUint16(28, p.name.length, true);
        dv.setUint16(30, 0, true);          // extra
        dv.setUint16(32, 0, true);          // comment
        dv.setUint16(34, 0, true);          // disk
        dv.setUint16(36, 0, true);          // internal attrs
        dv.setUint32(38, 0, true);          // external attrs
        dv.setUint32(42, c.offset, true);
        ch.set(p.name, 46);
        chunks.push(ch);
        cdSize += ch.length;
      });

      var eocd = new Uint8Array(22);
      var edv = new DataView(eocd.buffer);
      edv.setUint32(0, 0x06054B50, true);
      edv.setUint16(8, central.length, true);
      edv.setUint16(10, central.length, true);
      edv.setUint32(12, cdSize, true);
      edv.setUint32(16, cdStart, true);
      chunks.push(eocd);

      return new Blob(chunks, { type: 'application/octet-stream' });
    });
  };

  KC.crc32 = crc32;
})(window.KC);

/* gl.js — small flat-shaded WebGL viewer with orbit controls.
 * Renders the very mesh that gets exported, so the preview cannot drift from
 * the file.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'attribute vec3 aColor;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'varying vec3 vN;',
    'varying vec3 vC;',
    'varying vec3 vP;',
    'void main(){',
    '  vN = aNormal; vC = aColor; vP = aPos;',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  var FS = [
    'precision highp float;',
    'varying vec3 vN;',
    'varying vec3 vC;',
    'varying vec3 vP;',
    'uniform vec3 uEye;',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  vec3 v = normalize(uEye - vP);',
    '  vec3 l1 = normalize(vec3(0.45, -0.7, 1.0));',
    '  vec3 l2 = normalize(vec3(-0.8, 0.5, 0.35));',
    '  float d1 = max(dot(n, l1), 0.0);',
    '  float d2 = max(dot(n, l2), 0.0) * 0.35;',
    '  float sky = 0.32 + 0.28 * (n.z * 0.5 + 0.5);',   // hemispheric fill
    '  vec3 h = normalize(l1 + v);',
    '  float spec = pow(max(dot(n, h), 0.0), 42.0) * 0.28;',
    '  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.10;',
    '  vec3 col = vC * (sky + d1 * 0.72 + d2) + spec + rim;',
    '  col = col / (col + vec3(0.42)) * 1.42;',          // gentle tonemap
    '  gl_FragColor = vec4(pow(col, vec3(0.4545)), 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  }

  /* ── 4×4 matrices, column-major ─────────────────────────────────── */
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function lookAt(eye, target, up) {
    var zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    var zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
    ]);
  }

  KC.Viewer = function (canvas) {
    var gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) { this.failed = true; return; }

    this.canvas = canvas;
    this.gl = gl;
    this.count = 0;
    this.center = [0, 0, 0];
    this.radius = 40;

    // camera state
    this.az = -0.62;
    this.el = 0.78;
    this.dist = 120;
    this.pan = [0, 0];

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    this.prog = prog;
    this.loc = {
      pos: gl.getAttribLocation(prog, 'aPos'),
      nrm: gl.getAttribLocation(prog, 'aNormal'),
      col: gl.getAttribLocation(prog, 'aColor'),
      proj: gl.getUniformLocation(prog, 'uProj'),
      view: gl.getUniformLocation(prog, 'uView'),
      eye: gl.getUniformLocation(prog, 'uEye')
    };
    this.buf = gl.createBuffer();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    this._bindControls();
  };

  KC.Viewer.prototype._bindControls = function () {
    var self = this, canvas = this.canvas;
    var down = false, lastX = 0, lastY = 0, shift = false;

    canvas.addEventListener('pointerdown', function (e) {
      down = true; shift = e.shiftKey;
      lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (shift || e.buttons === 4) {
        var k = self.dist * 0.0016;
        self.pan[0] -= dx * k;
        self.pan[1] += dy * k;
      } else {
        self.az -= dx * 0.008;
        self.el = KC.clamp(self.el + dy * 0.008, -1.5, 1.5);
      }
      self.draw();
    });
    var end = function (e) {
      down = false;
      canvas.classList.remove('dragging');
      if (e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.dist = KC.clamp(self.dist * Math.exp(e.deltaY * 0.0012), self.radius * 0.55, self.radius * 14);
      self.draw();
    }, { passive: false });
    canvas.addEventListener('dblclick', function () { self.frame(); self.draw(); });
  };

  /* Build the interleaved flat-shaded buffer from exported parts. */
  KC.Viewer.prototype.setModel = function (parts) {
    if (this.failed) return;
    var gl = this.gl;
    var tris = 0;
    parts.forEach(function (p) { tris += p.indices.length / 3; });
    this.count = tris * 3;
    if (!tris) { this.bounds = null; return; }

    var data = new Float32Array(tris * 3 * 9);
    var o = 0;
    var minX = Infinity, minY = Infinity, minZ = Infinity;
    var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    parts.forEach(function (part) {
      var rgb = KC.hexToRgb(part.color);
      var p = part.positions, ix = part.indices;
      for (var i = 0; i < ix.length; i += 3) {
        var a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
        var ax = p[a], ay = p[a + 1], az = p[a + 2];
        var bx = p[b], by = p[b + 1], bz = p[b + 2];
        var cx = p[c], cy = p[c + 1], cz = p[c + 2];

        var ux = bx - ax, uy = by - ay, uz = bz - az;
        var vx = cx - ax, vy = cy - ay, vz = cz - az;
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        var len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;

        var v = [ax, ay, az, bx, by, bz, cx, cy, cz];
        for (var k = 0; k < 3; k++) {
          var x = v[k * 3], y = v[k * 3 + 1], z = v[k * 3 + 2];
          data[o++] = x; data[o++] = y; data[o++] = z;
          data[o++] = nx; data[o++] = ny; data[o++] = nz;
          data[o++] = rgb[0]; data[o++] = rgb[1]; data[o++] = rgb[2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      }
    });

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

    this.bounds = { minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ };
    this.center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    this.radius = Math.max(6, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  };

  KC.Viewer.prototype.frame = function () {
    this.dist = this.radius * 3.1;
    this.pan = [0, 0];
    this.az = -0.62;
    this.el = 0.78;
  };

  KC.Viewer.prototype.draw = function () {
    if (this.failed) return;
    var gl = this.gl, canvas = this.canvas;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.count) return;

    var ce = Math.cos(this.el), se = Math.sin(this.el);
    var target = [this.center[0] + this.pan[0], this.center[1] + this.pan[1], this.center[2]];
    var eye = [
      target[0] + this.dist * ce * Math.cos(this.az),
      target[1] + this.dist * ce * Math.sin(this.az),
      target[2] + this.dist * se
    ];

    var proj = perspective(0.62, w / h, this.radius * 0.05, this.dist + this.radius * 12);
    var view = lookAt(eye, target, [0, 0, 1]);

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.proj, false, proj);
    gl.uniformMatrix4fv(this.loc.view, false, view);
    gl.uniform3fv(this.loc.eye, new Float32Array(eye));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    var stride = 9 * 4;
    gl.enableVertexAttribArray(this.loc.pos);
    gl.vertexAttribPointer(this.loc.pos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.loc.nrm);
    gl.vertexAttribPointer(this.loc.nrm, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(this.loc.col);
    gl.vertexAttribPointer(this.loc.col, 3, gl.FLOAT, false, stride, 24);

    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  };

})(window.KC);

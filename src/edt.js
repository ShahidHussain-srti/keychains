/* edt.js — exact Euclidean distance transform, used to offset outlines.
 *
 * Offsetting an arbitrary polygon inwards is fiddly; on a raster it is just a
 * distance threshold. That is how borders are built: rasterise the shape, take
 * the signed distance to its outline, and keep the band you want. It works
 * identically for rectangles, hearts and hand-drawn blobs.
 *
 * Squared-distance transform after Felzenszwalb & Huttenlocher (2012): a 1-D
 * lower envelope of parabolas, run over columns then rows. O(n) overall.
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var INF = 1e20;

  /* Lower envelope of parabolas rooted at (i, f[i]); result back into f. */
  function edt1d(f, d, v, z, n) {
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    d[0] = f[0];

    for (var q = 1, k = 0, s = 0; q < n; q++) {
      do {
        var r = v[k];
        s = (f[q] - f[r] + q * q - r * r) / (2 * q - 2 * r);
      } while (s <= z[k] && --k > -1);

      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }

    for (var q2 = 0, k2 = 0; q2 < n; q2++) {
      while (z[k2 + 1] < q2) k2++;
      var r2 = v[k2];
      d[q2] = (q2 - r2) * (q2 - r2) + f[r2];
    }
    for (var i = 0; i < n; i++) f[i] = d[i];
  }

  /* Squared distance (in pixels²) from every cell to the nearest seed.
     `seed(i)` must return true where distance is zero. */
  function edt2d(cols, rows, seed) {
    var n = cols * rows;
    var grid = new Float64Array(n);
    for (var i = 0; i < n; i++) grid[i] = seed(i) ? 0 : INF;

    var m = Math.max(cols, rows);
    var f = new Float64Array(m), d = new Float64Array(m),
        v = new Int32Array(m), z = new Float64Array(m + 1);

    var x, y;
    for (x = 0; x < cols; x++) {                       // columns
      for (y = 0; y < rows; y++) f[y] = grid[y * cols + x];
      edt1d(f, d, v, z, rows);
      for (y = 0; y < rows; y++) grid[y * cols + x] = f[y];
    }
    for (y = 0; y < rows; y++) {                       // rows
      var off = y * cols;
      for (x = 0; x < cols; x++) f[x] = grid[off + x];
      edt1d(f, d, v, z, cols);
      for (x = 0; x < cols; x++) grid[off + x] = f[x];
    }
    return grid;
  }

  /* Signed distance to the 0.5-isoline of `mask`, in millimetres.
     Positive inside the shape, negative outside. */
  KC.sdf = function (mask, g) {
    var n = g.cols * g.rows;
    var outside = edt2d(g.cols, g.rows, function (i) { return mask[i] < 0.5; });
    var inside  = edt2d(g.cols, g.rows, function (i) { return mask[i] >= 0.5; });
    var out = new Float32Array(n), s = 1 / g.ppmm;
    for (var i = 0; i < n; i++) {
      out[i] = mask[i] >= 0.5
        ?  (Math.sqrt(outside[i]) - 0.5) * s
        : -(Math.sqrt(inside[i]) - 0.5) * s;
    }
    return out;
  };

  /* Largest inscribed radius of a mask, in mm — a cheap proxy for how thin the
     thinnest feature is (2× this ≈ the widest stroke that fits). */
  KC.maxInscribed = function (mask, g) {
    var outside = edt2d(g.cols, g.rows, function (i) { return mask[i] < 0.5; });
    var best = 0;
    for (var i = 0; i < outside.length; i++) if (mask[i] >= 0.5 && outside[i] > best) best = outside[i];
    return Math.sqrt(best) / g.ppmm;
  };

  /* Smooth band selector: 1 inside [lo,hi], anti-aliased across one pixel. */
  KC.band = function (d, lo, hi, aa) {
    var a = (d - lo) / aa + 0.5;
    var b = (hi - d) / aa + 0.5;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    b = b < 0 ? 0 : b > 1 ? 1 : b;
    return a * b;
  };

})(window.KC);

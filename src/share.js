/* Keychain Studio. Copyright (C) 2026 shahidhussain2k13@gmail.com
 * SPDX-License-Identifier: GPL-3.0-or-later — see LICENSE. */
/* share.js — a design packed into the link itself, after the '#', so it is
 * never sent to a server and the link works for as long as the site does.
 *
 *   #d=1.<base64url of deflate-raw JSON>   (browsers with CompressionStream)
 *   #d=0.<base64url of UTF-8 JSON>         (fallback, longer)
 */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var PREFIX = '#d=';

  function toB64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str) {
    var s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function pipe(bytes, stream) {
    return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()
      .then(function (b) { return new Uint8Array(b); });
  }
  var canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  /* obj → the part after the page address, '#d=…'. */
  KC.shareEncode = function (obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (!canZip) return Promise.resolve(PREFIX + '0.' + toB64url(bytes));
    return pipe(bytes, new CompressionStream('deflate-raw'))
      .then(function (z) { return PREFIX + '1.' + toB64url(z); });
  };

  /* '#d=…' (or a whole URL) → obj; null when the link carries no design. */
  KC.shareDecode = function (hash) {
    var i = (hash || '').indexOf(PREFIX);
    if (i < 0) return Promise.resolve(null);
    var body = hash.slice(i + PREFIX.length), kind = body.charAt(0);
    return Promise.resolve().then(function () {
      var bytes = fromB64url(body.slice(2));
      if (kind === '0') return bytes;
      if (kind !== '1') throw new Error('unknown link format');
      if (!canZip) throw new Error('this browser cannot unpack compressed links');
      return pipe(bytes, new DecompressionStream('deflate-raw'));
    }).then(function (bytes) { return JSON.parse(new TextDecoder().decode(bytes)); });
  };

  KC.shareBase = function () { return location.href.split('#')[0]; };

  /* ── the popup under the Share button ─────────────────────────────
     One at a time. Plain success fades after a few seconds (not while the
     pointer is over it); anything that needs reading stays until closed.
       opts: { anchor, kind: 'ok'|'warn', title, body, link, linkCopied } */
  var pop = null, popTimer = 0;
  KC.sharePopup = function (opts) {
    closePopup();
    var el = document.createElement('div');
    el.className = 'sharepop ' + (opts.kind || 'ok');
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="sp-head"><span class="sp-ic"></span><b></b>' +
      '<button type="button" class="sp-x" aria-label="Close">✕</button></div>';
    el.querySelector('.sp-ic').textContent = opts.kind === 'warn' ? '!' : '✓';
    el.querySelector('b').textContent = opts.title;
    if (opts.link) {
      var row = document.createElement('div');
      row.className = 'sp-link';
      var inp = document.createElement('input');
      inp.readOnly = true; inp.value = opts.link; inp.setAttribute('aria-label', 'Design link');
      inp.addEventListener('focus', function () { inp.select(); });
      var btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = opts.linkCopied ? 'Copy again' : 'Copy';
      btn.addEventListener('click', function () {
        KC.copyText(opts.link).then(function (ok) {
          btn.textContent = ok ? 'Copied ✓' : 'Select and copy';
          if (!ok) { inp.focus(); inp.select(); }
        });
      });
      row.appendChild(inp); row.appendChild(btn);
      el.appendChild(row);
    }
    (opts.body || []).forEach(function (b) {
      var p = document.createElement('p');
      p.className = 'sp-body' + (b.warn ? ' warn' : '');
      p.textContent = b.text || b;
      el.appendChild(p);
    });
    el.querySelector('.sp-x').addEventListener('click', closePopup);
    document.body.appendChild(el);

    // Under the anchor, right-aligned with it; centred at the top otherwise.
    var a = opts.anchor && opts.anchor.getBoundingClientRect();
    if (a) {
      el.style.top = (a.bottom + 8) + 'px';
      el.style.right = Math.max(8, window.innerWidth - a.right) + 'px';
    } else {
      el.classList.add('centred');
    }
    requestAnimationFrame(function () { el.classList.add('in'); });
    pop = el;

    var sticky = opts.kind === 'warn' || (opts.body || []).some(function (b) { return b.warn; }) ||
                 (opts.link && !opts.linkCopied);
    if (!sticky) {
      var arm = function () { popTimer = setTimeout(closePopup, 4500); };
      el.addEventListener('mouseenter', function () { clearTimeout(popTimer); });
      el.addEventListener('mouseleave', arm);
      arm();
    }
    return el;
  };
  function closePopup() {
    clearTimeout(popTimer);
    if (!pop) return;
    var el = pop; pop = null;
    el.classList.remove('in');
    setTimeout(function () { el.remove(); }, 180);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePopup(); });
  document.addEventListener('pointerdown', function (e) {
    if (pop && !pop.contains(e.target) && !e.target.closest('#btn-share')) closePopup();
  });

  /* Brief "Copied" on the button itself, so it is obvious where to look. */
  KC.flashButton = function (btn, text) {
    if (!btn) return;
    clearTimeout(btn._flash);
    if (btn._label == null) btn._label = btn.textContent;
    btn.textContent = text;
    btn.classList.add('flash');
    btn._flash = setTimeout(function () { btn.textContent = btn._label; btn.classList.remove('flash'); }, 1600);
  };

  /* Put text on the clipboard; returns whether it worked (file:// and older
     browsers can refuse, and the caller then shows the link to copy by hand). */
  KC.copyText = function (text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
    }
    return Promise.resolve(legacy());
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
  };
})(window.KC);

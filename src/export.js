/* Keychain Studio. Copyright (C) 2026 shahidhussain2k13@gmail.com
 * SPDX-License-Identifier: GPL-3.0-or-later — see LICENSE. */
/* export.js — the keychain as one printable object for the shared 3MF / STL
 * writers. */
window.KC = window.KC || {};
(function (KC) {
  'use strict';

  var APP = 'Keychain Studio';

  KC.exportThreeMF = function (model, state) {
    var name = state.name || 'keychain';
    return WB.export3MF({ app: APP, title: name, objects: [{ name: name, parts: model.parts }] });
  };

  KC.exportSTL = function (model) { return WB.exportSTL(model.parts, APP); };

})(window.KC);

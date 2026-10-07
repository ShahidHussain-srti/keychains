# Keychain Studio

**Try it here: https://shahidhussain-srti.github.io/keychains/**

Keychain Studio is a small browser app for designing 3D-printable keychains. Pick a shape,
add text, a border or a picture, choose colours, and export a multi-colour `.3mf` that
slicers open with the colours already assigned.

There's nothing to install and no build step. Use the link above, or download the repo
and double-click `index.html`. It works offline too: the geometry engine
([Manifold](https://github.com/elalish/manifold)) is bundled in `vendor/workbench/`.

## What you can do

- **Shape**: 12 presets, or draw your own outline. Up to 250 mm, with adjustable corner
  radius and thickness.
- **Two sides**: decorate the front and back separately, copy one to the other, or leave
  one plain.
- **Relief per side**: raised, inlaid (recessed or cut right through) or engraved, so you
  can emboss the front and engrave the back.
- **Borders**: 16 styles, including lines, dashes, dots, beads, waves, zigzags, scallops
  and braids. Set the inset to 0 for a flush rim, or have the border follow a different
  shape from the plate.
- **Text**: as many text boxes as you want, each with its own font, size, colour and
  position. There are 47 fonts, solid or outlined, with spacing, rotation and multiple
  lines.
- **Pictures**: upload an image or sketch one in the built-in drawing pad.
- **Colours**: one per element. A design needs only as many filaments as it has distinct
  colours.
- **Keyring hole**: pick one of five positions or drag it wherever you want.

The layout and the 3D preview sit side by side, or you can switch to either one on its
own. Click text, a picture or the hole in the layout to select it, then drag it or nudge
it with the arrow keys. While dragging, its edges and centre snap to the plate's edges and
centre lines, the inside of the border and the other elements, with a guide line (hold Alt to place freely). Every slider has a number box next to it: type an exact value, or
drag sideways on the label or the edge of the box (Shift for bigger steps, Alt for finer).

Each section of the sidebar has a ↺ button that puts its settings back to their defaults,
keeping your names, sizes, text and pictures. `⌘Z` / `Ctrl+Z` undoes anything, and your work survives a refresh. **Save** and **Load**
keep a design as a `.keychain.json` file.

**Share** copies a link that opens your design for whoever you send it to. The design is
packed into the link itself, after the `#`, so nothing is uploaded anywhere. Pictures and
hand-drawn outlines are too big to fit, though, so for those send the saved file or the
exported 3MF instead.

## Printing

Open the `.3mf` in Bambu Studio, OrcaSlicer, Creality Print or PrusaSlicer. It arrives as
one object with each colour already on its own extruder, numbered from 1 in the order
they're used. Every part is a closed, watertight solid. **STL** gives you a single-colour
mesh instead.

The file is laid out the way Bambu Studio writes its own multi-colour files: one mesh per
colour, grouped under an assembly, with `Metadata/model_settings.config` pointing each part
at its extruder. That link is what makes the colours stick. `Slic3r_PE_model.config` says
the same thing for PrusaSlicer. Most generators rely on the 3MF `basematerials` alone,
which slicers ignore, so the model ends up as a single colour.

Multi-colour needs an AMS, CFS or MMU. On a single-extruder printer the slicer puts every
part on extruder 1, whatever the file says. In **raised** mode each colour gets its own
band of layers, though, so a manual filament change works just as well, and the warnings
strip tells you which layer to swap at.

Set **layer height** to match your slicer. Every thickness is a whole number of layers, and
at least three, so nothing ever asks for a partial layer.

A few things worth knowing:

- Engraved and single-colour raised designs print on anything.
- A cut-through inlay goes all the way through the plate, so it shows on both sides and
  can only carry one design. If you decorate both faces, each one gets recessed instead.
- The back prints against the bed, so put the busier side on the front.
- Details thinner than about 0.8 mm get flagged in the warnings.

## How it works

Every element is drawn to an anti-aliased mask in millimetre space, traced with marching
squares, and extruded with [Manifold](https://github.com/elalish/manifold), whose booleans
always come back watertight. Working from masks makes a lot of things easy: colour
separation is a 2D subtraction, borders are a distance threshold (so they follow any
outline, even hand-drawn ones), and text needs no font parsing. Recesses are cut with the
very bodies that fill them, so inlays fit exactly. The back face reuses all of it,
mirrored. The 3D view shows the exact mesh that gets exported.

Files in `src/`: `util` state and depth rules, `raster` the plate and hole masks, `mesh`
the solids, `export` the keychain as a printable object, `preview` the layout view, and
`app` to wire it together.

The parts Keychain Studio shares with Dabba (masks and contours, borders, text and
pictures, the 3MF writer, the 3D viewer, the geometry engine, share links, undo, number
fields and most of the styling) live in
[Workbench](https://github.com/ShahidHussain-srti/workbench), copied into
`vendor/workbench/`.

If you need a case rather than a keychain, have a look at
[Dabba](https://shahidhussain-srti.github.io/dabba/), which grew out of this project.

## License

Copyright © 2026 shahidhussain2k13@gmail.com

Keychain Studio is free software under the **GNU General Public License v3.0 or later**.
You can use it, change it and share it. If you distribute something built from it,
including hosting a modified copy on a website, that has to be GPL with its source
available too. There's no warranty. See [LICENSE](LICENSE) for the full text.

`vendor/workbench/manifold.js` is [Manifold](https://github.com/elalish/manifold), © The
Manifold Authors, under the Apache License 2.0
([vendor/workbench/LICENSE-manifold.txt](vendor/workbench/LICENSE-manifold.txt)), which is
compatible with the GPL.

`vendor/workbench/` is [Workbench](https://github.com/ShahidHussain-srti/workbench), by the
same author under the same license.

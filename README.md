# Keychain Studio

Design a keychain in the browser, export a 3D-printable multi-colour `.3mf`.

No dependencies, no build step — **double-click `index.html`**.

## Controls

- **Shape** — 12 presets or draw your own outline; up to 250 mm, corner radius, thickness
- **Sides** — front and back decorated independently, each with its own relief style;
  copy one to the other, or switch one off
- **Relief** — raised, inlay (recessed or cut through), or engraved — per face, so you can
  emboss the front and engrave the back
- **Border** — 16 styles: lines, dashes, dots, beads, ticks, wave, zigzag, scallop, braid;
  inset to 0 for a flush rim; can trace a different shape than the plate
- **Text** — any number of text boxes per face, each with its own font, size, colour and
  placement; 47 fonts, solid or outlined, spacing/rotation, multiple lines
- **Pictures** — any number per face; upload an image or draw one in the built-in pad
- **Colour** — one per element, so a design needs as many filaments as you give it
  distinct colours, and no more
- **Keyring hole** — 5 presets or drag it anywhere

Click text, picture or hole in the Layout view to select; drag or arrow-key to move.
`⌘Z`/`Ctrl+Z` undoes anything. Work survives a refresh; **Reset** starts over.

## Printing

Import the `.3mf` into PrusaSlicer, OrcaSlicer, Bambu Studio or Creality Print. It arrives
as one object whose parts are pre-assigned to extruders, numbered from 1 in order of use.
Every part is independently watertight with outward normals. **STL** exports a
single-colour mesh instead.

The layout follows how Bambu Studio itself writes a multi-colour file: one mesh object per
colour, gathered by an assembly object's `<components>`, with
`Metadata/model_settings.config` keying each `<part>` by the *component's objectid* and
giving it an extruder. That id link is what makes colour stick. `Slic3r_PE_model.config`
states the same thing as triangle ranges for PrusaSlicer. Core `basematerials` are also
written for viewers, but slicers ignore them — a real Bambu file contains none, which is
why a file relying on them imports as a single colour.

Colour needs a multi-material printer (AMS / CFS / MMU). On a single-extruder machine the
3D view may show the colours while the **print preview stays one colour**: the slicer maps
every part to extruder 1 and the file cannot override that. In **raised** mode each colour
sits in its own band of layers, so a manual filament change gives the same result — the
warnings strip tells you the exact layer.

Set **layer height** to match your slicer: every thickness is a whole multiple of it and
at least 3 layers, so nothing asks for a partial layer.

## Notes

- Multi-colour needs an AMS/MMU or manual swaps. Engraved and single-colour raised
  designs print on anything.
- A through-cut inlay is one void through the plate, so it shows on both faces and can
  carry only one design. Decorate both faces and it recesses into each instead.
- Back-face detail prints against the bed — put the busier face up.
- Details under ~0.8 mm wide get flagged; watch the warnings strip.

## How it works

Every element is rasterised to an anti-aliased mask in mm space, then
`marching squares → simplify → ear clipping → extrude`. One representation gives colour
separation as a 2-D boolean, border offsetting as a distance threshold (so it hugs any
outline, hand-drawn included), and text without font parsing. The back face reuses all of
it, mirrored. The 3D view renders the exported mesh, so it cannot drift from the file.

`util` state + depth rules · `earcut` triangulation · `edt` distance fields ·
`contour` tracing · `shapes` outlines · `raster` masks · `mesh` extrusion ·
`zip`/`export` 3MF+STL · `gl` viewer · `preview` layout · `drawpad` · `app` wiring

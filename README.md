# Keychain Studio

Design a keychain in the browser, export a 3D-printable multi-colour `.3mf`.

No dependencies, no build step — **double-click `index.html`**.

## Controls

- **Shape** — 12 presets or draw your own outline; width, height, corner radius, thickness
- **Sides** — front and back decorated independently; copy one to the other, or switch one off
- **Relief** — raised, inlay (recessed or cut through), or engraved
- **Border** — 16 styles: lines, dashes, dots, beads, ticks, wave, zigzag, scallop, braid;
  inset to 0 for a flush rim; can trace a different shape than the plate
- **Text** — 16 fonts, solid or outlined, size/spacing/rotation, multiple lines
- **Picture** — upload an image or draw one in the built-in pad
- **Colour** — 4 filaments, assigned freely to plate / border / text / picture
- **Keyring hole** — 5 presets or drag it anywhere

Click text, picture or hole in the Layout view to select; drag or arrow-key to move.
`⌘Z`/`Ctrl+Z` undoes anything. Work survives a refresh; **Reset** starts over.

## Printing

Import the `.3mf` into PrusaSlicer, OrcaSlicer, Bambu Studio or Cura — bodies arrive
pre-aligned as one object with colours attached, ready to map to extruders. Every body
is watertight with outward normals. **STL** exports a single-colour mesh instead.

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

# Keychain Studio

A browser app for designing custom keychains and exporting them as **3D-printable
`.3mf`** files, with up to four separately-coloured bodies.

No build step, no server, no dependencies — **double-click `index.html`** and it
runs from `file://`.

---

## What you can make

**Plate shape** — rectangle, square, circle, ellipse, capsule, triangle,
pentagon, hexagon, octagon, star, heart, shield, or an outline you draw
freehand. Adjustable width, height and corner radius (corners are filleted, not
just clipped).

**Thickness** — 0.4 mm to 5 mm.

**Relief style** — how the details meet the plate:

| Style | Result | Printer |
|---|---|---|
| **Raised** | Details stand proud on top of the plate | Any; full colour needs AMS/MMU |
| **Inlay** | Details cut clean through and are filled with their own colour — flush, and visible from both sides | Multi-material |
| **Engraved** | Details recessed into the plate | Any, single colour |

**Keyring hole** — diameter, edge margin, and five positions. The hole is fitted
to the *actual silhouette*, not the bounding box, so it lands correctly inside a
circle, a star point, or a hand-drawn blob.

**Border** — none, single line, double line, dashed, dotted, or thick band, with
adjustable inset, width, gap and dash count. It can follow the plate outline or
trace a *different* shape (a star border inside a rectangle, say).

**Text** — 16 font choices, bold, italic, solid or outlined, size, letter
spacing, line height, rotation, alignment, multiple lines. Drag it into place
directly in the Layout view.

**Picture** — upload an image (traced by transparency, dark areas, or light
areas, with an adjustable threshold) or draw one in the built-in pad, which has
brush, eraser, line, rectangle and ellipse tools plus undo.

**Colour** — a palette of four filaments. The plate, border, text and picture
each get assigned to one of them, so all four can differ.

---

## Using it

1. Open `index.html` in a modern browser (Chrome, Edge, Safari or Firefox).
2. Design on the left; **Layout** shows a true-to-scale top view (drag the text
   and picture to position them), **3D preview** shows the real mesh — drag to
   orbit, scroll to zoom, shift-drag to pan, double-click to re-frame.
3. Watch the readout for size, triangle count and estimated PLA weight, and the
   warnings strip for printability problems.
4. **Export 3MF** for colour, or **STL** for a single-body mesh.
   **Save**/**Load** keeps a design as JSON, drawings included.

Import the `.3mf` into PrusaSlicer, OrcaSlicer, Bambu Studio or Cura: the bodies
arrive pre-aligned as one object with their colours attached, ready to map to
extruders.

**Quality** controls the raster resolution used to build the mesh (Draft →
Ultra). Normal is good for most designs; raise it for fine text or intricate
artwork.

---

## How it works

Every element — plate, border, text, uploaded image, freehand drawing — is
rasterised into an anti-aliased alpha mask in millimetre space. One
representation for everything buys three things at once:

- **Colour separation is a 2-D boolean.** Masks are subtracted in priority order
  (text over picture over border) *before* extrusion, so no two filaments ever
  claim the same volume and the slicer never sees overlapping solids.
- **Outline offsetting is a distance threshold.** Borders come from the signed
  distance field of the plate mask (`src/edt.js`, exact Euclidean transform), so
  they hug *any* outline — including hand-drawn ones — with naturally rounded
  corners. The same field fits the keyring hole and measures the thinnest detail
  for the printability warning.
- **Text needs no font parsing.** Glyphs are rasterised by the browser and
  traced like any other mask, so every installed font just works.

Masks then become geometry:

```
mask ──► marching squares ──► Douglas–Peucker ──► ear clipping ──► extrusion
         (sub-pixel, iso 0.5)   (simplify)        (holes bridged)   (prism + walls)
```

Marching squares interpolates along cell edges, so anti-aliased masks yield
smooth sub-pixel outlines rather than stair steps. Loops are stitched by *edge
identity* rather than by float coordinates, then nested by containment depth so
loops inside loops become holes (and islands inside those become solid again).
Outer rings are forced counter-clockwise and holes clockwise, which makes the
wall winding fall out correctly for both.

The 3D preview renders the exact mesh that gets exported, so the preview cannot
drift from the file.

### Layout

| File | Role |
|---|---|
| `src/util.js` | State defaults, mask algebra, mm↔pixel grid |
| `src/earcut.js` | Ear-clipping triangulator, hole bridging, z-order hashing |
| `src/edt.js` | Exact Euclidean distance transform, signed distance fields |
| `src/contour.js` | Marching squares, simplification, hole nesting |
| `src/shapes.js` | Parametric outlines, corner filleting |
| `src/raster.js` | Rasterises every element to a mask; border and hole fitting |
| `src/mesh.js` | Colour separation, extrusion, printability checks |
| `src/zip.js` | Minimal ZIP writer (deflate via `CompressionStream`) |
| `src/export.js` | 3MF and binary STL writers |
| `src/gl.js` | Hand-rolled WebGL viewer with orbit controls |
| `src/preview.js` | Layout view and drag-to-position |
| `src/drawpad.js` | Freehand editor with flood fill |
| `src/app.js` | Declarative `data-bind` UI wiring |

### About the exported 3MF

One mesh object per colour, each tagged with a `<base>` material from the
materials extension, assembled through a component object so a single build item
places them pre-aligned. Vertices are merged, coordinates are millimetres, and
the build transform shifts the model into the positive octant as the spec
expects.

Every exported body is watertight: each directed edge appears exactly once with
its reverse present, and signed volumes are positive, so normals face outward.

---

## Notes and limits

- **Inlay** and multi-colour **raised** designs need a multi-material printer or
  manual filament swaps. Engraved and single-colour raised designs print on
  anything.
- Details thinner than about 0.8 mm (two 0.4 mm extrusion widths) get flagged —
  they'll print poorly. Prefer a bolder font or a wider border.
- Geometry is raster-derived, so extremely fine detail is limited by the Quality
  setting rather than being mathematically exact.
- Saving and reloading restores the design exactly. The rebuilt mesh can differ
  by a couple of percent in triangle count, because a bitmap that has been
  through PNG encode/decode carries a slightly different internal premultiplied
  alpha representation, which nudges a few dozen edge cells across the tracing
  threshold. Both meshes are watertight and visually identical.
- Fonts are whatever the system provides; the stacks fall back gracefully, but a
  design opened on another machine may pick a different face.

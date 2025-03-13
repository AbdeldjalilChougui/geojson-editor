# geojson-editor

A small browser-based GeoJSON viewer, editor and validator built with
MapLibre GL JS and terra-draw. Everything runs in the browser and nothing is
uploaded.

**Live demo: <https://abdeldjalilchougui.github.io/geojson-editor/>** (static site on GitHub Pages; your files stay in the browser).

- **Load** a file (picker or drag and drop on the map), a URL (the server must allow CORS) or pasted text.
  A bare Geometry or Feature is wrapped into a FeatureCollection.
- **Draw and edit** points, lines, polygons and rectangles. Drag vertices, insert midpoints, move whole features
  and delete with the Delete key.
- **Properties panel** to add, rename, edit and delete keys. Values are typed from what you write
  (`42` → number, `true` → boolean, `"42"` → string, `[1,2]` → array), and key order is preserved.
- **Validation** against RFC 7946. Errors cover ring closure, ring length, position shape, swapped lat/lon and
  bad feature members. Warnings cover winding order, `crs`, >3-dimension positions and odd GeometryCollections.
  Clicking an issue selects its feature, and a one-click "Fix winding" applies the right-hand rule.
- **Export** downloads or copies the result with optional coordinate rounding (precision) and compact output.
- The current document is autosaved in `localStorage`. If storage is blocked, the editor still works.

## Install

Nothing to install: open the [live demo](https://abdeldjalilchougui.github.io/geojson-editor/). To run it locally or host
your own copy:

```sh
git clone https://github.com/AbdeldjalilChougui/geojson-editor.git
cd geojson-editor
pnpm install
pnpm dev
```

The production build uses the Vite base `/geojson-editor/` (see `vite.config.ts`);
change it if you serve the site from another path.

## Quick start

```sh
pnpm install
pnpm dev          # http://localhost:5173/geojson-editor/, then Paste or Open file (try public/sample.geojson)
pnpm test         # vitest, pure logic only
pnpm build        # type-check + production build into dist/
```

## How it works

```
src/lib/        pure, DOM-free, unit tested
  parse.ts      text -> JSON -> FeatureCollection (friendly errors, never throws)
  validate.ts   structural RFC 7946 validator, issues with JSONPath-like paths
  properties.ts value inference + immutable add/rename/set/delete
  winding.ts    signed area, orientation, rewind (exterior CCW, holes CW)
  bbox.ts       bounding boxes for fit-to-data
  export.ts     precision rounding (coordinates only) + serialisation
  storage.ts    injected key/value store with every access guarded
  model.ts      document items with stable uids, which geometries are editable
src/main.ts     glue: MapLibre map, terra-draw modes, panels
```

The editor keeps its own document, a list of `{uid, feature}`, as the source
of truth. Features terra-draw can edit (Point, LineString, single-ring
Polygon) are mirrored into terra-draw under the same uid. The user's
properties stay in the document, so terra-draw's reserved `mode` property
never reaches the export. Geometries terra-draw cannot edit (Multi*,
GeometryCollection, polygons with holes, or anything its validation rejects)
are drawn read-only by a plain MapLibre layer. They stay in the document, so
their properties can still be edited and they are exported unchanged.

## Status and limitations

- Multi-geometries, GeometryCollections and polygons with holes are **read-only** on the map.
- There is no undo/redo yet.
- Validation is structural only. It does not detect self-intersections or holes outside the exterior ring.
- Basemap tiles come from tile.openstreetmap.org, which is fine for light personal use
  ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)). Change the style in `src/main.ts` for anything heavier.
- The production bundle is about 1.2 MB (MapLibre + terra-draw) and is not code-split.

## License

MIT, see [LICENSE](LICENSE). Map data © OpenStreetMap contributors (ODbL). The
sample file holds hand-drawn approximate shapes.

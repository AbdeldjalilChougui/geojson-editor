// Ring orientation (winding order) helpers.
//
// RFC 7946 section 3.1.6: exterior rings are counterclockwise, holes are
// clockwise ("right-hand rule"). Parsers must not reject data that breaks this
// rule, so the validator only reports it as a warning; `rewind` fixes it.
//
// Orientation is computed with the planar shoelace formula on raw lon/lat.
// That is fine for deciding orientation of ordinary rings, but it is not a
// geodesic area and it does not handle rings crossing the antimeridian.

import type { Feature, FeatureCollection, Geometry, Position } from "./types";

/** Twice the signed planar area; > 0 means counterclockwise. */
export function signedArea2(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  // Close implicitly if the ring is not closed.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && (first[0] !== last[0] || first[1] !== last[1])) {
    sum += last[0] * first[1] - first[0] * last[1];
  }
  return sum;
}

export type Orientation = "ccw" | "cw" | "degenerate";

export function ringOrientation(ring: Position[]): Orientation {
  const a = signedArea2(ring);
  if (a > 0) return "ccw";
  if (a < 0) return "cw";
  return "degenerate";
}

function rewindRing(ring: Position[], wantCCW: boolean): Position[] {
  const o = ringOrientation(ring);
  if (o === "degenerate") return ring.map((p) => [...p]);
  const isCCW = o === "ccw";
  const copy = ring.map((p) => [...p]);
  return isCCW === wantCCW ? copy : copy.reverse();
}

export function rewindPolygon(rings: Position[][]): Position[][] {
  return rings.map((ring, i) => rewindRing(ring, i === 0));
}

/** Returns a copy of the geometry with RFC 7946 winding. Non-polygons are copied unchanged. */
export function rewindGeometry(g: Geometry): Geometry {
  switch (g.type) {
    case "Polygon":
      return { ...g, coordinates: rewindPolygon(g.coordinates as Position[][]) };
    case "MultiPolygon":
      return {
        ...g,
        coordinates: (g.coordinates as Position[][][]).map((p) => rewindPolygon(p)),
      };
    case "GeometryCollection":
      return { ...g, geometries: (g.geometries ?? []).map(rewindGeometry) };
    default:
      return structuredClone(g);
  }
}

export function rewindFeature(f: Feature): Feature {
  return { ...f, geometry: f.geometry ? rewindGeometry(f.geometry) : null };
}

export function rewindCollection(fc: FeatureCollection): FeatureCollection {
  return { ...fc, features: fc.features.map(rewindFeature) };
}

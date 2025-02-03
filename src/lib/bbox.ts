// Bounding boxes computed by walking every numeric position in the data.
// Invalid parts are skipped instead of throwing. Antimeridian-crossing data
// gets a (wide) naive box, which is a known limitation.

import type { BBox2D, Feature, FeatureCollection, Geometry } from "./types";

function isPosition(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

function walk(coords: unknown, visit: (p: number[]) => void) {
  if (isPosition(coords)) {
    visit(coords);
  } else if (Array.isArray(coords)) {
    for (const c of coords) walk(c, visit);
  }
}

function walkGeometry(g: Geometry | null | undefined, visit: (p: number[]) => void) {
  if (!g || typeof g !== "object") return;
  if (g.type === "GeometryCollection") {
    for (const child of g.geometries ?? []) walkGeometry(child, visit);
  } else {
    walk(g.coordinates, visit);
  }
}

class Acc {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  add = (p: number[]) => {
    if (p[0] < this.minX) this.minX = p[0];
    if (p[1] < this.minY) this.minY = p[1];
    if (p[0] > this.maxX) this.maxX = p[0];
    if (p[1] > this.maxY) this.maxY = p[1];
  };
  result(): BBox2D | null {
    return this.minX === Infinity ? null : [this.minX, this.minY, this.maxX, this.maxY];
  }
}

export function geometryBBox(g: Geometry | null): BBox2D | null {
  const acc = new Acc();
  walkGeometry(g, acc.add);
  return acc.result();
}

export function featureBBox(f: Feature): BBox2D | null {
  return geometryBBox(f.geometry);
}

/** Bounding box of all features, or null when there are no coordinates. */
export function collectionBBox(fc: FeatureCollection): BBox2D | null {
  const acc = new Acc();
  for (const f of fc.features) walkGeometry(f.geometry, acc.add);
  return acc.result();
}

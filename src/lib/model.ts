// The editor's in-memory document: features keyed by a stable uid so the
// drawing layer (terra-draw) and the properties panel can refer to them.
// The uid never leaks into exported GeoJSON.

import type { Feature, FeatureCollection, Geometry } from "./types";

export interface DocItem {
  uid: string;
  feature: Feature;
}

export type EditMode = "point" | "linestring" | "polygon";

let counter = 0;
/** UUID v4 (terra-draw's default id strategy only accepts UUIDs). */
export function newUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  counter++;
  const hex = (counter.toString(16) + Math.random().toString(16).slice(2)).padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function fromCollection(fc: FeatureCollection, uid: () => string = newUid): DocItem[] {
  return fc.features.map((feature) => ({ uid: uid(), feature }));
}

/** Rebuilds a FeatureCollection, keeping foreign members of the original root. */
export function toCollection(items: DocItem[], root: Partial<FeatureCollection> = {}): FeatureCollection {
  return { ...root, type: "FeatureCollection", features: items.map((i) => i.feature) };
}

/**
 * Which terra-draw mode can edit this geometry, or null when it is shown
 * read-only (multi-geometries, collections, polygons with holes, nulls).
 */
export function editModeFor(g: Geometry | null): EditMode | null {
  if (!g) return null;
  switch (g.type) {
    case "Point":
      return "point";
    case "LineString":
      return "linestring";
    case "Polygon":
      return Array.isArray(g.coordinates) && g.coordinates.length === 1 ? "polygon" : null;
    default:
      return null;
  }
}

export function featureLabel(f: Feature, index: number): string {
  const p = f.properties ?? {};
  for (const k of ["name", "name:en", "name:fr", "title", "id"]) {
    const v = p[k];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  if (f.id !== undefined) return String(f.id);
  return `${f.geometry?.type ?? "null geometry"} #${index + 1}`;
}

export function replaceGeometry(items: DocItem[], uid: string, geometry: Geometry): DocItem[] {
  return items.map((i) => (i.uid === uid ? { ...i, feature: { ...i.feature, geometry } } : i));
}

export function removeItem(items: DocItem[], uid: string): DocItem[] {
  return items.filter((i) => i.uid !== uid);
}

// Shared types for the pure logic modules. No DOM, no map library.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type Position = number[];

export type GeometryType =
  | "Point"
  | "MultiPoint"
  | "LineString"
  | "MultiLineString"
  | "Polygon"
  | "MultiPolygon"
  | "GeometryCollection";

export interface Geometry {
  type: GeometryType;
  coordinates?: unknown;
  geometries?: Geometry[];
  [key: string]: unknown;
}

export interface Feature {
  type: "Feature";
  geometry: Geometry | null;
  properties: JsonObject | null;
  id?: string | number;
  [key: string]: unknown;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
  [key: string]: unknown;
}

/** [minLon, minLat, maxLon, maxLat] */
export type BBox2D = [number, number, number, number];

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  /** JSONPath-like location, e.g. `$.features[2].geometry.coordinates[0][3]` */
  path: string;
  message: string;
}

export const GEOMETRY_TYPES: readonly GeometryType[] = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
];

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// A small, dependency-free structural validator for RFC 7946 GeoJSON.
//
// It never throws: any input (even non-objects) produces a list of issues.
// Errors are things the RFC forbids; warnings are things it discourages
// ("SHOULD" / "SHOULD NOT") or things that are very likely mistakes.

import { ringOrientation } from "./winding";
import { GEOMETRY_TYPES, isPlainObject, type Issue, type Position } from "./types";

class Collector {
  readonly issues: Issue[] = [];
  error(path: string, message: string) {
    this.issues.push({ severity: "error", path, message });
  }
  warn(path: string, message: string) {
    this.issues.push({ severity: "warning", path, message });
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Returns true when `v` is a structurally valid position (errors are reported). */
function checkPosition(v: unknown, path: string, c: Collector): v is Position {
  if (!Array.isArray(v)) {
    c.error(path, `Position must be an array of numbers, got ${typeName(v)}.`);
    return false;
  }
  if (v.length < 2) {
    c.error(path, `Position must have at least 2 elements (lon, lat), got ${v.length}.`);
    return false;
  }
  for (let i = 0; i < v.length; i++) {
    if (!isFiniteNumber(v[i])) {
      c.error(`${path}[${i}]`, `Position element must be a finite number, got ${typeName(v[i])}.`);
      return false;
    }
  }
  if (v.length > 3) {
    c.warn(path, `Position has ${v.length} elements; RFC 7946 says positions SHOULD NOT exceed 3.`);
  }
  const [lon, lat] = v as number[];
  if (lat < -90 || lat > 90) {
    const hint = lon >= -90 && lon <= 90 ? " Longitude and latitude may be swapped." : "";
    c.error(path, `Latitude ${lat} is outside [-90, 90].${hint}`);
  }
  if (lon < -180 || lon > 180) {
    c.warn(path, `Longitude ${lon} is outside [-180, 180]. Data may be projected, not WGS84.`);
  }
  return true;
}

/** Validate an array of positions; returns the valid positions (or null if not an array). */
function checkPositions(v: unknown, path: string, c: Collector): Position[] | null {
  if (!Array.isArray(v)) {
    c.error(path, `Expected an array of positions, got ${typeName(v)}.`);
    return null;
  }
  let allOk = true;
  v.forEach((p, i) => {
    if (!checkPosition(p, `${path}[${i}]`, c)) allOk = false;
  });
  return allOk ? (v as Position[]) : null;
}

function samePosition(a: Position, b: Position): boolean {
  if (a.length !== b.length) return false;
  return a.every((n, i) => n === b[i]);
}

function checkLineString(v: unknown, path: string, c: Collector) {
  const pts = checkPositions(v, path, c);
  if (pts && pts.length < 2) {
    c.error(path, `LineString must have at least 2 positions, got ${pts.length}.`);
  }
}

function checkPolygon(v: unknown, path: string, c: Collector) {
  if (!Array.isArray(v)) {
    c.error(path, `Polygon coordinates must be an array of linear rings, got ${typeName(v)}.`);
    return;
  }
  v.forEach((ringRaw, i) => {
    const rp = `${path}[${i}]`;
    const ring = checkPositions(ringRaw, rp, c);
    if (!ring) return;
    if (ring.length < 4) {
      c.error(rp, `Linear ring must have at least 4 positions, got ${ring.length}.`);
      return;
    }
    if (!samePosition(ring[0], ring[ring.length - 1])) {
      c.error(rp, "Linear ring is not closed: first and last positions must be identical.");
      return;
    }
    const o = ringOrientation(ring);
    const role = i === 0 ? "Exterior ring" : "Interior ring (hole)";
    if (o === "degenerate") {
      c.warn(rp, `${role} has zero area.`);
    } else if (i === 0 && o !== "ccw") {
      c.warn(rp, `${role} is clockwise; RFC 7946 right-hand rule wants counterclockwise.`);
    } else if (i > 0 && o !== "cw") {
      c.warn(rp, `${role} is counterclockwise; RFC 7946 right-hand rule wants clockwise.`);
    }
  });
}

function checkEachIn(v: unknown, path: string, c: Collector, what: string, fn: (x: unknown, p: string, c: Collector) => void) {
  if (!Array.isArray(v)) {
    c.error(path, `${what} coordinates must be an array, got ${typeName(v)}.`);
    return;
  }
  v.forEach((x, i) => fn(x, `${path}[${i}]`, c));
}

function checkBBox(v: unknown, path: string, c: Collector) {
  if (!Array.isArray(v) || !v.every(isFiniteNumber)) {
    c.error(path, "bbox must be an array of numbers.");
    return;
  }
  if (v.length !== 4 && v.length !== 6) {
    c.error(path, `bbox must have 4 or 6 numbers (2*n for n dimensions), got ${v.length}.`);
  }
}

function checkCommonMembers(o: Record<string, unknown>, path: string, c: Collector) {
  if ("bbox" in o) checkBBox(o.bbox, `${path}.bbox`, c);
  if ("crs" in o) c.warn(`${path}.crs`, '"crs" was removed in RFC 7946; coordinates are always WGS84.');
}

function checkGeometry(g: unknown, path: string, c: Collector, depth = 0) {
  if (!isPlainObject(g)) {
    c.error(path, `Geometry must be an object or null, got ${typeName(g)}.`);
    return;
  }
  const t = g.type;
  if (typeof t !== "string" || !(GEOMETRY_TYPES as readonly string[]).includes(t)) {
    c.error(`${path}.type`, `Unknown geometry type ${JSON.stringify(t)}.`);
    return;
  }
  checkCommonMembers(g, path, c);

  if (t === "GeometryCollection") {
    if ("coordinates" in g) c.warn(`${path}.coordinates`, 'GeometryCollection must not have "coordinates".');
    const gs = g.geometries;
    if (!Array.isArray(gs)) {
      c.error(`${path}.geometries`, 'GeometryCollection must have a "geometries" array.');
      return;
    }
    if (gs.length === 0) c.warn(`${path}.geometries`, "GeometryCollection is empty.");
    if (depth > 0) c.warn(path, "Nested GeometryCollections SHOULD be avoided (RFC 7946 3.1.8).");
    gs.forEach((child, i) => {
      if (child === null) {
        c.error(`${path}.geometries[${i}]`, "GeometryCollection members cannot be null.");
      } else {
        checkGeometry(child, `${path}.geometries[${i}]`, c, depth + 1);
      }
    });
    if (gs.length === 1) c.warn(`${path}.geometries`, "GeometryCollection with a single geometry; use that geometry directly.");
    return;
  }

  if (!("coordinates" in g)) {
    c.error(`${path}.coordinates`, `${t} must have a "coordinates" member.`);
    return;
  }
  const coords = g.coordinates;
  const cp = `${path}.coordinates`;
  if (Array.isArray(coords) && coords.length === 0) {
    c.warn(cp, `${t} has empty coordinates; consumers may treat it as a null geometry.`);
    return;
  }
  switch (t) {
    case "Point":
      checkPosition(coords, cp, c);
      break;
    case "MultiPoint":
      checkPositions(coords, cp, c);
      break;
    case "LineString":
      checkLineString(coords, cp, c);
      break;
    case "MultiLineString":
      checkEachIn(coords, cp, c, "MultiLineString", checkLineString);
      break;
    case "Polygon":
      checkPolygon(coords, cp, c);
      break;
    case "MultiPolygon":
      checkEachIn(coords, cp, c, "MultiPolygon", checkPolygon);
      break;
  }
}

function checkFeature(f: unknown, path: string, c: Collector) {
  if (!isPlainObject(f)) {
    c.error(path, `Feature must be an object, got ${typeName(f)}.`);
    return;
  }
  if (f.type !== "Feature") {
    c.error(`${path}.type`, `Expected type "Feature", got ${JSON.stringify(f.type)}.`);
    return;
  }
  checkCommonMembers(f, path, c);
  if ("id" in f && typeof f.id !== "string" && typeof f.id !== "number") {
    c.error(`${path}.id`, `Feature id must be a string or number, got ${typeName(f.id)}.`);
  }
  if (!("properties" in f)) {
    c.warn(`${path}.properties`, 'Feature has no "properties" member (should be an object or null).');
  } else if (f.properties !== null && !isPlainObject(f.properties)) {
    c.error(`${path}.properties`, `Feature properties must be an object or null, got ${typeName(f.properties)}.`);
  }
  if (!("geometry" in f)) {
    c.error(`${path}.geometry`, 'Feature must have a "geometry" member (it may be null).');
  } else if (f.geometry !== null) {
    checkGeometry(f.geometry, `${path}.geometry`, c);
  }
}

/** Validate any value as GeoJSON. Paths start at `$`. */
export function validate(value: unknown): Issue[] {
  const c = new Collector();
  if (!isPlainObject(value)) {
    c.error("$", `GeoJSON must be an object, got ${typeName(value)}.`);
    return c.issues;
  }
  const t = value.type;
  if (t === "FeatureCollection") {
    checkCommonMembers(value, "$", c);
    if (!Array.isArray(value.features)) {
      c.error("$.features", 'FeatureCollection must have a "features" array.');
    } else {
      value.features.forEach((f, i) => checkFeature(f, `$.features[${i}]`, c));
    }
  } else if (t === "Feature") {
    checkFeature(value, "$", c);
  } else if (typeof t === "string" && (GEOMETRY_TYPES as readonly string[]).includes(t)) {
    checkGeometry(value, "$", c);
  } else {
    c.error("$.type", `Unknown or missing GeoJSON type ${JSON.stringify(t)}.`);
  }
  return c.issues;
}

/** Extract the feature index from a path like `$.features[3].geometry...`. */
export function featureIndexFromPath(path: string): number | null {
  const m = /^\$\.features\[(\d+)\]/.exec(path);
  return m ? Number(m[1]) : null;
}

/** Count issues per feature index, useful for badges in a feature list. */
export function summarizeByFeature(issues: Issue[]): Map<number, { errors: number; warnings: number }> {
  const out = new Map<number, { errors: number; warnings: number }>();
  for (const is of issues) {
    const i = featureIndexFromPath(is.path);
    if (i === null) continue;
    const s = out.get(i) ?? { errors: 0, warnings: 0 };
    if (is.severity === "error") s.errors++;
    else s.warnings++;
    out.set(i, s);
  }
  return out;
}

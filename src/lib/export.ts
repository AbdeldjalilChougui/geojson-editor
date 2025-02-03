// Export helpers: coordinate precision rounding and serialisation.

import type { Feature, FeatureCollection, Geometry } from "./types";

/** Round half away from zero to `digits` decimals, avoiding -0. */
export function roundNumber(n: number, digits: number): number {
  const f = 10 ** digits;
  const r = (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
  return r === 0 ? 0 : r;
}

function roundCoords(c: unknown, digits: number): unknown {
  if (typeof c === "number") return roundNumber(c, digits);
  if (Array.isArray(c)) return c.map((x) => roundCoords(x, digits));
  return c;
}

function roundGeometry(g: Geometry | null, digits: number): Geometry | null {
  if (!g || typeof g !== "object") return g;
  if (g.type === "GeometryCollection") {
    return { ...g, geometries: (g.geometries ?? []).map((x) => roundGeometry(x, digits) as Geometry) };
  }
  const out: Geometry = { ...g, coordinates: roundCoords(g.coordinates, digits) };
  if (Array.isArray(g.bbox)) out.bbox = roundCoords(g.bbox, digits);
  return out;
}

/**
 * Returns a copy with every coordinate rounded to `digits` decimals.
 * Only coordinates (and bbox) are touched, never properties.
 * Note: rounding can collapse near-identical vertices; it does not fix that.
 */
export function roundCollection(fc: FeatureCollection, digits: number): FeatureCollection {
  if (!Number.isInteger(digits) || digits < 0 || digits > 15) {
    throw new RangeError(`precision must be an integer in [0, 15], got ${digits}`);
  }
  const out: FeatureCollection = {
    ...fc,
    features: fc.features.map((f) => {
      const nf: Feature = { ...f, geometry: roundGeometry(f.geometry, digits) };
      if (Array.isArray(f.bbox)) nf.bbox = roundCoords(f.bbox, digits);
      return nf;
    }),
  };
  if (Array.isArray(fc.bbox)) out.bbox = roundCoords(fc.bbox, digits);
  return out;
}

export interface SerializeOptions {
  /** Decimal places for coordinates; undefined/null keeps full precision. */
  precision?: number | null;
  /** Indentation; 0 for compact output. Default 2. */
  indent?: number;
}

export function serialize(fc: FeatureCollection, opts: SerializeOptions = {}): string {
  const data = opts.precision == null ? fc : roundCollection(fc, opts.precision);
  const indent = opts.indent ?? 2;
  return JSON.stringify(data, null, indent > 0 ? indent : undefined) + (indent > 0 ? "\n" : "");
}

/** A filesystem-friendly download name, e.g. "my-data.geojson". */
export function exportFileName(base: string | null | undefined): string {
  const cleaned = (base ?? "")
    .replace(/\.(geo)?json$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${cleaned || "export"}.geojson`;
}

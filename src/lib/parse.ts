// Parsing and normalisation: turn arbitrary text / values into a FeatureCollection.
//
// Normalisation is deliberately shallow: it only wraps the input so the rest
// of the app can always work with a FeatureCollection. Deep structural checks
// are the validator's job (see validate.ts).

import {
  GEOMETRY_TYPES,
  isPlainObject,
  type Feature,
  type FeatureCollection,
  type Geometry,
  type GeometryType,
  type JsonObject,
} from "./types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** JSON.parse with a friendly error instead of an exception. */
export function parseJson(text: string): Result<unknown> {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "Input is empty." };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Invalid JSON: ${msg}` };
  }
}

function isGeometryType(t: unknown): t is GeometryType {
  return typeof t === "string" && (GEOMETRY_TYPES as readonly string[]).includes(t);
}

function normalizeFeature(f: Record<string, unknown>): Feature {
  const props = f.properties;
  return {
    ...f,
    type: "Feature",
    geometry: (f.geometry ?? null) as Geometry | null,
    // Missing or null properties become {} so the editor always has an object.
    properties: isPlainObject(props) ? (props as JsonObject) : {},
  };
}

/**
 * Wrap a FeatureCollection, Feature, or bare Geometry into a FeatureCollection.
 * Returns an error for anything else. Input is not mutated.
 */
export function normalize(value: unknown): Result<FeatureCollection> {
  if (!isPlainObject(value)) {
    return { ok: false, error: "GeoJSON root must be a JSON object." };
  }
  const t = value.type;
  if (t === "FeatureCollection") {
    if (!Array.isArray(value.features)) {
      return { ok: false, error: "FeatureCollection.features must be an array." };
    }
    const features: Feature[] = [];
    for (let i = 0; i < value.features.length; i++) {
      const f: unknown = value.features[i];
      if (!isPlainObject(f) || f.type !== "Feature") {
        return { ok: false, error: `features[${i}] is not a Feature object.` };
      }
      features.push(normalizeFeature(f));
    }
    return { ok: true, value: { ...value, type: "FeatureCollection", features } };
  }
  if (t === "Feature") {
    return { ok: true, value: { type: "FeatureCollection", features: [normalizeFeature(value)] } };
  }
  if (isGeometryType(t)) {
    return {
      ok: true,
      value: {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: value as Geometry, properties: {} }],
      },
    };
  }
  return {
    ok: false,
    error:
      typeof t === "string"
        ? `Unsupported GeoJSON type "${t}".`
        : 'Missing "type" member at the GeoJSON root.',
  };
}

/** Convenience: text -> FeatureCollection. */
export function parseGeoJSON(text: string): Result<FeatureCollection> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  return normalize(parsed.value);
}

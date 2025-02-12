import { describe, expect, it } from "vitest";
import { parseGeoJSON, parseJson, normalize } from "../src/lib/parse";
import { validate, featureIndexFromPath, summarizeByFeature } from "../src/lib/validate";
import { inferValue, formatValue, addProperty, renameProperty, deleteProperty, setProperty } from "../src/lib/properties";
import { roundNumber, roundCollection, serialize, exportFileName } from "../src/lib/export";
import { geometryBBox, collectionBBox } from "../src/lib/bbox";
import { ringOrientation, rewindCollection, signedArea2 } from "../src/lib/winding";
import { createDocumentStore, type KeyValueStorage } from "../src/lib/storage";
import type { FeatureCollection } from "../src/lib/types";

const ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const cw = [...ccw].reverse();
const poly = (rings: number[][][]) => ({ type: "Polygon" as const, coordinates: rings });
const fc = (...geoms: object[]): FeatureCollection => ({
  type: "FeatureCollection",
  features: geoms.map((g) => ({ type: "Feature", geometry: g as never, properties: {} })),
});

describe("parse", () => {
  it("reports empty and invalid JSON", () => {
    expect(parseJson("  ")).toEqual({ ok: false, error: "Input is empty." });
    const r = parseJson("{oops");
    expect(r.ok).toBe(false);
  });
  it("wraps geometry and feature into a collection", () => {
    const g = parseGeoJSON('{"type":"Point","coordinates":[3,36]}');
    expect(g.ok && g.value.features.length).toBe(1);
    const f = normalize({ type: "Feature", geometry: null, properties: null });
    expect(f.ok && f.value.features[0].properties).toEqual({});
  });
  it("rejects unknown roots", () => {
    expect(normalize([]).ok).toBe(false);
    const r = normalize({ type: "Topology" });
    expect(!r.ok && r.error).toContain("Topology");
    expect(normalize({ type: "FeatureCollection", features: [1] }).ok).toBe(false);
  });
});

describe("validate", () => {
  it("accepts a clean collection", () => {
    expect(validate(fc({ type: "Point", coordinates: [3, 36] }, poly([ccw])))).toEqual([]);
  });
  it("flags unclosed rings, short rings and swapped lat/lon", () => {
    const issues = validate(
      fc(poly([[[0, 0], [1, 0], [1, 1], [0, 1]]]), poly([[[0, 0], [1, 1], [0, 0]]]), { type: "Point", coordinates: [36, 120] }),
    );
    const msgs = issues.map((i) => i.message).join("\n");
    expect(msgs).toContain("not closed");
    expect(msgs).toContain("at least 4 positions");
    expect(msgs).toContain("swapped");
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });
  it("warns about winding order and crs", () => {
    const issues = validate({ ...fc(poly([cw])), crs: {} });
    expect(issues.filter((i) => i.severity === "warning").length).toBe(2);
  });
  it("never throws on garbage", () => {
    for (const v of [null, 1, "x", { type: 5 }, { type: "Feature" }, { type: "GeometryCollection" }]) {
      expect(() => validate(v)).not.toThrow();
      expect(validate(v).length).toBeGreaterThan(0);
    }
  });
  it("groups issues by feature", () => {
    expect(featureIndexFromPath("$.features[12].geometry")).toBe(12);
    expect(featureIndexFromPath("$.crs")).toBeNull();
    const s = summarizeByFeature(validate(fc({ type: "Point", coordinates: [0, 99] }, { type: "Point", coordinates: [0, 0] })));
    expect(s.get(0)).toEqual({ errors: 1, warnings: 0 });
    expect(s.has(1)).toBe(false);
  });
});

describe("properties", () => {
  it("infers values from text", () => {
    expect(inferValue("42")).toBe(42);
    expect(inferValue("-1.5e3")).toBe(-1500);
    expect(inferValue("true")).toBe(true);
    expect(inferValue("null")).toBe(null);
    expect(inferValue('"42"')).toBe("42");
    expect(inferValue("[1,2]")).toEqual([1, 2]);
    expect(inferValue("007")).toBe("007");
    expect(inferValue("Alger")).toBe("Alger");
  });
  it("formatValue round-trips", () => {
    for (const v of ["42", "true", "Oran", 3.5, false, null, { a: 1 }, [1]]) {
      expect(inferValue(formatValue(v as never))).toEqual(v);
    }
  });
  it("add/rename/delete keep order and are immutable", () => {
    const p = { a: 1, b: 2, c: 3 };
    const r = renameProperty(p, "b", "x");
    expect(r.ok && Object.keys(r.value)).toEqual(["a", "x", "c"]);
    expect(p).toEqual({ a: 1, b: 2, c: 3 });
    expect(renameProperty(p, "a", "c").ok).toBe(false);
    expect(addProperty(p, "a", 5).ok).toBe(false);
    expect(addProperty(p, "", 5).ok).toBe(false);
    expect(deleteProperty(p, "a")).toEqual({ b: 2, c: 3 });
    expect(setProperty(p, "a", "z")).toEqual({ a: "z", b: 2, c: 3 });
  });
});

describe("export", () => {
  it("rounds half away from zero without -0", () => {
    expect(roundNumber(1.23456, 3)).toBe(1.235);
    expect(roundNumber(-1.5, 0)).toBe(-2);
    expect(Object.is(roundNumber(-0.0001, 2), 0)).toBe(true);
  });
  it("rounds only coordinates", () => {
    const c = fc({ type: "Point", coordinates: [3.123456789, 36.987654321] });
    c.features[0].properties = { v: 1.23456789 };
    const r = roundCollection(c, 4);
    expect(r.features[0].geometry?.coordinates).toEqual([3.1235, 36.9877]);
    expect(r.features[0].properties).toEqual({ v: 1.23456789 });
    expect(() => roundCollection(c, -1)).toThrow(RangeError);
  });
  it("serializes compact or pretty", () => {
    const c = fc({ type: "Point", coordinates: [1, 2] });
    expect(serialize(c, { indent: 0 })).not.toContain("\n");
    expect(serialize(c).endsWith("\n")).toBe(true);
  });
  it("builds safe file names", () => {
    expect(exportFileName("my data.json")).toBe("my-data.geojson");
    expect(exportFileName("x.geojson")).toBe("x.geojson");
    expect(exportFileName("")).toBe("export.geojson");
    expect(exportFileName(null)).toBe("export.geojson");
  });
});

describe("bbox and winding", () => {
  it("computes bboxes", () => {
    expect(geometryBBox({ type: "LineString", coordinates: [[0, 1], [5, -2]] })).toEqual([0, -2, 5, 1]);
    expect(geometryBBox(null)).toBeNull();
    expect(collectionBBox(fc({ type: "Point", coordinates: [1, 1] }, poly([ccw])))).toEqual([0, 0, 1, 1]);
    expect(collectionBBox(fc())).toBeNull();
  });
  it("detects and fixes orientation", () => {
    expect(signedArea2(ccw)).toBeGreaterThan(0);
    expect(ringOrientation(ccw)).toBe("ccw");
    expect(ringOrientation(cw)).toBe("cw");
    expect(ringOrientation([[0, 0], [1, 1], [0, 0]])).toBe("degenerate");
    const hole = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]]; // ccw, should become cw
    const fixed = rewindCollection(fc(poly([cw, hole])));
    const rings = fixed.features[0].geometry!.coordinates as number[][][];
    expect(ringOrientation(rings[0])).toBe("ccw");
    expect(ringOrientation(rings[1])).toBe("cw");
    expect(validate(fixed)).toEqual([]);
  });
});

describe("storage", () => {
  const mem = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };
  it("saves, loads and clears", () => {
    const s = createDocumentStore(mem());
    const c = fc({ type: "Point", coordinates: [1, 2] });
    expect(s.load()).toBeNull();
    expect(s.save(c)).toBe(true);
    expect(s.load()).toEqual(c);
    s.clear();
    expect(s.load()).toBeNull();
  });
  it("survives broken or missing storage", () => {
    const broken: KeyValueStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("denied"); },
    };
    const s = createDocumentStore(broken);
    expect(s.load()).toBeNull();
    expect(s.save(fc())).toBe(false);
    expect(() => s.clear()).not.toThrow();
    expect(createDocumentStore(null).save(fc())).toBe(false);
    const m = mem();
    m.data.set("k", "{not json");
    expect(createDocumentStore(m, "k").load()).toBeNull();
  });
});

import { editModeFor, featureLabel, fromCollection, toCollection, replaceGeometry, removeItem, newUid } from "../src/lib/model";

describe("model", () => {
  it("round-trips without leaking uids", () => {
    const c = { ...fc({ type: "Point", coordinates: [1, 2] }), name: "x" } as FeatureCollection;
    let n = 0;
    const items = fromCollection(c, () => `u${n++}`);
    expect(items.map((i) => i.uid)).toEqual(["u0"]);
    expect(toCollection(items, c)).toEqual(c);
  });
  it("chooses the edit mode", () => {
    expect(editModeFor({ type: "Point", coordinates: [0, 0] })).toBe("point");
    expect(editModeFor({ type: "LineString", coordinates: [] })).toBe("linestring");
    expect(editModeFor(poly([ccw]))).toBe("polygon");
    expect(editModeFor(poly([ccw, ccw]))).toBeNull();
    expect(editModeFor({ type: "MultiPoint", coordinates: [] })).toBeNull();
    expect(editModeFor(null)).toBeNull();
  });
  it("labels, replaces and removes", () => {
    const items = fromCollection(fc({ type: "Point", coordinates: [0, 0] }, { type: "Point", coordinates: [1, 1] }));
    items[0].feature.properties = { name: "Alger" };
    expect(featureLabel(items[0].feature, 0)).toBe("Alger");
    expect(featureLabel(items[1].feature, 1)).toBe("Point #2");
    const r = replaceGeometry(items, items[1].uid, { type: "Point", coordinates: [5, 5] });
    expect(r[1].feature.geometry?.coordinates).toEqual([5, 5]);
    expect(items[1].feature.geometry?.coordinates).toEqual([1, 1]);
    expect(removeItem(r, items[0].uid).length).toBe(1);
    expect(newUid()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

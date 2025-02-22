// UI wiring: MapLibre map + terra-draw editing + side panels.
// All data logic lives in src/lib (unit tested); this file is glue.

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "./style.css";

import { parseGeoJSON } from "./lib/parse";
import { validate, summarizeByFeature, featureIndexFromPath } from "./lib/validate";
import { serialize, exportFileName } from "./lib/export";
import { collectionBBox } from "./lib/bbox";
import { rewindCollection } from "./lib/winding";
import { createDocumentStore } from "./lib/storage";
import { inferValue, formatValue, addProperty, renameProperty, deleteProperty, setProperty } from "./lib/properties";
import {
  editModeFor,
  featureLabel,
  fromCollection,
  toCollection,
  removeItem,
  replaceGeometry,
  type DocItem,
} from "./lib/model";
import type { FeatureCollection, Geometry, JsonObject } from "./lib/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let safeStorage: Storage | null = null;
try {
  safeStorage = window.localStorage;
} catch {
  safeStorage = null;
}
const store = createDocumentStore(safeStorage);

// ---------------------------------------------------------------- state
let items: DocItem[] = [];
let root: Partial<FeatureCollection> = {};
let fileName = "export";
let selected: string | null = null;

const style: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const map = new maplibregl.Map({ container: "map", style, center: [3.06, 36.75], zoom: 5 });
map.addControl(new maplibregl.NavigationControl(), "top-right");

const editable = { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } };
let draw: TerraDraw;

function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// ------------------------------------------------- read-only layer (multi*, holes...)
function readOnlyCollection() {
  return {
    type: "FeatureCollection" as const,
    features: items
      .filter((i) => i.feature.geometry && (!editModeFor(i.feature.geometry) || readOnlyIds.has(i.uid)))
      .map((i) => ({ type: "Feature" as const, geometry: i.feature.geometry, properties: { uid: i.uid } })),
  };
}

function addReadOnlyLayers() {
  map.addSource("ro", { type: "geojson", data: readOnlyCollection() as never });
  map.addLayer({ id: "ro-fill", type: "fill", source: "ro", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#7c3aed", "fill-opacity": 0.2 } });
  map.addLayer({ id: "ro-line", type: "line", source: "ro", paint: { "line-color": "#7c3aed", "line-width": 2 } });
  map.addLayer({ id: "ro-point", type: "circle", source: "ro", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#7c3aed", "circle-radius": 5 } });
  map.on("click", "ro-fill", (e: MapLayerMouseEvent) => select(String(e.features?.[0]?.properties?.uid)));
  map.on("click", "ro-line", (e: MapLayerMouseEvent) => select(String(e.features?.[0]?.properties?.uid)));
  map.on("click", "ro-point", (e: MapLayerMouseEvent) => select(String(e.features?.[0]?.properties?.uid)));
}

// --------------------------------------------------------------- sync
function persist() {
  store.save(toCollection(items, root));
}

function refresh() {
  (map.getSource("ro") as GeoJSONSource | undefined)?.setData(readOnlyCollection() as never);
  renderFeatureList();
  renderIssues();
  renderProps();
  persist();
}

/** Replace the whole document (load, paste, new). */
const readOnlyIds = new Set<string>();

function loadDocument(fc: FeatureCollection, name = "export", fit = true) {
  const { features: _ignored, ...rest } = fc;
  root = rest;
  fileName = name;
  items = fromCollection(fc);
  selected = null;
  readOnlyIds.clear();
  draw.clear();
  const toDraw: GeoJSONStoreFeatures[] = [];
  for (const it of items) {
    const mode = editModeFor(it.feature.geometry);
    if (mode) toDraw.push({ id: it.uid, type: "Feature", geometry: it.feature.geometry as never, properties: { mode } });
  }
  const results = draw.addFeatures(toDraw);
  const rejected = results.filter((r) => !r.valid).length;
  if (rejected) toast(`${rejected} feature(s) could not be edited and are shown read-only`);
  // Anything terra-draw rejected stays in the doc; mark it so it renders read-only.
  for (const r of results) if (!r.valid) readOnlyIds.add(String(r.id));
  refresh();
  if (fit) {
    const b = collectionBBox(fc);
    if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 16, duration: 0 });
  }
}

function onDrawFinish(id: string | number) {
  const snap = draw.getSnapshotFeature(id);
  if (!snap) return;
  const uid = String(id);
  const geometry = snap.geometry as unknown as Geometry;
  if (items.some((i) => i.uid === uid)) {
    items = replaceGeometry(items, uid, geometry);
  } else {
    items = [...items, { uid, feature: { type: "Feature", geometry, properties: {} } }];
    setMode("select");
    draw.selectFeature(uid);
    selected = uid;
  }
  refresh();
}

function select(uid: string | null) {
  selected = uid;
  if (uid && draw.hasFeature(uid) && draw.getMode() === "select") {
    try {
      draw.selectFeature(uid);
    } catch {
      /* already selected */
    }
  }
  renderFeatureList();
  renderProps();
}

function deleteSelected() {
  if (!selected) return;
  if (draw.hasFeature(selected)) draw.removeFeatures([selected]);
  items = removeItem(items, selected);
  selected = null;
  refresh();
}

// ------------------------------------------------------------ rendering
function renderFeatureList() {
  const ul = $("features");
  const summary = summarizeByFeature(validate(toCollection(items, root)));
  $("count").textContent = `(${items.length})`;
  ul.replaceChildren(
    ...items.map((it, i) => {
      const li = document.createElement("li");
      if (it.uid === selected) li.className = "selected";
      const label = document.createElement("span");
      label.textContent = featureLabel(it.feature, i);
      li.append(label);
      const meta = document.createElement("span");
      if (!editModeFor(it.feature.geometry) || readOnlyIds.has(it.uid)) {
        const ro = document.createElement("span");
        ro.className = "ro";
        ro.textContent = "read-only ";
        meta.append(ro);
      }
      const s = summary.get(i);
      if (s?.errors) meta.append(badge(String(s.errors), ""));
      if (s?.warnings) meta.append(badge(String(s.warnings), "warn"));
      li.append(meta);
      li.onclick = () => {
        select(it.uid);
        const b = collectionBBox({ type: "FeatureCollection", features: [it.feature] });
        if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 17 });
      };
      return li;
    }),
  );
}

function badge(text: string, cls: string) {
  const b = document.createElement("span");
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

function renderIssues() {
  const issues = validate(toCollection(items, root));
  const ul = $("issues");
  if (!issues.length) {
    ul.innerHTML = '<li class="muted">No problems found.</li>';
    return;
  }
  ul.replaceChildren(
    ...issues.slice(0, 200).map((is) => {
      const li = document.createElement("li");
      li.className = is.severity;
      li.textContent = is.message;
      const code = document.createElement("code");
      code.textContent = is.path;
      li.append(code);
      li.onclick = () => {
        const idx = featureIndexFromPath(is.path);
        if (idx !== null && items[idx]) select(items[idx].uid);
      };
      return li;
    }),
  );
}

function updateProps(fn: (p: JsonObject) => JsonObject | { ok: boolean; value?: JsonObject; error?: string }) {
  const it = items.find((i) => i.uid === selected);
  if (!it) return;
  const r = fn(it.feature.properties ?? {});
  let next: JsonObject;
  if ("ok" in r && typeof r.ok === "boolean") {
    if (!r.ok) return toast(String(r.error));
    next = r.value as JsonObject;
  } else next = r as JsonObject;
  items = items.map((i) => (i.uid === selected ? { ...i, feature: { ...i.feature, properties: next } } : i));
  refresh();
}

function renderProps() {
  const box = $("props");
  const it = items.find((i) => i.uid === selected);
  if (!it) {
    box.innerHTML = '<p class="muted">Select a feature on the map or in the list.</p>';
    return;
  }
  const props = it.feature.properties ?? {};
  const table = document.createElement("table");
  for (const [k, v] of Object.entries(props)) {
    const tr = document.createElement("tr");
    const key = Object.assign(document.createElement("input"), { value: k });
    key.onchange = () => updateProps((p) => renameProperty(p, k, key.value.trim()));
    const val = Object.assign(document.createElement("input"), { value: formatValue(v) });
    val.onchange = () => updateProps((p) => setProperty(p, k, inferValue(val.value)));
    const del = Object.assign(document.createElement("button"), { textContent: "×", title: "Delete property" });
    del.onclick = () => updateProps((p) => deleteProperty(p, k));
    for (const el of [key, val, del]) {
      const td = document.createElement("td");
      td.append(el);
      tr.append(td);
    }
    table.append(tr);
  }
  const add = document.createElement("tr");
  const nk = Object.assign(document.createElement("input"), { placeholder: "new key" });
  const nv = Object.assign(document.createElement("input"), { placeholder: "value (42, true, \"text\")" });
  const ok = Object.assign(document.createElement("button"), { textContent: "+" });
  ok.onclick = () => updateProps((p) => addProperty(p, nk.value.trim(), inferValue(nv.value)));
  for (const el of [nk, nv, ok]) {
    const td = document.createElement("td");
    td.append(el);
    add.append(td);
  }
  table.append(add);
  const info = document.createElement("p");
  info.className = "muted";
  info.textContent = `${it.feature.geometry?.type ?? "null geometry"}`;
  const delBtn = Object.assign(document.createElement("button"), { textContent: "Delete feature" });
  delBtn.onclick = deleteSelected;
  box.replaceChildren(info, table, delBtn);
}

// ---------------------------------------------------------------- input
function loadText(text: string, name: string): boolean {
  const r = parseGeoJSON(text);
  if (!r.ok) {
    toast(r.error);
    return false;
  }
  loadDocument(r.value, name);
  toast(`Loaded ${r.value.features.length} feature(s)`);
  return true;
}

function setMode(mode: string) {
  draw.setMode(mode);
  document.querySelectorAll<HTMLButtonElement>("#modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}

function wireUi() {
  document.querySelectorAll<HTMLButtonElement>("#modes button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode!)));
  $<HTMLInputElement>("file").onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) loadText(await f.text(), f.name);
  };
  $("open-url").onclick = async () => {
    const url = prompt("GeoJSON URL (must allow CORS):");
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadText(await res.text(), new URL(url, location.href).pathname.split("/").pop() || "export");
    } catch (err) {
      toast(`Could not fetch: ${(err as Error).message}`);
    }
  };
  const dlg = $<HTMLDialogElement>("paste-dialog");
  $("paste").onclick = () => {
    $("paste-error").textContent = "";
    dlg.showModal();
  };
  $("paste-ok").onclick = (e) => {
    const r = parseGeoJSON($<HTMLTextAreaElement>("paste-text").value);
    if (!r.ok) {
      e.preventDefault();
      $("paste-error").textContent = r.error;
      return;
    }
    loadDocument(r.value, "pasted");
  };
  $("clear").onclick = () => {
    if (items.length && !confirm("Discard the current document?")) return;
    loadDocument({ type: "FeatureCollection", features: [] }, "export", false);
  };
  $("rewind").onclick = () => {
    loadDocument(rewindCollection(toCollection(items, root)), fileName, false);
    toast("Rings rewound: exterior CCW, holes CW");
  };
  const output = () => {
    const p = $<HTMLSelectElement>("precision").value;
    return serialize(toCollection(items, root), {
      precision: p === "" ? null : Number(p),
      indent: $<HTMLInputElement>("compact").checked ? 0 : 2,
    });
  };
  $("download").onclick = () => {
    const blob = new Blob([output()], { type: "application/geo+json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: exportFileName(fileName) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(output());
      toast("Copied to clipboard");
    } catch {
      toast("Clipboard not available");
    }
  };
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
  });
  // Drag and drop a file on the map.
  const mapEl = $("map");
  mapEl.addEventListener("dragover", (e) => e.preventDefault());
  mapEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) loadText(await f.text(), f.name);
  });
}

map.on("load", () => {
  addReadOnlyLayers();
  draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawSelectMode({ flags: { point: editable, linestring: editable, polygon: editable, rectangle: editable } }),
      new TerraDrawPointMode({ editable: true }),
      new TerraDrawLineStringMode(),
      new TerraDrawPolygonMode(),
      new TerraDrawRectangleMode(),
    ],
  });
  draw.start();
  setMode("select");
  draw.on("finish", (id) => onDrawFinish(id));
  draw.on("select", (id) => select(String(id)));
  draw.on("deselect", () => select(null));
  draw.on("change", (ids, type) => {
    if (type !== "delete") return;
    const gone = new Set(ids.map(String));
    if (items.some((i) => gone.has(i.uid) && editModeFor(i.feature.geometry))) {
      items = items.filter((i) => !gone.has(i.uid));
      if (selected && gone.has(selected)) selected = null;
      refresh();
    }
  });
  wireUi();
  const saved = store.load();
  if (saved) loadDocument(saved, "export", saved.features.length > 0);
  else refresh();
});

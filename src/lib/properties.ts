// Property editing helpers: type inference from text, and immutable
// add / rename / set / delete operations that preserve key order.

import type { JsonObject, JsonValue } from "./types";

// JSON number grammar (no leading +, no leading zeros, no NaN/Infinity).
const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

export type ValueType = "string" | "number" | "boolean" | "null" | "object" | "array";

/**
 * Infer a JSON value from what a user typed in a text box.
 *   "42" -> 42, "-1.5e3" -> -1500, "true" -> true, "null" -> null,
 *   '{"a":1}' / '[1,2]' -> parsed JSON (if valid),
 *   '"42"' -> the string "42" (quotes force a string), anything else -> string.
 */
export function inferValue(text: string): JsonValue {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (JSON_NUMBER.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  const first = t[0];
  if (first === "{" || first === "[" || first === '"') {
    try {
      return JSON.parse(t) as JsonValue;
    } catch {
      // Not valid JSON: fall through and keep the raw text.
    }
  }
  return text;
}

export function valueType(v: JsonValue): ValueType {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v as ValueType;
}

/**
 * Format a value for a text box so that `inferValue(formatValue(v))` gives `v` back.
 * Plain strings are shown raw unless they would be re-inferred as something else.
 */
export function formatValue(v: JsonValue): string {
  if (typeof v === "string") {
    const reinferred = inferValue(v);
    return reinferred === v ? v : JSON.stringify(v);
  }
  return JSON.stringify(v);
}

export type PropResult = { ok: true; value: JsonObject } | { ok: false; error: string };

export function setProperty(props: JsonObject, key: string, value: JsonValue): JsonObject {
  return { ...props, [key]: value };
}

export function deleteProperty(props: JsonObject, key: string): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(props)) if (k !== key) out[k] = v;
  return out;
}

/** Add a new key; fails on empty or duplicate key. */
export function addProperty(props: JsonObject, key: string, value: JsonValue): PropResult {
  const k = key.trim();
  if (k === "") return { ok: false, error: "Key cannot be empty." };
  if (Object.prototype.hasOwnProperty.call(props, k)) return { ok: false, error: `Key "${k}" already exists.` };
  return { ok: true, value: { ...props, [k]: value } };
}

/** Rename a key in place (keeps its position in the object). */
export function renameProperty(props: JsonObject, from: string, to: string): PropResult {
  const k = to.trim();
  if (!Object.prototype.hasOwnProperty.call(props, from)) return { ok: false, error: `Key "${from}" not found.` };
  if (k === "") return { ok: false, error: "Key cannot be empty." };
  if (k === from) return { ok: true, value: { ...props } };
  if (Object.prototype.hasOwnProperty.call(props, k)) return { ok: false, error: `Key "${k}" already exists.` };
  const out: JsonObject = {};
  for (const [key, v] of Object.entries(props)) out[key === from ? k : key] = v;
  return { ok: true, value: out };
}

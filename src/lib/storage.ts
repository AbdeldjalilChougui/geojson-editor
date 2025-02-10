// Persistence of the current document. The storage backend is injected
// (usually window.localStorage), so this module has no DOM dependency and
// every access is wrapped: private mode, quota errors or disabled storage
// must never break the editor.

import { parseGeoJSON } from "./parse";
import type { FeatureCollection } from "./types";

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const STORAGE_KEY = "geojson-editor:document:v1";

export interface DocumentStore {
  load(): FeatureCollection | null;
  /** Returns false if the write failed (quota, disabled storage...). */
  save(fc: FeatureCollection): boolean;
  clear(): void;
}

export function createDocumentStore(storage: KeyValueStorage | null, key = STORAGE_KEY): DocumentStore {
  return {
    load() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        if (raw == null) return null;
        const r = parseGeoJSON(raw);
        return r.ok ? r.value : null;
      } catch {
        return null;
      }
    },
    save(fc) {
      if (!storage) return false;
      try {
        storage.setItem(key, JSON.stringify(fc));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

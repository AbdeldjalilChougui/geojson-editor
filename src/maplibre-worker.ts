// maplibre-gl v6 locates its worker at runtime next to its own module URL,
// which bundlers cannot see. Bundle the worker explicitly and tell MapLibre
// where it is.
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);

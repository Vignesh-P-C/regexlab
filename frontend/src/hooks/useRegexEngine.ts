import { useEffect, useRef, useState } from "react";
import type { PipelineSnapshot } from "../types/engine";

type RegexLabModule = {
  runPipeline: (pattern: string, input: string) => string;
};

type RegexLabModuleFactory = (opts?: {
  locateFile?: (path: string) => string;
}) => Promise<RegexLabModule>;

type EngineState = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

/**
 * Loads the compiled WASM engine once and exposes a plain async-free
 * `runPipeline` function, so components stay ignorant of Emscripten's
 * module-loading ceremony. Frontend calls the compiled .wasm module
 * directly — no server round-trip.
 *
 * Expects the Emscripten build output (regexlab.js + regexlab.wasm,
 * produced by `emcmake cmake .. && emmake make` via CMakeLists.txt's
 * EMSCRIPTEN branch) copied into frontend/public/wasm/. Loaded at
 * runtime from /wasm/regexlab.js rather than a normal ES import, since
 * that file doesn't exist until the WASM build runs — this keeps
 * `npm run build` green without it.
 */
export function useRegexEngine() {
  const [state, setState] = useState<EngineState>({ status: "loading" });
  const moduleRef = useRef<RegexLabModule | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = "/wasm/regexlab.js";
        // Vite's dev server refuses import() of files served from /public
        // ("should not be imported from source code") -- it bypasses the
        // plugin pipeline. Fetching the raw text and importing it from a
        // Blob URL sidesteps that restriction, and works identically in
        // dev, build, and preview.
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
        }
        const code = await res.text();
        const blobUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
        let mod: { default: RegexLabModuleFactory };
        try {
          mod = await import(/* @vite-ignore */ blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
        // A blob: URL has no real "directory" for Emscripten to resolve
        // the sibling .wasm file against, so locateFile overrides that
        // auto-resolution and points it back at the real served path.
        const instance = await mod.default({ locateFile: (path) => `/wasm/${path}` });
        if (cancelled) return;
        moduleRef.current = instance;
        setState({ status: "ready" });
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setState({
          status: "error",
          message:
            "Engine failed to load. Copy the emcc build output " +
            "(regexlab.js, regexlab.wasm) into frontend/public/wasm/.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function runPipeline(pattern: string, input: string): PipelineSnapshot | null {
    if (!moduleRef.current) return null;
    return JSON.parse(moduleRef.current.runPipeline(pattern, input)) as PipelineSnapshot;
  }

  return { state, runPipeline };
}

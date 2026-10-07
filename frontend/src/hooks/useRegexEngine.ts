import { useEffect, useRef, useState } from "react";
import type { PipelineSnapshot } from "../types/engine";

type RegexLabModule = {
  runPipeline: (pattern: string, input: string) => string;
};

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
        const mod: { default: () => Promise<RegexLabModule> } = await import(/* @vite-ignore */ url);
        const instance = await mod.default();
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

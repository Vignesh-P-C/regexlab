#pragma once
// regexlab/json_bridge.hpp
//
// This is the actual logic of the WASM boundary — pattern + input in,
// a JSON string out — deliberately pulled out of the Emscripten binding
// file (engine/wasm/bindings.cpp) so it can be unit-tested natively with
// Catch2, without needing the Emscripten toolchain at all. The binding
// file itself ends up being ~5 lines of glue calling straight into this.
//
// Uses nlohmann::json, per CLAUDE.md v2 §5: "used ONLY at the pipeline
// boundary, never inside pass logic." This file IS that boundary —
// nothing upstream (the 5 passes, pipeline.cpp) knows JSON exists.

#include <string>

namespace regexlab {

/**
 * Runs the full pipeline and serializes the result to a JSON string.
 * This is the one function the frontend actually calls (via the WASM
 * binding) — it never sees PipelineResult, MatchTrace, or any other
 * C++ type directly.
 *
 * Shape on success:
 *   {"ok": true, "trace": {"steps": [{"ch": "a", "activeStates": [1]}, ...],
 *                            "result": "match" | "no-match",
 *                            "failurePosition": null | number}}
 * Shape on parse failure:
 *   {"ok": false, "error": {"type": "UnmatchedParen" | ...,
 *                             "position": number,
 *                             "expected": null | string,
 *                             "found": null | string}}
 */
std::string runPipelineJson(const std::string& pattern, const std::string& input);

}  // namespace regexlab

// engine/wasm/bindings.cpp
//
// The actual WASM boundary is engine/json_bridge.cpp — this file is
// just Embind glue exposing that one function to JavaScript. Kept
// separate specifically so json_bridge.cpp stays natively testable
// (see tests/json_bridge_test.cpp) without needing the Emscripten
// toolchain — this file is the only place in the whole engine that
// does.
//
// Only compiled when configuring with `emcmake cmake ..` (see the
// `if(EMSCRIPTEN)` guard in CMakeLists.txt) — never touched by a
// normal native build.

#include <emscripten/bind.h>

#include "regexlab/json_bridge.hpp"

EMSCRIPTEN_BINDINGS(regexlab_module) {
    // Exposed to JS as: Module.runPipeline(pattern, input) -> JSON string.
    // The frontend JSON.parse()s the result — see json_bridge.hpp for the
    // exact shape contract.
    emscripten::function("runPipeline", &regexlab::runPipelineJson);

    // issue #68 — Subset Growth / NFA Structure Lab (PR A). Deliberately
    // separate exports, not folded into runPipeline(): these do real
    // extra work (a second subset construction, product-BFS equivalence
    // checking) and must only run when the learner explicitly opens the
    // Growth panel or requests a what-if check — never on every
    // keystroke. See json_bridge.hpp for the exact JSON shapes.
    emscripten::function("runGrowthAnalysis", &regexlab::runGrowthAnalysisJson);
    emscripten::function("verifyCandidate", &regexlab::verifyCandidateJson);
    emscripten::function("verifyCandidateEdges", &regexlab::verifyCandidateEdgesJson);
    emscripten::function("runBoundedOptimization", &regexlab::runBoundedOptimizationJson);
}

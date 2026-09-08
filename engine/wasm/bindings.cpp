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
}

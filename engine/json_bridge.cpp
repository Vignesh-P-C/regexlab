// engine/json_bridge.cpp
//
// The actual JSON-serialization logic for the WASM boundary. See
// json_bridge.hpp for the shape contract. Kept as a normal, natively
// buildable .cpp file (part of regexlab_engine, same as any pass) —
// only engine/wasm/bindings.cpp needs the Emscripten toolchain, and
// that file is just glue calling straight into runPipelineJson() here.

#include "regexlab/json_bridge.hpp"

#include <nlohmann/json.hpp>

#include "regexlab/pipeline.hpp"

namespace regexlab {

namespace {

using json = nlohmann::json;

json toJson(const ParseError& error) {
    static const char* typeNames[] = {"UnmatchedParen", "UnexpectedToken", "EmptyGroup",
                                       "DanglingOperator"};
    json j;
    j["type"] = typeNames[static_cast<int>(error.type)];
    j["position"] = error.position;
    j["expected"] = error.expected.has_value() ? json(error.expected.value()) : json(nullptr);
    j["found"] = error.found.has_value() ? json(error.found.value()) : json(nullptr);
    return j;
}

json toJson(const MatchStep& step) {
    return json{{"ch", std::string(1, step.ch)}, {"activeStates", step.activeStates}};
}

json toJson(const MatchTrace& trace) {
    json j;
    j["steps"] = json::array();
    for (const auto& step : trace.steps) j["steps"].push_back(toJson(step));
    j["result"] = trace.result == MatchResultType::Match ? "match" : "no-match";
    j["failurePosition"] =
        trace.failurePosition.has_value() ? json(trace.failurePosition.value()) : json(nullptr);
    return j;
}

json toJson(const PipelineResult& result) {
    json j;
    j["ok"] = result.ok;
    if (result.ok) {
        j["trace"] = toJson(result.trace);
    } else {
        j["error"] = toJson(result.error);
    }
    return j;
}

}  // namespace

std::string runPipelineJson(const std::string& pattern, const std::string& input) {
    PipelineResult result = runPipeline(pattern, input);
    return toJson(result).dump();
}

}  // namespace regexlab

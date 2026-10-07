// engine/json_bridge.cpp
//
// The actual JSON-serialization logic for the WASM boundary. See
// json_bridge.hpp for the shape contract. Kept as a normal, natively
// buildable .cpp file (part of regexlab_engine, same as any pass) —
// only engine/wasm/bindings.cpp needs the Emscripten toolchain, and
// that file is just glue calling straight into runPipelineJson() here.

#include "regexlab/json_bridge.hpp"

#include <nlohmann/json.hpp>
#include <variant>

#include "regexlab/pipeline.hpp"

namespace regexlab {

namespace {

using json = nlohmann::json;

json toJson(const ParseError& error) {
    static const char* typeNames[] = {"UnmatchedParen", "UnexpectedToken", "EmptyGroup",
                                       "DanglingOperator", "PatternTooComplex"};
    // Keeps typeNames in lockstep with ParseErrorType by construction: if a
    // variant is added to the enum without updating this array, the build
    // fails here instead of an out-of-bounds read happening at runtime.
    static_assert(sizeof(typeNames) / sizeof(typeNames[0]) ==
                      static_cast<size_t>(ParseErrorType::PatternTooComplex) + 1,
                  "typeNames must have one entry per ParseErrorType variant");

    json j;
    j["type"] = typeNames[static_cast<int>(error.type)];
    j["position"] = error.position;
    j["expected"] = error.expected.has_value() ? json(error.expected.value()) : json(nullptr);
    j["found"] = error.found.has_value() ? json(error.found.value()) : json(nullptr);
    return j;
}

json toJson(const ASTNodePtr& node) {
    return std::visit(
        [&](auto&& n) -> json {
            using T = std::decay_t<decltype(n)>;
            if constexpr (std::is_same_v<T, CharNode>) {
                return json{{"kind", "char"}, {"value", std::string(1, n.value)}};
            } else if constexpr (std::is_same_v<T, ConcatNode>) {
                return json{
                    {"kind", "concat"}, {"left", toJson(n.left)}, {"right", toJson(n.right)}};
            } else if constexpr (std::is_same_v<T, AltNode>) {
                return json{
                    {"kind", "alt"}, {"left", toJson(n.left)}, {"right", toJson(n.right)}};
            } else if constexpr (std::is_same_v<T, StarNode>) {
                return json{{"kind", "star"}, {"child", toJson(n.child)}};
            }
        },
        node->node);
}

json toJson(const Automaton& automaton) {
    json j;
    j["stateCount"] = automaton.stateCount;
    j["startState"] = automaton.startState;
    j["acceptStates"] = automaton.acceptStates;  // nlohmann serializes unordered_set as an array

    json transitions = json::object();
    for (const auto& [state, bySymbol] : automaton.transitions) {
        json symbolMap = json::object();
        for (const auto& [symbol, targets] : bySymbol) {
            symbolMap[symbol] = targets;
        }
        // JSON object keys must be strings — state IDs are ints on the C++
        // side but become string keys at this one serialization boundary.
        transitions[std::to_string(state)] = symbolMap;
    }
    j["transitions"] = transitions;
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
        j["ast"] = toJson(result.ast);
        j["nfa"] = toJson(result.nfa);
        j["dfa"] = toJson(result.dfa);
        j["minDfa"] = toJson(result.minDfa);
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

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
 * Shape on success — every pipeline stage is included, not just the final
 * match, so the frontend visualizer can render AST -> NFA -> DFA -> min-DFA
 * without re-invoking the engine per stage:
 *   {"ok": true,
 *    "ast": {"kind": "char"|"concat"|"alt"|"star", ...},
 *    "nfa": Automaton, "dfa": Automaton, "minDfa": Automaton,
 *    "trace": {"steps": [{"ch": "a", "activeStates": [1]}, ...],
 *              "result": "match" | "no-match",
 *              "failurePosition": null | number}}
 * where Automaton is:
 *   {"stateCount": number, "startState": number, "acceptStates": [number, ...],
 *    "transitions": {"<stateId>": {"<symbol>|eps": [number, ...]}}}
 * Shape on parse failure:
 *   {"ok": false, "error": {"type": "UnmatchedParen" | "UnexpectedToken" |
 *                             "EmptyGroup" | "DanglingOperator" |
 *                             "PatternTooComplex" | "InvalidCharacterClass" |
 *                             "AutomatonTooComplex",
 *                             "position": number,
 *                             "expected": null | string,
 *                             "found": null | string,
 *                             "message": optional string for engine safety limits}}
 */
std::string runPipelineJson(const std::string& pattern, const std::string& input);

/**
 * issue #68 — Subset Growth / NFA Structure Lab (PR A). A SEPARATE entry
 * point from runPipelineJson(), deliberately: this re-parses/re-builds
 * the Thompson NFA for `pattern` and runs the (not-free) subset-trace +
 * metrics analysis, so it must never be called on every keystroke the
 * way runPipeline() is — see growth-analysis.hpp's header comment.
 * On parse failure, returns {"ok": false, "error": ParseError} with the
 * same shape runPipelineJson() uses for the same case.
 */
std::string runGrowthAnalysisJson(const std::string& pattern);

/**
 * issue #68 — verifies ONE candidate edit (v1 supports exactly
 * "deleteEpsilonEdge", identified by the edge's source/target state ids)
 * against the pattern's own baseline NFA. Returns
 * {"ok": true, "candidate": CandidateResult} or
 * {"ok": false, "error": ParseError} on parse failure.
 */
std::string verifyCandidateJson(const std::string& pattern, int edgeSource, int edgeTarget);

/**
 * Verifies a set of epsilon-edge deletions applied together to one candidate
 * copy. edgesJson is an array of {source, target} objects selected from the
 * baseline NFA. Returns an InvalidCandidateEdit error for malformed,
 * duplicate, or non-existent edges.
 */
std::string verifyCandidateEdgesJson(const std::string& pattern, const std::string& edgesJson);

/** Run the deterministic bounded epsilon-deletion search. */
std::string runBoundedOptimizationJson(
    const std::string& pattern, int maxEditDepth = 2, int maxCandidates = 24);

}  // namespace regexlab

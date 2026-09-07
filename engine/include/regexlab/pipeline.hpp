#pragma once
// regexlab/pipeline.hpp
//
// The single entry point for the whole engine: pattern + input string in,
// a match result out. This is what main.cpp, the WASM bridge, and the
// differential/fuzz tests should all call — nothing outside this file
// should need to know the pipeline is 5 separate passes chained together.
//
// This didn't exist on the TS side either (pipeline.ts was planned but
// never written) — this is a new file, not a port, so there's no TS
// reference to match against. The shape follows the same ok/error
// convention already established by ParseResult in types.hpp, for
// consistency with the rest of the codebase.

#include <string>

#include "regexlab/types.hpp"

namespace regexlab {

struct PipelineResult {
    bool ok;
    MatchTrace trace;    // meaningful iff ok == true
    ParseError error;    // meaningful iff ok == false — propagated straight from ParserPass
};

/**
 * Runs the full pipeline: parse -> Thompson's construction -> subset
 * construction -> minimization -> match. If the pattern fails to parse,
 * short-circuits and returns the ParseError immediately — the remaining
 * 4 passes never run on an invalid pattern.
 */
PipelineResult runPipeline(const std::string& pattern, const std::string& input);

// Equality operator, for test comparisons only — same rationale as the
// operator== block in types.hpp (C++ has no structural-equality
// equivalent to TS's toEqual).
inline bool operator==(const PipelineResult& a, const PipelineResult& b) {
    if (a.ok != b.ok) return false;
    if (a.ok) return a.trace == b.trace;
    return a.error == b.error;
}

}  // namespace regexlab

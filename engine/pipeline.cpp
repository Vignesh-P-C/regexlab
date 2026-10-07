// engine/pipeline.cpp
//
// Chains the 5 passes into the one function everything else calls.
// Sits at engine/ root rather than engine/passes/ — this mirrors where
// types.ts lived in the TS layout: it's plumbing, not a pass itself.

#include "regexlab/pipeline.hpp"

#include "regexlab/passes/matcher-pass.hpp"
#include "regexlab/passes/minimization-pass.hpp"
#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"

namespace regexlab {

PipelineResult runPipeline(const std::string& pattern, const std::string& input) {
    ParseResult parsed = parse(pattern);
    if (!parsed.ok) {
        // Short-circuit: an invalid pattern never reaches Thompson's
        // construction or anything after it.
        return PipelineResult{false, nullptr, Automaton{}, Automaton{},
                               Automaton{},    MatchTrace{}, parsed.error};
    }

    Automaton nfa = thompsonConstruction(parsed.ast);
    Automaton dfa = subsetConstruction(nfa);
    Automaton minDfa = minimize(dfa);
    MatchTrace trace = match(minDfa, input);

    // Every intermediate stage is carried through, not just the final
    // trace — this is what lets the frontend visualizer render AST -> NFA
    // -> DFA -> min-DFA, not only the match/no-match result.
    return PipelineResult{true, parsed.ast, nfa, dfa, minDfa, trace, ParseError{}};
}

}  // namespace regexlab

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

#include <utility>

namespace regexlab {

PipelineResult runPipeline(const std::string& pattern, const std::string& input) {
    ParseResult parsed = parse(pattern);
    if (!parsed.ok) {
        return PipelineResult{false, nullptr, Automaton{}, Automaton{},
                              Automaton{}, MatchTrace{}, parsed.error};
    }

    try {
        Automaton nfa = thompsonConstruction(parsed.ast);
        Automaton dfa = subsetConstruction(nfa);
        Automaton minDfa = minimize(dfa);
        MatchTrace trace = match(minDfa, input);
        return PipelineResult{true, parsed.ast, nfa, dfa, minDfa, trace, ParseError{}};
    } catch (const AutomatonTooComplexError& error) {
        ParseError engineError{
            ParseErrorType::AutomatonTooComplex, 0, std::nullopt, std::nullopt,
            std::string(error.what())};
        return PipelineResult{false, nullptr, Automaton{}, Automaton{},
                              Automaton{}, MatchTrace{}, std::move(engineError)};
    }
}

}  // namespace regexlab

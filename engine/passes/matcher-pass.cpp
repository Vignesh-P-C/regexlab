// engine/passes/matcher-pass.cpp
//
// Direct C++ port of matcher-pass.ts. Same O(n)-time, O(1)-space DFA
// walk — one transition per character, dead end stops immediately
// (no backtracking, by construction).

#include "regexlab/passes/matcher-pass.hpp"

namespace regexlab {

MatchTrace match(const Automaton& dfa, const std::string& input) {
    std::vector<MatchStep> steps;
    int current = dfa.startState;

    for (size_t i = 0; i < input.size(); ++i) {
        char c = input[i];
        std::string symbol(1, c);

        std::optional<int> destination;
        auto stateIt = dfa.transitions.find(current);
        if (stateIt != dfa.transitions.end()) {
            auto symIt = stateIt->second.find(symbol);
            if (symIt != stateIt->second.end() && !symIt->second.empty()) {
                destination = symIt->second[0];
            }
        }

        if (!destination.has_value()) {
            // Dead end: no transition exists for this character from the current
            // state, so the string can never match no matter what follows. Stop
            // immediately rather than consuming the rest of the string — this is
            // exactly what "the DFA never backtracks" looks like in code.
            MatchTrace trace;
            trace.steps = steps;
            trace.result = MatchResultType::NoMatch;
            trace.failurePosition = static_cast<int>(i);
            return trace;
        }

        current = *destination;
        steps.push_back(MatchStep{c, {current}});
    }

    // Consumed the whole string without hitting a dead end — whether it's a
    // match depends only on whether the final state is an accept state.
    MatchTrace trace;
    trace.steps = steps;
    trace.result = dfa.acceptStates.count(current) ? MatchResultType::Match : MatchResultType::NoMatch;
    return trace;
}

}  // namespace regexlab

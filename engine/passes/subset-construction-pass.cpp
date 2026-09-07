// engine/passes/subset-construction-pass.cpp
//
// Direct C++ port of subset-construction-pass.ts. Same epsilonClosure /
// move / alphabetOf / setKey helpers, same worklist processed as a stack
// (LIFO — .back()/.pop_back() here, matches JS array .push()/.pop()),
// same lazy state-ID assignment via idFor(). This ordering is what makes
// the ported golden test values (exact DFA state numbers) match the TS
// version — see subset-construction-pass.ts's header comment for the
// full algorithm rationale, identical here.

#include "regexlab/passes/subset-construction-pass.hpp"

#include <algorithm>
#include <sstream>

namespace regexlab {

namespace {

std::unordered_set<int> epsilonClosure(const Automaton& nfa,
                                        const std::unordered_set<int>& states) {
    std::unordered_set<int> closure(states);
    std::vector<int> stack(closure.begin(), closure.end());

    while (!stack.empty()) {
        int state = stack.back();
        stack.pop_back();

        auto stateIt = nfa.transitions.find(state);
        if (stateIt == nfa.transitions.end()) continue;
        auto epsIt = stateIt->second.find("eps");
        if (epsIt == stateIt->second.end()) continue;

        for (int target : epsIt->second) {
            if (closure.insert(target).second) {  // .second == true iff newly inserted
                stack.push_back(target);
            }
        }
    }
    return closure;
}

std::unordered_set<int> move(const Automaton& nfa, const std::unordered_set<int>& states,
                              const std::string& symbol) {
    std::unordered_set<int> result;
    for (int state : states) {
        auto stateIt = nfa.transitions.find(state);
        if (stateIt == nfa.transitions.end()) continue;
        auto symIt = stateIt->second.find(symbol);
        if (symIt == stateIt->second.end()) continue;
        for (int target : symIt->second) result.insert(target);
    }
    return result;
}

/** The input alphabet is every symbol the NFA transitions on, excluding "eps". */
std::vector<std::string> alphabetOf(const Automaton& nfa) {
    std::unordered_set<std::string> symbols;
    for (const auto& [state, bySymbol] : nfa.transitions) {
        for (const auto& [symbol, targets] : bySymbol) {
            if (symbol != "eps") symbols.insert(symbol);
        }
    }
    std::vector<std::string> result(symbols.begin(), symbols.end());
    std::sort(result.begin(), result.end());
    return result;
}

/** Canonical, order-independent key for a set of NFA states, used to dedupe DFA states. */
std::string setKey(const std::unordered_set<int>& states) {
    std::vector<int> sorted(states.begin(), states.end());
    std::sort(sorted.begin(), sorted.end());
    std::ostringstream oss;
    for (size_t i = 0; i < sorted.size(); ++i) {
        if (i > 0) oss << ",";
        oss << sorted[i];
    }
    return oss.str();
}

}  // namespace

Automaton subsetConstruction(const Automaton& nfa) {
    std::vector<std::string> alphabet = alphabetOf(nfa);

    std::vector<std::unordered_set<int>> stateSets;  // DFA state id -> the NFA-state-set it represents
    std::unordered_map<std::string, int> idBySetKey;
    std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions;

    auto idFor = [&](const std::unordered_set<int>& nfaStateSet) -> int {
        std::string key = setKey(nfaStateSet);
        auto it = idBySetKey.find(key);
        if (it != idBySetKey.end()) return it->second;
        int id = static_cast<int>(stateSets.size());
        idBySetKey[key] = id;
        stateSets.push_back(nfaStateSet);
        return id;
    };

    int startState = idFor(epsilonClosure(nfa, {nfa.startState}));

    // Worklist/fixpoint: process every DFA state exactly once, even though
    // new states can be discovered mid-loop (stateSets grows as we go).
    std::unordered_set<int> processed;
    std::vector<int> worklist = {startState};

    while (!worklist.empty()) {
        int current = worklist.back();
        worklist.pop_back();
        if (processed.count(current)) continue;
        processed.insert(current);

        for (const std::string& symbol : alphabet) {
            std::unordered_set<int> moved = move(nfa, stateSets[current], symbol);
            if (moved.empty()) continue;  // no transition on this symbol -> implicit dead state, omitted

            int targetId = idFor(epsilonClosure(nfa, moved));

            transitions[current][symbol] = {targetId};  // deterministic: exactly one destination per symbol

            if (!processed.count(targetId)) worklist.push_back(targetId);
        }
    }

    std::unordered_set<int> acceptStates;
    for (size_t dfaId = 0; dfaId < stateSets.size(); ++dfaId) {
        for (int nfaState : stateSets[dfaId]) {
            if (nfa.acceptStates.count(nfaState)) {
                acceptStates.insert(static_cast<int>(dfaId));
                break;
            }
        }
    }

    Automaton dfa;
    dfa.stateCount = static_cast<int>(stateSets.size());
    dfa.startState = startState;
    dfa.acceptStates = acceptStates;
    dfa.transitions = transitions;
    return dfa;
}

}  // namespace regexlab

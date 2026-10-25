// engine/passes/minimization-pass.cpp
//
// Direct C++ port of minimization-pass.ts. Same coarsest-first partition
// (non-accepting vs accepting), same refine() splitting groups by
// per-symbol "signature" (which group each transition leads to), same
// fixpoint loop, same worklist-based renumbering into canonical IDs.
//
// One deliberate detail carried over: TS's `buckets: Map<string, number[]>`
// preserves insertion order, and that order feeds directly into which
// group gets which position in newGroups — which in turn affects the
// final canonical state numbering. This port tracks that same insertion
// order explicitly (bucketOrder) since C++'s unordered_map does not
// preserve it. This is what makes the ported golden test values (exact
// minimized-DFA state numbers) match the TS version.

#include "regexlab/passes/minimization-pass.hpp"

#include <algorithm>
#include <sstream>

namespace regexlab {

namespace {

struct WorkBudget {
    std::size_t remaining;
    std::size_t maximum;
};

void accountWork(WorkBudget& budget, std::size_t amount = 1) {
    if (amount > budget.remaining) {
        throw AutomatonTooComplexError(
            "DFA minimization exceeded its safety limit of " +
            std::to_string(budget.maximum) + " work units.");
    }
    budget.remaining -= amount;
}

std::vector<std::string> alphabetOf(const Automaton& dfa, WorkBudget& budget) {
    std::unordered_set<std::string> symbols;
    for (const auto& [state, bySymbol] : dfa.transitions) {
        for (const auto& [symbol, targets] : bySymbol) {
            accountWork(budget);
            symbols.insert(symbol);
        }
    }
    std::vector<std::string> result(symbols.begin(), symbols.end());
    std::sort(result.begin(), result.end());
    return result;
}

struct RefineResult {
    std::vector<std::vector<int>> groups;
    bool changed;
};

/** One refinement pass: split every group using each state's "signature" (which group each symbol leads to). */
RefineResult refine(const std::vector<std::vector<int>>& groups, const Automaton& dfa,
                     const std::vector<std::string>& alphabet, WorkBudget& budget) {
    std::unordered_map<int, int> groupIndexOf;
    for (size_t i = 0; i < groups.size(); ++i) {
        for (int state : groups[i]) {
            accountWork(budget);
            groupIndexOf[state] = static_cast<int>(i);
        }
    }

    std::vector<std::vector<int>> newGroups;
    bool changed = false;

    for (const auto& group : groups) {
        std::vector<std::string> bucketOrder;  // preserves first-seen order, like a JS Map
        std::unordered_map<std::string, std::vector<int>> buckets;

        for (int state : group) {
            std::ostringstream sig;
            for (size_t i = 0; i < alphabet.size(); ++i) {
                accountWork(budget);
                if (i > 0) sig << ",";
                auto stateIt = dfa.transitions.find(state);
                bool found = false;
                if (stateIt != dfa.transitions.end()) {
                    auto symIt = stateIt->second.find(alphabet[i]);
                    if (symIt != stateIt->second.end() && !symIt->second.empty()) {
                        sig << groupIndexOf.at(symIt->second[0]);
                        found = true;
                    }
                }
                if (!found) sig << "-";
            }
            std::string signature = sig.str();
            if (buckets.find(signature) == buckets.end()) bucketOrder.push_back(signature);
            buckets[signature].push_back(state);
        }

        if (buckets.size() > 1) changed = true;
        for (const std::string& key : bucketOrder) newGroups.push_back(buckets[key]);
    }

    return {newGroups, changed};
}

}  // namespace

Automaton minimize(const Automaton& dfa, const MinimizationLimits& limits) {
    if (dfa.stateCount < 0 || static_cast<std::size_t>(dfa.stateCount) > limits.maxDfaStates) {
        throw AutomatonTooComplexError(
            "DFA minimization input exceeds its safety limit of " +
            std::to_string(limits.maxDfaStates) + " states.");
    }
    WorkBudget budget{limits.maxWorkUnits, limits.maxWorkUnits};
    std::vector<std::string> alphabet = alphabetOf(dfa, budget);

    std::vector<int> allStates(dfa.stateCount);
    for (int i = 0; i < dfa.stateCount; ++i) allStates[i] = i;

    std::vector<int> accepting, nonAccepting;
    for (int state : allStates) {
        if (dfa.acceptStates.count(state)) accepting.push_back(state);
        else nonAccepting.push_back(state);
    }

    std::vector<std::vector<int>> groups;
    if (!nonAccepting.empty()) groups.push_back(nonAccepting);
    if (!accepting.empty()) groups.push_back(accepting);

    bool changed = true;
    while (changed) {
        RefineResult result = refine(groups, dfa, alphabet, budget);
        groups = result.groups;
        changed = result.changed;
    }

    std::unordered_map<int, int> groupIndexOfState;
    for (size_t i = 0; i < groups.size(); ++i) {
        for (int state : groups[i]) {
            accountWork(budget);
            groupIndexOfState[state] = static_cast<int>(i);
        }
    }

    std::unordered_map<int, int> canonicalId;
    std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions;
    int startGroupIndex = groupIndexOfState.at(dfa.startState);

    auto idFor = [&](int groupIndex) -> int {
        auto it = canonicalId.find(groupIndex);
        if (it != canonicalId.end()) return it->second;
        int id = static_cast<int>(canonicalId.size());
        canonicalId[groupIndex] = id;
        return id;
    };

    int startState = idFor(startGroupIndex);
    std::vector<int> worklist = {startGroupIndex};
    std::unordered_set<int> processed;
    while (!worklist.empty()) {
        int groupIndex = worklist.back();
        worklist.pop_back();
        if (processed.count(groupIndex)) continue;
        processed.insert(groupIndex);
        int representative = groups[groupIndex][0];
        int currentId = idFor(groupIndex);

        for (const std::string& symbol : alphabet) {
            accountWork(budget);
            auto stateIt = dfa.transitions.find(representative);
            if (stateIt == dfa.transitions.end()) continue;
            auto symIt = stateIt->second.find(symbol);
            if (symIt == stateIt->second.end() || symIt->second.empty()) continue;
            int dest = symIt->second[0];
            int destGroupIndex = groupIndexOfState.at(dest);
            int destId = idFor(destGroupIndex);
            transitions[currentId][symbol] = {destId};
            if (!processed.count(destGroupIndex)) worklist.push_back(destGroupIndex);
        }
    }

    std::unordered_set<int> acceptStates;
    for (size_t groupIndex = 0; groupIndex < groups.size(); ++groupIndex) {
        accountWork(budget);
        if (dfa.acceptStates.count(groups[groupIndex][0])) {
            acceptStates.insert(idFor(static_cast<int>(groupIndex)));
        }
    }

    Automaton result;
    result.stateCount = static_cast<int>(canonicalId.size());
    result.startState = startState;
    result.acceptStates = acceptStates;
    result.transitions = transitions;
    return result;
}

}  // namespace regexlab

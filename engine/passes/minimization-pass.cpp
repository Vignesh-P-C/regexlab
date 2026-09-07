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

std::vector<std::string> alphabetOf(const Automaton& dfa) {
    std::unordered_set<std::string> symbols;
    for (const auto& [state, bySymbol] : dfa.transitions) {
        for (const auto& [symbol, targets] : bySymbol) {
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
                     const std::vector<std::string>& alphabet) {
    std::unordered_map<int, int> groupIndexOf;
    for (size_t i = 0; i < groups.size(); ++i) {
        for (int state : groups[i]) groupIndexOf[state] = static_cast<int>(i);
    }

    std::vector<std::vector<int>> newGroups;
    bool changed = false;

    for (const auto& group : groups) {
        std::vector<std::string> bucketOrder;  // preserves first-seen order, like a JS Map
        std::unordered_map<std::string, std::vector<int>> buckets;

        for (int state : group) {
            std::ostringstream sig;
            for (size_t i = 0; i < alphabet.size(); ++i) {
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

Automaton minimize(const Automaton& dfa) {
    std::vector<std::string> alphabet = alphabetOf(dfa);

    std::vector<int> allStates(dfa.stateCount);
    for (int i = 0; i < dfa.stateCount; ++i) allStates[i] = i;

    std::vector<int> accepting, nonAccepting;
    for (int s : allStates) {
        if (dfa.acceptStates.count(s)) accepting.push_back(s);
        else nonAccepting.push_back(s);
    }

    // Coarsest safe starting partition: non-accepting vs accepting (skip empty groups).
    std::vector<std::vector<int>> groups;
    if (!nonAccepting.empty()) groups.push_back(nonAccepting);
    if (!accepting.empty()) groups.push_back(accepting);

    // Fixpoint: keep refining until a full pass produces zero splits.
    bool changed = true;
    while (changed) {
        RefineResult result = refine(groups, dfa, alphabet);
        groups = result.groups;
        changed = result.changed;
    }

    std::unordered_map<int, int> groupIndexOfState;
    for (size_t i = 0; i < groups.size(); ++i) {
        for (int state : groups[i]) groupIndexOfState[state] = static_cast<int>(i);
    }

    // Renumber groups via a worklist starting from the start group, so IDs are
    // assigned in a deterministic discovery order (same style as the other
    // passes) rather than the arbitrary order refinement produced them in.
    std::unordered_map<int, int> canonicalId;  // original group index -> canonical new id
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

        int representative = groups[groupIndex][0];  // any member; refinement guarantees they all agree
        int currentId = idFor(groupIndex);

        for (const std::string& symbol : alphabet) {
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

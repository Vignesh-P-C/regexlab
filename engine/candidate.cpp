// engine/candidate.cpp — issue #68. C++ port of engine/candidate.ts.

#include "regexlab/candidate.hpp"

#include <algorithm>
#include <unordered_set>

namespace regexlab {

Automaton cloneAutomaton(const Automaton& automaton) {
    // Automaton's members (unordered_map/unordered_set/vector) are all
    // value types in C++, so a plain copy IS a deep copy already —
    // unlike TS's Map/Set references, there's no aliasing to worry about.
    return automaton;
}

std::vector<CandidateEdgeId> listEligibleEpsilonEdges(const Automaton& nfa) {
    std::vector<CandidateEdgeId> edges;
    for (const auto& [source, bySymbol] : nfa.transitions) {
        auto it = bySymbol.find("eps");
        if (it == bySymbol.end()) continue;
        std::unordered_set<int> distinctTargets(it->second.begin(), it->second.end());
        for (int target : distinctTargets) {
            edges.push_back(CandidateEdgeId{source, "eps", target});
        }
    }
    std::sort(edges.begin(), edges.end(), [](const CandidateEdgeId& a, const CandidateEdgeId& b) {
        if (a.source != b.source) return a.source < b.source;
        return a.target < b.target;
    });
    return edges;
}

Automaton applyCandidateEdit(const Automaton& nfa, const CandidateEdit& edit) {
    Automaton candidate = cloneAutomaton(nfa);
    if (edit.kind == CandidateEditKind::DeleteEpsilonEdge) {
        auto stateIt = candidate.transitions.find(edit.edge.source);
        if (stateIt != candidate.transitions.end()) {
            auto epsIt = stateIt->second.find("eps");
            if (epsIt != stateIt->second.end()) {
                auto& targets = epsIt->second;
                auto pos = std::find(targets.begin(), targets.end(), edit.edge.target);
                if (pos != targets.end()) {
                    targets.erase(pos);
                    if (targets.empty()) stateIt->second.erase(epsIt);
                }
            }
        }
    }
    return candidate;
}

}  // namespace regexlab

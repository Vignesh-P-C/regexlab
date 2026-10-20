// Rabin–Scott subset construction; symbolic NFA labels are tested against ASCII symbols.
#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/character-set.hpp"
#include <algorithm>
#include <sstream>
namespace regexlab {
namespace {
std::unordered_set<int> epsilonClosure(const Automaton& nfa, const std::unordered_set<int>& states) {
    std::unordered_set<int> closure(states); std::vector<int> stack(closure.begin(), closure.end());
    while (!stack.empty()) {
        int state = stack.back(); stack.pop_back(); auto it = nfa.transitions.find(state); if (it == nfa.transitions.end()) continue;
        auto eps = it->second.find("eps"); if (eps == it->second.end()) continue;
        for (int target : eps->second) if (closure.insert(target).second) stack.push_back(target);
    }
    return closure;
}
std::unordered_set<int> move(const Automaton& nfa, const std::unordered_set<int>& states, const std::string& symbol) {
    std::unordered_set<int> result;
    for (int state : states) {
        auto it = nfa.transitions.find(state); if (it == nfa.transitions.end()) continue;
        for (const auto& [label, targets] : it->second) if (transitionMatches(label, symbol[0])) for (int target : targets) result.insert(target);
    }
    return result;
}
std::vector<std::string> alphabetOf(const Automaton& nfa) {
    std::unordered_set<std::string> symbols;
    for (const auto& [state, edges] : nfa.transitions) for (const auto& [label, targets] : edges) {
        if (label == "eps") continue;
        if (isCharacterSetLabel(label)) for (int code : decodeCharacterSet(label)) symbols.insert(std::string(1, static_cast<char>(code)));
        else if (label.size() == 1) symbols.insert(label);
    }
    std::vector<std::string> out(symbols.begin(), symbols.end()); std::sort(out.begin(), out.end()); return out;
}
std::string setKey(const std::unordered_set<int>& states) {
    std::vector<int> sorted(states.begin(), states.end()); std::sort(sorted.begin(), sorted.end()); std::ostringstream out;
    for (size_t i = 0; i < sorted.size(); ++i) { if (i) out << ","; out << sorted[i]; } return out.str();
}
}
Automaton subsetConstruction(const Automaton& nfa) {
    const auto alphabet = alphabetOf(nfa);
    std::vector<std::unordered_set<int>> sets; std::unordered_map<std::string, int> ids;
    std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions;
    auto idFor = [&](const std::unordered_set<int>& states) {
        auto key = setKey(states); auto f = ids.find(key); if (f != ids.end()) return f->second;
        int id = static_cast<int>(sets.size()); ids[key] = id; sets.push_back(states); return id;
    };
    int start = idFor(epsilonClosure(nfa, {nfa.startState}));
    std::unordered_set<int> processed; std::vector<int> worklist{start};
    while (!worklist.empty()) {
        int current = worklist.back(); worklist.pop_back(); if (!processed.insert(current).second) continue;
        for (const auto& symbol : alphabet) {
            auto moved = move(nfa, sets[current], symbol); if (moved.empty()) continue;
            int target = idFor(epsilonClosure(nfa, moved)); transitions[current][symbol] = {target};
            if (!processed.count(target)) worklist.push_back(target);
        }
    }
    std::unordered_set<int> accepts;
    for (size_t i = 0; i < sets.size(); ++i) for (int state : sets[i]) if (nfa.acceptStates.count(state)) { accepts.insert(static_cast<int>(i)); break; }
    Automaton dfa; dfa.stateCount = static_cast<int>(sets.size()); dfa.startState = start; dfa.acceptStates = std::move(accepts); dfa.transitions = std::move(transitions); return dfa;
}
}

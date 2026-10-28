// engine/passes/subset-construction-pass.cpp
//
// Direct C++ port of subset-construction-pass.ts. Same epsilonClosure /
// move / alphabetOf / setKey helpers, same worklist processed as a stack
// (LIFO — .back()/.pop_back() here, matches JS array .push()/.pop()),
// same lazy state-ID assignment via idFor(). This ordering is what makes
// the ported golden test values (exact DFA state numbers) match the TS
// version — see subset-construction-pass.ts's header comment for the
// full algorithm rationale, identical here.
//
// Grammar v1 addition (issue #60, docs/regex-grammar-v1.md): see
// subset-construction-pass.ts's header comment for why alphabetOf() below
// decodes every "cs:" label into individual ASCII characters, and why
// move() needs transitionMatches() instead of a direct map lookup — this
// file mirrors that logic exactly.

#include "regexlab/passes/subset-construction-pass.hpp"
#include "regexlab/character-set.hpp"

#include <algorithm>
#include <sstream>

namespace regexlab {

namespace {

struct WorkBudget {
    std::size_t remaining;
};

struct BudgetExceeded {
    std::string message;
};

void accountWork(WorkBudget* budget, std::size_t amount = 1) {
    if (!budget) return;
    if (amount > budget->remaining) throw BudgetExceeded{"work-unit limit exceeded"};
    budget->remaining -= amount;
}

std::unordered_set<int> epsilonClosure(const Automaton& nfa,
                                        const std::unordered_set<int>& states,
                                        WorkBudget* budget = nullptr) {
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
            accountWork(budget);
            if (closure.insert(target).second) {  // .second == true iff newly inserted
                stack.push_back(target);
            }
        }
    }
    return closure;
}

/**
 * Unlike the pre-grammar-v1 version, this can't just look up a symbol
 * directly in the transitions map: `symbol` is always a single ASCII
 * character (see alphabetOf), but the NFA edge that matches it might be
 * labeled with that literal character OR with a "cs:" set that happens
 * to include it. transitionMatches() (see character-set.hpp) is what
 * tells the two apart.
 */
std::unordered_set<int> move(const Automaton& nfa, const std::unordered_set<int>& states,
                              const std::string& symbol, WorkBudget* budget = nullptr) {
    std::unordered_set<int> result;
    for (int state : states) {
        accountWork(budget);
        auto stateIt = nfa.transitions.find(state);
        if (stateIt == nfa.transitions.end()) continue;
        for (const auto& [label, targets] : stateIt->second) {
            accountWork(budget);
            if (transitionMatches(label, symbol[0])) {
                for (int target : targets) {
                    accountWork(budget);
                    result.insert(target);
                }
            }
        }
    }
    return result;
}

/**
 * The input alphabet is every symbol the NFA transitions on, excluding
 * "eps" — expanded one ASCII character at a time, even for symbols that
 * arrived compacted as a "cs:" set. See this file's header comment for
 * why that expansion happens here and what it costs downstream.
 */
std::vector<std::string> alphabetOf(const Automaton& nfa, WorkBudget* budget = nullptr) {
    std::unordered_set<std::string> symbols;
    for (const auto& [state, bySymbol] : nfa.transitions) {
        for (const auto& [label, targets] : bySymbol) {
            accountWork(budget);
            if (label == "eps") continue;
            if (isCharacterSetLabel(label)) {
                for (int code : decodeCharacterSet(label)) {
                    accountWork(budget);
                    symbols.insert(std::string(1, static_cast<char>(code)));
                }
            } else if (label.size() == 1) {
                symbols.insert(label);
            }
        }
    }
    std::vector<std::string> result(symbols.begin(), symbols.end());
    std::sort(result.begin(), result.end());
    return result;
}

/** Canonical, order-independent key for a set of NFA states, used to dedupe DFA states. */
std::string setKey(const std::unordered_set<int>& states, WorkBudget* budget = nullptr) {
    accountWork(budget, states.size());
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

namespace {
Automaton subsetConstructionImpl(const Automaton& nfa, WorkBudget* budget,
                                 std::size_t maxDfaStates) {
    std::vector<std::string> alphabet = alphabetOf(nfa, budget);

    std::vector<std::unordered_set<int>> stateSets;  // DFA state id -> the NFA-state-set it represents
    std::unordered_map<std::string, int> idBySetKey;
    std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions;

    auto idFor = [&](const std::unordered_set<int>& nfaStateSet) -> int {
        std::string key = setKey(nfaStateSet, budget);
        auto it = idBySetKey.find(key);
        if (it != idBySetKey.end()) return it->second;
        if (budget && stateSets.size() >= maxDfaStates) throw BudgetExceeded{"DFA-state limit exceeded"};
        int id = static_cast<int>(stateSets.size());
        idBySetKey[key] = id;
        stateSets.push_back(nfaStateSet);
        return id;
    };

    int startState = idFor(epsilonClosure(nfa, {nfa.startState}, budget));

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
            accountWork(budget);
            std::unordered_set<int> moved = move(nfa, stateSets[current], symbol, budget);
            if (moved.empty()) continue;  // no transition on this symbol -> implicit dead state, omitted

            int targetId = idFor(epsilonClosure(nfa, moved, budget));

            transitions[current][symbol] = {targetId};  // deterministic: exactly one destination per symbol

            if (!processed.count(targetId)) worklist.push_back(targetId);
        }
    }

    std::unordered_set<int> acceptStates;
    for (size_t dfaId = 0; dfaId < stateSets.size(); ++dfaId) {
        accountWork(budget, stateSets[dfaId].size());
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
}  // namespace

Automaton subsetConstruction(const Automaton& nfa, const SubsetConstructionLimits& limits) {
    const std::optional<Automaton> dfa = subsetConstructionBounded(nfa, limits);
    if (!dfa) {
        throw AutomatonTooComplexError(
            "DFA determinization exceeded its safety limits of " +
            std::to_string(limits.maxDfaStates) + " states or " +
            std::to_string(limits.maxWorkUnits) + " work units.");
    }
    return *dfa;
}

std::optional<Automaton> subsetConstructionBounded(
    const Automaton& nfa, const SubsetConstructionLimits& limits) {
    if (limits.maxDfaStates == 0) return std::nullopt;
    WorkBudget budget{limits.maxWorkUnits};
    try {
        return subsetConstructionImpl(nfa, &budget, limits.maxDfaStates);
    } catch (const BudgetExceeded&) {
        return std::nullopt;
    }
}

namespace {
std::vector<int> sortedStates(const std::unordered_set<int>& states) {
    std::vector<int> result(states.begin(), states.end());
    std::sort(result.begin(), result.end());
    return result;
}
}  // namespace

TracedSubsetConstruction subsetConstructionTraced(
    const Automaton& nfa, const SubsetConstructionLimits& limits, std::size_t maxTraceSteps) {
    if (limits.maxDfaStates == 0) {
        throw AutomatonTooComplexError("Growth Lab determinization requires room for at least one DFA state.");
    }
    WorkBudget budget{limits.maxWorkUnits};
    try {
        std::vector<std::string> alphabet = alphabetOf(nfa, &budget);

        std::vector<std::unordered_set<int>> stateSets;
        std::unordered_map<std::string, int> idBySetKey;
        std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions;
        std::vector<SubsetConstructionStep> steps;

        auto idFor = [&](const std::unordered_set<int>& nfaStateSet) -> std::pair<int, bool> {
            std::string key = setKey(nfaStateSet, &budget);
            auto it = idBySetKey.find(key);
            if (it != idBySetKey.end()) return {it->second, false};
            if (stateSets.size() >= limits.maxDfaStates) throw BudgetExceeded{"DFA-state limit exceeded"};
            int id = static_cast<int>(stateSets.size());
            idBySetKey[key] = id;
            stateSets.push_back(nfaStateSet);
            return {id, true};
        };

        int startState = idFor(epsilonClosure(nfa, {nfa.startState}, &budget)).first;

        std::unordered_set<int> processed;
        std::vector<int> worklist = {startState};

        while (!worklist.empty()) {
            int current = worklist.back();
            worklist.pop_back();
            if (processed.count(current)) continue;
            processed.insert(current);

            for (const std::string& symbol : alphabet) {
                accountWork(&budget);
                const std::unordered_set<int> sourceNfaStates = stateSets[current];
                std::unordered_set<int> moved = move(nfa, sourceNfaStates, symbol, &budget);
                if (moved.empty()) continue;

                std::unordered_set<int> closure = epsilonClosure(nfa, moved, &budget);
                auto [targetId, isNew] = idFor(closure);
                accountWork(&budget, closure.size());
                bool isAccepting = false;
                for (int state : closure) {
                    if (nfa.acceptStates.count(state)) {
                        isAccepting = true;
                        break;
                    }
                }
                if (steps.size() >= maxTraceSteps) throw BudgetExceeded{"subset-trace step limit exceeded"};

                SubsetConstructionStep step;
                step.sourceId = current;
                step.sourceNfaStates = sortedStates(sourceNfaStates);
                step.symbol = symbol;
                step.moveNfaStates = sortedStates(moved);
                step.closureNfaStates = sortedStates(closure);
                step.targetId = targetId;
                step.isNew = isNew;
                step.isAccepting = isAccepting;
                steps.push_back(std::move(step));

                transitions[current][symbol] = {targetId};
                if (!processed.count(targetId)) worklist.push_back(targetId);
            }
        }

        std::unordered_set<int> acceptStates;
        for (size_t dfaId = 0; dfaId < stateSets.size(); ++dfaId) {
            accountWork(&budget, stateSets[dfaId].size());
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

        SubsetTrace trace;
        trace.steps = std::move(steps);
        trace.subsetCount = dfa.stateCount;
        return TracedSubsetConstruction{std::move(dfa), std::move(trace)};
    } catch (const BudgetExceeded& error) {
        throw AutomatonTooComplexError(
            std::string("Growth Lab subset construction stopped safely: ") + error.message + ".");
    }
}

}  // namespace regexlab

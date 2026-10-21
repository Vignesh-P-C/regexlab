// engine/automaton-metrics.cpp — issue #68. C++ port of
// engine/automaton-metrics.ts. See that file's header comment for the
// exact definitions ("trim", "alphabet size", etc.) — identical here.

#include "regexlab/automaton-metrics.hpp"

#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace regexlab {

namespace {

std::unordered_set<int> forwardReachable(const Automaton& nfa, int from) {
    std::unordered_set<int> seen{from};
    std::vector<int> stack{from};
    while (!stack.empty()) {
        int state = stack.back();
        stack.pop_back();
        auto it = nfa.transitions.find(state);
        if (it == nfa.transitions.end()) continue;
        for (const auto& [symbol, targets] : it->second) {
            for (int target : targets) {
                if (seen.insert(target).second) stack.push_back(target);
            }
        }
    }
    return seen;
}

/** Every state that can reach some state in `targetsOfInterest`, via the reverse graph. */
std::unordered_set<int> canReach(const Automaton& nfa, const std::unordered_set<int>& targetsOfInterest) {
    std::unordered_map<int, std::vector<int>> reverse;
    for (const auto& [source, bySymbol] : nfa.transitions) {
        for (const auto& [symbol, targets] : bySymbol) {
            for (int target : targets) reverse[target].push_back(source);
        }
    }
    std::unordered_set<int> seen(targetsOfInterest);
    std::vector<int> stack(targetsOfInterest.begin(), targetsOfInterest.end());
    while (!stack.empty()) {
        int state = stack.back();
        stack.pop_back();
        auto it = reverse.find(state);
        if (it == reverse.end()) continue;
        for (int pred : it->second) {
            if (seen.insert(pred).second) stack.push_back(pred);
        }
    }
    return seen;
}

}  // namespace

AutomatonMetrics computeAutomatonMetrics(const Automaton& automaton) {
    std::unordered_set<int> reachable = forwardReachable(automaton, automaton.startState);
    std::unordered_set<int> reachesAccept = canReach(automaton, automaton.acceptStates);

    int trimCount = 0;
    for (int state : reachable) {
        if (reachesAccept.count(state)) trimCount++;
    }

    int epsilonEdgeCount = 0;
    int consumingEdgeCount = 0;
    std::unordered_set<std::string> alphabet;

    for (const auto& [state, bySymbol] : automaton.transitions) {
        for (const auto& [symbol, targets] : bySymbol) {
            std::unordered_set<int> distinctTargets(targets.begin(), targets.end());
            if (symbol == "eps") {
                epsilonEdgeCount += static_cast<int>(distinctTargets.size());
            } else {
                consumingEdgeCount += static_cast<int>(distinctTargets.size());
                alphabet.insert(symbol);
            }
        }
    }

    AutomatonMetrics m;
    m.rawStateCount = automaton.stateCount;
    m.reachableStateCount = static_cast<int>(reachable.size());
    m.trimStateCount = trimCount;
    m.epsilonEdgeCount = epsilonEdgeCount;
    m.consumingEdgeCount = consumingEdgeCount;
    m.totalTransitionCount = epsilonEdgeCount + consumingEdgeCount;
    m.alphabetSize = static_cast<int>(alphabet.size());
    return m;
}

PowersetCeiling computePowersetCeiling(int nfaStateCount) {
    int exponent = std::max(0, nfaStateCount);

    // Manual arbitrary-precision 2^n: start the decimal digit string at
    // "1" and double it `exponent` times, digit by digit with carry —
    // the same by-hand algorithm you'd use on paper. This is the
    // overflow-safe requirement from the MD (§7.3): a plain int64_t
    // overflows 2^n once n exceeds 63, which the existing 500-char
    // pattern-length guard makes routine, not exceptional.
    std::vector<int> digits{1};  // digits[0] is the ONES place
    for (int step = 0; step < exponent; ++step) {
        int carry = 0;
        for (int& d : digits) {
            int doubled = d * 2 + carry;
            d = doubled % 10;
            carry = doubled / 10;
        }
        if (carry > 0) digits.push_back(carry);
    }

    std::string decimal(digits.size(), '0');
    for (size_t i = 0; i < digits.size(); ++i) {
        decimal[digits.size() - 1 - i] = static_cast<char>('0' + digits[i]);
    }

    PowersetCeiling result;
    result.exponent = exponent;
    result.exactDecimal = decimal;
    return result;
}

}  // namespace regexlab

// engine/equivalence.cpp — issue #68. C++ port of engine/equivalence.ts.
// See that file's header comment for the full algorithm explanation
// (product BFS over two completed DFAs) — identical here.

#include "regexlab/equivalence.hpp"

#include <algorithm>
#include <deque>
#include <optional>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

#include "regexlab/passes/subset-construction-pass.hpp"

namespace regexlab {

namespace {

std::vector<std::string> alphabetOfDfa(const Automaton& dfa) {
    std::unordered_set<std::string> symbols;
    for (const auto& [state, bySymbol] : dfa.transitions) {
        for (const auto& [symbol, targets] : bySymbol) symbols.insert(symbol);
    }
    return std::vector<std::string>(symbols.begin(), symbols.end());
}

/** `dfa` plus one rejecting sink state, with every (state, symbol) in
 *  `alphabet` given an explicit transition. Does not mutate `dfa`. */
Automaton completeWithSink(const Automaton& dfa, const std::vector<std::string>& alphabet) {
    int sinkId = dfa.stateCount;
    Automaton completed = dfa;  // value-type copy, independent of `dfa`
    completed.stateCount = dfa.stateCount + 1;

    for (int state = 0; state < dfa.stateCount; ++state) {
        auto& bySymbol = completed.transitions[state];  // creates the row if absent
        for (const std::string& symbol : alphabet) {
            if (bySymbol.find(symbol) == bySymbol.end()) {
                bySymbol[symbol] = {sinkId};
            }
        }
    }
    auto& sinkRow = completed.transitions[sinkId];
    for (const std::string& symbol : alphabet) sinkRow[symbol] = {sinkId};
    // sink is never accepting — completed.acceptStates already excludes it
    // since it's a copy of dfa.acceptStates.

    return completed;
}

std::string pairKey(int b, int c) { return std::to_string(b) + "," + std::to_string(c); }

}  // namespace

EquivalenceResult checkEquivalence(const Automaton& baselineNfa, const Automaton& candidateNfa, int budget) {
    Automaton baselineDfa = subsetConstruction(baselineNfa);
    Automaton candidateDfa = subsetConstruction(candidateNfa);

    std::unordered_set<std::string> alphabetSet;
    for (const auto& s : alphabetOfDfa(baselineDfa)) alphabetSet.insert(s);
    for (const auto& s : alphabetOfDfa(candidateDfa)) alphabetSet.insert(s);
    std::vector<std::string> unionAlphabet(alphabetSet.begin(), alphabetSet.end());
    std::sort(unionAlphabet.begin(), unionAlphabet.end());

    Automaton baseline = completeWithSink(baselineDfa, unionAlphabet);
    Automaton candidate = completeWithSink(candidateDfa, unionAlphabet);

    struct Parent {
        std::string from;
        std::string symbol;
        bool hasParent;
    };
    std::unordered_map<std::string, Parent> parent;

    struct QueueEntry {
        int b, c;
        std::string key;
    };
    std::string startKey = pairKey(baseline.startState, candidate.startState);
    parent[startKey] = Parent{"", "", false};

    std::deque<QueueEntry> queue;
    queue.push_back(QueueEntry{baseline.startState, candidate.startState, startKey});
    std::unordered_set<std::string> enqueued{startKey};

    int visited = 0;

    auto reconstructWord = [&](const std::string& key) -> std::string {
        std::vector<std::string> symbols;
        std::string cursor = key;
        while (true) {
            auto it = parent.find(cursor);
            if (it == parent.end() || !it->second.hasParent) break;
            symbols.push_back(it->second.symbol);
            cursor = it->second.from;
        }
        std::reverse(symbols.begin(), symbols.end());
        std::ostringstream oss;
        for (const auto& s : symbols) oss << s;
        return oss.str();
    };

    while (!queue.empty()) {
        QueueEntry entry = queue.front();
        queue.pop_front();
        visited++;
        if (visited > budget) {
            EquivalenceResult result;
            result.status = EquivalenceStatus::Inconclusive;
            result.reason = "Resource limit reached: more than " + std::to_string(budget) +
                             " product states visited before the search completed.";
            return result;
        }

        bool bAccept = baseline.acceptStates.count(entry.b) > 0;
        bool cAccept = candidate.acceptStates.count(entry.c) > 0;
        if (bAccept != cAccept) {
            std::string word = reconstructWord(entry.key);
            EquivalenceResult result;
            result.status = EquivalenceStatus::Different;
            result.witness = EquivalenceWitness{word, word.empty(), bAccept, cAccept};
            return result;
        }

        for (const std::string& symbol : unionAlphabet) {
            int nextB = baseline.transitions.at(entry.b).at(symbol)[0];
            int nextC = candidate.transitions.at(entry.c).at(symbol)[0];
            std::string nextKey = pairKey(nextB, nextC);
            if (enqueued.find(nextKey) == enqueued.end()) {
                enqueued.insert(nextKey);
                parent[nextKey] = Parent{entry.key, symbol, true};
                queue.push_back(QueueEntry{nextB, nextC, nextKey});
            }
        }
    }

    EquivalenceResult result;
    result.status = EquivalenceStatus::Equivalent;
    return result;
}

}  // namespace regexlab

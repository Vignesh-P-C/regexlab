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

/**
 * Alphabet equivalence-class compression (added for issue #64 follow-up).
 *
 * refine()'s per-state "signature" loops over every symbol in the alphabet,
 * so each fixpoint round costs O(n * k) where k = alphabet.size(). Extended
 * syntax (character classes, `.`, shorthand classes) desugars into one DFA
 * symbol per matching ASCII code during subset construction, so k can now be
 * as large as 126 (`.`) instead of the ~1 symbol a plain literal pattern
 * produced before this grammar existed — and refine() runs up to n times to
 * reach the fixpoint, so the real cost is O(n^2 * k).
 *
 * The fix: two symbols that lead every state to the same destination are
 * interchangeable as far as refine()'s signature is concerned — including
 * both in a signature adds the same value twice, which can never cause an
 * extra split. So before refining, group the alphabet into equivalence
 * classes where symbols a and b are in the same class iff
 * transition(s, a) == transition(s, b) for every state s (the "transition
 * column" for a and b is identical). Only one representative per class is
 * needed to build a signature that is informationally identical to using
 * the full alphabet — dropping the duplicates never changes which states
 * end up in the same bucket, so the final partition (and therefore the
 * minimized DFA) is unaffected. A `.`-repeated pattern collapses its whole
 * 126-symbol alphabet into a single class (every symbol sends every state
 * to the same next state), so refine() becomes O(n^2 * 1) instead of
 * O(n^2 * 126) for exactly the case that used to be slow.
 *
 * Picking the lexicographically-first symbol in each class as its
 * representative (alphabet is pre-sorted) keeps this deterministic.
 */
std::vector<std::string> representativeAlphabetOf(const Automaton& dfa, const std::vector<std::string>& alphabet,
                                                    int stateCount) {
    std::unordered_set<std::string> seenKeys;
    std::vector<std::string> representatives;

    for (const std::string& symbol : alphabet) {
        std::ostringstream column;
        for (int state = 0; state < stateCount; ++state) {
            if (state > 0) column << ",";
            auto stateIt = dfa.transitions.find(state);
            bool found = false;
            if (stateIt != dfa.transitions.end()) {
                auto symIt = stateIt->second.find(symbol);
                if (symIt != stateIt->second.end() && !symIt->second.empty()) {
                    column << symIt->second[0];
                    found = true;
                }
            }
            if (!found) column << "-";
        }
        std::string key = column.str();
        if (seenKeys.insert(key).second) representatives.push_back(symbol);
    }

    return representatives;
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

Automaton minimize(const Automaton& dfa, const MinimizationLimits& limits) {
    if (dfa.stateCount < 0 || static_cast<std::size_t>(dfa.stateCount) > limits.maxDfaStates) {
        throw AutomatonTooComplexError(
            "DFA minimization received " + std::to_string(dfa.stateCount) +
            " states, above its safety limit of " + std::to_string(limits.maxDfaStates) + ".");
    }

    std::vector<std::string> alphabet = alphabetOf(dfa);
    std::vector<std::string> representatives = representativeAlphabetOf(dfa, alphabet, dfa.stateCount);

    // refine()'s per-state signature loop runs once per fixpoint round (up
    // to stateCount rounds), so its real cost is stateCount^2 * alphabetSize
    // — fine for a handful of symbols, not fine for a `.`-heavy pattern
    // whose alphabet is however many distinct ASCII codes its character
    // classes cover (up to 126). Alphabet compression (above) usually
    // drives that down to ~1 for a single repeated class, but a pattern can
    // still be constructed where every symbol's transition column really is
    // distinct (e.g. a long concatenation of distinct single-character
    // literals) — for that adversarial shape, compression buys nothing and
    // the cost is still stateCount^2 * alphabetSize.
    //
    // This check is a backstop against that shape, not the primary fix —
    // the primary fix is the compression above, which is why the estimate
    // uses representatives.size() (the alphabet size AFTER compression),
    // not alphabet.size(). Derivation of the default budget
    // (MinimizationLimits::maxWorkUnits): the engine's alphabet is
    // ASCII-only (at most 128 symbols, CLAUDE.md §10), so even the
    // fully-adversarial case can't push alphabetSize past 128. Measured on
    // the WASM build pre-compression (Stage 1 of the issue #64 follow-up
    // review): stateCount=501, alphabetSize=126 (a `.` x500 chain) cost
    // ~6793ms, i.e. ~4637 (stateCount^2 * alphabetSize) units per
    // millisecond. Capping worst-case synchronous blocking at ~2s on that
    // same hardware gives 2000ms * 4637 ~= 9.27M; rounded down to
    // 10,000,000 for margin. This is restored from main's own measured
    // value — a prior revision of this pass silently halved it to
    // 5,000,000 with no re-derivation, which would reject a legitimate,
    // moderately-complex pattern well within the fully-adversarial case
    // this budget is sized for (e.g. stateCount~300, alphabetSize~60 costs
    // 5.4M, comfortably under 10M but over 5M). Post-compression, the `.`
    // x500 case now costs 500^2 * 1 = 250,000 work units — far under the
    // budget — while a 128-symbol, zero-compression, 500-state adversarial
    // case (500^2 * 128 = 32,000,000) is still caught well before it would
    // run.
    const unsigned long long work = static_cast<unsigned long long>(dfa.stateCount) *
                                     static_cast<unsigned long long>(dfa.stateCount) *
                                     static_cast<unsigned long long>(representatives.size());
    if (work > static_cast<unsigned long long>(limits.maxWorkUnits)) {
        throw AutomatonTooComplexError(
            "DFA minimization exceeded its safety limit of " +
            std::to_string(limits.maxWorkUnits) + " work units.");
    }

    std::vector<int> allStates(dfa.stateCount);
    for (int i = 0; i < dfa.stateCount; ++i) allStates[i] = i;

    std::vector<int> accepting, nonAccepting;
    for (int state : allStates) {
        if (dfa.acceptStates.count(state)) accepting.push_back(state);
        else nonAccepting.push_back(state);
    }

    // Coarsest safe starting partition: non-accepting vs accepting (skip empty groups).
    std::vector<std::vector<int>> groups;
    if (!nonAccepting.empty()) groups.push_back(nonAccepting);
    if (!accepting.empty()) groups.push_back(accepting);

    // Fixpoint: keep refining until a full pass produces zero splits. Uses
    // the compressed representative list, not the full alphabet — see
    // representativeAlphabetOf's comment for why that's sound.
    bool changed = true;
    while (changed) {
        RefineResult result = refine(groups, dfa, representatives);
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

        // Uses the FULL alphabet, not the compressed representatives — the
        // minimized DFA's own transition table still needs an entry for
        // every symbol that had one; representatives are only ever a
        // shortcut for computing the partition, not part of the output.
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

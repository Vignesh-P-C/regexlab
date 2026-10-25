// C++ Thompson construction; fragment allocation order mirrors the TS pass.
#include "regexlab/passes/thompson-pass.hpp"
#include "regexlab/character-set.hpp"
#include <type_traits>
#include <cstddef>
#include <utility>
#include <vector>
namespace regexlab {
namespace {
struct Fragment {
    int start;
    int accept;
    std::vector<int> inlineExits;

    Fragment(int startState, int acceptState, std::vector<int> exits = {})
        : start(startState), accept(acceptState), inlineExits(std::move(exits)) {}
};
constexpr std::size_t kMaxNfaStates = 2048;

std::size_t cappedAdd(std::size_t left, std::size_t right) {
    if (left > kMaxNfaStates || right > kMaxNfaStates - left) return kMaxNfaStates + 1;
    return left + right;
}

std::size_t cappedDouble(std::size_t value) {
    return value > kMaxNfaStates / 2 ? kMaxNfaStates + 1 : value * 2;
}

std::size_t estimateStateCount(const ASTNodePtr& node, bool inlineTerminalPlus = false) {
    if (!node) return kMaxNfaStates + 1;
    return std::visit([&](auto&& n) -> std::size_t {
        using T = std::decay_t<decltype(n)>;
        if constexpr (std::is_same_v<T, CharNode> || std::is_same_v<T, CharacterSetNode>) {
            return 2;
        } else if constexpr (std::is_same_v<T, ConcatNode>) {
            return cappedAdd(estimateStateCount(n.left, true),
                             estimateStateCount(n.right, inlineTerminalPlus));
        } else if constexpr (std::is_same_v<T, AltNode>) {
            return cappedAdd(cappedAdd(estimateStateCount(n.left), estimateStateCount(n.right)), 2);
        } else if constexpr (std::is_same_v<T, StarNode> || std::is_same_v<T, OptionalNode>) {
            return cappedAdd(estimateStateCount(n.child), 2);
        } else {
            return cappedAdd(cappedDouble(estimateStateCount(n.child)), inlineTerminalPlus ? 0 : 1);
        }
    }, node->node);
}

class NFABuilder {
public:
    int newState() { return stateCount_++; }
    void addTransition(int from, const std::string& symbol, int to) { transitions_[from][symbol].push_back(to); }
    Automaton build(int start, int accept) {
        Automaton nfa; nfa.stateCount = stateCount_; nfa.startState = start; nfa.acceptStates = {accept}; nfa.transitions = transitions_; return nfa;
    }
private:
    int stateCount_ = 0;
    std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions_;
};
Fragment buildFragment(const ASTNodePtr& node, NFABuilder& b, bool inlineTerminalPlus = false) {
    Fragment result{0, 0};
    std::visit([&](auto&& n) {
        using T = std::decay_t<decltype(n)>;
        if constexpr (std::is_same_v<T, CharNode>) {
            int s = b.newState(), f = b.newState(); b.addTransition(s, std::string(1, n.value), f); result = {s, f};
        } else if constexpr (std::is_same_v<T, CharacterSetNode>) {
            int s = b.newState(), f = b.newState(); if (!n.characters.empty()) b.addTransition(s, encodeCharacterSet(n.characters), f); result = {s, f};
        } else if constexpr (std::is_same_v<T, ConcatNode>) {
            auto l = buildFragment(n.left, b, true), r = buildFragment(n.right, b, inlineTerminalPlus);
            if (l.inlineExits.empty()) b.addTransition(l.accept, "eps", r.start);
            else for (int exit : l.inlineExits) b.addTransition(exit, "eps", r.start);
            result = {l.start, r.accept, r.inlineExits};
        } else if constexpr (std::is_same_v<T, AltNode>) {
            auto l = buildFragment(n.left, b), r = buildFragment(n.right, b); int s = b.newState(), f = b.newState();
            b.addTransition(s, "eps", l.start); b.addTransition(s, "eps", r.start); b.addTransition(l.accept, "eps", f); b.addTransition(r.accept, "eps", f); result = {s, f};
        } else if constexpr (std::is_same_v<T, StarNode>) {
            auto in = buildFragment(n.child, b); int s = b.newState(), f = b.newState();
            b.addTransition(s, "eps", in.start); b.addTransition(s, "eps", f); b.addTransition(in.accept, "eps", in.start); b.addTransition(in.accept, "eps", f); result = {s, f};
        } else if constexpr (std::is_same_v<T, PlusNode>) {
            auto first = buildFragment(n.child, b), repeated = buildFragment(n.child, b);
            b.addTransition(first.accept, "eps", repeated.start);
            b.addTransition(repeated.accept, "eps", repeated.start);
            if (inlineTerminalPlus) result = {first.start, repeated.accept, {first.accept, repeated.accept}};
            else {
                int f = b.newState();
                b.addTransition(first.accept, "eps", f); b.addTransition(repeated.accept, "eps", f);
                result = {first.start, f};
            }
        } else if constexpr (std::is_same_v<T, OptionalNode>) {
            auto in = buildFragment(n.child, b); int s = b.newState(), f = b.newState();
            b.addTransition(s, "eps", in.start); b.addTransition(s, "eps", f); b.addTransition(in.accept, "eps", f); result = {s, f};
        }
    }, node->node);
    return result;
}
}
Automaton thompsonConstruction(const ASTNodePtr& ast) {
    const std::size_t estimatedStates = estimateStateCount(ast);
    if (estimatedStates > kMaxNfaStates) {
        throw AutomatonTooComplexError(
            "Thompson construction would exceed the safe limit of 2,048 NFA states.");
    }
    NFABuilder builder; auto fragment = buildFragment(ast, builder); return builder.build(fragment.start, fragment.accept);
}
}

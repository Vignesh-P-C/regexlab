// C++ Thompson construction; fragment allocation order mirrors the TS pass.
#include "regexlab/passes/thompson-pass.hpp"
#include "regexlab/character-set.hpp"
#include <type_traits>
namespace regexlab {
namespace {
struct Fragment { int start; int accept; };
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
Fragment buildFragment(const ASTNodePtr& node, NFABuilder& b) {
    Fragment result{0, 0};
    std::visit([&](auto&& n) {
        using T = std::decay_t<decltype(n)>;
        if constexpr (std::is_same_v<T, CharNode>) {
            int s = b.newState(), f = b.newState(); b.addTransition(s, std::string(1, n.value), f); result = {s, f};
        } else if constexpr (std::is_same_v<T, CharacterSetNode>) {
            int s = b.newState(), f = b.newState(); if (!n.characters.empty()) b.addTransition(s, encodeCharacterSet(n.characters), f); result = {s, f};
        } else if constexpr (std::is_same_v<T, ConcatNode>) {
            auto l = buildFragment(n.left, b), r = buildFragment(n.right, b); b.addTransition(l.accept, "eps", r.start); result = {l.start, r.accept};
        } else if constexpr (std::is_same_v<T, AltNode>) {
            auto l = buildFragment(n.left, b), r = buildFragment(n.right, b); int s = b.newState(), f = b.newState();
            b.addTransition(s, "eps", l.start); b.addTransition(s, "eps", r.start); b.addTransition(l.accept, "eps", f); b.addTransition(r.accept, "eps", f); result = {s, f};
        } else if constexpr (std::is_same_v<T, StarNode>) {
            auto in = buildFragment(n.child, b); int s = b.newState(), f = b.newState();
            b.addTransition(s, "eps", in.start); b.addTransition(s, "eps", f); b.addTransition(in.accept, "eps", in.start); b.addTransition(in.accept, "eps", f); result = {s, f};
        } else if constexpr (std::is_same_v<T, PlusNode>) {
            auto in = buildFragment(n.child, b); int s = b.newState(), f = b.newState();
            b.addTransition(s, "eps", in.start); b.addTransition(in.accept, "eps", in.start); b.addTransition(in.accept, "eps", f); result = {s, f};
        } else if constexpr (std::is_same_v<T, OptionalNode>) {
            auto in = buildFragment(n.child, b); int s = b.newState(), f = b.newState();
            b.addTransition(s, "eps", in.start); b.addTransition(s, "eps", f); b.addTransition(in.accept, "eps", f); result = {s, f};
        }
    }, node->node);
    return result;
}
}
Automaton thompsonConstruction(const ASTNodePtr& ast) {
    NFABuilder builder; auto fragment = buildFragment(ast, builder); return builder.build(fragment.start, fragment.accept);
}
}

// engine/passes/thompson-pass.cpp
//
// Direct C++ port of thompson-pass.ts. Same construction rules, same
// fragment invariant, same state-numbering order (left subtree before
// right subtree, inner before wrapper) — this ordering is what makes the
// ported golden test values (exact state IDs) match the TS version.
//
// TS used a switch on node.kind; C++'s equivalent for a std::variant is
// std::visit with `if constexpr` per alternative type.
//
// Grammar v1 additions (issue #60, docs/regex-grammar-v1.md): see
// thompson-pass.ts's header comment for the full rationale behind the
// CharacterSetNode/PlusNode/OptionalNode fragment rules below — this file
// mirrors them exactly, one `if constexpr` branch per new AST node kind.

#include "regexlab/passes/thompson-pass.hpp"
#include "regexlab/character-set.hpp"

#include <type_traits>

namespace regexlab {

namespace {

/** A fragment under construction: exactly one start state, one accept state. */
struct Fragment {
    int start;
    int accept;
};

class NFABuilder {
public:
    int newState() { return stateCount_++; }

    void addTransition(int from, const std::string& symbol, int to) {
        transitions_[from][symbol].push_back(to);
    }

    Automaton build(int startState, int acceptState) {
        Automaton nfa;
        nfa.stateCount = stateCount_;
        nfa.startState = startState;
        nfa.acceptStates = {acceptState};
        nfa.transitions = transitions_;
        return nfa;
    }

private:
    int stateCount_ = 0;
    std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions_;
};

Fragment buildFragment(const ASTNodePtr& node, NFABuilder& builder) {
    Fragment result{0, 0};

    std::visit(
        [&](auto&& n) {
            using T = std::decay_t<decltype(n)>;

            if constexpr (std::is_same_v<T, CharNode>) {
                int start = builder.newState();
                int accept = builder.newState();
                builder.addTransition(start, std::string(1, n.value), accept);
                result = Fragment{start, accept};

            } else if constexpr (std::is_same_v<T, CharacterSetNode>) {
                // One fragment, one edge, for the whole ASCII set — see
                // thompson-pass.ts's header comment. An empty set can't
                // actually occur (the parser rejects it as
                // InvalidCharacterClass before this pass ever runs), but
                // this still degrades safely to a dead-end fragment if it
                // did: no transition added, so nothing can traverse it.
                int start = builder.newState();
                int accept = builder.newState();
                if (!n.characters.empty()) {
                    builder.addTransition(start, encodeCharacterSet(n.characters), accept);
                }
                result = Fragment{start, accept};

            } else if constexpr (std::is_same_v<T, ConcatNode>) {
                Fragment left = buildFragment(n.left, builder);
                Fragment right = buildFragment(n.right, builder);
                builder.addTransition(left.accept, "eps", right.start);
                result = Fragment{left.start, right.accept};

            } else if constexpr (std::is_same_v<T, AltNode>) {
                Fragment left = buildFragment(n.left, builder);
                Fragment right = buildFragment(n.right, builder);
                int start = builder.newState();
                int accept = builder.newState();
                builder.addTransition(start, "eps", left.start);
                builder.addTransition(start, "eps", right.start);
                builder.addTransition(left.accept, "eps", accept);
                builder.addTransition(right.accept, "eps", accept);
                result = Fragment{start, accept};

            } else if constexpr (std::is_same_v<T, StarNode>) {
                Fragment inner = buildFragment(n.child, builder);
                int start = builder.newState();
                int accept = builder.newState();
                builder.addTransition(start, "eps", inner.start);
                builder.addTransition(start, "eps", accept);
                builder.addTransition(inner.accept, "eps", inner.start);
                builder.addTransition(inner.accept, "eps", accept);
                result = Fragment{start, accept};

            } else if constexpr (std::is_same_v<T, PlusNode>) {
                // "One or more": like star, but with NO skip edge from
                // start to accept — the inner fragment must be entered at
                // least once before the loop-back/exit choice applies.
                Fragment inner = buildFragment(n.child, builder);
                int start = builder.newState();
                int accept = builder.newState();
                builder.addTransition(start, "eps", inner.start);
                builder.addTransition(inner.accept, "eps", inner.start);
                builder.addTransition(inner.accept, "eps", accept);
                result = Fragment{start, accept};

            } else if constexpr (std::is_same_v<T, OptionalNode>) {
                // "Zero or one": like star's skip edge, but with NO
                // loop-back edge — once through the inner fragment, the
                // only way out is to accept.
                Fragment inner = buildFragment(n.child, builder);
                int start = builder.newState();
                int accept = builder.newState();
                builder.addTransition(start, "eps", inner.start);
                builder.addTransition(start, "eps", accept);
                builder.addTransition(inner.accept, "eps", accept);
                result = Fragment{start, accept};
            }
        },
        node->node);

    return result;
}

}  // namespace

Automaton thompsonConstruction(const ASTNodePtr& ast) {
    NFABuilder builder;
    Fragment fragment = buildFragment(ast, builder);
    return builder.build(fragment.start, fragment.accept);
}

}  // namespace regexlab

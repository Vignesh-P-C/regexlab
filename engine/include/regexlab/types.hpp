#pragma once
// regexlab/types.hpp
//
// Data contracts for the RegexLab engine — Track B (C++), ported 1:1 from
// CLAUDE.md v2 §7 (the TypeScript contracts). Keeping the shapes identical
// across both language tracks is deliberate: it's a real, citable design
// decision ("we validated the same contract in two languages"), and it means
// any golden test values already confirmed in the TypeScript version carry
// straight over.
//
// Nothing in this file implements a pass. It only defines the shapes that
// every pass (ParserPass, ThompsonPass, SubsetConstructionPass,
// MinimizationPass, MatcherPass) will consume and produce.

#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>

namespace regexlab {

// ============================================================
// AST  (mirrors TS: ASTNode = char | charset | concat | alt | star | plus | optional)
// ============================================================

struct ASTNode;
using ASTNodePtr = std::shared_ptr<ASTNode>;

struct CharNode {
    char value;
};

// A character class, `.`, a shorthand class (\d \w \s \D \W \S), or their
// negations — grammar v1 (issue #60) keeps all of these as ONE compact AST
// node holding the exact set of ASCII codes it matches, rather than
// exploding into one CharNode per matching character. `label` is the
// original surface syntax (e.g. "[a-z]", "\\w"), kept only for rendering —
// matching logic only ever looks at `characters`. See
// docs/regex-grammar-v1.md for the exact ASCII definitions.
struct CharacterSetNode {
    std::vector<int> characters;
    std::string label;
};

struct ConcatNode {
    ASTNodePtr left;
    ASTNodePtr right;
};

struct AltNode {
    ASTNodePtr left;
    ASTNodePtr right;
};

struct StarNode {
    ASTNodePtr child;
};

// `+` — "one or more". Its own AST node (not `child . child*` sugar) so
// ThompsonPass can build the textbook one-or-more fragment directly: enter
// the child once, loop back on completion, no skip edge. See
// thompson-pass.cpp's PlusNode case.
struct PlusNode {
    ASTNodePtr child;
};

// `?` — "zero or one". Its own AST node for the same reason as PlusNode:
// ThompsonPass builds a skip edge straight to accept alongside the normal
// entry edge. See thompson-pass.cpp's OptionalNode case.
struct OptionalNode {
    ASTNodePtr child;
};

struct ASTNode {
    std::variant<CharNode, CharacterSetNode, ConcatNode, AltNode, StarNode, PlusNode, OptionalNode> node;
};

// Small helper factories so call sites read like the TS object-literal style
// (e.g. regexlab::makeChar('a')) instead of raw variant construction.
inline ASTNodePtr makeChar(char value) {
    return std::make_shared<ASTNode>(ASTNode{CharNode{value}});
}
inline ASTNodePtr makeCharacterSet(std::vector<int> chars, std::string label) {
    return std::make_shared<ASTNode>(ASTNode{CharacterSetNode{std::move(chars), std::move(label)}});
}
inline ASTNodePtr makeConcat(ASTNodePtr left, ASTNodePtr right) {
    return std::make_shared<ASTNode>(ASTNode{ConcatNode{std::move(left), std::move(right)}});
}
inline ASTNodePtr makeAlt(ASTNodePtr left, ASTNodePtr right) {
    return std::make_shared<ASTNode>(ASTNode{AltNode{std::move(left), std::move(right)}});
}
inline ASTNodePtr makeStar(ASTNodePtr child) {
    return std::make_shared<ASTNode>(ASTNode{StarNode{std::move(child)}});
}
inline ASTNodePtr makePlus(ASTNodePtr child) {
    return std::make_shared<ASTNode>(ASTNode{PlusNode{std::move(child)}});
}
inline ASTNodePtr makeOptional(ASTNodePtr child) {
    return std::make_shared<ASTNode>(ASTNode{OptionalNode{std::move(child)}});
}

// ============================================================
// ParseError / ParseResult
// ============================================================

enum class ParseErrorType {
    UnmatchedParen,
    UnexpectedToken,
    EmptyGroup,
    DanglingOperator,
    // Guards against unbounded recursion — pathologically nested groups
    // (thousands of '(' in a row) or very long patterns would otherwise
    // overflow the call stack instead of failing gracefully. See the
    // nesting-depth and pattern-length limits in parser-pass.hpp/.cpp.
    PatternTooComplex,
    // A character class ([...]) that is syntactically present but
    // semantically invalid: empty ([] or [^]), or a descending range
    // (e.g. [z-a]). Reported at parse time, before any pass downstream
    // ever sees the class. See parser-pass.cpp's class-parsing code.
    InvalidCharacterClass,
    // Added for issue #64's follow-up: a safety net for MinimizationPass,
    // separate from PatternTooComplex. PatternTooComplex bounds the
    // *pattern* (length/nesting) before parsing; this bounds the *work*
    // Moore's refinement would do on the resulting DFA
    // (stateCount^2 * alphabetSize-after-compression), which extended
    // syntax can grow independently of pattern length — see
    // minimization-pass.cpp's work-budget check for exactly where this is
    // thrown and why the threshold is what it is.
    AutomatonTooComplex
};

struct ParseError {
    ParseErrorType type;
    int position;
    std::optional<std::string> expected;
    std::optional<std::string> found;
};

struct ParseResult {
    bool ok;
    ASTNodePtr ast;    // meaningful iff ok == true
    ParseError error;  // meaningful iff ok == false
};

// ============================================================
// Automaton  (shared shape for NFA, DFA, and min-DFA)
// States are ints, array-backed — matches the TS contract's explicit
// "O(1) access" design note.
// ============================================================

struct Automaton {
    int stateCount = 0;
    int startState = 0;
    std::unordered_set<int> acceptStates;
    // state -> (symbol | "eps" | "cs:" + 128-bit ASCII bitmap) -> [target states]
    //
    // The "cs:" form (see character-set.hpp) is how a CharacterSetNode's
    // whole ASCII set travels as ONE NFA edge instead of one edge per
    // matching character — ThompsonPass emits it directly (see
    // thompson-pass.cpp's CharacterSetNode case). SubsetConstructionPass
    // expands a "cs:" edge into one ordinary per-ASCII-character DFA
    // transition per matching code, so by the time an Automaton reaches
    // here as a DFA, every key is a single ASCII byte or "eps" — never a
    // "cs:" label. That expansion is also why a repeated `.` or `\w`
    // grows the DFA's *alphabet* (not just its state count) relative to a
    // plain-literal pattern, which is what MinimizationPass's alphabet
    // compression (see minimization-pass.cpp) exists to claw back.
    std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions;
};

// ============================================================
// MatchTrace  (drives the visualizer, frame by frame)
// ============================================================

struct MatchStep {
    char ch;
    std::vector<int> activeStates;
};

enum class MatchResultType { Match, NoMatch };

struct MatchTrace {
    std::vector<MatchStep> steps;
    MatchResultType result = MatchResultType::NoMatch;
    std::optional<int> failurePosition;
};

// ============================================================
// Pass interface
// Every pass implements this. name() exists specifically so error
// messages / logs / viva explanations can always name the algorithm,
// per CLAUDE.md v2 §0.1 rule 3.
// ============================================================

template <typename In, typename Out>
struct Pass {
    virtual ~Pass() = default;
    virtual std::string name() const = 0;
    virtual Out run(const In& input) = 0;
};

// ============================================================
// Equality operators — for golden-value testing only.
// TypeScript's `toEqual` performs structural equality automatically;
// C++ has no built-in equivalent, so these are defined explicitly,
// purely so the test suite can assert "does this AST/Automaton/etc.
// match the exact expected shape" the same way the TS golden tests do.
// Nothing in the actual passes depends on these.
// ============================================================

inline bool operator==(const CharNode& a, const CharNode& b) {
    return a.value == b.value;
}

inline bool operator==(const CharacterSetNode& a, const CharacterSetNode& b) {
    return a.characters == b.characters && a.label == b.label;
}

bool operator==(const ASTNode& a, const ASTNode& b);  // fwd decl — used recursively below

inline bool operator==(const ConcatNode& a, const ConcatNode& b) {
    return *a.left == *b.left && *a.right == *b.right;
}
inline bool operator==(const AltNode& a, const AltNode& b) {
    return *a.left == *b.left && *a.right == *b.right;
}
inline bool operator==(const StarNode& a, const StarNode& b) {
    return *a.child == *b.child;
}
inline bool operator==(const PlusNode& a, const PlusNode& b) {
    return *a.child == *b.child;
}
inline bool operator==(const OptionalNode& a, const OptionalNode& b) {
    return *a.child == *b.child;
}

inline bool operator==(const ASTNode& a, const ASTNode& b) {
    return a.node == b.node;
}

inline bool operator==(const ParseError& a, const ParseError& b) {
    return a.type == b.type && a.position == b.position &&
           a.expected == b.expected && a.found == b.found;
}

inline bool operator==(const ParseResult& a, const ParseResult& b) {
    if (a.ok != b.ok) return false;
    if (a.ok) return *a.ast == *b.ast;
    return a.error == b.error;
}

inline bool operator==(const MatchStep& a, const MatchStep& b) {
    return a.ch == b.ch && a.activeStates == b.activeStates;
}

inline bool operator==(const MatchTrace& a, const MatchTrace& b) {
    return a.steps == b.steps && a.result == b.result && a.failurePosition == b.failurePosition;
}

inline bool operator==(const Automaton& a, const Automaton& b) {
    return a.stateCount == b.stateCount && a.startState == b.startState &&
           a.acceptStates == b.acceptStates && a.transitions == b.transitions;
}

}  // namespace regexlab

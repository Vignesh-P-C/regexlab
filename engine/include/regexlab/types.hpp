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
// AST  (mirrors TS: ASTNode = char | concat | alt | star)
// ============================================================

struct ASTNode;
using ASTNodePtr = std::shared_ptr<ASTNode>;

struct CharNode {
    char value;
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

struct ASTNode {
    std::variant<CharNode, ConcatNode, AltNode, StarNode> node;
};

// Small helper factories so call sites read like the TS object-literal style
// (e.g. regexlab::makeChar('a')) instead of raw variant construction.
inline ASTNodePtr makeChar(char value) {
    return std::make_shared<ASTNode>(ASTNode{CharNode{value}});
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

// ============================================================
// ParseError / ParseResult
// ============================================================

enum class ParseErrorType {
    UnmatchedParen,
    UnexpectedToken,
    EmptyGroup,
    DanglingOperator
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
    // state -> (symbol | "eps") -> [target states]
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

}  // namespace regexlab

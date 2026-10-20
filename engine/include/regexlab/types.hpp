#pragma once
// Core RegexLab AST, parser results, automata, traces and pass interface.
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>
namespace regexlab {
struct ASTNode;
using ASTNodePtr = std::shared_ptr<ASTNode>;
struct CharNode { char value; };
struct CharacterSetNode { std::vector<int> characters; std::string label; };
struct ConcatNode { ASTNodePtr left; ASTNodePtr right; };
struct AltNode { ASTNodePtr left; ASTNodePtr right; };
struct StarNode { ASTNodePtr child; };
struct PlusNode { ASTNodePtr child; };
struct OptionalNode { ASTNodePtr child; };
struct ASTNode { std::variant<CharNode, CharacterSetNode, ConcatNode, AltNode, StarNode, PlusNode, OptionalNode> node; };
inline ASTNodePtr makeChar(char value) { return std::make_shared<ASTNode>(ASTNode{CharNode{value}}); }
inline ASTNodePtr makeCharacterSet(std::vector<int> chars, std::string label) { return std::make_shared<ASTNode>(ASTNode{CharacterSetNode{std::move(chars), std::move(label)}}); }
inline ASTNodePtr makeConcat(ASTNodePtr left, ASTNodePtr right) { return std::make_shared<ASTNode>(ASTNode{ConcatNode{std::move(left), std::move(right)}}); }
inline ASTNodePtr makeAlt(ASTNodePtr left, ASTNodePtr right) { return std::make_shared<ASTNode>(ASTNode{AltNode{std::move(left), std::move(right)}}); }
inline ASTNodePtr makeStar(ASTNodePtr child) { return std::make_shared<ASTNode>(ASTNode{StarNode{std::move(child)}}); }
inline ASTNodePtr makePlus(ASTNodePtr child) { return std::make_shared<ASTNode>(ASTNode{PlusNode{std::move(child)}}); }
inline ASTNodePtr makeOptional(ASTNodePtr child) { return std::make_shared<ASTNode>(ASTNode{OptionalNode{std::move(child)}}); }
enum class ParseErrorType { UnmatchedParen, UnexpectedToken, EmptyGroup, DanglingOperator, PatternTooComplex, InvalidCharacterClass };
struct ParseError { ParseErrorType type; int position; std::optional<std::string> expected; std::optional<std::string> found; };
struct ParseResult { bool ok; ASTNodePtr ast; ParseError error; };
struct Automaton {
    int stateCount = 0; int startState = 0; std::unordered_set<int> acceptStates;
    // Labels are one ASCII byte, "eps", or "cs:" plus a compact 128-bit ASCII set.
    std::unordered_map<int, std::unordered_map<std::string, std::vector<int>>> transitions;
};
struct MatchStep { char ch; std::vector<int> activeStates; };
enum class MatchResultType { Match, NoMatch };
struct MatchTrace { std::vector<MatchStep> steps; MatchResultType result = MatchResultType::NoMatch; std::optional<int> failurePosition; };
template <typename In, typename Out> struct Pass { virtual ~Pass() = default; virtual std::string name() const = 0; virtual Out run(const In& input) = 0; };
inline bool operator==(const CharNode& a, const CharNode& b) { return a.value == b.value; }
inline bool operator==(const CharacterSetNode& a, const CharacterSetNode& b) { return a.characters == b.characters && a.label == b.label; }
bool operator==(const ASTNode& a, const ASTNode& b);
inline bool operator==(const ConcatNode& a, const ConcatNode& b) { return *a.left == *b.left && *a.right == *b.right; }
inline bool operator==(const AltNode& a, const AltNode& b) { return *a.left == *b.left && *a.right == *b.right; }
inline bool operator==(const StarNode& a, const StarNode& b) { return *a.child == *b.child; }
inline bool operator==(const PlusNode& a, const PlusNode& b) { return *a.child == *b.child; }
inline bool operator==(const OptionalNode& a, const OptionalNode& b) { return *a.child == *b.child; }
inline bool operator==(const ASTNode& a, const ASTNode& b) { return a.node == b.node; }
inline bool operator==(const ParseError& a, const ParseError& b) { return a.type == b.type && a.position == b.position && a.expected == b.expected && a.found == b.found; }
inline bool operator==(const ParseResult& a, const ParseResult& b) { if (a.ok != b.ok) return false; if (a.ok) return *a.ast == *b.ast; return a.error == b.error; }
inline bool operator==(const MatchStep& a, const MatchStep& b) { return a.ch == b.ch && a.activeStates == b.activeStates; }
inline bool operator==(const MatchTrace& a, const MatchTrace& b) { return a.steps == b.steps && a.result == b.result && a.failurePosition == b.failurePosition; }
inline bool operator==(const Automaton& a, const Automaton& b) { return a.stateCount == b.stateCount && a.startState == b.startState && a.acceptStates == b.acceptStates && a.transitions == b.transitions; }
} // namespace regexlab

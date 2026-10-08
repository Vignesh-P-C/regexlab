// engine/passes/parser-pass.cpp
//
// Direct C++ port of parser-pass.ts. Same grammar, same recursive-descent
// structure, same precedence-via-call-chain, same left-associative
// alt/concat construction, same backslash-escape addition. Only the
// language changed — see parser-pass.ts's own header comment for the
// full design rationale (still applies unchanged).
//
// TS used exceptions (ParseFailure) caught once at the top of parse();
// this port keeps that exact structure, since it's the cleanest way to
// let every recursive helper "just throw on trouble" in C++ too.

#include "regexlab/passes/parser-pass.hpp"

#include <exception>

namespace regexlab {

namespace {

class ParseFailure : public std::exception {
public:
    explicit ParseFailure(ParseError error) : error_(std::move(error)) {}
    const ParseError& error() const { return error_; }
    const char* what() const noexcept override { return "parse failure"; }

private:
    ParseError error_;
};

class Parser {
public:
    // Two guards keep recursion bounded (limits come from ParseLimits):
    //
    //  - maxNestingDepth: bounds group nesting so thousands of '(' in a row
    //    fail as a normal ParseError instead of overflowing the call stack
    //    (reproduced: ~11-13k levels segfaults on an 8MB stack).
    //
    //  - maxPatternLength: the depth guard only counts '(' , but long chains
    //    of plain concatenation/alternation build equally deep ASTs (depth =
    //    pattern length) that recurse in the AST destructor, ThompsonPass and
    //    MinimizationPass. Measured on emcc 6.0.9 (Release, 5MB stack): a
    //    plain literal costs 0.24s at 500 chars and 0.80s at 1000 (Moore's
    //    minimization is O(n^2)), and every shape hits the JS call-stack
    //    ceiling by ~1500-3000 chars. 500 keeps the worst shape fast with
    //    ~3x margin under the lowest crash ceiling. See issue #29.
    Parser(const std::string& pattern, const ParseLimits& limits)
        : pattern_(pattern), limits_(limits) {}

    ParseResult parse() {
        try {
            if (pattern_.size() > static_cast<size_t>(limits_.maxPatternLength)) {
                throw ParseFailure(ParseError{
                    ParseErrorType::PatternTooComplex, limits_.maxPatternLength,
                    std::string("pattern length <= ") + std::to_string(limits_.maxPatternLength),
                    std::string("longer pattern")});
            }

            ASTNodePtr ast = parseRegex();

            if (pos_ < pattern_.size()) {
                char c = pattern_[pos_];
                if (c == ')') {
                    throw ParseFailure(ParseError{ParseErrorType::UnmatchedParen,
                                                   static_cast<int>(pos_),
                                                   std::string("end of input"),
                                                   std::string(1, ')')});
                }
                throw ParseFailure(ParseError{ParseErrorType::UnexpectedToken,
                                               static_cast<int>(pos_),
                                               std::string("end of input"),
                                               std::string(1, c)});
            }

            return ParseResult{true, ast, ParseError{}};
        } catch (const ParseFailure& failure) {
            return ParseResult{false, nullptr, failure.error()};
        }
    }

private:
    const std::string& pattern_;
    ParseLimits limits_;
    size_t pos_ = 0;
    int depth_ = 0;

    std::optional<char> peek() const {
        if (pos_ < pattern_.size()) return pattern_[pos_];
        return std::nullopt;
    }

    char advance() { return pattern_[pos_++]; }

    /**
     * The engine's alphabet is ASCII (bytes 0x00-0x7F). A byte >= 0x80 is
     * rejected where a literal would be consumed, so the leftmost error in
     * the pattern still wins (")\xC3\xA9" reports the dangling ')' first).
     *
     * `found` is a fixed description, never the raw byte: a lone byte of a
     * multi-byte UTF-8 sequence is invalid UTF-8 and made the JSON bridge
     * throw (nlohmann type_error.316) before this check existed. See D4.
     */
    void requireAscii(char c, size_t pos) const {
        if (static_cast<unsigned char>(c) >= 0x80) {
            throw ParseFailure(ParseError{ParseErrorType::UnexpectedToken,
                                           static_cast<int>(pos),
                                           std::string("an ASCII character"),
                                           std::string("non-ASCII character")});
        }
    }

    /** regex ::= term ('|' term)* */
    ASTNodePtr parseRegex() {
        ASTNodePtr node = parseTerm();
        while (peek() == '|') {
            advance();
            ASTNodePtr right = parseTerm();
            node = makeAlt(node, right);
        }
        return node;
    }

    /** term ::= factor+  (one or more factors, concatenated) */
    ASTNodePtr parseTerm() {
        ASTNodePtr node = parseFactor();
        while (canStartFactor()) {
            ASTNodePtr right = parseFactor();
            node = makeConcat(node, right);
        }
        return node;
    }

    /** Lookahead helper: could the next token legally start a new factor? */
    bool canStartFactor() const {
        auto c = peek();
        return c.has_value() && *c != '|' && *c != ')';
    }

    /** factor ::= atom quantifier?   (quantifier restricted to '*' in Core scope) */
    ASTNodePtr parseFactor() {
        ASTNodePtr atom = parseAtom();
        if (peek() == '*') {
            advance();
            return makeStar(atom);
        }
        return atom;
    }

    /**
     * atom ::= CHAR | '(' regex ')'
     * ('[' charclass ']' is Stretch B — not implemented yet, see types.hpp)
     */
    ASTNodePtr parseAtom() {
        auto c = peek();

        if (!c.has_value()) {
            throw ParseFailure(ParseError{ParseErrorType::UnexpectedToken,
                                           static_cast<int>(pos_),
                                           std::string("a character or '('"),
                                           std::string("end of input")});
        }

        if (*c == '(') {
            size_t openParenPos = pos_;
            advance();

            if (peek() == ')') {
                throw ParseFailure(ParseError{ParseErrorType::EmptyGroup,
                                               static_cast<int>(pos_),
                                               std::string("a pattern before ')'"),
                                               std::string(")")});
            }

            if (++depth_ > limits_.maxNestingDepth) {
                throw ParseFailure(ParseError{
                    ParseErrorType::PatternTooComplex, static_cast<int>(openParenPos),
                    std::string("nesting depth <= ") + std::to_string(limits_.maxNestingDepth),
                    std::string("deeper group nesting")});
            }
            ASTNodePtr inner = parseRegex();
            --depth_;

            if (peek() != ')') {
                std::string found =
                    peek().has_value() ? std::string(1, *peek()) : std::string("end of input");
                throw ParseFailure(ParseError{ParseErrorType::UnmatchedParen,
                                               static_cast<int>(openParenPos),
                                               std::string("')'"), found});
            }
            advance();  // consume ')'
            return inner;
        }

        if (*c == '|' || *c == '*' || *c == ')') {
            // An operator appearing where an atom was expected has nothing to
            // apply to — e.g. "*ab", "a||b", "a**" (second '*'), "()" handled above.
            throw ParseFailure(ParseError{ParseErrorType::DanglingOperator,
                                           static_cast<int>(pos_),
                                           std::string("a character or '('"),
                                           std::string(1, *c)});
        }

        if (*c == '\\') {
            size_t escapePos = pos_;
            advance();
            auto escaped = peek();
            if (!escaped.has_value()) {
                throw ParseFailure(ParseError{ParseErrorType::UnexpectedToken,
                                               static_cast<int>(escapePos),
                                               std::string("a character after '\\'"),
                                               std::string("end of input")});
            }
            requireAscii(*escaped, pos_);
            advance();
            return makeChar(*escaped);
        }

        requireAscii(*c, pos_);
        advance();
        return makeChar(*c);
    }
};

}  // namespace

ParseResult parse(const std::string& pattern, const ParseLimits& limits) {
    Parser parser(pattern, limits);
    return parser.parse();
}

}  // namespace regexlab

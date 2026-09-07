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
    explicit Parser(const std::string& pattern) : pattern_(pattern) {}

    ParseResult parse() {
        try {
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
    size_t pos_ = 0;

    std::optional<char> peek() const {
        if (pos_ < pattern_.size()) return pattern_[pos_];
        return std::nullopt;
    }

    char advance() { return pattern_[pos_++]; }

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

            ASTNodePtr inner = parseRegex();

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
            advance();
            return makeChar(*escaped);
        }

        advance();
        return makeChar(*c);
    }
};

}  // namespace

ParseResult parse(const std::string& pattern) {
    Parser parser(pattern);
    return parser.parse();
}

}  // namespace regexlab

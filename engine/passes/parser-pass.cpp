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
#include <algorithm>
#include <cctype>

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
    //    ~3x margin under the lowest crash ceiling. See issue #29. It applies
    //    to an all-ASCII prefix only — see exceedsLengthCap for why.
    Parser(const std::string& pattern, const ParseLimits& limits)
        : pattern_(pattern), limits_(limits) {}

    ParseResult parse() {
        try {
            if (exceedsLengthCap()) {
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

    std::optional<char> peek(size_t offset = 0) const {
        if (pos_ + offset < pattern_.size()) return pattern_[pos_ + offset];
        return std::nullopt;
    }

    char advance() { return pattern_[pos_++]; }

    /**
     * Does the length cap apply to this pattern?
     *
     * The cap counts units, and the two engines count different ones: C++
     * counts UTF-8 bytes, TS counts UTF-16 code units. Comparing a raw length
     * against the cap therefore diverged on non-ASCII input — "\xC3\xA9" x 300
     * is 600 bytes but 300 units: TS passed the length check then returned
     * UnexpectedToken@0, while the old C++ byte check returned
     * PatternTooComplex@500 before parsing (length cap: issue #29 / PR #33;
     * ASCII-only rule: issue #30).
     *
     * The fix is to apply the cap only to an all-ASCII prefix. Inside such a
     * prefix one byte is exactly one unit, so both engines measure the same
     * thing and the divergence disappears by construction.
     *
     * Skipping the cap is safe: positions 0..cap are then known to contain a
     * non-ASCII byte, and requireAscii rejects the first one the parser
     * reaches, so at most `cap` bytes are ever consumed and recursion stays
     * bounded no matter how long the rest of the pattern is. Verified in both
     * engines for literals, groups and escapes.
     *
     * Mirrors exceedsLengthCap in parser-pass.ts.
     */
    bool exceedsLengthCap() const {
        const size_t cap = static_cast<size_t>(limits_.maxPatternLength);
        if (pattern_.size() <= cap) return false;
        // pattern_.size() > cap, so indices 0..cap all exist.
        for (size_t i = 0; i <= cap; ++i) {
            if (static_cast<unsigned char>(pattern_[i]) >= 0x80) return false;
        }
        return true;
    }

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

    struct ClassAtom { std::vector<int> characters; bool singleton; };
    struct EscapeResult { ASTNodePtr node; ClassAtom atom; };

    static std::vector<int> range(int first, int last) {
        std::vector<int> values;
        for (int value = first; value <= last; ++value) values.push_back(value);
        return values;
    }

    /** factor ::= atom quantifier? */
    ASTNodePtr parseFactor() {
        ASTNodePtr child = parseAtom();
        auto q = peek();
        if (q == '*') { advance(); return makeStar(child); }
        if (q == '+') { advance(); return makePlus(child); }
        if (q == '?') { advance(); return makeOptional(child); }
        return child;
    }

    std::vector<int> shorthand(char c) const {
        switch (c) {
            case 'd': return range('0', '9');
            case 'w': {
                auto chars = range('A', 'Z'); auto digits = range('0', '9');
                chars.insert(chars.end(), digits.begin(), digits.end()); chars.push_back('_');
                auto lower = range('a', 'z'); chars.insert(chars.end(), lower.begin(), lower.end());
                std::sort(chars.begin(), chars.end()); return chars;
            }
            case 's': return {9, 10, 11, 12, 13, 32};
            case 'D': {
                auto chars = range(0, 127); auto excluded = range('0', '9');
                for (int c : excluded) chars.erase(std::remove(chars.begin(), chars.end(), c), chars.end());
                return chars;
            }
            case 'W': {
                auto chars = range(0, 127); auto excluded = shorthand('w');
                for (int c : excluded) chars.erase(std::remove(chars.begin(), chars.end(), c), chars.end());
                return chars;
            }
            case 'S': {
                auto chars = range(0, 127);
                for (int c : std::vector<int>{9, 10, 11, 12, 13, 32})
                    chars.erase(std::remove(chars.begin(), chars.end(), c), chars.end());
                return chars;
            }
            default: return {};
        }
    }

    bool isShorthand(char c) const {
        return c == 'd' || c == 'w' || c == 's' || c == 'D' || c == 'W' || c == 'S';
    }

    EscapeResult parseEscape() {
        size_t slash = pos_;
        advance();
        auto escaped = peek();
        if (!escaped.has_value()) {
            throw ParseFailure(ParseError{ParseErrorType::UnexpectedToken, static_cast<int>(slash),
                std::string("a character after '\\'"), std::string("end of input")});
        }
        requireAscii(*escaped, pos_);
        advance();
        if (isShorthand(*escaped)) {
            auto chars = shorthand(*escaped);
            return {makeCharacterSet(chars, std::string("\\") + *escaped), {chars, false}};
        }
        if (*escaped == 'x') {
            std::string digits = pattern_.substr(pos_, 2);
            if (digits.size() != 2 || !std::all_of(digits.begin(), digits.end(),
                    [](unsigned char c) { return std::isxdigit(c) != 0; })) {
                throw ParseFailure(ParseError{ParseErrorType::UnexpectedToken, static_cast<int>(slash),
                    std::string("two hex digits after '\\x'"),
                    digits.empty() ? std::string("end of input") : digits});
            }
            int code = std::stoi(digits, nullptr, 16);
            pos_ += 2;
            if (code > 127)
                throw ParseFailure(ParseError{ParseErrorType::UnexpectedToken, static_cast<int>(slash),
                    std::string("an ASCII escape"), std::string("non-ASCII character")});
            return {makeChar(static_cast<char>(code)), {{code}, true}};
        }
        int code = static_cast<unsigned char>(*escaped);
        switch (*escaped) {
            case 'n': code = 10; break; case 'r': code = 13; break; case 't': code = 9; break;
            case 'v': code = 11; break; case 'f': code = 12; break; default: break;
        }
        return {makeChar(static_cast<char>(code)), {{code}, true}};
    }

    ClassAtom parseClassAtom(size_t open) {
        if (!peek().has_value())
            throw ParseFailure(ParseError{ParseErrorType::InvalidCharacterClass, static_cast<int>(open),
                std::string("a closing ']'"), std::string("end of input")});
        if (peek() == '\\') return parseEscape().atom;
        char c = *peek();
        requireAscii(c, pos_);
        advance();
        return {{static_cast<unsigned char>(c)}, true};
    }

    ASTNodePtr parseCharacterClass() {
        size_t open = pos_;
        advance();
        bool negated = peek() == '^';
        if (negated) advance();
        std::unordered_set<int> chars;
        int members = 0;
        while (peek() != ']') {
            if (!peek().has_value())
                throw ParseFailure(ParseError{ParseErrorType::InvalidCharacterClass, static_cast<int>(open),
                    std::string("a closing ']'"), std::string("end of input")});
            ClassAtom first = parseClassAtom(open);
            if (first.singleton && first.characters[0] != 45 && peek() == '-' &&
                    peek(1) != ']' && peek(1).has_value()) {
                size_t dash = pos_;
                advance();
                ClassAtom last = parseClassAtom(open);
                if (!last.singleton || first.characters[0] > last.characters[0])
                    throw ParseFailure(ParseError{ParseErrorType::InvalidCharacterClass, static_cast<int>(dash),
                        std::string("an ascending range with single-character endpoints"),
                        std::string("invalid range")});
                for (int code = first.characters[0]; code <= last.characters[0]; ++code) chars.insert(code);
            } else {
                for (int code : first.characters) chars.insert(code);
            }
            ++members;
        }
        if (members == 0)
            throw ParseFailure(ParseError{ParseErrorType::InvalidCharacterClass, static_cast<int>(open),
                std::string("at least one class member"), std::string("empty character class")});
        advance();
        std::vector<int> values;
        if (negated) {
            for (int code = 0; code <= 127; ++code) if (!chars.count(code)) values.push_back(code);
        } else {
            values.assign(chars.begin(), chars.end());
            std::sort(values.begin(), values.end());
        }
        return makeCharacterSet(std::move(values), pattern_.substr(open, pos_ - open));
    }

    /**
     * atom ::= ASCII_CHAR | '.' | '[' class ']' | '(' regex ')' | escape
     * Outside a class, ^ and $ are ordinary ASCII literals under full-match
     * semantics; they do not introduce zero-width assertions.
     */
    ASTNodePtr parseAtom() {
        auto c = peek();
        if (!c.has_value()) {
            throw ParseFailure(ParseError{ParseErrorType::UnexpectedToken, static_cast<int>(pos_),
                std::string("a character or '('"), std::string("end of input")});
        }
        if (*c == '(') {
            size_t openParenPos = pos_;
            advance();
            if (peek() == ')') {
                throw ParseFailure(ParseError{ParseErrorType::EmptyGroup, static_cast<int>(pos_),
                    std::string("a pattern before ')'"), std::string(")")});
            }
            if (++depth_ > limits_.maxNestingDepth) {
                throw ParseFailure(ParseError{ParseErrorType::PatternTooComplex, static_cast<int>(openParenPos),
                    std::string("nesting depth <= ") + std::to_string(limits_.maxNestingDepth),
                    std::string("deeper group nesting")});
            }
            ASTNodePtr inner = parseRegex();
            --depth_;
            if (peek() != ')') {
                std::string found = peek().has_value() ? std::string(1, *peek()) : std::string("end of input");
                throw ParseFailure(ParseError{ParseErrorType::UnmatchedParen, static_cast<int>(openParenPos),
                    std::string("')'"), found});
            }
            advance();  // consume ')'
            return inner;
        }
        if (*c == '[') return parseCharacterClass();
        if (*c == '.') {
            advance();
            auto chars = range(0, 127);
            chars.erase(std::remove(chars.begin(), chars.end(), 10), chars.end());
            chars.erase(std::remove(chars.begin(), chars.end(), 13), chars.end());
            return makeCharacterSet(std::move(chars), ".");
        }
            // An operator appearing where an atom was expected has nothing to
            // apply to — e.g. "*ab", "a||b", "a**" (second '*'), "()" handled above.
        if (*c == '|' || *c == '*' || *c == '+' || *c == '?' || *c == ')') {
            throw ParseFailure(ParseError{ParseErrorType::DanglingOperator, static_cast<int>(pos_),
                std::string("a character or '('"), std::string(1, *c)});
        }
        if (*c == '\\') return parseEscape().node;
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

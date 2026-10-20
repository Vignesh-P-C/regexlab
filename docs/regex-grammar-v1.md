# RegexLab Regular Expression Grammar v1

This document defines the exact syntax accepted by the RegexLab compiler pipeline. The TypeScript prototype and the C++20/WASM implementation use the same grammar and semantics. This is a regular-language engine, not an implementation of all PCRE or JavaScript regex syntax.

## 1. Grammar

The grammar below is over ASCII input. CHAR means one ASCII character that is not being consumed as a syntax token at that position. A backslash escape can turn a metacharacter into a literal.

~~~ebnf
regex       ::= term ("|" term)*
term        ::= factor+
factor      ::= atom quantifier?
quantifier  ::= "*" | "+" | "?"
atom        ::= CHAR
              | "."
              | characterClass
              | "(" regex ")"
characterClass ::= "[" "^"? classItem+ "]"
classItem   ::= classAtom ("-" classAtom)?
              | classAtom
classAtom   ::= ASCII_LITERAL | ESCAPE | SHORTHAND
~~~

A class range is recognized when a singleton classAtom is followed by a hyphen and another singleton classAtom. Range endpoints are inclusive and ordered by ASCII code point. Shorthands expand to sets and are not valid range endpoints. The parser rejects a descending range such as **[z-a]**, an empty class, and an unterminated class.

The grammar intentionally requires one or more terms and one or more class members. The empty pattern, empty alternatives (**a|**), and empty groups (**()**) are not accepted. **a**, **a+?**, and other repeated postfix quantifiers are syntax errors; group the expression if a second repetition is intended, e.g. **(a+)?**.

## 2. Precedence and associativity

From loosest to tightest:

1. **|** alternation
2. Implicit concatenation
3. Postfix *****, **+**, and **?**

Alternation and concatenation are left-associative in the AST. All postfix quantifiers bind to exactly the preceding atom. Parentheses override the ordinary precedence.

Examples:

| Pattern | Parsed meaning |
|---|---|
| **ab|c** | (ab) | c |
| **a|bc** | a | (bc) |
| **ab*** | a followed by b* |
| **a+b?** | a+ followed by b? |
| **(ab)+** | one or more copies of the sequence ab |
| **a|b+** | a or one-or-more b |

## 3. Operators and their language semantics

| Syntax | Meaning | Example |
|---|---|---|
| **r*** | Zero or more repetitions of r (Kleene closure) | a* accepts empty, a, aa, … |
| **r+** | One or more repetitions of r | a+ accepts a, aa, … but not empty |
| **r?** | Zero or one occurrence of r | colou?r accepts color and colour |
| **r1r2** | Concatenation: a string from r1 followed by one from r2 | ab |
| **r1|r2** | Union/alternation | cat|dog |
| **(r)** | Grouping; changes precedence, not the language | (a|b)c |
| **.** | Any one ASCII code point except LF (0x0A) and CR (0x0D) | a.b |

The plus operator is implemented as a Thompson fragment that must enter its child at least once and can loop after each completed match. The optional operator adds a skip path and a one-match path. These remain direct AST operators; they are not rewritten into a different regex string.

## 4. ASCII character sets and shorthand escapes

The character universe for classes and their complements is all 128 ASCII code points, U = {0x00, ..., 0x7F}. This definition is shared across platforms and is independent of the user's locale.

| Notation | Exact set |
|---|---|
| **\d** | ASCII decimal digits 0 through 9 |
| **\w** | ASCII letters A-Z, a-z, digits 0-9, and underscore _ |
| **\s** | ASCII whitespace: space, tab, LF, VT, FF, CR |
| **\D** | U minus \d |
| **\W** | U minus \w |
| **\S** | U minus \s |
| **[abc]** | The set {a,b,c} |
| **[a-z]** | Inclusive ASCII range from a to z |
| **[^0-9]** | Every ASCII code point except the digits 0 through 9 |
| **[a-z0-9_]** | Union of the listed ranges and literal underscore |

A class is a set union: **[a-cx]** means {a,b,c,x}. Repeated members have no additional effect. Negation applies to the whole class over U; therefore **[^0-9]** includes ASCII control characters and line breaks. Dot is separate and excludes CR and LF.

Inside a class, caret negates only when it is the first character after **[**. A hyphen at the beginning or end is literal (**[-a]**, **[a-]**); use **\-** when a literal hyphen is clearer. A closing bracket is written **\]**. A literal caret in the first class position is **\^**. Shorthands inside classes are set members and may be combined, for example **[\dA-F]**; a shorthand cannot be a range endpoint.

## 5. Escaping and literal characters

An unescaped syntax character is interpreted as an operator or class delimiter where shown in the grammar. Prefix a character with backslash to quote it as a literal: **\+**, **\?**, **\.**, **\[**, **\]**, **\|**, **\***, **\(**, **\)**, and **\\**.

The standard ASCII control escapes are **\n**, **\r**, **\t**, **\v**, and **\f**. **\xHH** denotes exactly one ASCII code point from two hexadecimal digits; values above 7F are rejected by the ASCII-only engine. For example, **\x2B** matches a plus sign. An otherwise unrecognized escaped ASCII character is treated as that literal character.

**Compatibility note:** before grammar v1, an unescaped plus was a literal because the parser treated most escapes generically and had no plus quantifier. In v1, bare plus means one-or-more and a literal plus must be written **\+**. The same rule applies to newly introduced question-mark and dot syntax; write **\?** and **\.** for literals. Existing patterns that do not use these characters as literals retain their language.

## 6. Full-string matching, anchors, and unsupported constructs

RegexLab's matcher consumes the entire test string and accepts only if the DFA ends in an accepting state. It does not search for a substring. Because matching is already whole-string:

- Caret and dollar outside a character class are ordinary literal ASCII characters, not zero-width beginning/end assertions.
- Caret at the start of a class has the class-negation meaning described above.
- Lookahead/lookbehind and other lookaround syntax are unsupported.
- Backreferences such as **\1** are not backreferences; this grammar treats an unknown escaped character as a literal. Backreferences are context-sensitive and do not fit the regular finite-automaton model used by this pipeline.
- Bounded repetition such as **{m}**, **{m,n}**, and **{m,}** is deliberately outside grammar v1. It can be designed as a later extension without changing the meaning of the v1 constructs.
- Capturing groups are not a feature: parentheses only group expressions, and the engine does not expose captured substrings.

## 7. AST, NFA, DFA, and wire-format behavior

Parser AST nodes include **char**, **charset**, **concat**, **alt**, **star**, **plus**, and **optional**. A charset node keeps its sorted ASCII code-point set and source label, so the parser and AST visualization do not expand **[a-z]** into a large alternation tree.

Thompson construction represents a set with one NFA edge, not one edge per possible character. The edge label uses this compact internal and wire spelling:

~~~text
cs:<32 lowercase hexadecimal digits>
~~~

Each hex digit is a four-bit group: nibble i represents code points 4i through 4i+3, with the low-order bit representing the first code point. The label is deterministic and encoded the same way in TypeScript and C++. It keeps the NFA graph readable and bounds the edge label size even for dot or a negated class.

Subset construction expands only the NFA's symbolic labels into concrete ASCII alphabet symbols while computing moves. Consequently, DFA and minimized-DFA transition keys are ordinary one-character strings; the existing matcher remains a one-symbol-per-step DFA simulator. The JSON snapshot exposes the charset AST fields and compact symbolic NFA label; the UI decodes it to readable forms such as **[a-z]**, **\d**, **\w**, **\s**, or **.**.

## 8. Source positions and errors

Parser positions are zero-based indices into ASCII pattern text; because accepted syntax is ASCII, byte offsets in C++ and UTF-16 code-unit offsets in TypeScript agree for all valid patterns and syntax errors before a non-ASCII character. Malformed classes return **InvalidCharacterClass** at the opening bracket, or at the range hyphen for an invalid/descending range. Other malformed operators continue to use **DanglingOperator** or **UnexpectedToken**. The C++ JSON bridge and TypeScript parser use the same error names and positions.

## 9. Examples

| Pattern | Meaning |
|---|---|
| `[A-Za-z_][A-Za-z0-9_]*` | ASCII identifier shape |
| **\d+** | One or more ASCII digits |
| **colou?r** | color or colour |
| **[^\s]+** | One or more ASCII non-whitespace characters |
| **\+?\d+** | Optional literal plus followed by one or more digits |
| **([a-c]|\d)+** | One or more lowercase a-c letters or digits |

These are language examples only; the engine continues to use full-string semantics.

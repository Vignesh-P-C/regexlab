# RegexLab — Limitations (issue #27)

Each item: what the limit is, why we chose it, the alternative we didn't take, and what the next step would be if we kept building. Everything here is checked against the code on current `main`, not recalled.

## 1. Thompson + subset construction, not the direct method

**What:** we build the DFA indirectly — regex → AST → Thompson's-construction NFA → subset construction → DFA. We do not build it directly from the AST (nullable/firstpos/lastpos/followpos).

**Why chosen:** the indirect route visibly shows two separate, independently-defensible algorithms (Thompson's construction, then subset construction) instead of folding them into one pass. For a course built around naming and explaining individual constructions, two clearly separate stages — each independently testable — was worth more than one combined stage.

**Alternative:** the direct method builds the DFA in one pass over the AST using four node-level functions (`nullable`, `firstpos`, `lastpos`, `followpos`). Its real advantage: no intermediate NFA, so no epsilon-closure step and typically fewer total states to construct along the way — it's the faster path to the same DFA. We considered it (it was a real proposal, issues #43/#44) and closed it as out of scope, not forgotten.

**Next step if continued:** implement `followpos` as a sixth pass and add a test asserting it produces the same minimized DFA as the Thompson route, on the same patterns — a genuine equivalence proof, not just two implementations existing side by side.

## 2. Recursive descent, not a table-driven parser (LALR)

**What:** the parser is hand-written recursive descent — one function per grammar rule, precedence by which function calls which.

**Why chosen:** honestly, LALR (via a parser generator) could parse this grammar fine. We chose recursive descent for three concrete reasons, verified in the code: the grammar is tiny (4 productions), so a generator is overhead, not savings; hand-written functions give us exact control over error positions (`position`, `expected`, `found` in every `ParseError` — verified in `parser-pass.ts`/`.cpp`); and it needs no external generator tool, keeping the "hand-built, zero dependencies" claim true for the parser too.

**Precedence, verified in the parser:** `parseRegex` calls `parseTerm` calls `parseFactor` calls `parseAtom` — whatever's handled deepest in that call chain binds tightest (`*` tightest, then concatenation, then `|` loosest). No precedence table exists; this is directly checkable by reading the function-call structure.

**Next step if continued:** none planned — this was a one-time design decision that's been correct since week one, not an open question.

## 3. Moore's minimization (O(n²·k)), not Hopcroft's (O(n log n·k))

**What:** `MinimizationPass` uses Moore's partition-refinement algorithm.

**Why chosen:** Moore's is the simpler algorithm to implement correctly and explain from memory — a real requirement on this project (CLAUDE.md's explain-it-back rule). Hopcroft's achieves a better asymptotic bound by always processing the smaller half of a split, but that bookkeeping is meaningfully fiddlier to get right and to explain under questioning.

**Alternative, and the actual tradeoff:** Hopcroft's is faster in the worst case, O(n log n · k) vs O(n² · k), but under our 500-character pattern cap, n (DFA state count) stays small enough that the practical difference is negligible — this is a complexity-table talking point, not a real performance problem we've hit.

**Next step if continued:** implement Hopcroft's alongside Moore's (not replacing it) and add a test asserting both produce the same minimized automaton across the existing golden patterns — a real equivalence check, gated behind both of us being able to explain Moore's cold first (CLAUDE.md's own rule).

## 4. DFA state-count blowup (subset construction) — guard status

**What:** subset construction is O(2^m) in the worst case, m = NFA state count. **Verified not addressed by a dedicated guard**: there is no cap on DFA state count in the code.

**Why this is still acceptable in practice:** the 500-character pattern-length cap bounds the NFA size (roughly 2 states per character, so at most ~1000 NFA states), which bounds the worst case indirectly — but 2^1000 is not actually a safe bound in any real sense. The practical safety comes from the fact that pathological *exponential-blowup* patterns (famous ones like `(a|a)*(a|a)*...`) are unusual and weren't the cap's design target; the cap's stated purpose (parser-pass.ts/.cpp comments) is bounding recursion depth and parse time, not subset-construction size specifically.

**Alternative:** a dedicated DFA-state-count guard (reject or truncate once subset construction exceeds, say, 10,000 states) was proposed but never built on `main`.

**Next step if continued:** add a state-count ceiling inside `subsetConstructionPass`, returning a new structured error (e.g. `TooManyStates`) rather than letting the browser tab hang — **future work, not on `main`.**

## 5. Input guards: ASCII-only, 500-character cap, 1000-deep nesting cap

**What, verified exactly from `parser-pass.ts`/`.cpp`:**
- **ASCII only** — a code unit over `0x7F` is rejected as `UnexpectedToken` at its own position, whether in the pattern or (just failing to match) in the test string.
- **500-character pattern cap** — but only over an all-ASCII prefix: `exceedsLengthCap()` only fires `PatternTooComplex` at position 500 if every character from index 0 through 500 is ASCII. If a non-ASCII character appears in that window, the cap doesn't fire — the leftmost real error (that character's own `UnexpectedToken`) wins instead.
- **1000-level nesting-depth cap** — but **mathematically unreachable under the 500-character cap**, confirmed by the code's own comment: reaching depth 1000 needs at least 1000 characters by any construction (minimum 2 characters per paren-nesting level), which exceeds the 500-char cap before depth 1000 is ever reached. It's kept as defense in depth for if the length cap is ever relaxed.

**Why chosen:** both caps exist to keep parsing and subset construction fast and the recursion bounded — found after a real stack-overflow incident during development (not invented defensively; see the "D2/D4" history in `CLAUDE.md`/commit history).

**Next step if continued:** none required, but worth saying honestly in a viva: the depth guard currently does no independent work given the length cap's current value — it would only matter if the length cap were raised.

## 6. Full-match only, no substring search

**What:** the matcher requires the entire test string to be consumed and end in an accept state — like `std::regex_match`, not `std::regex_search`. No partial/substring matching, no anchors (`^`/`$` aren't needed because full-match is the only mode).

**Why chosen:** simpler matcher, simpler mental model for a teaching tool, and it's the natural semantics for "does this string belong to this regular language," which is the question the automata-theory chapter actually asks.

**Next step if continued:** search semantics would need trying the matcher from every start offset (or building a DFA with a `.*` prefix) — not planned.

## 7. Unsupported regex syntax — verified directly in `parser-pass.ts`

**What:** `+`, `?`, `.`, `[`, `]` are parsed as **literal characters**, not operators. `a+` parses as `concat('a', '+')` and matches the literal string `"a+"`, not one-or-more `a`s. Confirmed by reading `parseAtom`: these characters have no special case at all.

**Why chosen:** the grammar was deliberately kept to `char | concat | alt | star` (plus parentheses) as Core scope — enough to cover every automata-theory construction the syllabus names, without the extra parser/Thompson-rule/AST-node work each new operator adds.

**Alternative, considered and documented (not built):** desugaring (`a+` → `concat(a, star(a))`) touches only the parser; dedicated AST nodes (`plus`, `opt`) touch the parser, both Thompson passes, the JSON bridge, and the frontend types. Both were scoped and left as Stretch A/B, not started.

## 8. Partial DFA, no explicit dead state

**What, verified in `subset-construction-pass.ts`/`.cpp`:** `if (moved.size === 0) continue;` — when a symbol has no transition from the current DFA state's NFA-subset, no DFA state is created for it at all. A missing map entry at match time means reject; there's no explicit trap state that every unmatched symbol loops into.

**Why chosen:** fewer states to build and reason about, and the matcher's `undefined` check is enough to represent rejection — an explicit dead state draws the exact same conclusion with more bookkeeping.

**Next step if continued:** none — this is the standard, textbook-acceptable way to represent a partial DFA, not a shortcut.

## 9. Testing limits

**What, verified by reading the actual test files:** the differential tests (C++ vs `std::regex`, TypeScript vs native `RegExp`) use a small alphabet (`abcd`), shallow random ASTs (depth ≤ 3), and short random test strings (≤ 6 characters) — 2,000 (pattern, input) pairs per run. The C++ side seeds its generator from `std::random_device` with no seed logged, so a failing random case there is not automatically reproducible. These tests validate matching *semantics*; they can't reach the deep-nesting or large-pattern regimes the length/depth caps exist for — those have their own separate guard tests.

**Why acceptable:** differential testing against two independent reference engines across thousands of cases is a strong correctness signal even with a narrow alphabet, because the algorithms themselves (Thompson's construction, subset construction, Moore's) don't treat any particular alphabet specially.

**Next step if continued:** log and allow overriding the C++ test's random seed, the same way the TypeScript test already does.

## 10. Two engines, one source of truth problem

**What:** the algorithms are implemented twice — TypeScript (prototype) and C++ (production, compiled to WASM). They must be kept in sync by hand; there's no code generation from one to the other.

**Why chosen:** this was a deliberate correctness strategy, not duplicated effort for its own sake — a bug has to reproduce independently in two languages and two test frameworks to slip through both differential suites unnoticed. The shared parser-parity fixture (`tests/fixtures/parser-cases.json`, read by both a TS and a C++ test) exists specifically to keep the two parsers' error classification in lockstep.

**Cost, stated honestly:** every change to an algorithm is two changes, not one, and nothing currently detects drift automatically beyond the fixture and the golden-value tests — a genuine maintenance cost, accepted for the correctness story it buys.

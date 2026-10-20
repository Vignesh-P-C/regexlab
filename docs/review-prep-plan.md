# RegexLab: Review Prep Plan (issues #26, #27)

7 minutes of walkthrough, 3 minutes of questions, for a compiler-design professor. Everything below is checked against the real code on current `main` and the real running app (screenshots in `docs/slides/img/`, captured from the actual compiled WASM engine, not a mock).

## (a) 60-second architecture

```
pattern text  ──Parser──▶  AST  ──Thompson──▶  NFA (ε moves)
                                                   │
                                          Subset Construction
                                                   ▼
                                                  DFA
                                                   │
                                           Moore Minimization
                                                   ▼
                                               min-DFA
                                                   │
                                     test string ──Matcher──▶  match / no-match
```

Two separate inputs: **the pattern** (the program being compiled, going through every stage once) and **the test string** (the input fed to the finished machine; only the last stage touches it, and now it also drives the step-by-step playback on every tab).

Built twice, independently: a TypeScript prototype and a C++20 production engine compiled to WebAssembly, both implementing the same five stages. The browser only ever runs the C++/WASM build; the TypeScript version is kept as the design-validation history and a second oracle for differential testing.

## (b) Worked example: `(a|b)*abb`, verified against the real running app

Screenshots in `docs/slides/img/` were captured from the actual compiled WASM engine (`npx vite` dev server, real browser via Playwright). Not a mock, not hand-typed numbers.

**Parse and AST:** grammar is `regex ::= term ('|' term)*`, `term ::= factor+`, `factor ::= atom '*'?`, `atom ::= CHAR | '(' regex ')' | '\' CHAR`. Precedence comes from call depth (deepest binds tightest: `*` > concatenation > `|`), no table. Reading `(a|b)*abb`: group `(a|b)` → `*` applies to the group → three more characters concatenated after. AST (confirmed in `01-ast.png`): `concat(concat(concat(star(alt(a,b)), a), b), b)`.

**NFA, 14 states** (`02-nfa.png`), start state 6, accept state 13. Arithmetic: 5 literal characters × 2 states = 10, plus 2 for `*`'s own start/accept pair, plus 2 for `|`'s own start/accept pair = 14. The app's own caption confirms step 0: "ε-closure of {6} = {0,2,4,6,7,8}".

**Subset construction table** (confirmed via the DFA tab's own caption in `03-dfa.png`, which shows "NFA states for this prefix: {0,2,4,6,7,8}" for DFA state 0):

| DFA state | NFA subset (after ε-closure) | on `a` | on `b` |
|---|---|---|---|
| 0 (start) | {0,2,4,6,7,8} | →1 | →2 |
| 1 | {0,1,2,4,5,7,8,9,10} | →1 | →3 |
| 2 | {0,2,3,4,5,7,8} | →1 | →2 |
| 3 | {0,2,3,4,5,7,8,11,12} | →1 | →4 |
| 4 (accept) | {0,2,3,4,5,7,8,13} | →1 | →2 |

5 DFA states, matching the diagram in `03-dfa.png` exactly.

**Minimization partitions** (confirmed in `04-mindfa-accepted.png`): DFA states 0 and 2 have identical signatures (same reaction to `a`/`b`, neither accepting) and merge. Result: **4 states**, start 0, accept 3.

**Matcher trace, `babb` → MATCH** (`04-mindfa-accepted.png`, "✓ Accepted"): b→0, a→1, b→2, b→3(accept).
**Matcher trace, `abab` → NO MATCH** (`05-mindfa-rejected.png`, "✗ Rejected"): a→1, b→2, a→1, b→2 (not accept).

Why: `(a|b)*` eats any mix of `a`/`b` for free, so only the ending matters. `babb` ends in `abb`. `abab` ends in `bab`, not `abb`.

## (c) Pass → BCSE307L topic → file → what breaks without it

| Pass | Module | File | What fails without it |
|---|---|---|---|
| Parser (recursive descent) | 2, Syntax analysis | `parser-pass.{ts,cpp}` | No AST for anything downstream; malformed patterns would crash instead of returning a structured error |
| Thompson's construction | 1, Lexical analysis (indirect route) | `thompson-pass.{ts,cpp}` | No automaton exists yet |
| Subset construction | 1, Lexical analysis | `subset-construction-pass.{ts,cpp}` | The NFA is non-deterministic, so matching would need backtracking, losing the O(n)-time guarantee |
| Moore's minimization | 5, labeled "optimization," really automata theory | `minimization-pass.{ts,cpp}` | DFA still works, just bigger than necessary; correctness doesn't depend on this step |
| Matcher | 6, Code generation (`MatcherPass` *is* "turn the automaton into an executable procedure") | `matcher-pass.{ts,cpp}` | No way to test a string against the built machine |

No separate lexer/scanner file exists anywhere in `engine/` (checked directly). Fine for this grammar specifically, since every token is one character; a language with multi-character tokens would need a real lexical-analysis pass first.

## (d) 12 hardest questions

1. **Why Thompson's construction and not the direct method?** Indirect route (regex→NFA→DFA). Direct method (firstpos/followpos, no intermediate NFA) was a real proposal, scoped out on purpose (issues #43/#44), not forgotten. Its real advantage is skipping the epsilon-closure step entirely.
2. **Subset construction can blow up exponentially: what's your guard status?** Worst case O(2^m). We don't have a dedicated state-count guard on `main`; the 500-char pattern cap bounds NFA size indirectly, but that's not a tight bound on DFA blowup specifically. Stated honestly as a limitation, not hidden. Every DFA state subset construction creates is reachable from the start by construction, since the worklist begins at `ε-closure({nfa.startState})` and only ever discovers a new state via a real `move`+`ε-closure` transition from an already-reachable one, so there's never an unreachable state to prune, in the DFA or downstream in Moore's minimization.
3. **Moore's vs Hopcroft's?** Moore's: O(n²·k) time, simpler to implement and explain. Hopcroft's: O(n log n·k), faster but fiddlier. Built Moore's first, Hopcroft's deliberately gated as a later upgrade, never started. One correction: the space column for Moore's was wrong in CLAUDE.md. `refine()` builds a length-k signature per state on every pass, so the real working space is O(n·k), states times alphabet size, not O(n); that's now fixed in CLAUDE.md §10.
4. **Partial DFA and the dead state?** We only record a transition when one exists; a missing transition means reject. No explicit trap state, confirmed directly in the code: `if (moved.size === 0) continue`.
5. **Full match or search?** Full match, like `std::regex_match`. Whole string consumed, must end in an accept state.
6. **Why recursive descent, and your grammar/precedence?** Grammar is tiny; recursive descent gives exact error positions and needs no generator tool. Precedence by call depth: `regex` calls `term` calls `factor` calls `atom`, deepest binds tightest, no table. This grammar is genuinely LL(1), not just asserted: FIRST(atom) is every pattern character except `|`, `*`, `)`, and FIRST(term) = FIRST(regex) = FIRST(atom); FOLLOW(term) = {`|`, `)`, end-of-input}. The two EBNF loops (`('|' term)*` and `factor+`) each decide on one lookahead token that's provably disjoint from the other branch's FIRST set. `|` is never in FIRST(term), and the loop-stop tokens are never in FIRST(factor), so one token of lookahead always determines the next move, which is exactly the LL(1) condition.
7. **What does `(a*)*` do to epsilon loops?** It's fine: the inner `a*` already accepts empty, and the outer `*` adds another skip/loop epsilon pair. More states, not a correctness issue. It does create a real cycle in the NFA's epsilon graph (the inner star's accept→start edge plus the outer star's own edges loop back on each other), but `epsilonClosure` is cycle-safe by construction: it's a worklist walk over a visited set (`closure.has(target)` in TS, an `unordered_set` in C++), so an already-seen state is never pushed again and the closure always terminates in at most `|NFA states|` steps.
8. **What don't you support, and why?** `+`/`?`/character classes are literal characters today, scoped out on purpose, not built. Backreferences/lookahead are permanently out: not regular languages, no DFA exists for them.
9. **How do you prove correctness?** Differential testing: thousands of random (pattern, string) pairs checked against `std::regex` and native `RegExp`, in two independent implementations that must agree. 125 TS tests, 4,608 C++ assertions, measured fresh today. One limit worth naming unprompted: differential testing only exercises valid patterns, since `std::regex`/`RegExp` can't serve as an oracle for rejection, so it never touches the `ParseError` code paths. Those are covered separately: 9 golden `ParseError`-shape tests in `parser-pass.test.ts`/`parser_pass_test.cpp`, plus the 36-case shared fixture (`tests/fixtures/parser-cases.json`, read by both `parser-cases.test.ts` and `parser_cases_fixture_test.cpp`) that checks error type/position/expected/found parity between both parsers.
10. **Why C++/WASM when TypeScript already worked?** Matches the lab's own language convention, and gives a real two-implementation correctness story, since a bug must reproduce in two languages to slip through.
11. **Is the minimal DFA unique?** Yes, up to renaming, by the Myhill–Nerode theorem.
12. **What is epsilon-closure, simply?** Every state reachable using only epsilon moves, including the start set itself. It's what lets one DFA state represent "everywhere I could be right now."

## (e) Testing summary: real counts, measured today

Measured fresh on current `main` (`npm ci` + `npx vitest run`; `cmake --build` + `./engine_tests`):
- **TypeScript: 125 tests across 10 files**, 93 engine-side (33 parser + 36 shared parser-parity fixture + 5 Thompson + 5 subset construction + 4 minimization + 8 matcher + 2 differential) plus 32 frontend tests for the step-playback feature, issue #52 (5 `playbackIndex` + 22 `steps` + 5 `PlaybackControls`).
- **C++: 4,608 assertions across 41 Catch2 cases.**
- WASM build verified against `scripts/check-wasm-limits.mjs`: **25/25 probes passed** (the three acceptance cases, 500/501-char boundary, nesting boundaries, non-ASCII handling).
- Real app smoke-tested via Playwright against the compiled WASM build: zero console errors across all six captured states (AST, NFA, DFA, min-DFA accepted, min-DFA rejected, mid-playback). Checked once, by hand, while capturing the screenshots below. Not wired into any script or CI, so treat it as a one-off check, not a standing guarantee.

## (f) Contributions: from `git log` / PR history only

PR authorship as recorded by GitHub (who opened each PR on their account, not a claim about who personally wrote every line or understands every part; that's for you two to fill in yourselves, per `CLAUDE.md`'s own shared-notes-doc rule):

| GitHub account | Merged PRs | Rough area |
|---|---|---|
| `Vignesh-P-C` | #1–#13, #28, #32–#35, #37–#40, #42, #48, #53, #54 (25 PRs) | Initial engine passes (Thompson, subset construction, minimization, matcher), C++ port, pipeline, WASM binding, frontend scaffold, early defect fixes (D1–D8), visualizer polish (animation, responsive layout, edge contrast), TS differential testing, docs |
| `ujwal2311` | #49, #50, #51, #56 (4 PRs) | ASCII-prefix length-cap fix, dark-mode contrast fix, diagram sizing fix, step-playback UI wiring (issue #52) |

**TODO (fill in yourselves, this is not something git history can tell you):** who personally wrote vs. reviewed each PR, who can explain which pass unaided, and anything co-authored in a session that only shows one GitHub account on the PR. `CLAUDE.md` already asks you to keep a shared notes doc for exactly this reason; use it before the viva, not this file.

## (g) 5-line rehearsal plan

1. Read the section below (the 7-minute script) aloud once, no demo, just for pace.
2. Run it again with the actual demo clicks on the real app, timed.
3. Answer all 12 questions from (d) aloud, no notes.
4. Have someone else pick 3 questions at random from (d) and ask them out of order.
5. If you're running over time, cut from the end of the script first (the "what's out of scope" line); never cut the worked example.

---

## Timed 7-minute script (888 spoken words, narration only)

**[0:00–0:45]** "Every text editor, every linter, every programming language starts with the same deceptively simple-looking question: does this piece of text match this pattern? Underneath, that question has a precise mathematical answer, and today we want to show you the machine that answers it. Not a black box, not a library call, but every step laid bare, built by hand, and running live in the browser in front of you."

**[0:45–1:30]** "Here's the core idea. A regular expression isn't just a string of symbols, it's a specification for a machine. Given a pattern, we build a machine that reads a string one character at a time and, at the end, tells you yes or no. So there are really two separate inputs here: the pattern, which is the program we compile once, and the test string, which is the input we feed to the machine we just built from it. Everything you'll see today is that compilation pipeline, made visible, one stage at a time."

**[1:30–2:30]** "We built this twice and independently: once in TypeScript as a working prototype, and once in C++, compiled to WebAssembly, which is what actually runs in your browser right now, with zero network calls. Why bother with two implementations of the same thing? Because it gives us an honest way to catch our own mistakes. If a bug exists in one language but not the other, thousands of random tests comparing the two will eventually expose it. Every stage of this pipeline, from the raw pattern string, through an intermediate tree structure, through two different kinds of machines, down to a final yes-or-no verdict, is something you can click through and inspect for yourself on this screen, and switching between those views never recomputes anything: the engine runs once per edit, and every tab you click is just a different read of that same result. Let's walk through it stage by stage, with real numbers from the pattern on screen right now."

**[2:30–3:30] Parser.** "The first stage turns the raw text into a tree. We use recursive descent, one function per grammar rule, no separate tokenizer, because here every token is just one character. Precedence falls out of which function calls which: the function that handles repetition sits deepest in the call chain, so it binds tightest, then comes sequencing, then the vertical bar for alternatives, and that ordering is enforced by the code structure itself, not a lookup table." *[Type `(a|b)*abb` in Pattern. Point at the AST tab; the step caption names the construction rule each node corresponds to.]* "Watch what happens when the pattern is broken." *[Type `(ab`, show the `UnmatchedParen` error and its position.]* "Typing an unmatched opening parenthesis doesn't crash anything. It comes back as a precise, structured error, naming exactly where the problem is and what the parser expected to see there instead."

**[3:30–4:15] Thompson's construction.** "Once we have a tree, we turn it into a machine with epsilon moves: a nondeterministic finite automaton. Each piece of the tree becomes a small fragment with exactly one entry point and one exit point, and fragments snap together: a character costs two states, and each alternation or repetition contributes two more for its own entry and exit pair. For the pattern on screen, that arithmetic gives us fourteen states total." *[Switch to the NFA tab. Point at an epsilon edge, and at the active-state highlighting as you step through.]*

**[4:15–5:00] Subset construction.** "A machine with epsilon moves isn't deterministic. At any moment you could be in several states at once. So the next stage collapses every such possible-states-at-once set into a single new state: each state of the new, deterministic machine is really a whole set of states from the old one, closed over every epsilon move. For this pattern, those sets collapse down to five deterministic states, and the app shows you exactly which original states are hiding behind each one as you step through." *[Switch to the DFA tab, point at the caption showing the underlying state set.]*

**[5:00–5:45] Minimization.** "That deterministic machine works, but it isn't necessarily the smallest one that accepts the same language. Moore's algorithm finds that smallest machine by starting with the coarsest possible guess: accepting states in one group, everything else in another, and splitting a group apart only when it finds real evidence two states behave differently. Run to a fixpoint, and what's left is provably the unique minimal machine for this pattern. Here, two states turn out to be indistinguishable and merge, bringing us down to four states total." *[Switch to the min-DFA tab.]*

**[5:45–6:00] Matching, verified live.** "And now the payoff: feed it a string, one character at a time, no backtracking, no guessing." *[Type `babb`, point at the ✓ Accepted badge.]* *[Type `abab`, point at the ✗ Rejected badge.]* "Same length, similar-looking string, opposite answer, because this pattern only cares how the string ends: `babb` ends in `abb` while `abab` doesn't."

**[6:00–7:00] Scope, stated honestly.** "A couple of honest caveats before questions. We don't just trust hand-picked examples. We prove correctness by throwing thousands of random patterns and random strings at this engine and checking its answer against two completely independent reference engines, one per language, and both have to agree with us every time. That's a strong signal, but it's not a proof for every possible pattern, and we say so rather than overclaim it. We also don't support everything a modern regex engine does, on purpose: backreferences and lookahead are permanently out of scope, because they describe something fundamentally more powerful than a regular language, and no finite machine like the ones we just watched get built can exist for them. Character classes and the plus and question-mark operators are scoped out for now too, not because they're hard, but because we chose to spend our time going deep on the automata theory itself rather than wide on syntax." "That's the whole machine, start to finish. Happy to take questions."

**Fallback if the live demo breaks:** go straight to the screenshots in `docs/slides/img/` and the tables in section (b) above. Same engine, same real numbers, already captured.

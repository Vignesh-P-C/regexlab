# RegexLab — Report Data and Validation

**Prepared:** 25 October 2026
**Project:** RegexLab
**Report branch:** Vignesh-P-C/regexlab-final-ab-20261025
**Pull request:** [#72](https://github.com/Vignesh-P-C/regexlab/pull/72)

> The figures below come from automated tests, compiled-WASM probes, or the recorded browser walkthrough. These are correctness examples, not performance benchmarks.

## 1. What the project demonstrates

RegexLab turns a supported regular expression into an abstract syntax tree, a Thompson NFA, a subset-construction DFA, and a minimized DFA. It lets a learner inspect these stages, step through how an input is processed, and compare structural measurements instead of treating the regex engine as a black box.

The project work has two connected parts:

- **A — Subset Growth / NFA Structure Lab:** exposes automaton counts, construction traces, the theoretical powerset ceiling, and verified epsilon-edge deletion experiments.
- **B — Bounded Optimization Explorer:** searches a deliberately limited space of one-edge and grouped epsilon-edge deletions, checks whether each candidate recognizes the same language, and reports safe candidates and counterexamples.

The initial A foundation is already on main; PR #72 carries the B feature and the accompanying robustness, visualization, test, and documentation changes. This report describes the combined A+B project.

## 2. Representative automata measurements

Example: pattern **(a|b)*ab**, test string **aab**.

| Measurement | Observed value | What it means |
|---|---:|---|
| Match result | Accepted | The input ends in ab, as the pattern requires. |
| Thompson NFA states | 12 | States in the nondeterministic construction. |
| Reachable subset-DFA states | 4 | Distinct reachable NFA-state subsets discovered by subset construction. |
| Minimized DFA states | 3 | States remaining after equivalent DFA states are merged. |
| Powerset ceiling | 2^12 = 4,096 | The theoretical maximum number of subsets for 12 NFA states; it is not the number actually reached. |

This example lets a presenter contrast the large theoretical ceiling (4,096) with the 4 subsets actually reached and the 3 states needed by the minimized DFA.

## 3. Verified deletion experiments

The Growth Lab and Bounded Optimization Explorer work on a **copy** of the baseline NFA. A candidate edit never mutates the original automaton. The equivalence checker compares the two languages; when they differ, it provides a shortest distinguishing input.

| Pattern | Candidate edit | Result | Evidence shown |
|---|---|---|---|
| a|a | Delete either one of the duplicate branch-entry epsilon edges | Equivalent | The remaining branch still accepts a. |
| a|a | Delete both branch-entry epsilon edges together | Different | Shortest witness: a. Baseline accepts; edited candidate rejects. |
| a* | Delete the epsilon skip edge from start to accept | Different | Shortest witness: the empty string (ε). Baseline accepts it; candidate rejects it. |

These examples show why grouped edits need their own verification: individually safe edits do not guarantee that the combined edit is safe.

## 4. Bounded-search result values

The deterministic C++ and TypeScript tests run bounded search on a|a with edit depth 2.

| Search result | Value |
|---|---:|
| Raw NFA states | 6 |
| Eligible epsilon edges | 4 |
| Candidate sets of size 1 | 4 |
| Candidate sets of size 2 | 6 |
| Total declared/evaluated candidate sets | 10 |
| Equivalent candidates | 6 |
| Language-changing candidates | 4 |
| Inconclusive candidates in this run | 0 |
| Pareto-frontier candidates | 2 |

The two expected frontier IDs are:

| Candidate ID | Interpretation |
|---|---|
| delete-eps:1>5,4>0 | Delete the selected pair of epsilon edges. |
| delete-eps:3>5,4>2 | Delete the other selected pair of epsilon edges. |

The explorer labels the search as complete only when the declared search space has been exhausted. When a configured cap prevents a proof, the affected result remains **inconclusive** and is excluded from the verified Pareto frontier.

### Default bounded-search limits

| Limit | Default |
|---|---:|
| Eligible epsilon edges considered | 12 |
| Maximum edit depth | 2 |
| Maximum candidates evaluated | 24 |
| DFA states per analysis | 128 |
| Work units per check | 100,000 |
| Product-state pairs per equivalence check | 10,000 |

The implementation also clamps requests to hard ceilings (including 64 candidates, edit depth 3, 256 DFA states, and 20,000 product-state pairs) so UI or API inputs cannot request unbounded work.

## 5. Failed-input playback and dead state

| Pattern | Test string | Expected playback |
|---|---|---|
| (a|b+)* | aac | The DFA/min-DFA consumes a, a, then enters rejecting sink ⊥ on c; the full string is rejected. |

The sink has a self-loop for the remaining alphabet and is always rejecting. The visualizer shows it for DFA and minimized-DFA playback when a transition is missing. NFA playback remains sink-free because the NFA is represented with partial transitions; the display does not invent an NFA state. The failed input character is highlighted.

## 6. Resource-limit probes

| Probe | Input size or cap | Observed outcome |
|---|---:|---|
| Literal pattern at supported length | 500 characters | Returns a normal engine result. |
| Literal pattern above length limit | 501, 1,000, and 5,000 characters | Clean PatternTooComplex@500 error; no hang. |
| Alternation near length limit | 250 terms / 499 characters | Normal result. |
| Alternation above length limit | 251 terms / 501 characters | Clean PatternTooComplex@500 error. |
| Star chain near length limit | 250 stars / 500 characters | Normal result. |
| Nested plus below NFA-state cap | 8 nested wrappers | Builds and returns a normal result. |
| Nested plus above NFA-state cap | 12 nested wrappers | Typed AutomatonTooComplex error; construction stops before exceeding 2,048 NFA states. |
| Ordinary maximum-length alternation | 250 terms | Builds exactly 998 NFA states, below the 2,048-state cap. |
| Determinization with a test state cap of 1 | Pattern a|b | Returns no partial DFA. |
| Determinization with a test work budget of 0 | Pattern a|b | Raises the typed complexity error. |
| Minimization with a test work budget of 0 | Pattern (a|b)*ab | Raises the typed complexity error. |
| Growth trace with a row cap of 0 | Pattern a | Raises the typed complexity error instead of returning a misleading partial trace. |

The configured expansion guard values include a 2,048-state Thompson NFA limit, a 20,000-state/1,000,000-work-unit subset-construction limit, a 20,000-state/5,000,000-work-unit minimization limit, and a 50,000-row traced-subset limit. The tests also force much smaller limits to verify that each guard actually stops work safely.

### Compiled-WASM probe breakdown

The final check-wasm-limits.mjs run used the freshly built module and passed **27/27 probes**.

| Probe group | Checks | Examples |
|---|---:|---|
| Basic acceptance and parse error | 3 | A matching input, a non-matching input, and an unmatched parenthesis. |
| Pattern-length boundary | 8 | 500 vs. over-500 literals, alternations, and star chains. |
| Nested-plus NFA guard | 2 | A below-limit and an above-limit pattern. |
| Deep-group handling | 5 | Allowed inputs and inputs rejected by the length cap before unsafe recursion. |
| Non-ASCII handling | 5 | Accented text, emoji, malformed syntax, and non-ASCII input. |
| ASCII/length parity probes | 4 | Escapes and non-ASCII characters at the length boundary. |
| **Total** | **27** | **27 passed; 0 failed.** |

## 7. Automated validation summary

| Validation | Result |
|---|---|
| Vitest | **209 passed** across **20 test files**. |
| Native C++ Catch2 suite | **81 test cases passed**, **4,923 assertions passed**. |
| TypeScript typecheck | Passed (npm run typecheck). |
| Production frontend build | Passed (npm --prefix frontend run build). |
| Built-WASM limit probes | **27/27 passed** using node scripts/check-wasm-limits.mjs build-wasm/regexlab.js. |

The production build produced a 263.84 kB JavaScript bundle (82.01 kB gzipped) and an 18.46 kB CSS bundle (4.23 kB gzipped). Bundle size is included as build output, not as a speed or runtime claim.

## 8. Main implementation changes

| Area | Change |
|---|---|
| Bounded Optimization Explorer | Added deterministic bounded candidate enumeration, grouped epsilon-edge edits, explicit search limits, equivalence verification, candidate metrics, and a verified Pareto frontier. |
| Equivalence evidence | Reuses the language-equivalence checker; changed candidates include shortest distinguishing inputs, while resource-limited checks stay inconclusive. |
| Thompson construction safety | Estimates expansion before allocation and returns a typed complexity error when the 2,048-state budget would be exceeded, including nested plus cases. |
| DFA and minimization safety | Added state/work budgets to subset construction and minimization; the pipeline returns a structured complexity error instead of hanging or returning partial output. |
| Growth Lab safety | Bounded traced construction so an oversized trace cannot consume unbounded memory. |
| DFA playback | Added a rejecting sink (⊥) for missing DFA/min-DFA transitions and failed-input highlighting; NFA playback remains without a fabricated sink. |
| Frontend and tests | Added the B explorer UI, playback and sink-state coverage, search-result presentation, and regression tests across the pipeline. |
| Project materials | Updated the README, review notes, proposal, grammar notes, presentation, and added compiler-design notes. |

The regular-expression operators remain aligned with the Thompson construction: plus requires one occurrence before repetition, while question mark provides an optional skip path. Both are exercised through the automata pipeline and regression tests.

## 9. Scope and interpretation

- Bounded search is intentionally limited to epsilon-edge deletions; it is an educational, verified search over the declared candidate space, not a claim of globally optimal automata.
- If a resource budget is reached, the result is reported as inconclusive rather than guessed.
- The powerset ceiling is a mathematical upper bound, not a prediction of actual DFA size. The research-based structural upper-bound card was removed because its cited condition has not been established for this epsilon-NFA representation.
- The engine's supported pattern alphabet is ASCII; non-ASCII patterns produce clean parse errors.

## 10. Source references

- Bounded search tests: tests/bounded_optimization_test.cpp, engine/__tests__/unit/bounded-optimization.test.ts
- Growth, witness, and trace tests: tests/growth_analysis_test.cpp
- Complexity guards: tests/thompson_pass_test.cpp, tests/subset_construction_pass_test.cpp, tests/minimization_pass_test.cpp, tests/pipeline_test.cpp
- WASM probes: scripts/check-wasm-limits.mjs
- Dead-state UI test: frontend/src/App.dead-state.test.tsx
- Search UI test: frontend/src/components/BoundedOptimizationExplorer.test.tsx

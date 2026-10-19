# 🔎 RegexLab — Automata Made Visible

[![Status](https://img.shields.io/badge/STATUS-CORE%20IN%20PROGRESS-orange?style=for-the-badge)](#-current-status)
[![Engine](https://img.shields.io/badge/ENGINE-COMPLETE-brightgreen?style=for-the-badge)](#-current-status)

> A regex engine — lexer through matcher — built entirely from scratch as a pipeline of independently testable passes, with a live automaton visualizer and a planned AI-assisted, self-verifying error-correction layer. No regex libraries. No NFA/DFA packages. Every algorithm is hand-built, implemented twice — once as a TypeScript prototype, once as the production C++ engine compiled to WebAssembly.

![C++](https://img.shields.io/badge/C%2B%2B20-STATIC%20LIB-00599C?style=for-the-badge&logo=cplusplus&logoColor=white)
![CMake](https://img.shields.io/badge/CMAKE-BUILD-064F8C?style=for-the-badge&logo=cmake&logoColor=white)
![Catch2](https://img.shields.io/badge/CATCH2-UNIT%20%2B%20PIPELINE-6E9F18?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TYPESCRIPT-PROTOTYPE-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/REACT-VITE-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Dependencies](https://img.shields.io/badge/ENGINE%20DEPENDENCIES-ZERO-blue?style=for-the-badge)

---

## Overview

RegexLab is a compiler-design semester project: take a regex pattern as a raw string and carry it, stage by stage, through the pipeline a real lexer generator uses — parse it into an AST, compile the AST into an NFA (Thompson's construction), determinize the NFA into a DFA (subset construction), shrink the DFA to its minimal form (Moore's minimization), and finally use it to match strings — with every intermediate structure rendered live as a graph in the browser.

**The engine is implemented twice, deliberately.** It was first prototyped in TypeScript to validate the design and algorithms end to end. Once proven against golden test values, it was re-implemented in **C++** — the production version, compiled to WebAssembly for the browser — matching the TS reference pass for pass, golden value for golden value.

**Engineering focus areas:**
- A hand-written recursive-descent parser with a formally specified grammar, not a regex-library shim
- Classic automata-theory constructions (Thompson, subset construction, Moore's) as a pipeline of independently testable passes
- The same pipeline validated in two languages, with the C++ build compiled to WebAssembly for in-browser execution — the same technique browser builds of SQLite use
- Correctness validated four ways: golden-value unit tests, a pipeline-equivalence test, differential testing against a reference engine on thousands of randomized inputs in **both** languages, and sanitizer runs (AddressSanitizer / UndefinedBehaviorSanitizer)
- Explicit input guards (pattern length, nesting depth, ASCII-only) that turn pathological input into a clean `PatternTooComplex` / `UnexpectedToken` error instead of a crash — see [Limits and guards](#limits-and-guards)
- A planned AI suggestion layer that can propose fixes for malformed patterns but is architecturally incapable of showing a wrong one — every suggestion must be re-parsed by the same hand-built parser before it is trusted
- Strict separation between engine, visualization, and AI layers — each runs and is demoable on its own

---

## Architecture

```
                         PRESENTATION LAYER
              Pattern input · Test-string input · Playback controls
                             │                       │
                             ▼                       ▼
        VISUALIZATION LAYER                  SUGGESTION LAYER (planned)
   Renders pipeline output as an        (only invoked on parse failure)
   SVG graph. Pure function of          Proposes a fix for a structured
   engine state — no logic of its       ParseError; every suggestion is
   own.                                 untrusted until re-parsed.
                     │                                    │
                     ▼                                    │ suggestion string
┌──────────────────────────────────────────────────┐      │  (untrusted —
│         CORE ENGINE — PASS PIPELINE (C++)          │◄─────┘   re-parsed
│         compiled to WASM for the browser            │           before use)
│                                                      │
│   ParserPass             → AST  (or ParseError)      │
│   ThompsonPass           → NFA                        │
│   SubsetConstructionPass → DFA   (worklist/fixpoint)  │
│   MinimizationPass       → Min-DFA (partition refine) │
│   MatcherPass            → MatchTrace                 │
│   pipeline.cpp           → wires all 5 into one call  │
└──────────────────────────────────────────────────┘
```

**Why this shape:** the Core Engine is a pure library — string in, structured data out — runnable and testable with no browser involved. The Suggestion Layer sits *beside* the engine, never inside it: a proposed fix re-enters the system as an ordinary string and must clear the same parser gate as any human-typed pattern. The Visualization Layer only renders what the engine already computed, which keeps every hard theory bug confined to a single testable layer.

### The Pass Pipeline

| Stage | Named algorithm | Input → Output | TS (prototype) | C++ (production) |
|---|---|---|---|---|
| `ParserPass` | Recursive-descent parsing | `string` → `AST` \| `ParseError` | ✅ 33 tests | ✅ Ported, all golden values match |
| `ThompsonPass` | Thompson's construction | `AST` → `NFA` | ✅ 5 tests | ✅ Ported, all golden values match |
| `SubsetConstructionPass` | Subset construction (Rabin–Scott) | `NFA` → `DFA` | ✅ 5 tests | ✅ Ported, all golden values match |
| `MinimizationPass` | Moore's minimization | `DFA` → `Min-DFA` | ✅ 4 tests | ✅ Ported, all golden values match |
| `MatcherPass` | DFA-driven matching | `Min-DFA`, `string` → `MatchTrace` | ✅ 8 tests | ✅ Ported, all golden values match |
| `pipeline` | Chains all 5 passes into one call | `string`, `string` → snapshot of every stage \| `ParseError` | — (TS chains passes directly in tests) | ✅ Complete — a test proves output is identical to manually chaining all 5 passes |

All C++ tests pass under `-Wall -Wextra` with zero warnings in our own code, and the suite is clean under AddressSanitizer/UndefinedBehaviorSanitizer (run `./engine_tests` for the current case and assertion counts). The TS side has 55 per-pass unit tests plus a differential test.

Each pass has one job, one input type, and one output type, and is unit-testable without the rest of the pipeline. Passes are plain functions chained by the pipeline (a `Pass<In, Out>` interface was sketched in the original design but is not used). The same `Automaton` shape covers the NFA, DFA and min-DFA stages.

**Data contracts.** `types.ts` and `types.hpp` are analogous, not identical: the TS prototype uses `Set`/`Map` and a `char` field, while the C++ side and the JSON sent to the browser use arrays/objects, `ch`, and `null` for missing values. The **JSON wire format** emitted by `json_bridge.cpp` and consumed by `frontend/src/types/engine.ts` is the contract that matters; its full description lives in the `json_bridge.hpp` doc comment (a dedicated `docs/data-contracts.md` is tracked in issue #16).

### Module Structure

```
regexlab/
├── engine/
│   ├── types.ts                              # ✅ TS data contracts: AST, ParseError, Automaton, MatchTrace
│   ├── passes/
│   │   ├── parser-pass.{ts,cpp}              # ✅ recursive-descent parser + input guards
│   │   ├── thompson-pass.{ts,cpp}            # ✅
│   │   ├── subset-construction-pass.{ts,cpp} # ✅
│   │   ├── minimization-pass.{ts,cpp}        # ✅
│   │   └── matcher-pass.{ts,cpp}             # ✅
│   ├── pipeline.cpp                          # ✅ wires all 5 C++ passes; returns every stage
│   ├── json_bridge.cpp                       # ✅ serializes the pipeline snapshot to the JSON wire format
│   ├── wasm/bindings.cpp                     # ✅ Embind bindings exposing runPipeline() to JS
│   ├── include/regexlab/
│   │   ├── types.hpp                         # ✅ C++ data contracts
│   │   ├── pipeline.hpp
│   │   ├── json_bridge.hpp                   # JSON wire-format documentation
│   │   └── passes/*.hpp                      # one header per pass
│   └── __tests__/
│       ├── unit/                             # ✅ TS golden-value tests, one file per pass
│       ├── parity/parser-cases.test.ts       # ✅ TS half of the shared C++/TS parser parity fixture
│       └── differential.test.ts              # ✅ TS differential test vs native RegExp (anchored full-match), 2000 cases/run
├── tests/                                    # ✅ C++ Catch2 tests (golden values, pipeline, json bridge, differential)
│   ├── fixtures/parser-cases.json           # ✅ Shared parser parity cases for TypeScript and C++
│   ├── parser_cases_fixture_test.cpp        # ✅ C++ half of the shared parser parity fixture
│   ├── smoke_test.cpp
│   ├── parser_pass_test.cpp
│   ├── thompson_pass_test.cpp
│   ├── subset_construction_pass_test.cpp
│   ├── minimization_pass_test.cpp
│   ├── matcher_pass_test.cpp
│   ├── pipeline_test.cpp
│   ├── json_bridge_test.cpp
│   └── differential_test.cpp
├── scripts/
│   └── check-wasm-limits.mjs                 # ✅ probes the built WASM module: acceptance cases + stack-depth robustness
├── frontend/                                 # ✅ React + Vite, verified end to end against the real WASM build
│   ├── src/
│   │   ├── App.tsx
│   │   ├── hooks/useRegexEngine.ts           # loads the WASM module (Blob-URL import), exposes runPipeline()
│   │   ├── types/engine.ts                   # mirrors the JSON wire format exactly
│   │   └── components/                       # PatternInput, PlaybackControls, AutomatonView; SuggestionBanner stubbed, unwired
│   └── public/wasm/                          # regexlab.js + regexlab.wasm go here (built locally, not committed)
├── api/
│   └── suggest.ts                            # 📋 only if the AI layer uses an LLM (decision pending, issue #19)
├── CMakeLists.txt                            # ✅ C++ build — FetchContent for Catch2 + nlohmann/json; WASM target defaults to Release
├── package.json
├── tsconfig.json
├── CLAUDE.md                                 # project brief and working agreement (paste into every Claude session)
└── README.md
```

### Key Design Decisions

**Pass pipeline over one big function**
Each stage has one input type, one output type and its own tests, and the pipeline chains them — a deliberate echo of how LLVM structures its optimizer. Adding a capability (`+`/`?` quantifiers, character classes) means adding or extending a pass rather than rewriting the system.

**Structural precedence, not a precedence table**
The parser encodes `|` binding loosest, then concatenation, then `*`, purely through which grammar production calls which (`parseRegex` → `parseTerm` → `parseFactor` → `parseAtom`). Tighter-binding operators live deeper in the call chain — the standard recursive-descent technique from Aho/Lam/Sethi/Ullman.

**TypeScript prototype, C++ production**
The pipeline was built and validated in TypeScript first — cheap to iterate on, fast test loop. Once every pass had golden-value tests, it was re-implemented in C++, ported pass by pass against the TS reference, with every golden value carried into Catch2. If a bug existed in the algorithm itself, it would have to reproduce independently in two type systems and two test frameworks to slip through both.

**C++ compiled to WebAssembly, not a server backend**
The production engine runs entirely client-side via WASM — no server round-trip, no backend to keep warm, instant "type and see it match" feedback.

**The AI layer never gets the final word**
```
ParserPass fails → structured ParseError → a fix is proposed → the SAME
ParserPass re-parses the proposal → only shown if it is accepted
```
The hand-built parser has final say, every time, with no exception, so the suggestion layer cannot put an invalid pattern in front of a user. How the fix is *generated* (rule-based corrector vs LLM call) is a pending design decision (issue #19); the gate is the same either way.

**Differential testing as a first-class correctness story**
Beyond hand-picked golden tests, the matcher's output is checked against a reference engine — C++'s `std::regex` and JavaScript's native `RegExp` — on thousands of randomized inputs, used strictly as a test oracle, never a runtime dependency. The JS oracle is anchored as `^(?:…)$`, because `RegExp.test()` otherwise finds a match anywhere in the string and would silently test partial-match semantics instead of this engine's full-match behavior. Both suites generate patterns from the engine's own AST building blocks (always parseable) at nesting depth ≤ 3, so they validate matching semantics; size and nesting limits are covered by dedicated guard tests, not by the fuzzers.

---

## Limits and guards

| Guard | Value | Behavior |
|---|---|---|
| Pattern length | 500 characters | `PatternTooComplex` at position 500, in both parsers |
| Nesting depth | 1000 levels of `(` | `PatternTooComplex` at position 1000, in both parsers |
| Alphabet | ASCII only | A non-ASCII byte in the *pattern* is rejected as `UnexpectedToken`; a non-ASCII character in the *test string* simply fails to match |
| WASM build type | Release by default | An unoptimized (`-O0`) Emscripten build overflows the browser's JS stack at a far shallower recursion depth than the guards; `CMakeLists.txt` defaults the WASM target to Release |
| Subset construction | O(2^m) worst case | Exponential blowup in NFA states is a property of the algorithm, not a bug; bounded in practice by the pattern-length cap |
| Minimization | O(n²·k) (Moore's) | Fast under the 500-character cap; Hopcroft's O(n log n · k) is a documented possible improvement, not implemented |

`scripts/check-wasm-limits.mjs` re-checks these guards against a freshly built WASM module (each probe runs in its own process, since a WASM stack overflow corrupts the module instance).

---

## Testing Strategy

1. **Golden-value unit tests, per pass, in both languages.** Feed a known pattern, assert the exact expected AST shape / NFA state count / DFA state count / minimized state count. Ported 1:1 from TS (Vitest) to C++ (Catch2).
2. **Pipeline-equivalence testing (C++).** A dedicated test proves `runPipeline()`'s output is byte-identical to manually chaining all 5 passes across a spread of patterns — the justification for trusting the wired-together entry point.
3. **Differential testing, both languages.** C++ is fuzzed against `std::regex`; TypeScript is fuzzed against native `RegExp` (anchored for full-match). 2000 random (pattern, input) pairs per run. The TS test uses a seeded PRNG and prints the seed on failure so any mismatch is reproducible.
4. **Sanitizers and warnings.** The C++ suite is built with strict warnings and run under AddressSanitizer and UndefinedBehaviorSanitizer.
5. **Mutation discipline.** New tests are checked by breaking the implementation on purpose (invert a condition, drop a line) and confirming the test goes red before trusting it green.
6. **Browser verification.** The three acceptance cases (`(a|b)*ab` on `aab` → match, on `aba` → no-match, `(ab` → `UnmatchedParen`) were verified end to end in a real browser against the real WASM build, and `scripts/check-wasm-limits.mjs` re-checks the guards on the built module.
7. **Isomorphism-based equivalence testing** *(Hard Stretch, not Core)*. Two DFAs accept the same language iff their minimized forms are isomorphic.

## Complexity Analysis

| Stage | Time | Space | Note |
|---|---|---|---|
| Parsing | O(n) | O(n) | n = pattern length |
| Thompson's construction | O(n) | O(n) | linear in AST size |
| Subset construction | O(2^m) worst case | O(2^m) worst case | m = NFA states — exponential blowup, named explicitly rather than hidden |
| Minimization (Moore's) | O(n² · k) | O(n) | n = DFA states, k = alphabet size |
| Minimization (Hopcroft's, Hard Stretch) | O(n log n · k) | O(n) | only attempted once Moore's is solid and tested |
| Matching | O(n) per string | O(1) active state | why DFA matching beats naive backtracking engines |

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Core engine (production) | C++20, CMake, zero runtime dependencies | Compiles to WebAssembly for in-browser execution; systems-language depth beyond a frontend-only project |
| Core engine (prototype) | TypeScript, strict mode, zero dependencies | Fast dev loop for validating the algorithms before the C++ port; kept in the repo as the documented design-validation history |
| Engine tests (C++) | Catch2 v3 (CMake FetchContent), `nlohmann/json` for the bridge | Golden values, pipeline equivalence, JSON bridge, differential testing against `std::regex` |
| Engine tests (TS) | Vitest | Golden-value tests per pass, plus a seeded differential test against native `RegExp` |
| WASM bridge | Emscripten | Compiles the C++ engine to a `.wasm` module the frontend calls directly |
| Frontend | React + Vite | Fast dev loop; one view per pipeline stage, driven by pipeline output |
| Visualization | Hand-rolled SVG | Keeps the "built from scratch" story intact — no charting or graph library |
| AI suggestion generator | Decision pending (issue #19): rule-based corrector vs LLM via a serverless function | Either way, every candidate is re-parsed by the local parser before display |
| Deployment | Decision pending (issue #23): GitHub Pages if fully client-side, Vercel if an LLM proxy is needed | Depends on the #19 decision |

---

## Syllabus Mapping (BCSE307L — Compiler Design)

An honest mapping: deep where the problem domain naturally supports it, absent where it does not.

| Module | Topic | Coverage | How |
|---|---|---|---|
| 1 | Lexical analysis | **Direct, core** | Regex → DFA is the project; `ParserPass` → `ThompsonPass` → `SubsetConstructionPass` implements the syllabus's own named example (indirect route). The *direct method* (nullable/firstpos/lastpos/followpos) is not built |
| 2 | Syntax analysis | **Direct, partial** | Recursive-descent parsing, parse tree (the AST), unambiguous grammar with precedence by call order. The grammar is LL(1)-compatible but the parser is hand-written, not table-driven. No LR/SLR/LALR |
| 3 | Semantic analysis | Thin | `ParseError` detection is lightweight error checking inside the parser; no attribute grammars or separate semantic pass |
| 4 | Intermediate code | Real but unconventional | The AST is a syntax tree; the Thompson NFA plays the structural role of an IR between parsing and matching. No three-address code |
| 5 | Code optimization | Same word, different technique | DFA minimization reduces a representation to its minimal equivalent form, but it is automata theory, not data-flow, loop or peephole optimization |
| 6 | Code generation | Real, specific | `MatcherPass` turns the min-DFA into an executable matching procedure; C++ → WASM is a second, literal code-generation step. No registers or activation records |
| 7 | Parallelism | Not covered | Nothing in a regex engine naturally exercises this; stated plainly rather than forced |
| 8 | Contemporary issues | Not assessed | — |

---

## 🚦 Current Status

| Component | Status | Both teammates can explain it? |
|---|---|---|
| Language/track decision | ✅ Resolved — **C++ (Track B)**, compiled to WASM; TypeScript kept as the validated prototype | — |
| `ParserPass` + grammar | ✅ Complete in TS and C++, with length, depth and ASCII guards | Yes (TS) — merged via reviewed PR. C++ port: pending explain-it-back |
| `ThompsonPass` | ✅ Complete in TS and C++ | Pending explain-it-back checkpoint (both languages) |
| `SubsetConstructionPass` | ✅ Complete in TS and C++ | Pending explain-it-back checkpoint (both languages) |
| `MinimizationPass` (Moore's) | ✅ Complete in TS and C++ | Pending explain-it-back checkpoint (both languages) |
| `MatcherPass` | ✅ Complete in TS and C++ | Pending explain-it-back checkpoint (both languages) |
| `pipeline.cpp` + JSON bridge | ✅ Complete — carries every stage (AST, NFA, DFA, min-DFA, trace) | Pending explain-it-back checkpoint |
| Differential testing | ✅ Complete in both languages (`std::regex` and native `RegExp` oracles) | Pending explain-it-back checkpoint |
| WASM binding (Emscripten) | ✅ Complete — builds, ES-module output verified, limits probed by `scripts/check-wasm-limits.mjs` | — |
| Visualizer | ✅ Working end to end in a browser (AST tree + NFA/DFA/min-DFA graphs with match-trace playback). 🔄 Polish (animation, responsive layout, input-length UX) in review | — |
| Contract freeze (`docs/data-contracts.md`) | 📋 Not started (issue #16) | — |
| AI suggestion layer + hard gate | 📋 Not started — design decision pending (issues #19–#21) | — |
| CI + deployment | 📋 Not started (issues #22, #23) | — |
| Final report | 📋 Not started (issues #26, #27) | — |
| Hopcroft's / isomorphism testing (Hard Stretch) | 🔒 Locked until Core is done | — |

## Build Sequence

13-week plan, two people, Core scope only until Week 10:

| Weeks | Theory track | Systems/UI track | Checkpoint |
|---|---|---|---|
| 1–2 | Grammar + `ParserPass` + tests | Project scaffold, static UI shell against mock data | Explain the grammar & precedence rules |
| 3–4 | `ThompsonPass` + tests | `AutomatonView` renderer, fed by mock trace data | Explain Thompson's construction |
| 5–6 | `SubsetConstructionPass` (worklist) + tests | Playback controls, animation state machine | Explain subset construction, ε-closures |
| 7 | **Contract freeze** — `Automaton`/`MatchTrace` shapes locked | | |
| 8 | `MinimizationPass` (Moore's) + tests | Wire real pipeline output in, replace mocks | Explain Moore's minimization |
| 9 | `MatcherPass`; differential test suite | Suggestion banner UI + endpoint scaffold | Explain differential testing |
| 10 | Bug bash on adversarial patterns | AI integration + client-side re-validation gate | Full pipeline walkthrough, unaided |
| 11 | Report + viva prep | Polish: loading states, error messaging | |
| 12 | Hard Stretch, only if ahead of schedule | Deploy + demo video fallback | |
| 13 | Buffer | Buffer | Final full run-through together |

> **Note:** the engine work (all 5 passes, pipeline, both differential suites, WASM binding) is complete and the visualizer works end to end, ahead of the plan's original per-week pacing. The AI suggestion layer is now the largest unbuilt piece, followed by CI/deployment and the final report. The formal contract freeze (issue #16) is still owed and should land before the AI layer starts consuming `ParseError`.

---

## Run Locally

**C++ engine (production):**
```bash
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . -j$(nproc)
./engine_tests        # golden-value + pipeline + json-bridge + differential tests via Catch2
```

**TypeScript engine (prototype, still in the repo):**
```bash
npm install
npm test              # golden-value + differential tests via Vitest
npm run typecheck     # strict TypeScript check, no emit
```

**WASM module (needed to run the frontend with real data):**
```bash
# one-time setup
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest

# every session
source ~/emsdk/emsdk_env.sh
cd ~/regexlab
mkdir -p build-wasm && cd build-wasm
emcmake cmake ..                 # defaults to a Release build for the WASM target
emmake make regexlab_wasm
cp regexlab.js regexlab.wasm ../frontend/public/wasm/

# optional: re-check the guards against the fresh build
cd ~/regexlab && node scripts/check-wasm-limits.mjs
```
Run these from a native shell, not through a Windows UNC path (e.g. use the WSL terminal directly); `cmd.exe` cannot use `\\wsl.localhost\…` as a working directory. (A fuller, independently verified write-up is tracked in issue #17.)

**Frontend:**
```bash
cd frontend
npm install
npm run build     # typecheck + bundle
npm run dev       # needs regexlab.js / regexlab.wasm in frontend/public/wasm/
```

---

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| **Core (must-ship)** | `char`, concat, `\|`, `*`, `()`, pass pipeline (TS + C++), golden tests, pipeline-equivalence test, differential tests (both languages), WASM binding, visualizer, Moore's minimization, AI suggestion layer with hard gate | 🔄 In progress — engine, pipeline, differential testing, WASM binding and visualizer done; contract freeze, AI layer, CI/deployment and report remain |
| **Syllabus-coverage candidates** | LL(1) FIRST/FOLLOW + predictive table; direct-method DFA construction (nullable/firstpos/lastpos/followpos) | 🤔 Under consideration — decision pending; the direct-method pass must land before the contract freeze if chosen |
| **Stretch A** | `+`, `?` quantifiers | 📋 Planned — cheap once `*` works |
| **Stretch B** | `[a-z]` character classes | 📋 Planned — if time remains after Core is demo-ready |
| **Hard Stretch** | Hopcroft's minimization, isomorphism-based equivalence testing | 🔒 Gated — only after Core is finished *and* both teammates can explain differential testing and Moore's minimization without notes |
| **Explicitly out of scope** | Backreferences, lookahead/lookbehind | ❌ These break the regular-language guarantee — a theory-grounded scope decision, not an oversight |

---

## Engineering Reflection

*A running log of decisions worth being able to defend, not just describe.*

**On `ParserPass` (Week 1–2):** encoding operator precedence structurally — through which grammar production calls which — instead of a precedence table turned out to be the cleanest way to make the "`|` binds loosest, `*` binds tightest" rule impossible to get wrong by accident. Every precedence claim is directly checkable by reading four small functions in call order.

**On the TS → C++ port:** porting after the algorithms were proven in TS was closer to careful translation than fresh implementation — the real work was language idiom (`std::variant` + `if constexpr` for the tagged-union AST, explicit `operator==` overloads, tracking `std::unordered_map` iteration order in `MinimizationPass` where TS's `Map` preserves insertion order for free), not the algorithms.

**On the stack overflow and the guards:** the parser originally had no recursion limit, and a pattern with ~11,000+ nested parentheses crashed the process. It was found with a manual bisection probe, not by the fuzzer — the fuzzers only generate patterns at nesting depth ≤ 3 and cannot reach that regime, which is why guard behavior has its own dedicated tests. The first fix (a depth cap that only counted `(`) turned out to cover only one way of building a deep AST; a long chain of plain concatenations or alternations recurses just as deep. A pattern-length cap closed that gap. Verifying in a real browser then showed an unoptimized WASM build overflows the JS stack far earlier than either guard, which is why the WASM target now defaults to Release. The lesson: a guard is only proven once it is tested at the layer where it can actually fail.

---

## Academic Integrity Note

Built with extensive AI assistance (Claude) as a pair-programmer and tutor — not a ghostwriter. Every pass is gated behind an explain-it-back checkpoint before the next one starts, specifically to keep build velocity from outrunning genuine understanding of the underlying automata theory.

---

## Contact

**Vignesh P C** — [GitHub](https://github.com/Vignesh-P-C) · [LinkedIn](https://www.linkedin.com/in/vignesh-p-c/)
**CVS Ujwal** — [GitHub](https://github.com/ujwal2311) · [LinkedIn](Need to fill value)
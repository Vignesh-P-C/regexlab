# RegexLab — Project Walkthrough

**What this file is:** a study guide to the project as it exists in the current checkout. It explains the algorithms, data contracts, JS-to-WASM boundary, frontend flow, current limitations, and what remains to be done.

**How to read the status:** this guide was refreshed against the current repository on 2026-10-19. Test totals below are the last totals recorded in the previous version of this guide, not a new test run. The project's `readme.md` and `CLAUDE.md` still contain older status and design-plan text; this guide describes the code currently in the checkout.

This file is the study guide and walkthrough. It is separate from the repository's `readme.md` and `CLAUDE.md`.

---

## Contents

1. The project in one page
2. Current status (code review; test totals historical)
3. Architecture and repository map
4. The data contracts
5. The engine, pass by pass
6. The glue: pipeline, JSON bridge, WASM
   - including what crosses the JS ⇄ WASM boundary
7. The frontend
8. Tests, build, and how to run everything
9. **Pending work and how we'll add it**
10. Suggested order for the remaining work
11. Documentation status and known disagreements
12. Appendix: design decisions and limitations quick-reference

---

# 1. The project in one page

**RegexLab** takes a regular expression typed by a user and walks it through the exact pipeline a lexer-generator uses, showing every intermediate structure in the browser:

```
 pattern string
      │  ParserPass            recursive descent
      ▼
     AST          (or a structured ParseError)
      │  ThompsonPass          Thompson's construction
      ▼
   ε-NFA
      │  SubsetConstructionPass  Rabin–Scott subset construction
      ▼
    DFA
      │  MinimizationPass      Moore's partition refinement
      ▼
  minimal DFA
      │  MatcherPass           DFA simulation
      ▼
  MatchTrace   (step-by-step record of which state was active)
```

Key properties:
- **No regex libraries, no automata libraries.** Every algorithm is hand-written.
- **Implemented twice:** a TypeScript prototype (kept in the repo) and a C++20 production engine. The C++ is what the browser runs, compiled to WebAssembly.
- **Layers are decoupled:** the C++ engine returns a JSON string through WASM; the frontend parses it into a snapshot and renders it. AI suggestions are planned but not implemented.
- **Implemented regex syntax:** ASCII literals, concatenation, `|`, `*`, parentheses, and backslash escapes. Matching is against the full input string.
- **Limits:** patterns are capped at 500 characters; non-ASCII pattern characters are rejected. `+`, `?`, `.`, `[`, and `]` are literal characters, not operators.

---

# 2. Current status at a glance

Legend: ✅ implemented in the current source · 🟡 integrated but needs a local runtime artifact or polish · ⛔ not implemented · 🔒 optional/gated. Test totals are historical, as explained above.

| Component | Status | Evidence / notes |
|---|---|---|
| TypeScript contracts and five passes | ✅ | Implemented; the old grammar block in `engine/types.ts` is inaccurate about `+`, `?`, and character classes |
| ParserPass (TS) | ✅ | 33 tests were recorded in the prior run; not rerun for this update |
| ThompsonPass (TS) | ✅ | Implemented; prior guide recorded 5 tests |
| SubsetConstructionPass (TS) | ✅ | Implemented; prior guide recorded 5 tests |
| MinimizationPass, Moore's (TS) | ✅ | Implemented; prior guide recorded 4 tests |
| MatcherPass (TS) | ✅ | Implemented; prior guide recorded 8 tests |
| C++ data contracts (`types.hpp`) | ✅ | 1:1 mirror of `types.ts` |
| All 5 passes in C++ | ✅ | Golden values ported; previous guide recorded passing tests |
| `pipeline.cpp` (`runPipeline`) | ✅ | Pipeline-equivalence test |
| JSON bridge (`json_bridge.cpp`) | ✅ | Natively tested (`json_bridge_test.cpp`) |
| WASM binding (`bindings.cpp`) + CMake Emscripten target | ✅ | `build-wasm/regexlab.js` and `.wasm` exist in this checkout; frontend expects copies under `frontend/public/wasm/` |
| WASM limit probes (`scripts/check-wasm-limits.mjs`) | ✅ | Script exists; it expects the WASM files under the frontend public path |
| Differential testing, C++ vs `std::regex` | ✅ | 2,000 (pattern, input) pairs per run |
| Differential testing, TS side | ✅ | `engine/__tests__/differential.test.ts` exists and passes (vs native `RegExp`, anchored full-match); it's a file, not a `differential/` directory |
| Frontend: loading hook, App, input, controls, SVG view | 🟡 | Source is wired end-to-end to the real engine; the generated files are currently not in `frontend/public/wasm/`, so the app will show its load error until copied there |
| `SuggestionBanner` component | 🟡 | A stub; **not rendered anywhere** |
| AI suggestion endpoint (`api/suggest.ts`) | ⛔ | File doesn't exist |
| AI suggestion hard gate (client-side re-parse) | ⛔ | Not wired |
| Deployment | ⛔ | And has a real blocker, see §9.3 |
| `+`, `?` (Stretch A) | 🔒 | Currently parsed as *literal* characters, see §5.1 |
| `[a-z]` classes (Stretch B) | 🔒 | Same: `[`, `]` are literals |
| Hopcroft's, isomorphism testing (Hard Stretch) | 🔒 | Gated behind Core |
| Explain-it-back checkpoints | ⛔ | No completion record in the repository; use these sections as a study checklist |
| Report, viva prep, demo video | ⛔ | Yours to write |

**Current-checkout clarifications**
- The frontend integration is implemented, but app runtime also depends on the two generated WASM files being at the exact public paths it fetches. Those files are ignored by Git; this checkout has them in `build-wasm/`, not `frontend/public/wasm/`.
- Measured fresh for this guide refresh (`npm ci` + `npx vitest run`; `cmake --build` + `./engine_tests`, on current `main`): **125 TypeScript tests across 10 files** — 93 engine-side (33 parser + 36 shared parser-parity fixture + 5 Thompson + 5 subset + 4 minimization + 8 matcher + 2 differential) plus 32 frontend tests for the step-playback feature, issue #52 (5 `playbackIndex` + 22 `steps` + 5 `PlaybackControls`) — and **4,608 C++ assertions across 41 Catch2 cases**. The previously recorded "55 tests" / "4,517 assertions across 40 cases" were stale: they omitted the parity fixture, the differential test, and the frontend tests entirely.
- C++ `runPipeline` and the JSON bridge are implemented. The TypeScript side has individual passes and unit tests, but no TypeScript pipeline entry point or differential test suite.
- There is no `api/suggest.ts`, no working AI suggestion flow, and no deployment configuration. `SuggestionBanner.tsx` exists only as an unwired stub.
- The C++/WASM implementation is the production path. `engine/types.ts` comments and the root project brief still contain some original-plan text that describes syntax/architecture differently from the parser code; follow actual parser behavior as documented in §5.1.

---

# 3. Architecture and repository map

## 3.1 Layered view

```
┌──────────────────────────────────────────────────────────────┐
│ PRESENTATION  PatternInput · PlaybackControls (React)         │
├──────────────────────────────────────────────────────────────┤
│ VISUALIZATION AutomatonView (hand-rolled SVG)                 │
│   pure function of the engine's snapshot; derives nothing     │
├──────────────────────────────────────────────────────────────┤
│ SUGGESTION    planned only; component stub, no endpoint        │
├──────────────────────────────────────────────────────────────┤
│ JS ⇄ WASM BOUNDARY   runPipeline(pattern, input) → JSON text  │
├──────────────────────────────────────────────────────────────┤
│ ENGINE (C++20 → WASM)                                         │
│   Parser → Thompson → Subset → Minimize → Match               │
│   pipeline.cpp chains all five                                │
└──────────────────────────────────────────────────────────────┘
        (TypeScript prototype of the engine: kept for reference)
```

## 3.2 Repository map

```
regexlab/
├── engine/
│   ├── types.ts                    TS prototype contracts (some header notes are stale)
│   ├── passes/
│   │   ├── parser-pass.{ts,cpp}
│   │   ├── thompson-pass.{ts,cpp}
│   │   ├── subset-construction-pass.{ts,cpp}
│   │   ├── minimization-pass.{ts,cpp}
│   │   └── matcher-pass.{ts,cpp}
│   ├── pipeline.cpp                chains the five C++ passes
│   ├── json_bridge.cpp             PipelineResult → JSON string
│   ├── wasm/bindings.cpp           Embind glue (the ONLY Emscripten-only file)
│   ├── include/regexlab/
│   │   ├── types.hpp               C++ contracts (variant AST, Automaton, …)
│   │   ├── pipeline.hpp, json_bridge.hpp
│   │   └── passes/*.hpp
│   └── __tests__/unit/             Vitest tests for the TS passes
├── tests/                          Catch2 tests for the C++ engine (10 files)
├── frontend/                       React 19 + Vite 8 + TypeScript
│   ├── src/App.tsx, main.tsx
│   ├── src/hooks/useRegexEngine.ts
│   ├── src/components/{PatternInput,PlaybackControls,AutomatonView,SuggestionBanner}.tsx
│   ├── src/types/engine.ts         hand-mirrored JSON contract
│   └── public/wasm/                expected runtime location; currently empty
├── build-wasm/                     locally generated regexlab.js + regexlab.wasm in this checkout
├── scripts/check-wasm-limits.mjs   probes the built WASM module
├── CMakeLists.txt                  engine lib + tests + WASM target
├── package.json, tsconfig.json     TS engine tooling (Vitest, tsc)
├── CLAUDE.md                       project brief & working agreement
└── readme.md
```

Not present: `api/suggest.ts`, `engine/__tests__/differential/`, or `docs/data-contracts.md` / `docs/wasm-build.md`. The `docs/Context/` directory contains archived context files, not current engine documentation.

---

# 4. The data contracts

These are the shapes every pass agrees on. The TS version is `engine/types.ts`; the C++ version is `engine/include/regexlab/types.hpp`; the JSON version is mirrored by hand in `frontend/src/types/engine.ts`.

## 4.1 AST
Four node kinds only:

| Kind | Fields | Meaning |
|---|---|---|
| `char` | `value` | A literal character |
| `concat` | `left`, `right` | `left` followed by `right` (binary) |
| `alt` | `left`, `right` | `left | right` (binary) |
| `star` | `child` | Zero or more repetitions |

In C++ this is `std::variant<CharNode, ConcatNode, AltNode, StarNode>` held through `std::shared_ptr<ASTNode>`, with `makeChar/makeConcat/makeAlt/makeStar` factory helpers.

## 4.2 ParseError
`{ type, position, expected?, found? }` where `type` is one of:

| Type | When it fires | Example (verified) |
|---|---|---|
| `UnmatchedParen` | An opening `(` never closed, or a `)` with nothing to close | `(a` → pos 0; `a)` → pos 1 |
| `UnexpectedToken` | Something that can't continue the pattern, incl. end-of-input where an atom is required, non-ASCII, trailing backslash | `""` → pos 0; `a|` → pos 2 |
| `EmptyGroup` | `()` | `()` → pos 1 |
| `DanglingOperator` | `|`, `*` or `)` where an atom was expected | `*a` → pos 0; `a**` → pos 2; `a||b` → pos 2 |
| `PatternTooComplex` | Pattern longer than 500 chars, or nesting > 1000 | `a`×501 → pos 500 |

Passes return `ParseResult = {ok:true, ast} | {ok:false, error}` and **never throw** to callers.

## 4.3 Automaton (shared by NFA, DFA, min-DFA)
```
{ stateCount, startState, acceptStates, transitions }
transitions : state → (symbol | "eps") → [destination states]
```
- States are integers.
- ε-moves live under the string key `"eps"`. No collision is possible because real symbols are single characters.
- A DFA's destination lists always have exactly one element, so the matcher reads `[0]`.
- **DFAs are partial**: there is no explicit dead/trap state. No transition means "reject".

## 4.4 MatchTrace
```
{ steps: [{char, activeStates}], result: "match"|"no-match", failurePosition? }
```
For a DFA, `activeStates` has at most one element: one state while the path exists, then an empty list after a missing transition. `failurePosition` is set when matching hits a dead end. The TypeScript prototype calls the consumed character `char`; C++ and the JSON contract call it `ch`. C++ stores the optional failure position as `std::optional`; JSON always emits the field and uses `null` when there was no failure.

## 4.5 PipelineSnapshot (what the frontend receives)
```
{ ok:true,  ast, nfa, dfa, minDfa, trace }
{ ok:false, error }
```
JSON particulars: state IDs become **string keys** in `transitions` (JSON object keys must be strings), `acceptStates` becomes an array, match-step characters use the key `ch`, and absent optionals become `null`. The frontend's `PipelineSnapshot` type is maintained by hand and `JSON.parse(...) as PipelineSnapshot` is a TypeScript assertion, not runtime schema validation.

---

# 5. The engine, pass by pass

For each pass: job, algorithm, how the code does it, choices to be able to defend, and behavior you can demo.

## 5.1 ParserPass — recursive descent
**Files:** `engine/passes/parser-pass.ts`, `parser-pass.cpp`, `include/.../parser-pass.hpp`

**Job:** `string → ParseResult`.

**Algorithm:** recursive-descent (predictive) parsing, one function per grammar production:

```
parseRegex  :  term ('|' term)*
parseTerm   :  factor+          (loop while canStartFactor())
parseFactor :  atom '*'?
parseAtom   :  CHAR | '(' regex ')' | '\' CHAR
```

**Precedence by structure.** `parseRegex` calls `parseTerm`, which calls `parseFactor`, which calls `parseAtom`. The operator handled *deepest* binds *tightest*: `*` (in `parseFactor`) binds tighter than concatenation (the loop in `parseTerm`), which binds tighter than `|` (the loop in `parseRegex`). There's no precedence table anywhere.

**Associativity.** Both loops fold to the left: `a|b|c` → `alt(alt(a,b),c)`; `abc` → `concat(concat(a,b),c)`.

**`canStartFactor()`** is the lookahead: a term continues unless the next char is end-of-input, `|`, or `)`.

**Error handling.** Internal helpers `throw ParseFailure`; `parse()` catches once and returns `{ok:false,error}`.

**Safety limits** (the same in TS and C++):
- Max pattern length **500**; max nesting depth **1000**. Because a 500-char pattern can't nest 1000 deep, the length cap fires first, and the depth guard is defense in depth.
- **ASCII only** (code units ≤ 0x7F). A non-ASCII char in a *pattern* is `UnexpectedToken` with a fixed `found` description (never echoing the raw character).

**Additions beyond the written grammar (deliberately flagged in comments):** backslash escaping (`\(` = literal `(`).

**Behavior to know (verified):**
- `+ ? [ ] .` are **literals**. `a+` parses as `concat('a','+')`; it matches the string `"a+"` and not `"aaa"`. This is "unsupported" in the grammar sense, but not *rejected*. See §9.7 for the consequences.
- The empty pattern is rejected: `UnexpectedToken` at 0 (`found: "end of input"`). `a|` and `(|a)` are rejected too.
- `a**` is rejected (grammar allows one optional quantifier per atom), but `(a*)*` is fine.

## 5.2 ThompsonPass — AST → ε-NFA
**Files:** `thompson-pass.{ts,cpp}`

**Algorithm:** Thompson's construction (Aho et al., Ch. 3). Recursively build a *fragment* `{start, accept}` per AST node.

**Invariant:** every fragment has **one start, one accept**, with no edge into the start and none out of the accept.

| AST node | Construction | New states |
|---|---|---|
| `char c` | `s —c→ f` | 2 |
| `concat(A,B)` | `A.accept —ε→ B.start`; fragment = `(A.start, B.accept)` | 0 |
| `alt(A,B)` | new `s`: `s—ε→A.start`, `s—ε→B.start`; `A.accept—ε→f`, `B.accept—ε→f` | 2 |
| `star(A)` | new `s`,`f`: `s—ε→A.start`, `s—ε→f`, `A.accept—ε→A.start`, `A.accept—ε→f` | 2 |

**Size:** O(n) states and transitions. **Implementation:** an `NFABuilder` hands out integer state IDs and records transitions; the final `Automaton` has the single accept state of the root fragment.

**Verified sizes:** `ab`→4, `a|b`→6, `a*`→4, `(a|b)*ab`→12 states.

## 5.3 SubsetConstructionPass — ε-NFA → DFA
**Files:** `subset-construction-pass.{ts,cpp}`

**Algorithm:** subset construction (Rabin–Scott) as a worklist/fixpoint.

**Helpers:**
- `epsilonClosure(S)`: stack-based graph search over `"eps"` edges.
- `move(S, c)`: union of `c`-targets from every state in S.
- `alphabetOf(nfa)`: all symbols except `"eps"`, **sorted** (so numbering is deterministic).
- `setKey(S)`: sorted, comma-joined string, used to deduplicate DFA states.

**Procedure:**
1. DFA state 0 = ε-closure({NFA start}).
2. Pop an unprocessed DFA state; for each symbol, compute `ε-closure(move(S, c))`. Skip if empty (that's the omitted dead state). Otherwise look up/create the target via `idFor`, record the transition, push the target if unprocessed.
3. A DFA state accepts iff its set contains any NFA accept state.

**Detail that affects test numbering:** the worklist is a **LIFO stack** (`pop()` in TS, `back()/pop_back()` in C++). That ordering is why the golden tests' exact state numbers match across both languages.

**Worst case:** O(2^m) states, where m = NFA states. State it plainly.

**Verified:** `(a|b)*ab`: 12 NFA states → **4** DFA states.

## 5.4 MinimizationPass — Moore's algorithm
**Files:** `minimization-pass.{ts,cpp}`

**Algorithm:** Moore's partition refinement.
1. Initial groups: non-accepting, accepting (empty groups dropped).
2. `refine()`: for each group, bucket its states by **signature** = for every symbol (in sorted order), the *index of the group* its destination lies in (or `-` if no transition). States with equal signatures stay together; others split.
3. Repeat until a full pass causes no splits (**fixpoint**).
4. Build the min-DFA: each group becomes a state; renumber via a worklist from the start group so IDs come out in deterministic discovery order; accept groups are those whose members accept.

**Why it's correct:** the final partition is the set of **Myhill–Nerode** equivalence classes, so the result is the unique minimal DFA up to renaming.

**Partial-DFA handling:** the `-` marker makes "no transition" its own signature entry, equivalent to a transition into a rejecting trap state.

**C++ subtlety:** TS `Map` preserves insertion order and `std::unordered_map` doesn't, so the C++ port tracks `bucketOrder` explicitly to keep group (and hence state) numbering identical to TS.

**Complexity:** O(n²·k). Hopcroft's O(n log n · k) is a gated Hard Stretch.

**Verified:** `(a|b)*ab`: 4 DFA states → **3** (states 0 and 2 merge). `a|b`: 3 → 2. `a*`: 2 → 1.

## 5.5 MatcherPass — DFA simulation
**Files:** `matcher-pass.{ts,cpp}`

**Algorithm:** from the start state, for each input char take the single transition. If none exists, return `no-match` immediately with `failurePosition = i`. After consuming everything, `match` iff the final state accepts.

**Properties:** O(n) time in input length, O(1) extra space; no backtracking; **full-string match** (like `regex_match`, not search). Each consumed character appends a step `{char, activeStates:[current]}`.

**Verified trace** for `(a|b)*ab`: `aab` → states 1,1,2 → match; `aba` → 1,2,1 → no-match; `b` → 0 → no-match.

---

# 6. The glue: pipeline, JSON bridge, WASM

## 6.1 `pipeline.cpp` — `runPipeline(pattern, input)`
```
parse → (fail? return error, skip everything else)
      → thompsonConstruction → subsetConstruction → minimize → match(minDfa, input)
```
Returns a `PipelineResult` carrying **all** intermediate artifacts (`ast`, `nfa`, `dfa`, `minDfa`, `trace`) so the UI does not need to re-run the engine to switch stages. On a parse error it returns immediately; the four later stages are skipped. There is no `pipeline.ts` in the TypeScript prototype; the complete pipeline entry point only exists in C++.

## 6.2 `json_bridge.cpp` — the boundary
`runPipelineJson(pattern, input)` calls the C++ pipeline, converts its result into JSON using nlohmann/json, then returns the serialized JSON as a **string**. Points worth knowing:
- **nlohmann/json is used only here**, never inside a pass.
- `std::visit` with a generic lambda and `if constexpr` serializes the AST variant.
- A `static_assert` ties the error-name array to the `ParseErrorType` enum, so adding an enum value without a name fails the build instead of reading out of bounds.
- State IDs → string keys (JSON requirement).
- Native-testable: `tests/json_bridge_test.cpp` needs no Emscripten.

### What “one function across the boundary” means

The diagram's `runPipeline(p, s) → JSON` is a short name for the single call the browser needs. `p` is the pattern; `s` is the input string to match. In this codebase the actual names are `pattern` and `input`:

```text
React/TypeScript: runPipeline(pattern, input)
        │ two strings cross Embind
        ▼
C++: runPipelineJson(pattern, input)
        │ parse → NFA → DFA → minimized DFA → match
        │ serialize the PipelineResult
        ▼
JavaScript receives one JSON string
        │ JSON.parse
        ▼
PipelineSnapshot used by App and the visualizer
```

This is a *data-format boundary*, not a network request. The C++ code runs locally in the browser's WebAssembly instance. JavaScript passes two strings into the exported function; it does not pass React objects, TypeScript `Map`s, or a callback for every algorithm stage. Embind converts the strings to C++ `std::string`s. `runPipelineJson` returns one string because that is the stable value type exposed by the binding.

There are two response shapes. If parsing succeeds, JSON contains `ok`, the AST, all three automata, and the match trace. If parsing fails, JSON contains `ok: false` and the structured error; it does not include partial automata. The frontend parses either response once and stores the resulting snapshot. Stage tabs just select `ast`, `nfa`, `dfa`, or `minDfa` from that saved object. The scrubber selects a trace step; only min-DFA states are highlighted because the matcher traversed that automaton.

For example, with pattern `(a|b)*ab` and input `aab`, the browser sends those two strings. C++ builds the full pipeline snapshot and records the states visited by the final DFA matcher. JS parses the JSON, the UI shows the AST or any automaton stage, and the trace controls can move through the recorded match steps. Changing the selected tab does not call WASM again; changing the pattern or input does, after the app's 150 ms debounce.

The output is deliberately JSON rather than a collection of individual calls. It keeps the browser-facing API small, makes the serializer testable in a normal native C++ build, and gives the visualizer every intermediate result from the same engine run. The tradeoff is that the C++ structures, JSON shape, and frontend TypeScript types must stay synchronized by hand.

An abbreviated success object looks like this (large AST and transition maps omitted):

```json
{
  "ok": true,
  "ast": { "kind": "concat", "left": "…", "right": "…" },
  "nfa": { "stateCount": 12, "startState": 0, "acceptStates": [11], "transitions": { "0": { "eps": [1] } } },
  "dfa": { "…": "…" },
  "minDfa": { "…": "…" },
  "trace": {
    "steps": [{ "ch": "a", "activeStates": [1] }],
    "result": "match",
    "failurePosition": null
  }
}
```

For the simple pattern `a` and input `a`, the data is small enough to read directly:

```json
{
  "ok": true,
  "ast": { "kind": "char", "value": "a" },
  "nfa": { "stateCount": 2, "startState": 0, "acceptStates": [1], "transitions": { "0": { "a": [1] } } },
  "dfa": { "stateCount": 2, "startState": 0, "acceptStates": [1], "transitions": { "0": { "a": [1] } } },
  "minDfa": { "stateCount": 2, "startState": 0, "acceptStates": [1], "transitions": { "0": { "a": [1] } } },
  "trace": { "steps": [{ "ch": "a", "activeStates": [1] }], "result": "match", "failurePosition": null }
}
```

On a parse failure, the JSON is instead shaped like `{ "ok": false, "error": { "type": "…", "position": 0, "expected": "…", "found": "…" } }`; the bridge sends a structured error, not a C++ exception message. That's different from an engine-loading or runtime exception: the React app catches those, clears any stale snapshot, and displays an engine error.

## 6.3 `engine/wasm/bindings.cpp` — Embind registration
```cpp
EMSCRIPTEN_BINDINGS(regexlab_module) {
    emscripten::function("runPipeline", &regexlab::runPipelineJson);
}
```
Exposes `Module.runPipeline(pattern, input) → string`. This is the only Emscripten-dependent source file.

## 6.4 `CMakeLists.txt` — the build
- C++20; `-Wall -Wextra` on your own targets only.
- `FetchContent`: nlohmann/json **v3.11.3**, Catch2 **v3.5.4**.
- Targets: static lib `regexlab_engine`; test executable `engine_tests`; and, only under Emscripten, `regexlab_wasm`.
- Emscripten link flags: `-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=RegexLabModule -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node -sSTACK_SIZE=5242880 -fexceptions -lembind`. Output name `regexlab` ⇒ `regexlab.js` + `regexlab.wasm`.
- Emscripten builds default to **Release**, because an unoptimized (-O0) WASM build overflows the stack far shallower than the parser's own guard, which would make that guard untestable in production.

## 6.5 `scripts/check-wasm-limits.mjs`
Probes the built module. **Each probe runs in a fresh child process with a 10-second timeout**, because a linear-memory stack overflow corrupts the module instance and can hang. It checks: the three acceptance cases (`(a|b)*ab` on `aab`/`aba`, and `(ab` → `UnmatchedParen@0`), the 500/501-char boundary on literals, alternations and star chains, nesting boundaries, and non-ASCII handling (clean `UnexpectedToken`, not an exception). Run with `node scripts/check-wasm-limits.mjs` after copying the artifacts into `frontend/public/wasm/`.

---

# 7. The frontend

**Stack:** React 19, Vite 8, TypeScript, oxlint. No graph or chart library; the SVG is hand-rolled.

## 7.1 Loading the engine — `useRegexEngine.ts`
1. `fetch("/wasm/regexlab.js")`, read it as text.
2. Wrap in a `Blob`, `URL.createObjectURL`, then dynamic `import()` of the blob URL. *Why:* Vite's dev server refuses `import()` of files in `/public`.
3. Call the factory with `locateFile: (p) => "/wasm/" + p`. *Why:* a `blob:` URL has no real directory for Emscripten to find the sibling `.wasm`.
4. State machine: `loading → ready | error`. If the runtime files are absent, the error message tells you to copy the build output into `frontend/public/wasm/`.
5. Exposes `runPipeline(pattern, input)`, which `JSON.parse`s the engine's string into a `PipelineSnapshot`.

The hook fetches the generated `regexlab.js` from `/wasm/regexlab.js`; Emscripten then loads its sibling `.wasm` file through the supplied `locateFile` callback. Both files must be under `frontend/public/wasm/`. The frontend build can bundle without them because they are fetched at runtime, but using the app requires them.

## 7.2 `App.tsx` — state and flow
State: `pattern`, `input`, `snapshot`, `activeStage` (`ast|nfa|dfa|minDfa`), `activeStep`, `engineError`. Defaults: pattern `(a|b)*ab`, input `aab`.

**Data flow:**
```
user types ─▶ setPattern/setInput
              │ (150 ms debounce via setTimeout in useEffect)
              ▼
        runPipeline(pattern,input) ─▶ setSnapshot ; setActiveStep(0)
              │ (thrown error ⇒ snapshot=null, show engineError)
              ▼
 snapshot.ok ?  render PlaybackControls + AutomatonView + result line
            :   PatternInput shows the ParseError message
```
`activeStates` (the highlighted state) is taken from `trace.steps[activeStep]` and applied **only on the min-DFA tab**, since that's the automaton the matcher ran on.

## 7.3 Components
- **PatternInput** — two text inputs; shows `type at position N — expected X, found "Y"`; contains a reserved comment where the suggestion banner will go.
- **PlaybackControls** — two independent axes: stage tabs (AST/NFA/DFA/min-DFA) and a step scrubber (◀ slider ▶ with "step i / n").
- **AutomatonView** — either `AstTree` (recursive tree layout; depth → y, leaf order → x; node labels `'a'`, `·`, `|`, `*`) or `AutomatonGraph` (states on a circle; accept states double-ringed; start arrow; self-loops as arcs; two-way edges bow apart; parallel symbols merged into one label like `a,b`).
- **SuggestionBanner** — a stub with props `{error, suggestion, onAccept}`; **never rendered**.

## 7.4 What is and is not implemented in the frontend
Implemented: loading, engine-load errors, parse errors, empty visualization states, pattern/input editing, pipeline-stage tabs, manual trace scrubbing, match result display, and AST/automaton SVG rendering. There is no auto-play or speed control, transition labels show `eps` rather than ε, and the trace highlight applies only to min-DFA. There is no AI suggestion flow or deployment configuration. Circle layout becomes difficult to read for larger automata (roughly 10–12 states and up).

---

# 8. Tests, build, and how to run everything

## 8.1 Test suites
| Suite | Framework | Location | Scope |
|---|---|---|---|
| TS golden tests | Vitest | `engine/__tests__/unit/*.test.ts` | One file per pass; prior guide recorded 55 total |
| C++ unit/golden | Catch2 | `tests/*_pass_test.cpp` | Pass cases and golden values ported from the TS prototype |
| Smoke | Catch2 | `tests/smoke_test.cpp` | Build sanity |
| Pipeline equivalence | Catch2 | `tests/pipeline_test.cpp` | `runPipeline` equals manually chaining all five passes |
| JSON bridge | Catch2 | `tests/json_bridge_test.cpp` | Serialization shape contract |
| Differential | Catch2 | `tests/differential_test.cpp` | 200 random patterns × 10 random strings vs `std::regex` |

**How the differential test works:** `randomAST(depth≤3)` builds a *valid AST directly*; `serialize()` turns it into a pattern string, adding parentheses where precedence demands (an alternation inside concatenation, or any non-literal under `*`); the test re-parses it with the engine's own parser as a sanity check on the serializer, then compares `runPipeline(...)` against `std::regex_match` on random strings over `abcd` (≤6 chars). The source sets 200 patterns × 10 input strings = 2,000 pairs per run. A `std::random_device` seeds the generator, so a failing random case is not automatically reproducible from a logged fixed seed.

## 8.2 Commands (PowerShell / Windows)
```powershell
# TypeScript prototype — from the repository root
npm install
npm test                      # 125 tests / 10 files, measured fresh on current main
npm run typecheck             # strict tsc, no emit

# C++ engine (native) — from the repository root
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure # 4,608 assertions / 41 cases, measured fresh on current main

# WASM build — activate/use an Emscripten SDK environment first
emcmake cmake -S . -B build-wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build-wasm --config Release
Copy-Item build-wasm\regexlab.js, build-wasm\regexlab.wasm frontend\public\wasm\
node scripts\check-wasm-limits.mjs

# Frontend — from the frontend folder
Set-Location frontend
npm install
npm run dev                   # needs the two WASM files in public/wasm/
npm run build                 # tsc -b && vite build; bundling doesn't need WASM files
```

## 8.3 The development workflow (useful to be able to narrate)
1. Wrote the contracts and the grammar first (Weeks 1–2), so every pass had a stable interface.
2. Built each pass **in TypeScript** with golden tests and an explain-it-back checkpoint intended after each.
3. **Ported pass-by-pass to C++** with the golden values carried over, matching TS numbering exactly.
4. Added `pipeline.cpp` and the pipeline-equivalence test.
5. Added **differential testing** against `std::regex`.
6. Added the **JSON bridge** (natively tested) and the **WASM binding**, then hardened with length/depth/ASCII limits and a probe script after finding stack-overflow hangs (the "issue #29" and "D2/D4/D5/D7/D8" references in comments are those fixes).
7. Built the **React visualizer** against the real engine output.

---

# 9. Pending work and how we'll add it

These are possible next steps based on the current checkout. The older root brief still has its original scope gates and schedule; check your course requirements and your own understanding before choosing optional work.

## 9.1 Explain-it-back checkpoints  ·  Core  ·  **do first**
**Why:** working code is only useful in a viva if you can explain it. No explain-it-back results are recorded in the repository, so treat them as a personal learning task rather than a code status inferred from passing tests.
**Steps:** for each of Parser, Thompson, Subset, Minimization, Matcher, Pipeline, Differential testing: close the editor, and each of you explains aloud (input/output, algorithm name and idea, one tricky detail, one failure mode). Log who passed in a shared notes doc, and update CLAUDE.md §15.
**Done when:** each teammate can explain every row without reading code, and can trace one example from input pattern through the JSON snapshot.

## 9.2 AI suggestion layer with the hard gate  ·  Core  ·  *largest remaining feature*
**Status:** not implemented. `SuggestionBanner.tsx` is present but not rendered; there is no endpoint, model call, client hook, or parser gate for suggestions.

**Why it may matter:** only build this if AI suggestions are still a requirement. It is separate from the core regex pipeline and should never alter what the engine accepts.

**Design (from CLAUDE.md §12):**
```
parse fails ─▶ ParseError {type, position, expected}
   ─▶ POST /api/suggest {pattern, error}      (serverless; holds the API key)
   ─▶ LLM returns ONE candidate pattern string
   ─▶ browser runs runPipeline(candidate, "") in the local WASM engine
   ─▶ show "Did you mean: …" ONLY if ok === true; otherwise discard silently
```

**Files to add / change**
| File | Change |
|---|---|
| `api/suggest.ts` | New Vercel Edge Function: reads `GEMINI_API_KEY` (or chosen provider) from env, builds the constrained prompt, returns `{suggestion}` |
| `frontend/src/hooks/useSuggestion.ts` | New: calls the endpoint, applies the gate, caches by `pattern+error` key, handles timeout/failure |
| `frontend/src/App.tsx` | Hold `suggestion` state; trigger only when `snapshot.ok === false` (after the existing debounce) |
| `frontend/src/components/PatternInput.tsx` | Render `<SuggestionBanner …/>` in the reserved slot; `onAccept` sets the pattern |
| `frontend/src/components/SuggestionBanner.tsx` | Already exists; wire it up |
| `.env.local` (git-ignored already) | Local API key |
| `vercel.json` | Needed because the frontend lives in `frontend/` while `api/` is at repo root (see §9.3) |

**Steps**
1. Write the endpoint with the constrained prompt: *"Pattern: {pattern}. Error: {type} at position {position}, expected {expected}. Return ONLY a corrected regex pattern, no explanation."* Use the free-tier model recommended in CLAUDE.md (Gemini Flash-Lite).
2. Strip whitespace/backticks from the model's reply; reject empty or over-long output.
3. Build the **gate** in the client: `const r = runPipeline(candidate, ""); if (!r.ok) discard`. Also discard if `candidate === pattern`.
4. Don't call the LLM for `PatternTooComplex` (nothing to "fix"), and don't call on every keystroke. Trigger after the debounce, or via a "Suggest fix" button.
5. Cache the last few suggestions; keep 2–3 pre-tested broken patterns (`(ab`, `a**`, `*a`) as demo fallbacks.
6. Wire `SuggestionBanner` into `PatternInput`.

**How to test**
- Unit-test the gate with a mocked `fetch` returning (a) a valid pattern, (b) an invalid pattern, (c) the original pattern, (d) garbage; assert only (a) is ever shown.
- A small script that feeds 10 known-broken patterns through the endpoint and reports the gate's accept rate.

**Risks / things to be honest about**
- The gate guarantees **syntactic validity, not intent**. A valid but different pattern can still be suggested.
- **Privacy:** patterns are sent to a third-party API. Say so.
- Rate limits and latency: a demo-time failure must degrade silently (no banner), never break the page.
- Never put the API key in the browser bundle.

## 9.3 Deployment  ·  Core  ·  **has a real blocker**
**Current state:** `.gitignore` excludes `frontend/public/wasm/*.js` and `*.wasm`; `build-wasm/regexlab.js` and `build-wasm/regexlab.wasm` exist in this checkout, but the frontend's expected `frontend/public/wasm/` location is empty. The user-facing app therefore cannot load WASM until the files are copied there. There is no deployment configuration in the repository, so a deployment would also need a plan to build or provide those artifacts.

**Options**
| Option | How | Trade-off |
|---|---|---|
| **A. Commit the built artifacts** | Remove the two lines from `.gitignore`; commit `regexlab.js` + `regexlab.wasm`; add a short note/script describing how to rebuild | Simplest; artifacts can drift from source if you forget to rebuild |
| **B. Build in CI** | GitHub Actions: `setup-emsdk` → `emcmake cmake` → `emmake make` → copy artifacts → build frontend → deploy (Vercel CLI or Pages) | Reproducible and rigorous; more setup |
| **C. Hybrid** | Commit artifacts, but add a CI check that rebuilds and diffs them | Best of both, most work |

Recommendation: **A first** (unblocks the demo quickly), **C if time permits**.

**Other deployment steps**
1. Add `vercel.json` so Vercel builds `frontend/` (`buildCommand`, `outputDirectory: frontend/dist`) and still serves `api/` from the repo root. Test with `vercel dev` before deploying.
2. Verify `.wasm` is served with the right MIME type (`application/wasm`) and that the Blob-URL loading hack works in the production build, not just dev.
3. Run `scripts/check-wasm-limits.mjs` against the **deployed artifacts**.
4. Record a demo video as the fallback if the live demo fails.
5. There is a short `frontend/public/wasm/README.md`; there is no `docs/wasm-build.md` in the current checkout. Update that local build note if you want fuller setup instructions.

## 9.4 Frontend polish  ·  Optional
The frontend is already wired to the real engine. Possible refinements:
- **Auto-play** control for the match trace (play/pause, speed), reusing `activeStep`.
- Show **which input character was just consumed** at each step (the trace already has `ch`).
- Render `eps` as **ε**; add a small legend (start arrow, double ring = accept, highlighted = active).
- Show a short "supported syntax" note (`| * ( ) \`) to head off the `a+` surprise (§9.7).
- Check responsiveness and keyboard accessibility on narrow screens.
- Better layout for larger automata (the circle layout degrades past ~10–12 states): options are a layered left-to-right layout (rank by BFS distance from the start) or gentle force-directed relaxation, both hand-rolled to keep the "no library" claim.
- Optional: highlight the **path** across NFA/DFA tabs, not just on the min-DFA.

**When changing UI behavior:** the project has `npm run build`; manually inspect `(a|b)*ab`, `a*`, `(ab`, and a larger automaton.
**Risk:** layout work is a time sink; cap it. The theory is the graded part.

## 9.5 TypeScript-side differential tests  ·  Core (per CLAUDE.md), lower practical priority
**Why:** TypeScript has per-pass unit tests, but no TS differential suite or pipeline helper. The C++ side is the only differential suite.
**Steps**
1. `npm i -D fast-check`.
2. Create `engine/__tests__/differential/differential.test.ts`.
3. Write an AST arbitrary with `fc.letrec` (depth-bounded: `char` over `abcd`, `concat`, `alt`, `star`) and a `serialize()` identical in spirit to the C++ one (parenthesize `alt` inside `concat`; parenthesize any non-`char` under `star`).
4. Oracle: `new RegExp("^(?:" + pattern + ")$").test(input)`.
5. Add a tiny helper `runPipeline` (TS has none): `match(minimize(subsetConstruction(thompsonConstruction(ast))), input)`.
6. Use a **fixed, logged seed** so failures reproduce.
**Why it's lower priority:** the TS engine is the prototype. The value is mostly narrative ("two oracles, two languages"). If time is tight, skip it and say so honestly.

## 9.6 Housekeeping and robustness  ·  Core
- **Synchronize the root status docs when you choose to maintain them.** They still contain the original plan; this walkthrough describes current code.
- **Decide what to do with `Pass<In,Out>`:** a generic interface is declared in `types.hpp` but current passes are free functions, not objects. Either remove the unused declaration later or adopt it intentionally; it has no role in the current pipeline.
- **Empty pattern:** currently rejected, as are empty alternatives and groups. Supporting epsilon/empty language cases would require an explicit AST representation and changes through every pass; it is a feature decision, not an unfinished bug fix.
- **Contract drift guard:** add a small test that runs a few patterns through the built WASM and checks the JSON keys against `types/engine.ts`, or generate the TS types from one source.
- **Reproducible fuzzing:** log the seed in the differential test and allow overriding it.
- **CI:** a GitHub Actions workflow running `npm test`, the native C++ build with tests (ideally with ASan/UBSan), and the frontend build.

## 9.7 Stretch A — `+` and `?`  ·  🔒 gated
**First, note the current behavior:** `+` and `?` are **literal characters** today. Implementing Stretch A *changes the meaning* of any existing pattern containing them. After this lands, a literal plus needs `\+`. Update tests accordingly.

**Design choice (decide before coding):**
| Approach | How | Touches |
|---|---|---|
| **Desugar in the parser** | `a+` → `concat(a, star(a))` (reuse the atom twice; Thompson builds it twice, giving separate states). `a?` → `alt(a, empty)` | Parser, plus a new `empty` AST node + Thompson rule for `?` |
| **New AST nodes** | Add `plus` and `opt` kinds with their own Thompson rules | Parser, `types.ts`/`types.hpp`, Thompson (both languages), `json_bridge.cpp` visitor, frontend types and `AstTree` labels, differential serializer, tests |

Desugaring keeps downstream passes unchanged (fewer files, less risk) but makes the AST shown in the UI differ from what the user typed (`a+` appears as `a·a*`). New nodes show the user's intent but touch more files. Either is defensible. Pick one, and be ready to justify it.

**Steps:** (1) extend `quantifier` handling in `parseFactor`; (2) keep "one quantifier per atom" so `a+*` stays a `DanglingOperator`; (3) add the Thompson rule(s); (4) update the JSON visitor (a missing `if constexpr` branch makes the lambda return nothing, which is a compile error/warning); (5) update frontend `ASTNode` type and `AstTree` label function; (6) extend `randomAST`/`serialize` in the differential test and add golden tests; (7) update the grammar comment and the readme.
**Gate:** Core finished and both of you can explain differential testing and Moore's unaided.

## 9.8 Stretch B — character classes `[a-z]`  ·  🔒 gated
**Design:** desugar `[abc]`/`[a-c]` into an `alt` chain of `char` nodes in the parser (no new automaton rule needed). Ranges expand by ASCII code; validate `lo <= hi`; reject empty `[]`.
**Consequences:** `[a-z]` becomes 25 nested `alt`s (NFA ≈ 100 states, pushing the 500-char cap and the circle layout), so the visualizer will need a better layout (see §9.4). Consider capping range size. `[` and `]` stop being literals; escaping needed. New error cases (unterminated class, reversed range) mean new `ParseError` handling, and possibly new enum values (remember the `static_assert` in `json_bridge.cpp` will force you to add names).
**Files:** parser (TS/C++), tests, differential generator (optional), frontend (only if you add new error text).

## 9.9 Hard Stretch — Hopcroft's minimization and isomorphism testing  ·  🔒 gated hard
- **Hopcroft's:** replace `refine`'s round-based splitting with a worklist of splitter sets, always processing the *smaller* half of a split; O(n log n · k). Keep Moore's alongside it and add a test asserting both give **identical minimized automata** across the existing golden patterns and the random generator. Update the complexity table and report.
- **Isomorphism-based equivalence:** minimize two patterns' DFAs and check they are isomorphic (BFS from both start states, matching transitions by symbol). Use it to test identities like `a(b|c) ≡ ab|ac` and `(a*)* ≡ a*`.
- **Gate:** only after Core is finished *and* both can explain differential testing and Moore's cold. CLAUDE.md calls this a hard boundary.

## 9.10 Report, viva prep, demo video  ·  Core (deadline-driven)
Yours to write, with Claude as reviewer rather than author (CLAUDE.md §0.1 #6, §17). Contents: grammar, architecture diagram, complexity table, syllabus mapping, testing story, **honest limitations** (use §12 below), and what each of you built. Keep a shared notes doc of who built and understands what, in case you're questioned separately.

---

# 10. Suggested order for the remaining work

| # | Task | Why this position |
|---|---|---|
| 1 | Make the local WASM output available under `frontend/public/wasm/` | That's the path the app actually fetches; the files currently sit in `build-wasm/` |
| 2 | Walk through the complete boundary and pipeline (§6) | Explain what `pattern` and `input` mean, the JSON success/error shapes, and how React uses one snapshot |
| 3 | Complete explain-it-back checkpoints (§9.1) | Confirms that implementation knowledge matches the source, not just the diagrams |
| 4 | Decide whether a deployed demo is required; if so, define a repeatable way to supply WASM (§9.3) | No deployment configuration currently exists |
| 5 | Decide whether the AI suggestion feature is still required (§9.2) | It is separate from the functioning regex engine and is currently absent |
| 6 | Do only the UI refinements that help the planned demo (§9.4) | Stage selection and manual trace scrubbing already work |
| 7 | Consider TS differential tests and contract-drift protection (§§9.5–9.6) | These are quality improvements; C++ differential coverage already exists |
| 8 | Prepare report, viva notes, and demo material (§9.10) | Keep claims tied to what is actually implemented and understood |
| 9 | Stretch syntax / algorithm work | Only if required and time remains; it changes engine contracts and UI labels |

---

# 11. Documentation status and known disagreements

The walkthrough describes the code currently in the checkout. The following repository documents have not yet been synchronized and still describe parts of the original plan rather than the current implementation:

1. `readme.md` has stale test counts and still calls the frontend a scaffold in its status sections, despite the app being wired to `useRegexEngine` and the real WASM result.
2. `CLAUDE.md` retains the unresolved Track A/Track B decision and the original, unstarted progress tracker. The actual implementation is C++20 → WASM, with TypeScript retained as a prototype.
3. Both documents discuss AI as planned Core scope, but current source contains only the unwired `SuggestionBanner` stub and no endpoint.
4. `engine/types.ts` still has an original grammar comment that includes `+`, `?`, and character classes. The parser implementation does **not** implement those operators; it parses them as literals. Use §5.1 here for actual parser behavior.
5. `engine/pipeline.cpp` is the only pipeline entry point. No `engine/pipeline.ts` or TS differential test directory exists.
6. `docs/data-contracts.md` and `docs/wasm-build.md` are absent. `frontend/public/wasm/README.md` documents where to copy generated output; the `docs/Context/` folder contains archived context exports.
7. The WASM files are ignored by Git. They are present in this local checkout under `build-wasm/`, but are absent from the frontend's runtime folder.

---

# 12. Appendix — design decisions and limitations quick-reference

## Decisions you can defend
| Decision | Rationale |
|---|---|
| Pipeline of focused functions | Independent testing and clear data flow; `runPipeline` provides one caller-facing entry point |
| Precedence by call structure | Impossible to get out of sync with a table; directly checkable |
| One `Automaton` type for NFA/DFA/min-DFA | One place to read, one visualizer path |
| ε as string key `"eps"` | No collision: real symbols are single chars |
| Structured parse result | Invalid patterns return a typed `ParseError`; internal parser exceptions are caught before returning to callers |
| TS prototype → C++ port | Cheap iteration first, then production; shared golden values |
| WASM, not a server | No latency, no hosting cost, same technique as browser SQLite |
| JSON string across the boundary | Tiny stable interface; natively testable |
| Hand-rolled SVG | Keeps "built from scratch" true |
| Planned AI as an untrusted consumer | If implemented, suggestions should be checked by the same parser; this gate does not exist yet |
| Differential testing against an oracle | Stronger than hand-picked examples; oracle never at runtime |
| Backrefs/lookaround out of scope | They leave the regular languages; no DFA exists |

## Limitations to state before they're discovered
1. `+ ? [ ] .` are parsed as literal characters; they are not implemented operators.
2. The empty pattern and empty alternatives are rejected.
3. ASCII only; no Unicode.
4. Full-match semantics only (no substring search, no anchors).
5. Patterns capped at 500 characters.
6. DFAs omit the dead state (partial DFAs).
7. Subset construction is exponential in the worst case.
8. The AI layer and its validity gate are not built.
9. The WASM artifacts are not committed. A fresh clone needs an Emscripten build and copy into `frontend/public/wasm/` before the browser app can load the engine.
10. The frontend/JSON types are synchronized by hand.
11. The `Pass<>` interface is declared but unused; the passes are free functions.
12. Differential coverage is narrow (small alphabet, shallow patterns, one oracle, valid patterns only); the test generator's seed is not fixed or logged.

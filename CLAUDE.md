# RegexLab: Automata Made Visible
### CLAUDE.md v3 — Project Brief & Working Agreement
*Last refreshed: 14 Oct 2026. Supersedes v2. Source-code comments that cite "CLAUDE.md v2 §…" still point at the same section numbers here.*

> This document is self-contained. Paste it in full into every new Claude chat before asking for help on this project — a fresh Claude session has no memory of earlier sessions and needs this to have complete context. If this file conflicts with an older handoff document or chat, **this file and the code on `main` win**; when in doubt about project state, check §15 and the repo itself.
>
> Two audiences read this document: the Claude session helping you build, and the two of you building it. Section 0 is written directly to both.

---

## 0. Read This First

### 0.1 Operating instructions for this Claude session

1. **Don't build ahead of the current phase.** Check the Progress Tracker (§15) before writing any code. If Core isn't fully complete and both students can explain it, do not implement anything under Stretch A/B/Hard Stretch — even if asked directly. Flag it and confirm they're sure, since skipping ahead is the single biggest named risk in this plan (§16). The optional add-ons in §11 (issues #43–#47) are a *decision pending between the two teammates* — don't start them until that decision is recorded in §15.
2. **Prefer clear, well-commented, "textbook" code over clever or terse code.** This will be explained in a viva by two undergraduates, not maintained by a team. An implementation that visibly maps to the algorithm's textbook description beats a compact one every time.
3. **Always name the algorithm you're implementing or explaining** — Thompson's construction, subset construction (Rabin–Scott), Moore's minimization, etc. — and note that these are the constructions covered in Aho/Lam/Sethi/Ullman's *Compilers: Principles, Techniques, and Tools*, the prescribed textbook for BCSE307L.
4. **Run an "explain it back" checkpoint after every pass, before moving to the next one.** Ask the student(s) to explain what the pass does and why, in their own words, with no notes and no scrolling back up. If they can't do it cleanly, stay on this pass rather than proceeding.
5. **Flag added complexity honestly, in the moment.** If a request would meaningfully grow scope, add a new dependency, or introduce a new concept, say so before implementing it.
6. **Don't write the final report, abstract, or viva answers wholesale on the students' behalf.** Help them think it through, review and critique drafts, explain concepts as many times as needed — but the authored words should be theirs. See §17.
7. **When debugging, explain the bug, not just the fix.** A silent one-line patch defeats the point of the project.
8. **The implementation track is locked: Track B (C++ compiled to WASM), with the TypeScript engine kept as the validated prototype** (§1). Don't suggest switching.
9. **At the end of every session, remind the student to update the Progress Tracker (§15)** so the next session starts with accurate context instead of guesswork.
10. **Verify before you claim.** Several early docs overstated things (a "fuzzer found the bug" claim that was false, "types match 1:1" when they don't, passes described as `Pass` objects when they are plain functions). State only what has been checked, and say how it was checked. If something can't be verified from where you are, say so.
11. **Don't touch the validation gate.** Any AI-proposed pattern is untrusted input and must be re-parsed by the same hand-built parser before it is ever shown (§12). Never weaken or bypass this, even under deadline pressure.

### 0.2 Reminders for us, before every session

- Paste this file, plus the current Progress Tracker (§15), at the start of every new chat.
- Do the explain-it-back checkpoint with *each other*, not with Claude — Claude can prompt for it, but the test is whether you two can do it unassisted.
- Don't chase a stretch goal because it sounds impressive mid-project. Core, fully working and understood, beats a longer feature list that neither of you can defend.
- Check your course/university's policy on AI-assisted coursework — see §17.
- Keep a shared notes doc logging what each of you personally built and understand, in case you're questioned separately in viva.

### 0.3 Repo and workflow conventions

- **Repo:** `github.com/Vignesh-P-C/regexlab` (public). Collaborators: Vignesh (`Vignesh-P-C`, owner) and Ujwal (`ujwal2311`, Write access).
- **Branch protection on `main`:** changes land only through a pull request that needs an approval; "do not allow bypassing" is on, which applies to the owner too. So every change needs the other teammate's real review.
- **Branch per issue**, cut from an up-to-date `main`. Commit messages use conventional commits (`feat(frontend): …`, `fix(engine): …`, `docs: …`, `test(engine): …`). Put `Closes #N` in the PR body when a PR finishes an issue.
- **Before every push or PR:** `git fetch origin`, then check `git log --oneline HEAD..origin/main` is empty (otherwise `git rebase origin/main` and `git push --force-with-lease`), `git diff origin/main...HEAD --name-only` lists only intended files, and `git diff origin/main...HEAD -- .gitignore` is empty unless the change is deliberate.
- **README rule:** whenever files are added to the repo, update `README.md` (module-structure tree and status tables) in the same change, without waiting to be asked.
- **Environment:** Windows + WSL2 Ubuntu. Clone and run everything inside the WSL filesystem (`~/regexlab`), never through a `\\wsl.localhost\…` path (`cmd.exe` cannot use UNC working directories). Files copied in from a Windows browser leave `*Zone.Identifier` clutter; clean it before committing: `find ~/regexlab -name "*Zone.Identifier*" -delete`.
- **`gh` quirks:** `gh auth login` uses the browser flow. If `gh pr edit` fails on this machine's `gh` version, edit the PR body with `gh api -X PATCH repos/Vignesh-P-C/regexlab/pulls/<N> -f body="…"`.
- **`.gitignore`:** `/docs/*` is ignored except `docs/data-contracts.md` and `docs/wasm-build.md`; `build/`, `build-wasm/`, `frontend/public/wasm/*.{js,wasm}` and `.claude/` are ignored. A local `Context/` folder of chat exports must never enter the repo.
- **Local build/test commands:**
  - C++: `mkdir -p build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release && cmake --build . -j$(nproc) && ./engine_tests`
  - TS: `npm install && npm run typecheck && npx vitest run`
  - WASM: `source ~/emsdk/emsdk_env.sh`, then `mkdir -p build-wasm && cd build-wasm && emcmake cmake .. && emmake make regexlab_wasm`, copy `regexlab.js` and `regexlab.wasm` into `frontend/public/wasm/`, then `node scripts/check-wasm-limits.mjs`
  - Frontend: `cd frontend && npm install && npm run build && npm run dev`

---

## 1. Decision Gate — RESOLVED

**Status: RESOLVED — Track B.** The production engine is C++ compiled to WebAssembly with Emscripten; the TypeScript engine was built first as the validated prototype and is kept in the repo as the documented design history. Both implement identical algorithms and satisfy the identical syllabus mapping (§3).

Rationale: matches the lab's C++ convention, so there is no viva risk on "why isn't this C++", and gives a real two-implementation correctness story (a bug would have to reproduce independently in two languages and two test frameworks to slip through).

---

## 2. Design Philosophy

1. **The engine is pure and dependency-free.** No regex libraries, no NFA/DFA packages. If it's not hand-built, it doesn't count toward the syllabus claim or the resume claim. (Reference engines — `std::regex`, native `RegExp` — are used only as test oracles, never at runtime.)
2. **Layers are strictly decoupled.** The engine doesn't know a UI exists. The UI doesn't know an AI exists. Each layer runs and demos completely on its own.
3. **The AI layer is a consumer of engine output, never a participant in correctness.** It reads the engine's own structured error objects, and every suggestion it produces must pass back through the hand-built parser before it's ever shown. It never gets the final word.
4. **Every addition either directly serves the syllabus mapping or the resume claim, or it doesn't ship.** No scope creep for its own sake.
5. **Understanding gates progress, not just working code.** A pass isn't "done" when it compiles and passes tests — it's done when both of you can explain it from memory. This overrides "we're ahead of schedule, let's start the next thing."

---

## 3. Syllabus Mapping (honest version, for your report and viva prep)

Deep where the problem domain naturally supports it, absent where it does not. Do not oversell the thin rows.

| Syllabus module | Coverage | Notes |
|---|---|---|
| 1. Lexical analysis | **Direct, core** | Regex → DFA is the syllabus's own named example. Implemented via the *indirect* route (Thompson NFA → subset construction). The *direct method* (nullable/firstpos/lastpos/followpos) is not built; optional add-on #43 (§11) |
| 2. Syntax analysis | **Direct, partial** | Recursive-descent parsing, parse tree, unambiguous grammar with precedence by call order. LL(1)-*compatible* but hand-written, not table-driven; no LR/SLR/LALR |
| 3. Semantic analysis | Thin | `ParseError` detection is lightweight error checking inside the parser; no attribute grammars or separate semantic pass. Optional add-on #43 would add a real S-attributed definition |
| 4. Intermediate code | Real but unconventional | The AST is a syntax tree; the Thompson NFA plays the structural role of an IR. No three-address code; optional add-on #46 would add a linear intermediate form with backpatching |
| 5. Code optimization | Same word, different technique | DFA minimization reduces a representation to its minimal equivalent form; it is automata theory, not data-flow/loop/peephole optimization. Optional add-ons #45 (algebraic simplification) and #46 (basic blocks, CFG, VM-code verifier) would add real instances |
| 6. Code generation | Real, specific | `MatcherPass` turns the min-DFA into an executable matching procedure; C++ → WASM is a second, literal code-generation step. No registers or activation records |
| 7. Parallelism | Not covered | Nothing here naturally exercises it; say so plainly |
| 8. Contemporary issues | Not assessed | Two lecture hours, not a project deliverable |

If asked "why more TOC than compiler concepts": Module 1 itself frames lexical analysis as regex-to-DFA, so going deep there *is* compiler content; Modules 3–7 assume a full programming language under analysis, and building contrived versions would be less honest than going deep and rigorous where the problem supports it.

---

## 4. High-Level Architecture

```
                         PRESENTATION LAYER
              Pattern input · Test-string input · Playback controls
                             │                       │
                             ▼                       ▼
        VISUALIZATION LAYER                  SUGGESTION LAYER (planned)
   Renders pipeline output as an        (only invoked on parse failure)
   SVG graph. Pure function of          Proposes a fix for the engine's
   engine state — no logic of its       structured ParseError; the fix
   own.                                 re-enters through the same
                                         parser gate before ever shown.
                     │                                │
                     ▼                                │ suggestion string
        CORE ENGINE — PASS PIPELINE                   │  (untrusted,
   ParserPass             → AST  (or ParseError)       │   re-parsed
   ThompsonPass           → NFA                        │   before use)
   SubsetConstructionPass → DFA  (worklist/fixpoint)
   MinimizationPass       → Min-DFA
   MatcherPass            → MatchTrace
```

**Why this shape:** the Core Engine is a pure library — string in, structured data out — independently runnable and testable with no UI. The Suggestion Layer sits *beside* the engine, never inside it. The Visualization Layer only renders what the engine already computed, which keeps the hardest theory bugs confined to one layer.

---

## 5. Implementation (Track B, locked)

| Layer | Choice | Why |
|---|---|---|
| Core engine (production) | C++20, CMake; only dependency is `nlohmann/json` (fetched via CMake) for output serialization | Matches the lab's language convention |
| Compilation to browser | **Emscripten** → `regexlab.js` + `regexlab.wasm` (`MODULARIZE=1`, `EXPORT_ES6=1`, `EXPORT_NAME=RegexLabModule`, Embind). The WASM target defaults to a **Release** build | An unoptimized build overflows the browser's JS stack far earlier than the parser's guards |
| Core engine (prototype) | TypeScript, strict mode, zero dependencies | Fast iteration; kept as the design-validation history and the second implementation |
| Engine tests | Catch2 v3 (C++, native, no browser needed); Vitest (TS) | Test the engine as an ordinary program first, WASM second |
| Frontend | React + Vite + TypeScript; hand-rolled SVG for every view (no charting/graph library) | Keeps the "built from scratch" story intact |
| AI generator + proxy | **Decision pending (#19):** rule-based corrector (offline, deterministic, static hosting) vs LLM via a serverless function (API key server-side) | The choice also decides hosting (#23) |
| Deployment | **Decision pending (#23):** GitHub Pages if fully client-side, Vercel if an LLM proxy is needed | Depends on #19 |

---

## 6. Formal Grammar

Write this into the parser file as a comment block — a parser without a written grammar is a parser you can't prove is complete.

```
regex      ::= term ('|' term)*
term       ::= factor+
factor     ::= atom quantifier?
quantifier ::= '*' | '+' | '?'
atom       ::= CHAR
             | '(' regex ')'
             | '[' charclass ']'
charclass  ::= CHAR ('-' CHAR)? (CHAR ('-' CHAR)?)*
```

**Implemented today (Core):** `CHAR` (a backslash escapes a metacharacter), concatenation, `|`, `*`, `( )`. `+`, `?`, and `[a-z]` character classes are stretch goals (§11). Because `a**` is not in this grammar, `*` after a quantified atom is a syntax error (`DanglingOperator`).

---

## 7. Core Engine — Data Contracts

The contract that matters is the **JSON wire format** between the C++/WASM engine and the frontend. `frontend/src/types/engine.ts` mirrors it exactly, and `json_bridge.hpp` documents it. The TypeScript prototype's in-memory types in `engine/types.ts` are *analogous, not identical* (see the differences below). A dedicated `docs/data-contracts.md` and the formal freeze are issue #16.

```typescript
// Wire format (what runPipeline(pattern, input) returns, as a JSON string)
type ASTNode =
  | { kind: "char"; value: string }
  | { kind: "concat"; left: ASTNode; right: ASTNode }
  | { kind: "alt"; left: ASTNode; right: ASTNode }
  | { kind: "star"; child: ASTNode };

type Automaton = {
  stateCount: number;
  startState: number;
  acceptStates: number[];
  transitions: Record<string, Record<string, number[]>>; // stateId (string key) -> symbol|"eps" -> [targets]
};

type MatchStep = { ch: string; activeStates: number[] };

type MatchTrace = {
  steps: MatchStep[];
  result: "match" | "no-match";
  failurePosition: number | null;
};

type ParseErrorType =
  | "UnmatchedParen" | "UnexpectedToken" | "EmptyGroup" | "DanglingOperator"
  | "PatternTooComplex"; // pattern length > 500 or nesting depth > 1000

type ParseError = { type: ParseErrorType; position: number; expected: string | null; found: string | null };

type PipelineSnapshot =
  | { ok: true; ast: ASTNode; nfa: Automaton; dfa: Automaton; minDfa: Automaton; trace: MatchTrace }
  | { ok: false; error: ParseError };
```

**Known differences between the TS prototype's types and the wire format** (document these rather than claiming 1:1):

| Item | `engine/types.ts` (TS prototype) | Wire format / `types.hpp` |
|---|---|---|
| Match-step character field | `char` | `ch` |
| Missing optional values | optional (`undefined`) | `null` |
| `acceptStates` | `Set<number>` | array |
| `transitions` | `Map<number, Map<…>>` | object with **string** keys (convert with `Number(key)` when you need the id) |

**Parser classification quirks to know before writing the AI layer** (both parsers behave identically): `(a` → `UnmatchedParen` at 0; `(` → `UnexpectedToken` at 1; `a)` → `UnmatchedParen` at 1; `)` → `DanglingOperator` at 0; `a|` → `UnexpectedToken` at 2; 1001 unclosed `(` → `PatternTooComplex` at 1000. A rule-based fixer must key on `(type, found)` together, not `type` alone.

---

## 8. The Pass Pipeline

The engine is a **pipeline of passes**, an echo of how LLVM structures its optimizer:

```
ParserPass  →  ThompsonPass  →  SubsetConstructionPass  →  MinimizationPass  →  MatcherPass
```

Each pass has one job, one input type, one output type, and is independently unit-testable. In the code, passes are **plain functions** chained by `pipeline.cpp`; a generic `Pass<In, Out>` interface was sketched earlier but is not used — don't describe the code as if it were. Adding a capability (`+`/`?`, character classes) means extending or adding a pass.

---

## 9. Testing Strategy

1. **Golden-value unit tests, per pass, in both languages — Core, done.** Exact expected AST shape / state counts for known patterns; ported 1:1 from Vitest to Catch2.
2. **Pipeline-equivalence testing (C++) — done.** `runPipeline()` output is identical to manually chaining the five passes.
3. **Differential testing — Core, done in both languages.** C++ vs `std::regex`; TypeScript vs native `RegExp` anchored as `^(?:…)$` (unanchored `RegExp.test()` is a partial-match oracle and would silently test the wrong thing). Random ASTs at depth ≤ 3 over the alphabet `abcd`, 2000 cases per run; the TS test is seeded and prints its seed on failure. These validate *matching semantics*; they cannot reach deep-nesting or large-pattern regimes, so size/nesting limits have their own guard tests.
4. **Sanitizers and warnings — done.** Strict warnings, AddressSanitizer + UndefinedBehaviorSanitizer on the C++ suite.
5. **Mutation discipline.** Don't trust a test just because it's green: break the implementation on purpose, confirm red, revert, confirm green.
6. **Browser verification — done.** The three acceptance cases verified in a real browser against the real WASM build; `scripts/check-wasm-limits.mjs` re-probes the guards on any fresh build.
7. **Isomorphism-based equivalence testing — Hard Stretch.** Two DFAs accept the same language iff their minimized forms are isomorphic. If the direct-method pass is built (§11), this becomes the natural cross-check against the Thompson route.

---

## 10. Complexity Analysis and Input Guards (include in your report)

| Stage | Time | Space | Note |
|---|---|---|---|
| Parsing | O(n) | O(n) | n = pattern length |
| Thompson's construction | O(n) | O(n) | linear in AST size |
| Subset construction | O(2^m) worst case | O(2^m) worst case | m = NFA states — name the exponential blowup, don't hide it |
| Minimization (Moore's — Core) | O(n² · k) | O(n) | n = DFA states, k = alphabet size; fast under the 500-char cap |
| Minimization (Hopcroft's — Hard Stretch) | O(n log n · k) | O(n) | only after Moore's is solid; otherwise a documented limitation |
| Matching | O(n) per string | O(1) active state | why DFA matching beats naive backtracking engines |

| Guard | Value | Behavior |
|---|---|---|
| Pattern length | 500 characters | `PatternTooComplex` at position 500 (both parsers) |
| Nesting depth | 1000 levels of `(` | `PatternTooComplex` at position 1000 (both parsers) |
| Alphabet | ASCII only | Non-ASCII byte in the *pattern* → `UnexpectedToken`; in the *test string* it just doesn't match |
| WASM build | Release by default | `-O0` overflows the JS stack at nesting depth ≈ 172, before the guards can fire |

The length cap exists because the nesting guard counts only `(`: a long chain of plain concatenations or alternations builds an equally deep AST. A guard is only proven once tested at the layer where it can fail (the browser build).

---

## 11. Phased Scope

| Phase | Scope | Status |
|---|---|---|
| **Core (must-ship)** | `char`, concat, `\|`, `*`, `()`, pass pipeline (TS + C++), golden tests, pipeline-equivalence test, differential tests (both languages), WASM binding, visualizer, Moore's minimization, AI suggestion layer with hard gate | 🔄 Engine, pipeline, differential testing, WASM and visualizer done. Contract freeze, AI layer, CI/deployment and report remain |
| **Optional add-ons for syllabus coverage** (label `optional add-ons for syllabus coverage`) | (a) LL(1) FIRST/FOLLOW + predictive table (no issue yet); (b) #43 + #44 direct-method DFA via attributes (Modules 1, 3); (c) #45 AST simplifier (Module 5); (d) #46 + #47 bytecode backend with backpatching, VM matcher and verifier (Modules 4, 5, 6) | 🤔 **Decision pending between the teammates; none may start until it is recorded in §15.** (b), (c) and (d) change the JSON contract, so whichever are kept must land *before* the contract freeze (#16). Suggested order: (b), then (c), and (d) only once the AI layer, CI and the report are on track. Skipped as not worthwhile: a dead-state-elimination pass (measured: it removes nothing on real pipeline output) and anything claiming parallelism |
| **Stretch A** | `+`, `?` quantifiers | Cheap once `*` works |
| **Stretch B** | `[a-z]` character classes | If time remains after Core is demo-ready |
| **Hard Stretch** | Hopcroft's minimization, isomorphism-based equivalence testing | Only if Core is finished *and* both can explain differential testing and Moore's minimization without notes — the two places where AI-assisted speed and genuine understanding are most likely to diverge |
| **Explicitly out of scope** | Backreferences, lookahead/lookbehind | These break the regular-language guarantee — a theory-grounded scope decision, not an oversight |

---

## 12. The AI Suggestion Layer — Detailed Flow

```
1. ParserPass fails → returns a structured ParseError (type, position, expected, found)
2. A candidate fix is produced from { pattern, error }  — GENERATOR IS A PENDING DECISION (#19):
     Option A: rule-based corrector keyed on (type, found) — offline, deterministic, no backend,
               and a genuine instance of phrase-level error recovery from the syntax-analysis chapter
     Option B: LLM behind a serverless function that holds the API key
     Option C: A first, B later as a fallback
3. The candidate is re-run through the SAME local parser the user's input goes through
   (the C++ parser via WASM in the browser — NOT the TS prototype)
4. HARD GATE: only if the local parser accepts it is "Did you mean: ..." shown
5. If rejected, the candidate is silently discarded — never shown as valid
```

Step 4 is the single most important interview-defensible detail in the whole system: the AI layer cannot put a wrong answer in front of a user, because the hand-built parser has final say, every time. Notes: if the generator is rule-based, the README's "AI-assisted" wording is only accurate if an LLM fallback is added. The frontend wiring (#21) must tag each suggestion request with the pattern it was made for and drop responses whose pattern has since changed.

---

## 13. Repository Structure (current)

```
regexlab/
├── engine/
│   ├── types.ts                      # TS prototype's in-memory types
│   ├── passes/                       # parser, thompson, subset-construction, minimization, matcher — .ts and .cpp each
│   ├── pipeline.cpp                  # chains the five C++ passes; returns every stage
│   ├── json_bridge.cpp               # serializes the pipeline snapshot (the JSON wire format)
│   ├── wasm/bindings.cpp             # Embind: exposes runPipeline(pattern, input)
│   ├── include/regexlab/             # types.hpp, pipeline.hpp, json_bridge.hpp, passes/*.hpp
│   └── __tests__/
│       ├── unit/                     # TS golden-value tests, one file per pass
│       └── differential.test.ts      # TS differential test vs native RegExp
├── tests/                            # C++ Catch2: per-pass tests, pipeline, json_bridge, differential
├── scripts/check-wasm-limits.mjs     # probes a built WASM module (acceptance cases + stack-depth robustness)
├── frontend/
│   ├── src/                          # App.tsx, hooks/useRegexEngine.ts, types/engine.ts, components/
│   └── public/wasm/                  # regexlab.js + regexlab.wasm (built locally, not committed)
├── docs/                             # only data-contracts.md and wasm-build.md are tracked (see .gitignore)
├── api/suggest.ts                    # only if the AI layer uses an LLM (#19)
├── CMakeLists.txt, package.json, tsconfig.json
├── CLAUDE.md                         # this file
└── README.md
```

---

## 14. Build Sequence — 2–3 Months, Two People

| Week | Theory-heavy person | Systems/UI-heavy person | Checkpoint |
|---|---|---|---|
| 1–2 | Data contracts (§7), formal grammar (§6). ParserPass + golden tests | Scaffold, static UI shell against mock automaton data | Explain-it-back: the grammar and precedence rules |
| 3–4 | ThompsonPass + tests | AutomatonView renderer, fed by mock trace data | Explain-it-back: Thompson's construction |
| 5–6 | SubsetConstructionPass (worklist-framed) + tests | Playback controls, animation state machine | Explain-it-back: subset construction, ε-closures |
| 7 | **Contract freeze** — shapes locked | Same checkpoint, both sign off | — |
| 8 | MinimizationPass (Moore's) + tests | Wire real pipeline output into the renderer, replace mocks; begin WASM build | Explain-it-back: Moore's minimization |
| 9 | MatcherPass + trace; differential test suite | Suggestion banner UI + endpoint scaffold | Explain-it-back: differential testing methodology |
| 10 | Bug bash on adversarial patterns, together | AI integration + client-side re-validation gate (§12) | Both walk through the full pipeline end to end, unaided |
| 11 | Report: grammar, complexity table, syllabus mapping (§3), viva prep | Polish: loading states, error messaging, responsiveness | — |
| 12 | Hard Stretch only if genuinely ahead | Deploy; record a demo video as a live-demo fallback | — |
| 13 | Buffer | Buffer | Final full run-through together |

*Actual pacing: the engine, both differential suites, the WASM binding and a working visualizer are done ahead of this plan; the formal contract freeze (week 7) is still owed.*

---

## 15. Progress Tracker — update this before every new chat

*As of 14 Oct 2026.* Paste your current version into every new Claude session.

| Component | Status | Both can explain it? | Notes |
|---|---|---|---|
| Decision Gate (§1) | ✅ Resolved — Track B | — | C++ → WASM; TS kept as prototype |
| ParserPass + grammar | ✅ TS + C++ | TS yes; C++ pending | Length, depth and ASCII guards in both |
| ThompsonPass | ✅ TS + C++ | Pending | |
| SubsetConstructionPass | ✅ TS + C++ | Pending | |
| MinimizationPass (Moore's) | ✅ TS + C++ | Pending | O(n²·k), documented limitation |
| MatcherPass | ✅ TS + C++ | Pending | |
| pipeline + JSON bridge | ✅ C++ | Pending | Carries ast/nfa/dfa/minDfa/trace |
| Differential testing | ✅ Both languages | Pending | C++ vs `std::regex`; TS vs anchored native `RegExp` |
| WASM binding | ✅ | — | Release default; `scripts/check-wasm-limits.mjs` |
| End-to-end browser verification (#14) | ✅ Closed | — | Three acceptance cases verified |
| Audit fixes D1–D8 | ✅ Closed | — | Loader (Blob import), Release build, try/catch, 500-char cap, ASCII rule, AST/edge rendering |
| Visualizer polish (#24, #25, #36) | ✅ Merged | — | Animation + edge-label contrast, layered layout + responsive, length counter; manual 360px/theme QA open in #41 |
| Contract freeze (#16) | 📋 Not started | — | Must land before the AI layer reads `ParseError`; blocked on the §11 optional add-on decisions (#43, #45, #46) |
| WASM build doc (#17) | 📋 Not started | — | README has working steps; needs independent verification |
| Explain-it-back session (#18) | 📋 Not started | — | Both teammates; include the guard story and the oracle-anchoring detail |
| AI suggestion layer (#19–#21) | 📋 Not started | No | #19 decision pending: rule-based vs LLM vs A-then-B |
| CI (#22), hosting (#23) | 📋 Not started | — | #23 waits on #19 |
| Final report (#26, #27) | 📋 Not started | — | Include D2/D4 limits, Moore vs Hopcroft, honest `Pass` description |
| Optional syllabus add-ons (§11) | 🤔 Decision pending | — | #43–#47 (direct method, simplifier, bytecode backend, frontend halves); LL(1) table has no issue yet |
| Hopcroft's / isomorphism testing (Hard Stretch) | 🔒 Locked | No | |

**Small cleanups still open:** correct the handoff-doc claim that the fuzzer found the original stack overflow (it was a manual bisection probe; the fuzzer's depth ≤ 3 can't reach it); update any doc that still describes only the depth-1000 guard; Ujwal's LinkedIn link in the README (#7).

**Decisions pending between the teammates:** (1) which optional add-ons are in (#43–#47, and the LL(1) table), decided before #16; (2) AI generator: rule-based, LLM, or A-then-B (#19); (3) Moore's O(n²) as a documented limitation vs Hopcroft later; (4) who owns which remaining issue.

---

## 16. Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hopcroft's minimization too fiddly | Medium | Ship Moore's (§11) — a real, citable, correct algorithm |
| Subset construction state explosion on adversarial patterns | Low–Medium | The 500-character cap bounds it in practice; name the exponential worst case honestly (§10) |
| Pathological input crashes the engine or leaves stale UI | Low (mitigated) | Length/depth/ASCII guards in both parsers; Release WASM build; frontend try/catch; `check-wasm-limits.mjs` after every WASM rebuild |
| SVG layout unreadable on large automata | Low | Layered left-to-right layout and horizontal scroll; length cap bounds size |
| AI API rate limit or key issue mid-demo | Low | Prefer the rule-based generator (no API); otherwise cache suggestions and keep pre-tested broken patterns ready |
| Contract drift between TS prototype, C++ and the frontend | Medium | The JSON wire format is the contract; freeze it in #16 before the AI layer consumes it; anything adding fields (e.g. the direct-method automaton) lands first |
| PR review bottleneck (branch protection needs the other teammate's approval) | Medium | Keep PRs small and scoped to one issue; agree a review turnaround |
| **AI-assisted build velocity outpacing genuine understanding** | **Medium–High** | Mandatory explain-it-back after every pass (§0.1, §14); Hard Stretch gated behind demonstrated understanding of Core |
| **Docs that overstate what's built** (a recurring pattern in this project) | Medium | §0.1 item 10: state only what's been checked, say how; refresh §15 and the README status table with every merge |

---

## 17. Academic Integrity Note

You've said you'll use Claude extensively to build this — a reasonable, modern way to work, and nothing here is meant to discourage it. But check your course's policy on AI-assisted coursework before leaning on it fully, since policies vary and this is a graded team project. Practically, for your own sake as much as any policy question: treat Claude as a pair programmer and tutor that writes code and explains algorithms, not as a ghostwriter for your report or your viva answers. The resume line (§19) is only true, and only defensible under questioning, if the two of you can stand behind every part of it yourselves.

---

## 18. Pros / Cons of This Plan, Honestly Weighed

| Pros | Costs |
|---|---|
| Pass pipeline mirrors LLVM's architecture — accurate, strong talking point | A few extra days of upfront design before any pass was "done" |
| Differential testing in both languages gives an unimpeachable correctness story cheaply | Test-only dependencies, never shipped |
| Complexity table, guard table and syllabus mapping show theoretical maturity | Requires understanding the connections well enough to defend them under questioning |
| Phased scope with a Hard Stretch tier keeps ambitious parts genuinely optional | Requires real discipline not to chase them early |
| Explain-it-back checkpoints protect the resume claim's credibility | Costs calendar time a purely code-focused plan wouldn't spend |

---

## 19. Resume / Report Summary Line

*"Designed and built RegexLab as a pass-based compiler pipeline — mirroring LLVM's own architecture — implementing Thompson's construction, subset construction, and Moore's DFA minimization from scratch in both TypeScript and C++ (compiled to WebAssembly), with a live automaton visualizer, input guards verified in the browser build, and correctness validated through differential testing against two independent reference engines on thousands of randomized inputs, used strictly as test oracles, never runtime dependencies."*
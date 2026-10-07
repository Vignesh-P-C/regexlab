# RegexLab: Automata Made Visible
### CLAUDE.md v2 — Project Brief & Working Agreement

> This document is self-contained. Paste it in full into every new Claude chat before asking for help on this project — a fresh Claude session has no memory of earlier sessions and needs this to have complete context. It supersedes the original design doc but keeps everything from it that was genuinely good; paste the original alongside it too if you want the extra implementation detail, but this file is the one that governs decisions.
>
> Two audiences read this document: the Claude session helping you build, and the two of you building it. Section 0 is written directly to both.

---

## 0. Read This First

### 0.1 Operating instructions for this Claude session

1. **Don't build ahead of the current phase.** Check the Progress Tracker (§15) before writing any code. If Core isn't fully complete and both students can explain it, do not implement anything under Stretch A/B/Hard Stretch — even if asked directly. Flag it and confirm they're sure, since skipping ahead is the single biggest named risk in this plan (§16).
2. **Prefer clear, well-commented, "textbook" code over clever or terse code.** This will be explained in a viva by two undergraduates, not maintained by a team. An implementation that visibly maps to the algorithm's textbook description beats a compact one every time.
3. **Always name the algorithm you're implementing or explaining** — Thompson's construction, subset construction (Rabin–Scott), Moore's minimization, etc. — and note that these are the same constructions covered in Aho/Lam/Sethi/Ullman's *Compilers: Principles, Techniques, and Tools*, the prescribed textbook for BCSE307L. This is a real, citable detail for the report and viva.
4. **Run an "explain it back" checkpoint after every pass, before moving to the next one.** Ask the student(s) to explain what the pass does and why, in their own words, with no notes and no scrolling back up. This isn't a formality — it's the main defense against moving faster than genuine understanding. If they can't do it cleanly, stay on this pass rather than proceeding.
5. **Flag added complexity honestly, in the moment.** If a request would meaningfully grow scope, add a new dependency, or introduce a new concept, say so explicitly before implementing it. Don't let scope grow silently.
6. **Don't write the final report, abstract, or viva answers wholesale on the students' behalf.** Help them think it through, review and critique drafts, explain concepts as many times as needed — but the authored words should be theirs. See §17.
7. **When debugging, explain the bug, not just the fix.** A silent one-line patch defeats the point of the project.
8. **Confirm which Track (A or B) is locked in before writing implementation code** — see §1. If the Decision Gate is still unresolved, help resolve it first rather than assuming.
9. **At the end of every session, remind the student to update and save the Progress Tracker (§15)** so the next session starts with accurate context instead of guesswork.

### 0.2 Reminders for us, before every session

- Paste this file, plus your current filled-in Progress Tracker (§15), at the start of every new chat.
- Do the explain-it-back checkpoint with *each other*, not with Claude — Claude can prompt for it, but the test is whether you two can do it unassisted.
- Don't chase a stretch goal because it sounds impressive mid-project. Core, fully working and understood, beats a longer feature list that neither of you can defend.
- Check your course/university's policy on AI-assisted coursework before leaning on this fully — see §17.
- Keep a shared notes doc logging what each of you personally built and understand, in case you're questioned separately in viva.

---

## 1. Decision Gate — Resolve Before Writing Any Code

**Status: UNRESOLVED.** Ask your professor directly: *"Does the semester project need to be implemented in C/C++, or is any language acceptable as long as we build the algorithms ourselves rather than using a library?"*

- Confirmed any language is fine → **Track A**
- C/C++ required, or no answer yet and you want the safer default → **Track B**

Both tracks implement identical algorithms and satisfy identical syllabus mapping (§3). The choice only changes implementation language and deployment mechanics — not the compiler-design content, not the grading substance.

If this is still unresolved when a session starts, **Claude should ask which track is locked in before writing any implementation code**, and should not assume Track A by default just because it was the original plan.

---

## 2. Design Philosophy

1. **The engine is pure and dependency-free.** No regex libraries, no NFA/DFA packages. If it's not hand-built, it doesn't count toward the syllabus claim or the resume claim.
2. **Layers are strictly decoupled.** The engine doesn't know a UI exists. The UI doesn't know an AI exists. Each layer runs and demos completely on its own.
3. **The AI layer is a consumer of engine output, never a participant in correctness.** It reads the engine's own structured error objects, and every suggestion it produces must pass back through the hand-built parser before it's ever shown. It never gets the final word.
4. **Every addition either directly serves the syllabus mapping or the resume claim, or it doesn't ship.** No scope creep for its own sake.
5. **Understanding gates progress, not just working code.** A pass isn't "done" when it compiles and passes tests — it's done when both of you can explain it from memory. This rule overrides "we're ahead of schedule, let's start the next thing."

---

## 3. Syllabus Mapping (for your report and viva prep)

| Syllabus module | Project component | Notes |
|---|---|---|
| 1. Lexical analysis | The entire project's premise | This is the syllabus's own named example ("Regular expression to DFA") |
| 2. Syntax analysis | Regex grammar (§6) + recursive-descent parser | Real operator precedence: `|` binds loosest, then concatenation, then `*`/`+`/`?` |
| 3. Semantic analysis | Malformed-pattern detection (unmatched parens, empty groups, dangling operators) | Feeds directly into the AI suggestion layer (§12) |
| 4. Intermediate representation | The NFA, built via Thompson's construction | A genuine graph-structured IR, not a stretch analogy |
| 5. Code optimization | DFA minimization (Moore's, and Hopcroft's as stretch) | Your strongest, most defensible module |
| 6. Code generation | The matcher pass, compiling the minimized DFA into an executable matching procedure | |
| 7. Parallelism | Out of scope | Not realistic for two people in this timeframe — state this plainly if asked, don't apologize for it |
| 8. Contemporary issues | N/A | Two lecture hours, not a project deliverable |

---

## 4. High-Level Architecture

```
                         PRESENTATION LAYER
              Pattern input · Test-string input · Playback controls
                             │                       │
                             ▼                       ▼
        VISUALIZATION LAYER                  SUGGESTION LAYER
   Renders pipeline output as an        (only invoked on parse failure)
   animated automaton graph.            Sends the engine's structured
   Pure function of engine state        error to an LLM; suggestion
   — no logic of its own.               re-enters through the same
                                         parser gate before ever shown.
                     │                                │
                     ▼                                │ suggestion string
        CORE ENGINE — PASS PIPELINE                   │  (untrusted,
   ParserPass             → AST  (or ParseError)       │   re-parsed
   ThompsonPass           → NFA                        │   before use)
   SubsetConstructionPass → DFA  (worklist/fixpoint)
   MinimizationPass       → Min-DFA (worklist/fixpoint)
   MatcherPass            → MatchTrace
```

**Why this shape:** the Core Engine is a pure library — string in, structured data out — independently runnable and testable with no UI at all. The Suggestion Layer sits *beside* the engine, never inside it: an AI suggestion re-enters the system as an ordinary string and must clear the same parser gate as any user input, with zero special treatment. The Visualization Layer only renders what the engine already computed — it never derives anything itself, which keeps your hardest theory bugs confined to one layer.

---

## 5. Implementation Track

### Track A — TypeScript / React / Vite / Vercel

| Layer | Choice | Why |
|---|---|---|
| Core engine | TypeScript, zero dependencies | Type safety catches structural bugs early; runs identically in browser and Node |
| Engine tests | Vitest (unit) + fast-check (property-based, Core now — see §9) | |
| Frontend | React + Vite | Fast dev loop, component-per-pass layout |
| Visualization | Hand-rolled SVG | Keeps the "built from scratch" story intact |
| AI proxy | Single serverless function (Vercel Edge Function) | Keeps the API key server-side — a real, citable security decision |
| AI model | A free-tier LLM API (Gemini Flash-Lite recommended — see cost discussion earlier in this project's history) | |
| Deployment | Vercel | One-command deploy, free tier, real public link for your resume |

### Track B — C++ Engine Compiled to WebAssembly (recommended default if the Decision Gate is unresolved)

| Layer | Choice | Why |
|---|---|---|
| Core engine | C++, zero dependencies beyond a small JSON library (`nlohmann/json`, header-only) for output serialization | Matches your lab's language convention exactly, no viva risk on "why isn't this C++" |
| Compilation to browser | **Emscripten**, compiling the engine to a `.wasm` module | This is how real production tools do it (e.g. browser builds of SQLite); not a workaround, a legitimate technique |
| Engine tests | A plain C++ test runner (Catch2 or a hand-rolled assertion harness), run natively on the command line — no browser needed for this | Test the engine as an ordinary C++ program *first*, before touching WASM at all |
| Frontend | Plain JS or React — calls the compiled `.wasm` module directly, no server round-trip for the engine itself | |
| Visualization | Hand-rolled SVG, same as Track A | |
| AI proxy | Same serverless-function approach as Track A, used only for the suggestion layer, not the engine | |
| Deployment | Vercel or GitHub Pages for the static frontend + `.wasm` file | |

**Sequencing note for Track B:** build and fully test the C++ engine as a normal command-line program across Weeks 1–7. Only wire up Emscripten and the WASM build in Week 8–9, once the engine is already correct. Don't fight WASM tooling and algorithm correctness at the same time.

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

`+`, `?`, and `[a-z]` character classes are explicit stretch goals (§11). The core deliverable is `char`, concatenation, `|`, `*`, `()`.

---

## 7. Core Engine — Data Contracts

Define these before writing any pass logic. Getting this right first is what lets both of you build against a stable interface independently from Week 1.

**Track A (TypeScript):**
```typescript
type ASTNode =
  | { kind: "char"; value: string }
  | { kind: "concat"; left: ASTNode; right: ASTNode }
  | { kind: "alt"; left: ASTNode; right: ASTNode }
  | { kind: "star"; child: ASTNode };

type ParseError = {
  type: "UnmatchedParen" | "UnexpectedToken" | "EmptyGroup" | "DanglingOperator";
  position: number;
  expected?: string;
  found?: string;
};

// States are integers, not strings — array-backed, O(1) access
type Automaton = {
  stateCount: number;
  startState: number;
  acceptStates: Set<number>;
  transitions: Map<number, Map<string, number[]>>; // state -> (symbol|"eps") -> [states]
};

type MatchTrace = {
  steps: { char: string; activeStates: number[] }[];
  result: "match" | "no-match";
  failurePosition?: number;
};
```

**Track B (C++):** the same shapes, expressed as plain structs — a tagged union or `std::variant` for `ASTNode`, a `struct ParseError`, an `Automaton` struct using `int` state IDs and `std::unordered_map<int, std::unordered_map<char, std::vector<int>>>` for transitions, serialized to JSON at the pipeline boundary for the frontend to consume.

---

## 8. The Pass Pipeline

Instead of standalone functions, the engine is a **pipeline of composable Pass objects** — a deliberate, defensible echo of how LLVM structures its own optimizer. Every new capability (character classes, `+`/`?`) becomes a new pass with zero UI changes required.

```
ParserPass  →  ThompsonPass  →  SubsetConstructionPass  →  MinimizationPass  →  MatcherPass
```

Each pass has one job, one input type, one output type, and is independently unit-testable without the rest of the pipeline running.

---

## 9. Testing Strategy (updated)

1. **Golden-value unit tests, per pass — Core, required.** Feed a known pattern, assert the exact expected AST shape / NFA state count / DFA state count / minimized state count.
2. **Differential testing — moved into Core (was stretch in the original plan).** Compare your engine's match result against a reference engine (JS's built-in `RegExp`, or C++'s `std::regex`) on randomized inputs, used strictly as a test oracle, never a runtime dependency. This is genuinely cheap to set up and gives you the single strongest correctness story in the project — "we validated against thousands of randomized inputs," not "it passed our five hand-picked examples." Promoted to Core because the payoff-to-effort ratio is too good to leave optional.
3. **Isomorphism-based equivalence testing — Hard Stretch, not Core.** Two DFAs accept the same language iff their minimized forms are isomorphic; use this to test algebraic identities like `a(b|c)` ≡ `ab|ac`. Elegant and dependency-free, but genuinely optional — don't start this until Core is fully working and both of you can explain differential testing cold.

---

## 10. Complexity Analysis (include this table in your report)

| Stage | Time | Space | Note |
|---|---|---|---|
| Parsing | O(n) | O(n) | n = pattern length |
| Thompson's construction | O(n) | O(n) | linear in AST size |
| Subset construction | O(2^m) worst case | O(2^m) worst case | m = NFA states — name the exponential blowup explicitly, don't hide it |
| Minimization (Moore's — Core) | O(n² · k) | O(n) | n = DFA states, k = alphabet size |
| Minimization (Hopcroft's — Hard Stretch) | O(n log n · k) | O(n) | only after Moore's is solid and tested |
| Matching | O(n) per string | O(1) active state | this is *why* DFA matching beats naive backtracking engines |

---

## 11. Phased Scope (updated)

| Phase | Scope | Status |
|---|---|---|
| **Core (must-ship)** | `char`, concat, `\|`, `*`, `()`, pass pipeline, golden tests, differential tests, visualizer, Moore's minimization, AI suggestion layer with hard gate | Guaranteed deliverable — nothing below starts until this is done and both of you can explain every part |
| **Stretch A** | `+`, `?` quantifiers | Cheap once `*` works |
| **Stretch B** | `[a-z]` character classes | If time remains after Core is demo-ready |
| **Hard Stretch** | Hopcroft's minimization, isomorphism-based equivalence testing | Only attempt these if Core is finished *and* both of you can already explain differential testing and Moore's minimization without notes. These are the two places where AI-assisted speed and genuine understanding are most likely to diverge — treat that as a hard boundary, not a soft one. |
| **Explicitly out of scope** | Backreferences, lookahead/lookbehind | State why in the report: these break the regular-language guarantee — a theory-grounded scope decision, not an oversight |

---

## 12. The AI Suggestion Layer — Detailed Flow

```
1. ParserPass fails → returns a structured ParseError (type, position, expected)
2. Frontend sends { pattern, error } to the suggestion endpoint (serverless, holds the API key)
3. Prompt is constrained: "Pattern: {pattern}. Error: {error.type} at
   position {error.position}, expected {error.expected}. Return ONLY
   a corrected regex pattern, no explanation."
4. The model returns a suggestion string
5. Frontend re-runs the suggestion through the SAME local ParserPass
   (client-side / engine-side, not the AI)
6. HARD GATE: only if the local parser accepts it is "Did you mean: ..." shown
7. If still rejected, the suggestion is silently discarded — never shown as valid
```

Step 6 is the single most important interview-defensible detail in the whole system: the AI cannot put a wrong answer in front of a user, because the hand-built parser has final say, every time, with no exception.

---

## 13. Repository Structure

**Track A:**
```
regexlab/
├── engine/
│   ├── passes/            # parser-pass.ts, thompson-pass.ts, subset-construction-pass.ts,
│   │                       #   minimization-pass.ts, matcher-pass.ts
│   ├── pipeline.ts
│   ├── types.ts
│   └── __tests__/
│       ├── unit/           # golden-value tests, one file per pass
│       └── differential/   # property-based oracle tests (§9)
├── frontend/
│   └── src/components/     # PatternInput, AutomatonView, PlaybackControls, SuggestionBanner
├── api/
│   └── suggest.ts          # serverless function, holds the API key
├── CLAUDE.md                # this file
└── README.md                 # public pitch + live demo link
```

**Track B:** same shape, with `engine/` as a C++ CMake project (`passes/*.cpp` + `*.hpp`, a `tests/` directory using Catch2, and a `wasm/` build target invoking Emscripten), and `frontend/` consuming the compiled `.wasm` module directly.

---

## 14. Build Sequence — 2–3 Months, Two People

| Week | Track/theory-heavy person | Systems/UI-heavy person | Checkpoint |
|---|---|---|---|
| 1–2 | Finalize data contracts (§7), write the formal grammar (§6). ParserPass + golden tests | Scaffold the project, static UI shell against mock automaton data | Explain-it-back: the grammar and precedence rules |
| 3–4 | ThompsonPass + tests | AutomatonView renderer, fed by mock trace data | Explain-it-back: Thompson's construction |
| 5–6 | SubsetConstructionPass (worklist-framed) + tests | Playback controls, animation state machine | Explain-it-back: subset construction, epsilon-closures |
| 7 | **Contract freeze** — `Automaton`/`MatchTrace` shapes locked | Same checkpoint, both sides sign off | — |
| 8 | MinimizationPass (Moore's) + tests | Wire real pipeline output into the renderer, replace mocks. Track B: begin WASM build here | Explain-it-back: Moore's minimization |
| 9 | MatcherPass + trace generation; differential test suite (now Core, §9) | Suggestion banner UI + suggestion endpoint scaffold | Explain-it-back: differential testing methodology |
| 10 | Bug bash on adversarial patterns, together | AI integration + client-side re-validation gate (§12) | Both of you walk through the full pipeline end to end, unaided |
| 11 | Report: grammar, complexity table, syllabus mapping (§3), viva prep | Polish: loading states, error messaging, responsiveness | — |
| 12 | Only now: Hard Stretch items, if genuinely ahead of schedule | Deploy; record a demo video as a live-demo fallback | — |
| 13 (buffer) | Buffer | Buffer | Final full run-through together |

---

## 15. Progress Tracker — update this before every new chat

Copy this table into your notes, fill in the Status/Notes columns as you go, and paste your current version into every new Claude session so it has accurate context.

| Component | Status | Both can explain it? | Notes |
|---|---|---|---|
| Decision Gate (§1) | Not resolved | — | |
| ParserPass + grammar | Not started | No | |
| ThompsonPass | Not started | No | |
| SubsetConstructionPass | Not started | No | |
| MinimizationPass (Moore's) | Not started | No | |
| MatcherPass | Not started | No | |
| Differential testing | Not started | No | |
| Visualizer | Not started | No | |
| AI suggestion layer + hard gate | Not started | No | |
| Deployment | Not started | — | |
| Hopcroft's / isomorphism testing (Hard Stretch) | Not started | No | |

---

## 16. Risk Register (updated)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hopcroft's minimization too fiddly | Medium | Ship Moore's instead (§11) — still a real, citable, correct algorithm |
| Subset construction state explosion on adversarial patterns | Low–Medium | Cap demo patterns to a reasonable NFA size; name the exponential worst case honestly (§10) |
| SVG animation performance on large automatons | Low | Cap demo pattern complexity; state as a known scope limit |
| AI API rate limit hit mid-demo | Low | Cache last few suggestions client-side; keep 2–3 pre-tested broken patterns ready as fallback |
| Contract drift between the two tracks/people | Medium | Freeze `Automaton`/`MatchTrace` contracts at the Week 7 checkpoint; changes after require both sign-offs |
| **AI-assisted build velocity outpacing genuine understanding** | **Medium–High** | Mandatory explain-it-back checkpoint after every pass (§0.1, §14); Hard Stretch items are gated behind demonstrated understanding of Core, not just Core being "done" |
| Language/Track decision left unresolved too long | Medium | Ask the professor this week; default to Track B if no answer arrives before you need to start coding |

---

## 17. Academic Integrity Note

You've said you'll use Claude extensively to build this — that's a reasonable, modern way to work, and nothing here is meant to discourage it. But it's worth explicitly checking your course's policy on AI-assisted coursework before leaning on it fully, since policies vary and this is a graded team project, not a personal side project. Practically, for your own sake as much as any policy question: treat Claude as a pair programmer and tutor that writes code and explains algorithms, not as a ghostwriter for your report or your viva answers. The resume line at the bottom of this document (§19) is only true, and only defensible under questioning, if the two of you can actually stand behind every part of it yourselves.

---

## 18. Pros / Cons of This Plan, Honestly Weighed

| Pros | Costs |
|---|---|
| Pass-pipeline directly mirrors LLVM's architecture — accurate, strong talking point | A few extra days of upfront design before any pass is "done" |
| Differential testing (now Core) gives an unimpeachable correctness story cheaply | One extra test-only dependency, never shipped |
| Complexity table and syllabus mapping show theoretical maturity | Requires actually understanding the connections well enough to defend them under questioning |
| Phased scope with a Hard Stretch tier keeps ambitious parts genuinely optional | Requires real discipline not to chase them early |
| Explain-it-back checkpoints protect the resume claim's credibility | Costs calendar time that a purely code-focused plan wouldn't spend |

---

## 19. Resume / Report Summary Line

*"Designed and built RegexLab as a pass-based compiler pipeline — mirroring LLVM's own architecture — implementing Thompson's construction, subset construction, and Moore's DFA minimization from scratch, with a live automaton visualizer, an AI-assisted self-verifying error-correction layer, and correctness validated through differential testing against thousands of randomized inputs using an external engine strictly as a test oracle, never a runtime dependency."*

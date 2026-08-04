# 🔎 RegexLab — Automata Made Visible

[![Status](https://img.shields.io/badge/STATUS-CORE%20IN%20PROGRESS-orange?style=for-the-badge)](#-current-status)
[![Weeks](https://img.shields.io/badge/WEEK-2%20of%2013-blue?style=for-the-badge)](#-build-sequence)

> A regex engine — lexer through matcher — built entirely from scratch as a composable pass pipeline, with a live automaton visualizer and an AI-assisted, self-verifying error-correction layer. No regex libraries. No NFA/DFA packages. Every algorithm is hand-built and independently testable.

![TypeScript](https://img.shields.io/badge/TYPESCRIPT-STRICT-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/VITEST-UNIT%20%2B%20PROPERTY-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![React](https://img.shields.io/badge/REACT-VITE-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Dependencies](https://img.shields.io/badge/ENGINE%20DEPENDENCIES-ZERO-blue?style=for-the-badge)

---

## Overview

RegexLab is a compiler-design semester project: take a regex pattern as a raw string and carry it, stage by stage, through the exact pipeline a real lexer-generator would use — parse it into an AST, compile the AST into an NFA (Thompson's construction), determinize the NFA into a DFA (subset construction), shrink the DFA to its minimal form (Moore's minimization), and finally use it to match strings — with every intermediate structure rendered live as an animated graph in the browser.

**Engineering focus areas:**
- A hand-written recursive-descent parser with a formally specified grammar, not a regex-library shim
- Classic automata-theory constructions (Thompson, subset construction, Moore's) implemented as a pipeline of independently testable passes — a deliberate, defensible echo of how LLVM structures its own optimizer
- Correctness validated two ways: golden-value unit tests *and* differential testing against a reference engine on thousands of randomized inputs
- An AI suggestion layer that can propose fixes for malformed patterns but is architecturally incapable of ever showing a wrong one — every suggestion is re-parsed by the same hand-built parser before it's trusted
- Strict separation between engine, visualization, and AI layers — each one runs and is demoable completely on its own

---

## Architecture

```
                         PRESENTATION LAYER
              Pattern input · Test-string input · Playback controls
                             │                       │
                             ▼                       ▼
        VISUALIZATION LAYER                  SUGGESTION LAYER
   Renders pipeline output as an        (only invoked on parse failure)
   animated SVG graph. Pure function    Serverless function calls a free-
   of engine state — no logic of its    tier LLM with the engine's own
   own.                                 structured ParseError object.
                     │                                    │
                     ▼                                    │ suggestion string
┌──────────────────────────────────────────────────┐      │  (untrusted —
│              CORE ENGINE — PASS PIPELINE           │◄─────┘   re-parsed
│                                                      │           before use)
│   ParserPass             → AST  (or ParseError)      │
│   ThompsonPass           → NFA                        │
│   SubsetConstructionPass → DFA   (worklist/fixpoint)  │
│   MinimizationPass       → Min-DFA (worklist/fixpoint)│
│   MatcherPass            → MatchTrace                 │
└──────────────────────────────────────────────────┘
```

**Why this shape:** the Core Engine is a pure library — string in, structured data out — runnable and testable with no browser involved at all. The Suggestion Layer sits *beside* the engine, never inside it: an AI-proposed fix re-enters the system as an ordinary string and must clear the exact same parser gate as any human-typed pattern, with zero special treatment. The Visualization Layer only renders what the engine already computed — it never derives anything itself, which keeps every hard theory bug confined to a single, testable layer.

### The Pass Pipeline

| Stage | Named Algorithm | Input → Output | Status |
|---|---|---|---|
| `ParserPass` | Recursive-descent parsing | `string` → `AST` \| `ParseError` | ✅ Complete — 15/15 golden tests passing |
| `ThompsonPass` | Thompson's construction | `AST` → `NFA` | ✅ Complete — 5/5 golden tests passing |
| `SubsetConstructionPass` | Subset construction (Rabin–Scott) | `NFA` → `DFA` | ✅ Complete — 5/5 golden tests passing |
| `MinimizationPass` | Moore's minimization | `DFA` → `Min-DFA` | 📋 Not started |
| `MatcherPass` | DFA-driven matching | `Min-DFA`, `string` → `MatchTrace` | 📋 Not started |

Each pass has one job, one input type, one output type, and is independently unit-testable without the rest of the pipeline running. Same shapes are reused across passes (`Automaton` covers both the NFA and DFA stages) so a fresh pair of eyes can follow data through the whole system from one type file.

### Module Structure

```
regexlab/
├── engine/
│   ├── types.ts                    # ✅ shared data contracts: AST, ParseError, Automaton, MatchTrace
│   ├── passes/
│   │   ├── parser-pass.ts          # ✅ done
│   │   ├── thompson-pass.ts        # ✅ done
│   │   ├── subset-construction-pass.ts   # ✅ done
│   │   ├── minimization-pass.ts    # 📋 planned
│   │   └── matcher-pass.ts         # 📋 planned
│   ├── pipeline.ts                 # 📋 planned — wires all passes together
│   └── __tests__/
│       ├── unit/                   # ✅ golden-value tests, one file per pass
│       │   ├── parser-pass.test.ts
│       │   ├── thompson-pass.test.ts
│       │   └── subset-construction-pass.test.ts
│       └── differential/           # 📋 planned — property-based oracle tests
├── frontend/                       # 📋 planned — React + Vite
│   └── src/components/             # PatternInput, AutomatonView, PlaybackControls, SuggestionBanner
├── api/
│   └── suggest.ts                  # 📋 planned — Vercel serverless function, holds the AI API key
├── package.json
├── tsconfig.json
├── CLAUDE.md                       # full design doc: grammar, contracts, build plan, risk register
└── README.md
```

### Key Design Decisions

**Pass pipeline over standalone functions**
Each stage is a composable `Pass` object rather than a loose function — a deliberate echo of how LLVM structures its own optimizer. Adding a new capability (`+`/`?` quantifiers, character classes) becomes a new pass with zero changes required anywhere else in the system.

**Structural precedence, not a precedence table**
The parser encodes `|` binding loosest, then concatenation, then `*`, purely through which grammar production calls which (`parseRegex` → `parseTerm` → `parseFactor` → `parseAtom`). Tighter-binding operators live deeper in the call chain — the standard recursive-descent technique from Aho/Lam/Sethi/Ullman, applied directly rather than reached for a lookup table.

**The AI layer never gets the final word**
```
ParserPass fails → structured ParseError → AI proposes a fix → the SAME
ParserPass re-parses the AI's suggestion → only shown if it's accepted
```
This is the single most interview-defensible detail in the whole system: the AI cannot put an invalid pattern in front of a user, because the hand-built parser has final say, every time, with no exception.

**Differential testing as a first-class correctness story**
Beyond hand-picked golden tests, the matcher's output is checked against a reference engine (JS's built-in `RegExp`) on thousands of randomized inputs — used strictly as a test oracle, never a runtime dependency. This is a stronger correctness claim than "it passed our five examples."

---

## Testing Strategy

1. **Golden-value unit tests, per pass.** Feed a known pattern, assert the exact expected AST shape / NFA state count / DFA state count / minimized state count. `ParserPass` currently has 15, covering valid precedence cases and every `ParseError` variant.
2. **Differential testing.** Compare the engine's match result against JS's built-in `RegExp` on randomized inputs — the strongest correctness signal in the project, and cheap to set up.
3. **Isomorphism-based equivalence testing** *(Hard Stretch, not Core)*. Two DFAs accept the same language iff their minimized forms are isomorphic — used to test algebraic identities like `a(b|c) ≡ ab|ac`.

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
| Core engine | TypeScript, strict mode, zero dependencies | Type safety catches structural bugs early; runs identically in browser and Node, testable headlessly |
| Engine tests | Vitest (unit) + fast-check (property-based) | Fast golden-value tests per pass; property/differential testing against a reference oracle |
| Frontend | React + Vite | Fast dev loop; one component per pipeline stage, driven by pipeline output |
| Visualization | Hand-rolled SVG | Keeps the "built from scratch" story intact — no charting/graph library |
| AI proxy | Vercel Edge Function (serverless) | Keeps the AI API key server-side, never shipped to the client — a real, citable backend decision |
| AI model | Free-tier LLM API | Used only for suggestions on parse failure; never a runtime dependency of the engine itself |
| Deployment | Vercel | One-command deploy, free tier, public link for the resume |

---

## Syllabus Mapping

| Compiler-design module | Project component |
|---|---|
| Lexical analysis | The entire project's premise — regex-to-DFA is the syllabus's own named example |
| Syntax analysis | `ParserPass` — recursive-descent, real operator precedence (`\|` < concat < `*`) |
| Semantic analysis | Malformed-pattern detection (`ParseError` variants), feeding the AI suggestion layer |
| Intermediate representation | The NFA, built via Thompson's construction — a genuine graph-structured IR |
| Code optimization | DFA minimization (Moore's, Hopcroft's as stretch) |
| Code generation | `MatcherPass` — compiling the minimized DFA into an executable matching procedure |

---

## 🚦 Current Status

| Component | Status | Both teammates can explain it? |
|---|---|---|
| Language/track decision | ✅ Resolved — TypeScript (Track A) | — |
| `ParserPass` + grammar | ✅ Complete, 15/15 golden tests | Yes — merged via reviewed PR |
| `ThompsonPass` | ✅ Complete, 5/5 golden tests | Pending explain-it-back checkpoint |
| `SubsetConstructionPass` | ✅ Complete, 5/5 golden tests | Pending explain-it-back checkpoint |
| `MinimizationPass` (Moore's) | 📋 Not started | — |
| `MatcherPass` | 📋 Not started | — |
| Differential testing | 📋 Not started | — |
| Visualizer | 📋 Not started | — |
| AI suggestion layer + hard gate | 📋 Not started | — |
| Deployment | 📋 Not started | — |
| Hopcroft's / isomorphism testing (Hard Stretch) | 🔒 Locked until Core is done | — |

## Build Sequence

13-week plan, two people, Core scope only until Week 10:

| Weeks | Theory track | Systems/UI track | Checkpoint |
|---|---|---|---|
| 1–2 | Grammar + `ParserPass` + tests | Project scaffold, static UI shell against mock data | ✅ *in progress* — explain the grammar & precedence rules |
| 3–4 | `ThompsonPass` + tests | `AutomatonView` renderer, fed by mock trace data | Explain Thompson's construction |
| 5–6 | `SubsetConstructionPass` (worklist) + tests | Playback controls, animation state machine | Explain subset construction, ε-closures |
| 7 | **Contract freeze** — `Automaton`/`MatchTrace` shapes locked | | |
| 8 | `MinimizationPass` (Moore's) + tests | Wire real pipeline output in, replace mocks | Explain Moore's minimization |
| 9 | `MatcherPass`; differential test suite | Suggestion banner UI + endpoint scaffold | Explain differential testing |
| 10 | Bug bash on adversarial patterns | AI integration + client-side re-validation gate | Full pipeline walkthrough, unaided |
| 11 | Report + viva prep | Polish: loading states, error messaging | |
| 12 | Hard Stretch, only if ahead of schedule | Deploy + demo video fallback | |
| 13 | Buffer | Buffer | Final full run-through together |

---

## Run Locally

Only the engine exists so far — no frontend yet.

```bash
npm install
npm test          # runs all golden-value tests via Vitest
npm run typecheck # strict TypeScript check, no emit
```

Once the frontend lands (Week 3–4+):

```bash
cd frontend
npm install
npm run dev
```

---

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| **Core (must-ship)** | `char`, concat, `\|`, `*`, `()`, pass pipeline, golden tests, differential tests, visualizer, Moore's minimization, AI suggestion layer with hard gate | 🔄 In progress — `ParserPass` done |
| **Stretch A** | `+`, `?` quantifiers | 📋 Planned — cheap once `*` works |
| **Stretch B** | `[a-z]` character classes | 📋 Planned — if time remains after Core is demo-ready |
| **Hard Stretch** | Hopcroft's minimization, isomorphism-based equivalence testing | 🔒 Gated — only attempted once Core is finished *and* both teammates can explain differential testing and Moore's minimization without notes |
| **Explicitly out of scope** | Backreferences, lookahead/lookbehind | ❌ These break the regular-language guarantee — a theory-grounded scope decision, not an oversight |

---

## Engineering Reflection

*This section fills in as the build progresses — a running log of decisions worth being able to defend, not just describe.*

**On `ParserPass` (Week 1–2):** encoding operator precedence structurally — through which grammar production calls which — instead of a precedence table turned out to be the cleanest way to make the "`\|` binds loosest, `*` binds tightest" rule impossible to get wrong by accident. It also means every precedence claim in the design doc is directly checkable by reading four small functions in call order, rather than trusting a table matches the prose next to it.

---

## Academic Integrity Note

Built with extensive AI assistance (Claude) as a pair-programmer and tutor — not a ghostwriter. Every pass is gated behind an explain-it-back checkpoint before the next one starts, specifically to keep build velocity from outrunning genuine understanding of the underlying automata theory.

---

## Contact

**Vignesh P C** — [GitHub](https://github.com/Vignesh-P-C) · [LinkedIn](https://www.linkedin.com/in/vignesh-p-c/)
**CVS Ujwal** — [GitHub](https://github.com/ujwal2311) · [LinkedIn](Need to fill value)
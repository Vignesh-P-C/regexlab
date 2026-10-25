# RegexLab Automata Complexity and Optimization Lab

## Feature proposal and implementation handoff

**Audience:** Ujwal and the RegexLab team
**Prepared:** 21 October 2026
**Purpose:** Define the proposed feature, explain its theoretical basis, map it onto the current codebase, give an implementation plan, and make a careful novelty case against related public tools.

> **Honest novelty statement:** The public projects and papers reviewed for this proposal document many of the ingredients separately: regex-to-NFA conversion, stepwise subset construction, ε-transition removal, manual automaton editing, equivalence checking, shortest counterexamples, and automata reduction. In that comparison set, I did not find a public app documenting the complete workflow proposed here: a regex-generated NFA, a step-by-step determinization trace, a paper-grounded structure-sensitive upper bound, interactive what-if edits, exact language-equivalence verification with a shortest witness when an edit is unsafe, and a bounded Pareto search over verified variants. This is evidence for a potentially distinctive combination, not proof that no such system exists anywhere. We should not claim “first ever” or say absence is almost certain without a much broader and independently checked search.

---

## 1. Decision summary

The proposed feature is an **Automata Complexity and Optimization Lab** inside RegexLab. It upgrades the earlier **NFA Structure Lab** idea with a second major capability: a **bounded optimization explorer**.

The feature has two linked modes:

1. **Understand subset growth.** Compile a supported regex using RegexLab’s real engine. Show the actual NFA and subset-construction process, count the reachable DFA states, and compare that observed count with a mathematically valid structure-sensitive upper bound where the bound can be computed within a declared budget.
2. **Experiment with safe NFA edits.** Let a learner remove candidate transitions in a copy of the generated ε-NFA. Check whether the edited NFA accepts exactly the same language as the baseline. Show a shortest distinguishing string when it does not. Search a limited set of candidate edits and show the verified trade-offs as a Pareto frontier.

The important contribution is the **closed learning loop**:

> Observe the generated automaton → see why determinization produces its particular reachable subsets → change a structural cause → measure the new automaton → prove whether the edit preserved the language → compare verified alternatives.

This is substantially more defensible than claiming that RegexLab invented regex-to-NFA conversion or stepwise DFA visualization. Those capabilities already exist in multiple tools.

### Recommended name

**Automata Complexity and Optimization Lab** is clear enough for a project review. In the UI, the two sections can be named **Subset Growth** and **Verified Optimization Explorer**. Avoid calling the explorer simply “NFA Minimizer”: it does not solve the unrestricted minimum-NFA problem and must not imply that it returns a global minimum.

---

## 2. What RegexLab already has

The proposal is grounded in the current repository at `D:\Vignesh\Projects\regexlab`, inspected on 21 October 2026. It is not a proposal to replace the existing compiler pipeline.

### 2.1 Current engine path

The C++ pipeline in [`engine/pipeline.cpp`](engine/pipeline.cpp) runs:

```text
pattern + input
    → ParserPass
    → ThompsonPass
    → SubsetConstructionPass
    → MinimizationPass
    → MatcherPass
```

The single C++ function `runPipeline(pattern, input)` returns a `PipelineResult`. On a valid pattern, it includes the parsed AST, the Thompson ε-NFA, the determinized DFA, the minimized DFA, and the match trace. On parse failure it returns the parser’s structured error and stops the remaining passes.

[`engine/include/regexlab/types.hpp`](engine/include/regexlab/types.hpp) defines the shared AST, `Automaton`, parse errors, and match trace. The current AST variants are `char`, `concat`, `alt`, and `star`. The current parser comments and implementation in [`engine/passes/parser-pass.cpp`](engine/passes/parser-pass.cpp) describe a core scope whose quantifier is `*`; do not assume that the extended-regex work discussed in earlier review is already implemented in this checkout.

The NFA is represented by a state count, start state, accept-state set, and a transition map. Epsilon transitions use the string label `"eps"`. Thompson construction in [`engine/passes/thompson-pass.cpp`](engine/passes/thompson-pass.cpp) creates two-state literal fragments, joins concatenation fragments with ε, creates branch and join edges for alternation, and creates the entry, skip, loop, and exit edges for star.

[`engine/passes/subset-construction-pass.cpp`](engine/passes/subset-construction-pass.cpp) computes ε-closures, symbol moves, and reachable state subsets with a worklist. It assigns a DFA state ID to each distinct NFA-state set and returns the reachable subset automaton. It currently returns the automaton, not a durable list of each subset-construction operation. The exact per-step trace needed for the new lesson must be captured explicitly.

[`engine/passes/minimization-pass.cpp`](engine/passes/minimization-pass.cpp) uses Moore-style partition refinement on the DFA. This minimizes the **DFA**; it does not minimize the Thompson NFA. [`engine/passes/matcher-pass.cpp`](engine/passes/matcher-pass.cpp) walks the minimized DFA and records the trace used to explain the supplied input string.

### 2.2 Current JavaScript/WASM boundary

The WASM binding in [`engine/wasm/bindings.cpp`](engine/wasm/bindings.cpp) exposes one function, `runPipeline(pattern, input)`. The JSON bridge in [`engine/json_bridge.cpp`](engine/json_bridge.cpp) calls the C++ pipeline and serializes its snapshots. The frontend hook in [`frontend/src/hooks/useRegexEngine.ts`](frontend/src/hooks/useRegexEngine.ts) invokes that WASM function and parses the returned JSON. The app and views consume the resulting snapshot.

That boundary is useful for a normal compile-and-match action. The optimization explorer can be an explicit, separately requested computation so the regular run remains quick. The implementation can still use a small number of WASM exports while keeping one coherent engine API. Do not silently turn every keystroke into an exhaustive candidate search.

### 2.3 Consequence for this proposal

The baseline pipeline already supplies the original NFA and actual DFA output. New work should preserve that baseline as immutable input, record the subset trace, add structural analysis, and add a bounded comparison/search service over cloned NFAs. Edits must never mutate the baseline object that drives the ordinary pipeline and existing playback.

---

## 3. Learner experience: end-to-end workflow

### Step A — Compile a baseline

The learner enters a regex supported by the current parser and presses Compile. RegexLab keeps the existing result and adds a **Subset Growth** view. The UI identifies the NFA representation being measured, including its state count, ε-edge count, symbol alphabet, and trimming statistics.

### Step B — Watch reachable subsets appear

The learner steps through the real Rabin–Scott subset construction. Each operation should show:

1. Current DFA subset, for example `{q0, q2, q5}`.
2. Chosen input symbol.
3. The NFA states reached by the symbol move.
4. ε-closure of that moved set.
5. The resulting target DFA subset.
6. Whether the target is a newly discovered subset or an existing one.
7. Whether the subset is accepting, which is true exactly when it contains an accepting NFA state.

The visualization should accumulate a count as each new reachable subset is discovered. A summary can compare:

- NFA state count `n`;
- the coarse powerset ceiling `2^n`;
- actual reachable subset-DFA state count;
- minimized-DFA state count;
- the research-derived structural upper bound, only when the chosen computation really produces a finite, valid bound.

The app must distinguish the **reachable subset DFA size** from the **minimum DFA size**. The first is the algorithm’s actual output before minimization. The second is the smallest DFA for that language. They can differ substantially.

### Step C — Explore a local what-if edit

The learner selects a transition, initially an ε-transition, and toggles it off in a **candidate copy**. The view immediately shows the edited NFA and highlights the changed edge. The learner can inspect how the candidate’s reachability, transition counts, subset trace, actual DFA count, and structural bound change.

This preview is not evidence that the edit is safe. It is a hypothesis until the exact comparison finishes.

### Step D — Verify the language

RegexLab compares the candidate with the immutable baseline:

- If languages are equal, label the candidate **Equivalent — verified within the completed exact check**.
- If languages differ, show the shortest distinguishing word found by breadth-first search over a product of the two completed DFAs. Highlight how the baseline and candidate process that word and which side accepts it.
- If a state, time, memory, or candidate budget is reached before exact checking finishes, label it **Inconclusive — resource limit reached**. Never label an unchecked candidate safe or equivalent.

### Step E — Search a bounded edit space

The learner asks the explorer to consider a limited set of candidate edits. A reasonable first version searches subsets of eligible ε-edge deletions up to a configured edit depth, with a hard evaluation cap. Each completed candidate is classified as equivalent, language-changing, or inconclusive. Equivalent candidates are added to a Pareto comparison; unsafe edits can remain visible as examples with counterexamples.

The result should say **best verified candidates found within this search budget**. It must not say “minimum NFA,” “optimal NFA,” or “globally smallest equivalent automaton.”

---

## 4. Feature 1: explain subset growth

### 4.1 Basic mathematical idea

An NFA can occupy several states at once after reading an input prefix. Subset construction represents that simultaneous set as one DFA state. Starting with the ε-closure of the NFA start state, it repeatedly computes a symbol move followed by ε-closure. A new DFA state is created only when the resulting set has not appeared before.

An NFA with `n` states has at most `2^n` possible subsets, but the algorithm usually reaches only some of them. Therefore the actual count is obtained by running the reachable-state worklist; it is not a guessed value. In this repository, the existing subset construction already computes that actual reachable automaton.

### 4.2 Why the feature should show more than `2^n`

`2^n` is a worst-case powerset ceiling and can be a very loose description of one particular NFA. The proposed lesson ties the size to the generated NFA’s transition structure. It compares the observed result with a structural measure and then lets a learner change that structure and see what happens.

The relevant paper is Baburin and Cotterell, [“A Close Analysis of the Subset Construction”](https://arxiv.org/abs/2407.09891), current arXiv version 6 dated 19 May 2025. It proves that forecasting determinization/state complexity in general is hard and introduces **subset complexity** as an upper bound on the size of the subset automaton. The measure is based on the transition matrices of the NFA and can be bounded using matrix range, transition-monoid size, rank, and graph cyclicity.

At a high level, for each alphabet symbol, its transition relation is represented as a Boolean matrix. The paper’s structural measure considers different ways of splitting the alphabet into symbols handled through a generated transition monoid and symbols handled through transition-matrix ranges. It takes the best such split. The theorem states that the resulting subset-complexity quantity upper-bounds the number of states in the subset automaton.

The paper also gives a more efficiently computable estimate using rank and cyclicity. Its simple all-but-one presentation is asymptotic big-O notation. **Do not plug an asymptotic `O(...)` expression into a UI and present the result as a concrete finite numeric upper bound.** If RegexLab wants to show a numeric bound, implement a derivation whose constants and assumptions produce a real finite guaranteed bound, or compute the paper’s exact finite subset-complexity expression for the cases where that work finishes. If only rank/cyclicity indicators are available, call them indicators or an asymptotic estimate, not an exact numeric upper bound.

### 4.3 Epsilon-transition issue: a required correctness gate

The paper’s development assumes ε-free automata after establishing that ε-transitions can be removed. RegexLab’s Thompson NFA currently contains ε-edges and the existing subset construction uses ε-closures. The bound must not be applied directly to this raw ε-NFA as if the paper had proved the formula for it.

Before implementing the bound, agree on and document a semantics-preserving ε-free normalization for this NFA representation. A suitable normalization needs to account for:

- the initial ε-closure, which may be a **set of initial states** in the normalized machine;
- symbol transitions after ε-closure;
- accepting status inherited through ε-closure;
- preservation of the exact reachable subset automaton being counted, where the chosen normalization is intended to support that claim;
- duplicate transitions as relations rather than duplicate edges, because the matrix model represents transition relations.

Use the same normalized representation for the baseline and each candidate. Show the user which representation the bound describes. Record the normalization procedure, assumptions, and a correctness argument in the implementation notes. If the team cannot confidently establish the correspondence, ship the actual growth trace first and defer the numeric structural bound rather than showing a misleading number.

### 4.4 Recommended output labels

The view should label separate quantities explicitly:

| Quantity | Meaning |
|---|---|
| Powerset ceiling | `2^n`, a general upper ceiling from `n` NFA states; not the observed count. |
| Reachable subset states | Exact count produced by RegexLab’s subset construction before DFA minimization. |
| Minimized DFA states | Exact count after RegexLab minimizes the DFA; this is language-level DFA size for the completed representation. |
| Structural bound | A theorem-backed finite upper bound for the specifically named normalized NFA representation, if computed successfully. |
| Structural diagnostics | Rank/cyclicity/range-related observations; do not present these alone as an exact forecast. |

If a bound is unavailable because its own computation exceeded its budget, report **Bound not computed within the limit**. A fallback can still show `2^n` with an overflow-safe display, such as symbolic or logarithmic notation.

---

## 5. Feature 2: bounded verified optimization explorer

### 5.1 What “optimization” means here

This is not unrestricted NFA minimization. It is a bounded search over a declared family of local edits to the regex-generated NFA, with exact language checks for all candidates marked safe.

For the first milestone, keep the edit family narrow and explainable:

- start with deleting selected ε-transitions in a cloned baseline NFA;
- optionally add other edit types later only after defining their semantics and UI clearly;
- do not edit the original pipeline result;
- record every edit as a stable operation such as “remove ε-edge `q_i → q_j`” rather than relying on an ephemeral array index.

Why start with ε-edge deletion? The baseline NFA is produced by Thompson construction and uses ε-edges as structural connectors. A learner can inspect these edges and test whether any are redundant in this particular generated machine. Some deletions will change the language; some may be safe. That contrast is instructive. But this is **not** ε-elimination: conventional ε-elimination rewrites transitions and accepting conditions while preserving the language; merely deleting ε-edges is only a candidate edit that needs verification.

### 5.2 Candidate generation and boundedness

Let `m` be the number of eligible edges. Searching every subset involves up to `2^m` candidates. Even limiting edits to at most `k` deletions involves `Σ(i=0..k) C(m,i)`. The search therefore needs explicit limits before it is exposed to users.

Recommended limits/configuration:

- maximum eligible edges considered;
- maximum edit depth (number of deletions in one candidate);
- maximum candidates generated and evaluated;
- maximum automaton states allowed during candidate determinization;
- maximum time or deterministic work units per equivalence check;
- maximum aggregate WASM memory/work for the whole search;
- cancellation support if the user starts a new regex or closes the explorer.

These should be engine limits with UI-readable explanations, not hidden failure behavior. A run must return partial verified results and a clear completion reason. Search order should be deterministic: stable edge ordering, stable candidate IDs, and stable symbol ordering. The UI should show how much of the declared search space was evaluated and how many candidates are equivalent, different, or inconclusive.

### 5.3 Exact equivalence and counterexamples

For each candidate:

1. Build the candidate NFA without modifying the baseline.
2. Trim or analyze the candidate only in a way that preserves its language. Keep pre-trim and post-trim counts so the learner can see what trimming did.
3. Determinize the candidate under a cap. The baseline’s existing DFA can be reused if its alphabet/completion semantics match; otherwise normalize both consistently.
4. Complete partial DFA transitions with a rejecting sink state for every symbol in the union alphabet.
5. Breadth-first search the product graph from the pair of start states. A product pair is distinguishing when exactly one component is accepting.
6. If such a pair is reachable, reconstruct the path label. BFS gives a shortest-length distinguishing word. For reproducible ties, inspect alphabet symbols in sorted order.
7. If the product search finishes with no mismatch, the DFAs are equivalent, so the candidate and baseline languages are equal.
8. If determinization or product exploration hits a resource limit, return **inconclusive**. Do not reinterpret a timeout as inequivalence or equivalence.

The shortest witness should be useful in the UI: show the word, whether the baseline accepts it, whether the candidate accepts it, and each automaton’s state path or subset trace. For an empty-string witness, show `ε` and explain it denotes the empty input rather than the literal Greek letter.

This method uses deterministic product BFS after determinization. It is exact when it completes, but NFA determinization/equivalence can have exponential worst cases. A hard cap remains necessary even for an educational app.

### 5.4 Metrics and Pareto results

For each baseline/candidate, report at least:

- raw NFA states;
- reachable NFA states from the initial state;
- useful/trim states (states both reachable from the initial set and able to reach an accepting state), with the exact trim definition stated;
- ε-edge count;
- consuming-edge count;
- total distinct transition relation count;
- reachable subset-DFA states before minimization;
- minimized-DFA states;
- structural bound/diagnostics, using the same normalization and method;
- whether language equivalence was proven, disproven with a witness, or left inconclusive.

Avoid a single unexplained “score.” Show non-dominated equivalent candidates as a **Pareto frontier**. A candidate is dominated if another verified equivalent candidate is no worse in every selected metric and better in at least one. Let learners compare trade-offs such as fewer ε-edges vs fewer total edges vs fewer reachable subset states.

The minimized-DFA state count is a useful **invariant**, not a useful optimization objective for equivalent candidates: two equivalent languages have isomorphic minimal DFAs, so a mismatch after full minimization points to a bug or a mismatch in alphabet/completion semantics. In contrast, the number of states in the *unminimized reachable subset DFA* can differ based on the NFA representation even when the final language is the same. Make those distinctions explicit.

### 5.5 What the explorer may conclude

Allowed conclusions:

- “This particular edge deletion preserves the language; exact equivalence check completed.”
- “This deletion changes the language; here is the shortest distinguishing word found.”
- “No difference was found after exhaustive product exploration of these completed DFAs.”
- “The search found these non-dominated verified candidates within the declared budget.”
- “The remaining candidates were not checked because the state/work/time limit was reached.”

Not allowed:

- “This is the smallest equivalent NFA.”
- “All redundant transitions have been found.”
- “The candidate is safe” if the exact verification did not complete.
- “The theoretical bound predicts the exact number of reachable DFA states.”
- “No other tool has this feature” based only on search results.

---

## 6. Why the combination can be educationally useful

Most conversion visualizers teach what the algorithm does: build an NFA, discover DFA subsets, then minimize. The proposed lab adds a question about *why this particular input causes this particular amount of determinization work* and lets the learner experimentally change the transition structure.

The lesson is stronger than a static warning that subset construction can have `2^n` states:

1. The baseline trace establishes actual behavior.
2. The bound provides a structural lens, while clearly remaining an upper bound.
3. The learner changes one cause and observes which outputs change.
4. Formal equivalence checking separates safe simplification from a merely smaller-looking but wrong machine.
5. A shortest counterexample makes failure concrete and debuggable.
6. A bounded Pareto frontier demonstrates that “better” depends on the selected cost metrics.

The feature connects automata theory to compiler correctness and optimization: transformations are candidate rewrites, semantic preservation is checked independently, and cost is presented as several measurable dimensions rather than one marketing score.

---

## 7. Proposed architecture in the current repository

### 7.1 Preserve the pipeline contract

Keep the present compile-and-match path usable as-is. The ordinary call should not start a combinatorial search. A recommended conceptual split is:

```text
runPipeline(pattern, input)
    → baseline AST, NFA, DFA, min-DFA, match trace
    → subset construction trace / baseline metrics (reasonably small overhead)

runGrowthAnalysis(baseline NFA, analysis options)
    → normalized representation, structural result, or explicit unavailable status

runOptimizationSearch(baseline NFA, search options)
    → bounded candidate results, verification status, witnesses, Pareto set
```

The actual WASM interface may use multiple exports, a tagged request, or one extended request function. The key design rule is semantic separation: normal compile is not exhaustive search; expensive analyses are requested deliberately and receive explicit budgets.

The existing diagram labels the JavaScript↔WASM contract as “one function: `runPipeline(p, s) → JSON`.” Keep that as the primary pipeline function if possible. If a second exported function is needed for explicit search, update the architecture diagram and handoff docs rather than hiding costly modes behind ambiguous side effects.

### 7.2 Engine-level data contracts to consider

Possible new value types (names illustrative; adapt to local conventions):

- `SubsetConstructionStep`: source subset ID, source NFA states, symbol, raw move set, ε-closed target set, target DFA state ID, newly discovered flag, accepting flag.
- `SubsetTrace`: ordered step records, stable subset labels, completeness/termination metadata.
- `AutomatonMetrics`: raw/reachable/trim state counts; ε/consuming/total transition counts; alphabet size.
- `NormalizationInfo`: source and normalized representation IDs, normalization description, original-to-normalized state correspondence if available, initial-state set, assumptions.
- `BoundResult`: method/version/citation, representation ID, finite numeric or symbolic value, whether it is a proven bound vs diagnostic estimate, completion status, resource-limit reason.
- `CandidateEdit`: stable edge identity and edit operation.
- `CandidateResult`: candidate ID, edit list, candidate automaton/snapshot reference, metrics, equivalence status, optional witness, computation status.
- `SearchSummary`: declared limits, evaluated count, generated count, complete/partial status, equivalent/different/inconclusive counts, Pareto candidate IDs.

Use integers or stable IDs rather than UI-specific node coordinates in the engine. Sort state sets and symbols at serialization time so equivalent runs produce reproducible output. Keep the algorithm independent of React and SVG concerns.

### 7.3 JSON boundary concerns

[`engine/json_bridge.cpp`](engine/json_bridge.cpp) serializes the current `PipelineResult`; [`engine/wasm/bindings.cpp`](engine/wasm/bindings.cpp) exposes it. New structures should have explicit versioned JSON shapes. Include `status` values for bounded computations rather than a nullable number whose meaning is unclear. Represent potentially huge counts safely: do not overflow a machine integer while calculating `2^n` or the bound. A symbolic/logarithmic representation is acceptable when it is clearly labeled and mathematically faithful.

For long-running work, expose progress/cancellation if practical. WebAssembly calls are synchronous in the current hook shape, so a long optimizer could freeze the UI. Consider chunked work, a worker, or yielding between candidates before shipping broad searches. The initial candidate cap should be small enough that the normal app remains responsive.

### 7.4 Frontend placement

The current frontend contains `App.tsx`, `PatternInput`, `PlaybackControls`, `AutomatonView`, and `useRegexEngine`. Add the lab as an opt-in panel or tab that consumes engine outputs. Keep graph rendering separate from engine semantics. Candidate edge highlights should refer to stable transition identities, not labels that may be duplicated or graph coordinates that may be rearranged.

Recommended displays:

- **Growth summary:** side-by-side count cards for NFA, actual subset DFA, minimized DFA, and valid structural bound.
- **Step playback:** subset/source/move/closure/target worksheet aligned with the highlighted graph states and transition.
- **What-if panel:** baseline/candidate toggle, edited-edge list, undo/reset to baseline.
- **Verification status:** green only after exact completed equivalence; red with witness when different; neutral/amber when inconclusive.
- **Pareto table/scatter plot:** only verified equivalent candidates in the main frontier, with unsafe/inconclusive candidates in separately labeled result groups.
- **Limits disclosure:** candidate budget and state/work budget visible before search and summarized afterward.

---

## 8. Correctness and scientific safeguards

These checks should be part of implementation review. They are listed here as a plan; this document does not add or execute repository tests.

### 8.1 Subset trace invariants

- The first subset is the ε-closure of the NFA start state.
- Every target is `εClosure(move(sourceSubset, symbol))`.
- A DFA subset is accepting iff it intersects the NFA accept set.
- The same canonical NFA-state set is assigned one DFA state ID only.
- Every reported actual state is reachable from the initial subset under the processed alphabet.
- The count shown in the UI equals the number of states in the returned subset DFA, before minimization.

### 8.2 Equivalence invariants

- Candidate graph is a deep copy; baseline NFA and existing result remain unchanged.
- Candidate/base DFA completion uses the same alphabet and rejecting-sink convention.
- A witness returned by the product BFS is accepted by exactly one of the two machines.
- A completed product BFS with no mismatch means equivalent languages for those machines.
- Resource exhaustion yields `inconclusive`, not a guessed boolean.
- Equivalent candidates have the same minimized DFA state count (up to isomorphism) under identical language/alphabet semantics.

### 8.3 Bound invariants

- Every shown numeric value is tied to a theorem and to a named NFA representation.
- Raw ε-NFA matrices are not silently passed to an ε-free theorem.
- A claimed upper bound must be at least the observed reachable subset-DFA size when it is for that same normalized machine and same subset-construction semantics.
- If a computation is only heuristic, empirical, or asymptotic, the UI does not label it a guaranteed numeric upper bound.
- If exact structure computation is too large, the result is visibly unavailable or falls back only to a separately identified coarse powerset ceiling.

---

## 9. Risks, limitations, and decisions for Ujwal

### 9.1 Theoretical bound implementation risk

This is the highest-priority research-to-code issue. The 2025 paper’s subset-complexity measure is a real upper bound. However, its definition uses transition-monoid and matrix-range sizes, which can be difficult to compute exactly, while the practical rank/cyclicity presentation is asymptotic. The project should decide which *finite theorem-backed quantity* it will calculate before designing a number card in the UI.

Suggested staged result:

1. First, always show exact reachable subset count and `2^n` ceiling.
2. Implement the exact subset-complexity formula only for instances that finish within an explicit budget, if a code review confirms the implementation.
3. Separately compute rank/cyclicity diagnostics and label them accurately.
4. If a valid finite structural number is not available for a case, say so. Do not manufacture a prediction from an asymptotic expression.

### 9.2 NFA equivalence and optimization hardness

The minimum equivalent NFA problem is PSPACE-complete (Jiang and Ravikumar, [SIAM Journal on Computing](https://epubs.siam.org/doi/10.1137/0222067)). Exact NFA language questions can also have exponential worst cases. Therefore the bounded-search promise is real: it is a finite exploration over a chosen edit grammar, not a hidden claim to solve all NFA minimization.

### 9.3 Search space vs usefulness

The optimizer may find no equivalent edge deletions for a particular Thompson NFA. That is a valid result and still illustrates why edits require proof. If the edit family is too narrow, the feature may feel underpowered; if it is too broad, search becomes too slow and correctness becomes harder. ε-deletion-only is the recommended demonstration slice; add candidate transformations one class at a time.

### 9.4 Representation dependence

Two NFAs may recognize the same language while having different sizes and very different determinization behavior. Thompson NFA shape depends on the compiler construction and the expression representation. The structural bound and Pareto measurements must say which representation they describe. A bound for the generated Thompson NFA is not automatically a bound for every equivalent NFA or for the language in the abstract.

### 9.5 UX and performance

Candidate generation can become combinatorial. Determinization may produce many subsets; product equivalence can multiply DFA state counts. Cap each stage, make progress and cancellation visible, and make the `inconclusive` state understandable. Do not run optimizer search automatically on each input change.

### 9.6 Alphabet semantics

The current parser’s core model is ASCII-oriented and transitions use individual symbols. The verifier must agree on whether absent symbols, a sink state, and symbols appearing only in a candidate are handled consistently. Do not conflate literal `ε` in a regex with the internal epsilon-transition marker `"eps"`.

### 9.7 What counts as a “transition”

The C++ representation stores a destination vector under a state/symbol pair. Decide whether metric counts are:

- distinct `(source, symbol, target)` relations, or
- visual edge objects after labels have been merged.

The engine should report the former. The graph renderer may group parallel labels for display but must not redefine the metric.

---

## 10. Implementation plan

### Phase 0 — Freeze feature contract and math

- Confirm the scope: generated Thompson ε-NFAs only for v1; no arbitrary manual NFA import unless separately agreed.
- Write the candidate edit grammar and exact count definitions.
- Choose ε-free normalization and prove how its accepted language and subset construction relate to the original ε-NFA.
- Choose the finite structural bound to implement. Review the theorem and constants; keep asymptotic diagnostics separate.
- Set deterministic resource budgets and `inconclusive` result semantics.
- Agree on the exact JSON versioned shapes and whether analysis/search uses new WASM exports or an explicit tagged action.

**Exit condition:** a short math/design note exists and the team can explain what every displayed number means.

### Phase 1 — Preserve subset-construction trace

- Extend the subset pass to optionally record each processed source subset, symbol, move result, closure result, target ID, discovery status, and acceptance status.
- Keep trace collection deterministic and avoid storing redundant large copies if IDs plus canonical sets suffice.
- Serialize the trace at the engine/WASM boundary.
- Confirm the existing pipeline output remains backward compatible or explicitly bump/version its JSON contract.
- Show the trace in the frontend with synchronized graph highlights and a running count.

**Exit condition:** user can replay actual subset discovery for the same NFA whose DFA is returned by the existing pass.

### Phase 2 — Metrics and baseline growth panel

- Add well-defined metrics for raw, reachable, and trim NFA states; ε, consuming, and total transition relations; alphabet size; reachable subset-DFA states; and minimized-DFA states.
- Add the `2^n` coarse ceiling in an overflow-safe format.
- Add the structural-bound engine behind a status-bearing API. It should return `computed`, `not-applicable`, `budget-exceeded`, or `error`, with the method and representation named.
- Build UI labels/tooltips that distinguish exact counts, proven bounds, and diagnostics.

**Exit condition:** no UI text calls a bound an exact prediction; computed bounds are checked against the actual subset count for the same representation.

### Phase 3 — One-edit what-if and exact verifier

- Add immutable baseline/candidate copies and a reversible edge toggle for ε-transitions.
- Recompute candidate NFA metrics, reachable subset construction, structural output, and minimized DFA as required.
- Implement completion and product-BFS equivalence with shortest witness reconstruction.
- Add `equivalent`, `different`, and `inconclusive` statuses.
- Display the witness and acceptance outcome on both sides.

**Exit condition:** user can test one proposed edit end-to-end and cannot confuse an unchecked candidate with a verified one.

### Phase 4 — Bounded candidate search and Pareto view

- Enumerate candidate edge-deletion sets deterministically under declared budgets.
- Canonicalize candidates and avoid evaluating duplicate automata.
- Track generated/evaluated/verified/inconclusive counts and reasons for stopping.
- Pareto-filter only equivalent candidates using the selected metrics.
- Keep counterexamples attached to unsafe candidates so the search also teaches.
- Label the outcome “best found within this bounded search,” never “global minimum.”

**Exit condition:** the user can reproduce a search configuration, see its limits, inspect any candidate’s edits, and understand why each candidate was classified as it was.

### Phase 5 — Novelty evidence and presentation

- Re-run competitor searches close to the actual implementation date.
- Inspect relevant repositories’ documentation and, for the closest matches, run the demos or examine source if available.
- Record search terms, sources, access date, and which features are documented vs not documented.
- Update the comparison table and claim wording.
- Have an independent reviewer challenge the feature against the closest competitors.

**Exit condition:** review materials use precise “not found in reviewed sources” wording and present real comparative evidence rather than a universal first-ever claim.

---

## 11. Acceptance checklist for the feature handoff

This list describes what the completed feature should visibly and technically satisfy. It is a planning checklist, not a request to alter unrelated parser, UI, or pipeline behavior.

- [ ] Existing regex-to-automata pipeline still produces the same baseline result for its supported syntax.
- [ ] Subset trace corresponds exactly to the actual worklist construction, not a separately simulated or fabricated animation.
- [ ] The UI distinguishes NFA state count, reachable subset-DFA count, and minimized-DFA count.
- [ ] Any theorem-backed structural number names the normalized representation and has an explicit completion status.
- [ ] A candidate edit is made on a copy and can be reset to the baseline.
- [ ] Exact language checks produce either a proof result, a shortest witness, or an explicit inconclusive status.
- [ ] Search budgets are visible, deterministic, and enforced at candidate generation and automata exploration stages.
- [ ] Pareto candidates are all fully verified equivalent machines; unsafe and inconclusive results are not mixed into that frontier.
- [ ] UI and report wording never claims a global minimum NFA or “first ever” without evidence that supports that scope.
- [ ] The implementation has a clear correctness review plan for epsilon normalization, transition counting, alphabet completion, and witness validation.

---

## 12. Novelty analysis

### 12.1 Component features are not individually novel

The following are established or already present in public tools and papers:

- Thompson regex-to-NFA construction.
- Rabin–Scott subset construction and stepwise visualization.
- DFA minimization by partition refinement.
- ε-closure visualization and ε-transition elimination.
- Editable NFA graphs and deleting states or edges.
- DFA equivalence and shortest distinguishing counterexamples.
- NFA reduction/pruning research.
- General warnings or counts about the `2^n` powerset ceiling.

Accordingly, do not present any one of those as the new feature. The novelty candidate is their **integrated, learner-facing, proof-backed workflow** connected to a structural analysis of determinization.

### 12.2 Proposed combined capability

The full proposed combination is:

1. Start from RegexLab’s own parsed regex and generated Thompson ε-NFA.
2. Show the actual sequence of reachable subsets generated by RegexLab’s subset construction.
3. Show a research-grounded structural upper-bound analysis for a carefully documented ε-free normalization, alongside actual counts.
4. Let the learner perform what-if transition edits on a clone of the generated NFA.
5. Verify each edit against the original language exactly when computation completes.
6. Give a shortest distinguishing word and machine traces for unsafe edits.
7. Search a bounded edit family and present non-dominated verified candidates with multiple cost measures.
8. Report budget exhaustion and uncertainty honestly.

In the public sources reviewed below, we found tools with meaningful subsets of these capabilities, including one with step-by-step equivalence and shortest counterexamples and another with ε-elimination, unreachable-state removal, and bisimulation-style merging. We did not find the complete structural-bound + interactive safe-edit + bounded verified Pareto-search teaching workflow documented together. This conclusion is deliberately limited to the reviewed public evidence.

### 12.3 Defensible novelty wording for a project review

Preferred wording:

> **RegexLab’s proposed contribution is an integrated learning workflow for automata growth and verified NFA editing. It connects a real regex-to-automata pipeline and stepwise subset construction to a structure-sensitive upper-bound analysis, then lets learners test and search bounded NFA edits with exact language checks and shortest counterexamples. In the public tools we reviewed, we found these ideas separately but did not find this complete combination documented in one learner-facing application.**

Short version:

> **RegexLab combines subset-growth analysis with bounded, equivalence-checked NFA optimization experiments and shortest counterexamples.**

If asked whether this is definitely the first app in the world, answer:

> **We cannot prove universal absence from web searches. Our evidence supports that we did not find this complete combination in the public sources and projects we reviewed. The distinctive work is the integration and the verified learning workflow, not the invention of the underlying automata algorithms.**

### 12.4 How to increase confidence before claiming novelty

To responsibly strengthen the case:

1. Search GitHub and GitLab using combinations of terms such as `subset complexity visualizer`, `automata growth bound`, `NFA transition deletion equivalence`, `NFA optimization counterexample`, `bounded NFA minimization`, `automata Pareto reduction`, and `regex Thompson NFA verifier`.
2. Search papers, theses, conference proceedings, software artifacts, courseware, package registries, and app directories, not only general web results.
3. Inspect README pages and source for the closest repositories. A missing README feature is not proof that the software lacks it.
4. Open and try live demos where possible. Record date and observed version because demos change.
5. Ask Ujwal or another reviewer to independently search for the exact combination and document any counterexample project they find.
6. Keep a small “prior art and differences” appendix with search date, terms, checked artifacts, and caveats.

Even after these steps, phrase the conclusion as a bounded literature/product review. A feature can be novel for the project’s rubric without being globally unprecedented; confirm the rubric’s standard with the instructor.

---

## 13. Public project and paper comparison

The table below compares what each source documents. “Not documented” means that the reviewed public material did not describe the feature; it does **not** prove the live software has no hidden or undocumented implementation.

| Project/source | Documented overlap | Difference from the proposed RegexLab workflow | What we must not claim |
|---|---|---|---|
| [regex-fsm](https://github.com/Abdalla-Eldoumani/regex-fsm) | Very broad automata teaching tool: Thompson, subset construction, Moore minimization, direct regex-to-DFA methods, NFA-to-regex, closure constructions, pumping-lemma activities, computation trees, language equivalence, and shortest counterexamples. Its documented equivalence check uses product BFS. It also documents state/time work limits. | We did not find a documented structure-sensitive subset-complexity bound or a bounded search over edits to a regex-generated NFA, followed by Pareto presentation of exactly verified candidates. It is the closest overall teaching competitor and already proves that step-by-step pipeline plus shortest-counterexample features are not sufficient novelty on their own. | Do not say RegexLab is the first tool with stepwise conversion, DFA equivalence, or shortest counterexamples. |
| [A-Regular-Language-Conversion-Engine-Visualizer](https://github.com/aditya0020/A-Regular-Language-Conversion-Engine-Visualizer) | Regex, ε-NFA/NFA, DFA, min-DFA; step panels; editable NFA transition table; ε-elimination; unreachable-state removal; bisimulation-style state merging; string simulation; `+` and `?` are documented. | It is especially close to the optimization story because it documents NFA cleanup transformations and graph editing. The reviewed README does not document exact equivalence checking for arbitrary user edits with shortest distinguishing witnesses, the research subset-complexity bound, or a budgeted Pareto search over verified variants. | Do not claim that NFA cleanup, ε-elimination, edge editing, or step panels are new. |
| [Felix NFA-to-DFA Visualizer](https://github.com/Felix-au/NFA-to-DFA-Visualizer) | Manual SVG NFA editor; add/delete/reposition states and edges; create ε-transitions; step-by-step subset construction; synchronized transition table; playback and narration; offline PWA. | Starts with a user-authored NFA and teaches the subset algorithm. Its public docs do not describe a regex-generated baseline, structural upper bound, exact edit-equivalence check, shortest counterexample, or bounded Pareto optimization. | Do not claim stepwise conversion or manual graph/edge editing as novel. |
| [SigmaX / regex-dfa-visualizer](https://github.com/aishwary-vansh/regex-dfa-visualizer) | Complete regex → Thompson NFA → subset DFA → minimized DFA pipeline; supports `*`, `+`, `?` per the README; DFA simulation, transition tables, trace, and graph export. | Strong overlap in core pipeline and syntax coverage. The reviewed README does not document NFA edit verification, a subset-complexity bound, or bounded search/frontier. | Do not claim the end-to-end compiler pipeline, extended quantifiers, or trace playback as novel. |
| [RegVizz](https://github.com/ahmedyar7/RegVizz) | Regex → Thompson ε-NFA → subset DFA; side-by-side graph views and educational explanation. | More focused on teaching the construction and comparing NFA/DFA shapes. The reviewed docs do not describe minimization/optimization verification, structural growth bounds, or bounded search. | Do not claim regex-to-NFA/DFA visual conversion as novel. |
| [JMU RE → NFA → DFA Visualizer](https://w3.cs.jmu.edu/lam2mo/cs432/finite-automata/) | Educational visualization of Thompson construction, subset construction, and minimization, with states/subsets shown. | The reviewed page is a classic conversion lesson. It does not document what-if NFA editing with language checks, structural subset bounds, or an optimizer frontier. | Do not claim the classical pipeline playback is novel. |
| [ComVis Compiler Visualization System](https://comvis.pr.ac.rs/) | Regex-to-NFA/DFA, Thompson’s algorithm, syntax tree, transition table, state elimination and other compiler visualizations. | Broad compiler teaching suite; the reviewed feature descriptions do not show the proposed structural growth-bound plus verified bounded NFA edit workflow. | Do not claim general compiler visualization or automata conversion is novel. |
| [AutomataStudio](https://github.com/ReyEscarlata0/automata-studio) | Browser/desktop DFA/NFA editing, ε-transitions, simulation, subset construction, full subset table, and DFA minimization. | Manual automata workbench with conversion and simulation. The reviewed docs do not describe regex-generated structural growth analysis or verified candidate-edit search with shortest witnesses. | Do not claim editable automata, subset tables, or simulation are novel. |
| [BinaryVisual ε-NFA to NFA](https://www.binaryvisual.com/theory-of-automata/epsilon-nfa-to-nfa) | Visual demonstrations of ε-closure, transition mapping, language equivalence concepts, and ε-removal. | Teaches one conversion and equivalence concept. It does not document a search through candidate edits, a shortest counterexample for each unsafe candidate, or a Pareto frontier. | Do not claim ε-closure or ε-elimination visual teaching is novel. |
| [Regex Equivalence Lab](https://teck-tani.com/en/regex-equivalence-lab) | Regex-language comparison and shortest counterexamples were identified in the previous public-source review. | Focuses on comparing regex languages. The proposed difference is tying exact language verification to editable generated NFA structure, subset-growth measurements, and a bounded candidate optimizer. Recheck the live source before using detailed claims, because this page was not accessible in this search pass. | Do not claim shortest counterexamples or language equivalence checking alone are novel. |
| [BinaryVisual NFA → DFA](https://www.binaryvisual.com/theory-of-automata/nfa-to-dfa) | Previously reviewed as showing subset construction, ε-closure, the generic `2^n` ceiling, and growth discussion. | The proposal’s distinction is structure-sensitive analysis tied to the actual generated machine and verified edits, not simply stating the worst-case ceiling. Recheck this page before citing UI specifics. | Do not claim showing powerset growth or `2^n` is novel. |
| [Thaumatorium Regex to DFA/NFA Visualizer](https://thaumatorium.com/projects/regex2fa/) | Regex-to-automata visualizer with options to expose internals. | Useful baseline for conversion visualization. The reviewed material does not document the complete bound/edit/verification/search combination. | Do not claim any generic regex-to-automata graph as unique. |
| [Regex101](https://regex101.com/) | Regex debugging, match explanation, and a backtracking/event visualization in the user’s reference screenshot. | Its screenshot is focused on a practical regex engine’s matching/backtracking trace, not a formal Thompson ε-NFA → subset DFA growth study with proof-checked edits. This is a different audience/workflow, not a direct novelty comparator for the proposed theory feature. | Do not dismiss Regex101 as having “no visualization”; distinguish its trace from automata-construction visualization. |
| Baburin & Cotterell, [“A Close Analysis of the Subset Construction”](https://arxiv.org/abs/2407.09891) | Provides the core research concept: subset complexity as an upper bound and efficiently computable bounds/estimates based on rank and cyclicity. | This is a research paper, not a learner-facing regex app. It supplies theory for the analysis feature, not the interactive combined product. Its ε-free assumption must be addressed in our representation. | Do not claim RegexLab invented subset complexity or the theoretical bound. Cite and credit the authors. |
| Holzer et al., [“Efficient reduction of nondeterministic automata…”](https://arxiv.org/abs/1711.09946) | Researches language-preserving NFA/NBA reductions and transition pruning, including equivalence/inclusion-related techniques. | Research algorithm work rather than the proposed beginner-facing, regex-generated, visually inspectable, bounded what-if workflow. It demonstrates that language-preserving NFA reduction itself has extensive prior art. | Do not claim transition pruning or language-preserving NFA reduction as a new algorithm. |
| Jiang & Ravikumar, [“Minimal NFA Problems are Hard”](https://epubs.siam.org/doi/10.1137/0222067) | Establishes PSPACE-completeness for the decision version of finding a minimum NFA equivalent to a DFA. | Provides the theoretical reason to constrain search and avoid promising global NFA optimality. | Do not call the bounded explorer an exact general-purpose minimum-NFA solver. |

### 13.1 The closest challenges to our novelty claim

The claim is strongest only if the implementation really includes all the hard parts:

- **regex-fsm** already combines stepwise automata learning with shortest counterexamples and bounded execution;
- **A-Regular-Language-Conversion-Engine-Visualizer** already includes ε-removal, unreachable-state removal, bisimulation-like merging, live editability, and step panels;
- **Felix’s visualizer** already allows user-authored graph edits and animated subset construction;
- research papers already establish NFA reduction and transition pruning.

Therefore the differentiating claim must be specifically about a coherent *connection* between:

- actual reachable-subset construction trace;
- a correct paper-grounded structural growth bound for an explicitly normalized representation;
- what-if edits to the generated NFA;
- exact semantic verification and shortest witness;
- a budgeted Pareto search over the verified equivalence class neighborhood.

If the finished implementation omits the structural bound or exact verifier, the novelty claim gets much weaker. A UI mock-up or design document alone is not evidence that the project has implemented the feature.

---

## 14. Suggested demonstration for the instructor

Use a small regex supported by the parser that creates meaningful ε-structure, for example a parenthesized alternation with a star. The live demo should:

1. Compile the regex and show the exact baseline AST/NFA/DFA/min-DFA counts.
2. Step through the NFA subsets, with ε-closure visible at every step.
3. Compare the actual reachable subset-DFA count with the powerset ceiling and the computed structural bound (or state that the structural bound is unavailable for this example if it exceeds its own budget).
4. Select an ε-edge and remove it in the candidate copy.
5. Show a witness for an unsafe edit or the completed exact verification for a safe edit.
6. Start a small bounded search, show the evaluated-candidate and resource budget, then show a Pareto frontier of verified equivalent candidates.
7. Pick one candidate and compare its graph, counts, bound, and subset trace to the baseline.
8. Explain why its minimized DFA count must remain equal if equivalence was correctly established, while the NFA size/edge counts and pre-minimization subset DFA count may differ.

The demo should include at least one unsafe candidate with a short counterexample and, if the selected example has one, at least one non-trivial safe alternative. Do not rely on an example where every candidate is instantly rejected or where the search is too large to finish during a review.

---

## 15. Questions to settle with Ujwal

1. Should v1 search only ε-edge deletions, or should it also test duplicate-edge removal and unreachable/dead-state trimming as separate transformations?
2. Which exact finite structural bound can we implement and explain without presenting an asymptotic formula as a numeric guarantee?
3. Should the structure bound run only on small automata with an explicit cap, while larger cases show rank/cyclicity diagnostics and `2^n`?
4. Should the optimizer return only the Pareto frontier plus counterexample examples, or expose every candidate row?
5. What candidate, state, and work limits keep WASM responsive on the target devices?
6. Should the user select the optimization objectives, or should v1 always report a fixed set of metrics without a weighted score?
7. Should the current JS↔WASM boundary gain explicit analysis/search exports, or use a tagged request through one wrapper? Either way, normal pipeline runs must not trigger full search.
8. Does the instructor require proof of a globally unprecedented feature, or a novel combination compared with named projects? The public web cannot establish universal nonexistence.

---

## 16. Sources and review method

### Sources reviewed directly for this proposal

1. Baburin & Cotterell, [“A Close Analysis of the Subset Construction”](https://arxiv.org/html/2407.09891) and [arXiv record](https://arxiv.org/abs/2407.09891), current version 6 dated 19 May 2025. Primary source for subset complexity, its upper-bound status, ε-free assumption, rank/cyclicity estimate, and hardness of forecasting.
2. [regex-fsm repository](https://github.com/Abdalla-Eldoumani/regex-fsm). Public README/documentation for its algorithms, equivalence check, shortest counterexample, and work caps.
3. [A-Regular-Language-Conversion-Engine-Visualizer repository](https://github.com/aditya0020/A-Regular-Language-Conversion-Engine-Visualizer). Public README for ε-elimination, unreachable-state removal, bisimulation-style merging, step panels, syntax, and manual editing.
4. [Felix NFA-to-DFA Visualizer repository](https://github.com/Felix-au/NFA-to-DFA-Visualizer). Public README for manual graph editing and step-by-step subset construction.
5. [SigmaX regex-dfa-visualizer repository](https://github.com/aishwary-vansh/regex-dfa-visualizer). Public README for a from-scratch full pipeline, `+`/`?` support, simulator, and execution trace.
6. [RegVizz repository](https://github.com/ahmedyar7/RegVizz). Public README for the educational regex→Thompson NFA→subset DFA workflow.
7. [JMU finite automata visualizer](https://w3.cs.jmu.edu/lam2mo/cs432/finite-automata/) and [ComVis](https://comvis.pr.ac.rs/) for academic/course conversion visualizations.
8. [AutomataStudio repository](https://github.com/ReyEscarlata0/automata-studio) for a manual NFA/DFA editor, subset construction, and minimization.
9. [BinaryVisual ε-NFA→NFA](https://www.binaryvisual.com/theory-of-automata/epsilon-nfa-to-nfa) and its [NFA→DFA visualizer](https://www.binaryvisual.com/theory-of-automata/nfa-to-dfa) for interactive ε-closure/removal and generic state-growth teaching.
10. [Regex Equivalence Lab](https://teck-tani.com/en/regex-equivalence-lab) for regex equivalence and shortest-counterexample comparison identified in the previous review. Live page was not accessible in this pass; recheck before relying on detailed feature wording.
11. Holzer et al., [“Efficient reduction of nondeterministic automata with application to language inclusion testing”](https://arxiv.org/abs/1711.09946), primary research on NFA/NBA reduction and transition pruning.
12. Jiang & Ravikumar, [“Minimal NFA Problems are Hard”](https://epubs.siam.org/doi/10.1137/0222067), primary source on the complexity of minimum equivalent NFA.

### Method and limits

The review combined targeted web searches with opening public project repositories, their readmes, the research paper, and selected educational tool pages. It focused on the exact combination described in this proposal, not on finding every finite-automata project on the internet.

This is not a systematic literature review, an exhaustive code audit of every tool, or proof of global novelty. Repository descriptions can omit functionality; pages and code can change; private, unpublished, classroom, desktop, or recently created projects may not be indexed. The comparison table therefore reports **documented features found in the reviewed public material** and carefully treats absent documentation as unknown rather than proof of absence.

Before an assessed novelty claim is submitted, update the search and inspect the closest apps again. Record date, search strings, demo version if visible, and any caveats. The strongest honest conclusion is “we did not find this complete documented combination in the public sources reviewed as of [date].”

---

## Final recommendation

Proceed with the **Automata Complexity and Optimization Lab** as a combined proposal, but gate implementation on the bound’s mathematical contract. The exact subset trace and verified candidate-edit loop are practical and compelling. The structural bound adds a distinctive research connection only if its ε-free assumptions and finite numerical guarantee are implemented correctly.

The bounded explorer is the major addition beyond the original subset-growth idea: it searches a constrained neighborhood of the generated NFA, verifies candidate languages, produces counterexamples for unsafe edits, and exposes trade-offs among verified variants. Its output is “best found in this declared search,” never “globally minimal.”

This creates a credible novelty argument based on integration and pedagogy. It does **not** let us almost confirm that no other project, website, or app does the same thing. After implementation, a fresh, independently reviewed prior-art search can raise confidence, but the claim should remain scoped to the evidence reviewed.

## 16. Dependency and pull-request split

The two add-ons are separable as user-facing features, but they share important engine capabilities. Both should use an immutable copy of the same canonical Thompson NFA, stable transition identities, consistent metrics, explicit resource limits, and the same exact language-equivalence verifier. The verifier should return one of three outcomes: equivalent, different with a shortest witness, or inconclusive because a limit was reached.

- **Subset Growth / NFA Structure Lab** needs the actual subset-construction trace and baseline metrics. Its first what-if milestone needs the shared copy/edit and equivalence API for one candidate edit.
- **Bounded Optimization Explorer** reuses that API to generate, deduplicate, and verify many candidate edits, then rank equivalent candidates by Pareto metrics. It should not implement a second, subtly different equivalence checker.

### Recommended PR sequence

1. **PR A - Structure Lab foundation and first end-to-end slice.** Add the reusable candidate-copy and equivalence contracts, subset trace/metrics required by the view, and a one-edit workflow with exact status and witness reporting. Keep bounded enumeration out of this PR.
2. **PR B - Bounded Optimization Explorer.** Add deterministic candidate generation, deduplication, budgets, partial-result reporting, and the Pareto view using PR A's shared API.

These can be separate PRs. They can be developed at the same time only after the shared engine/API contract is agreed. If PR B imports code introduced by PR A, make PR B a stacked PR based on PR A (or its branch); merge PR A first, then rebase/retarget PR B to the updated main branch. Do not make two unrelated branches independently change the verifier and then merge both without reconciling their contracts.

Issue #63's separate optimized-NFA display is not inherently a prerequisite if both add-ons operate on an immutable canonical Thompson NFA. However, inspect its merged interface before implementation: if #63 changes automaton IDs, provenance, or snapshot types, align the shared contracts rather than building parallel representations. Do not make the original NFA depend on the optimized view.

## 17. Session-limited implementation and handoff

A session at roughly 80% usage should not assume that both full features can be completed safely in the remainder. Preserve correctness over feature count:

- First inspect repository state and the attached specification; preserve existing work and do not spend the remaining session repeating novelty research.
- Deliver a small, working, tested vertical slice. Prefer PR A's shared verifier and one-edit Structure Lab slice before a broad search implementation, because PR B depends on reusable verification.
- Add PR B only if there is enough time to implement and verify its candidate limits, result statuses, and Pareto filtering. Do not ship placeholder verification, unbounded enumeration, or a UI that labels unverified candidates as safe.
- Begin wrap-up before the session is nearly exhausted. Open a PR as soon as a coherent, tested slice exists. If work is incomplete, mark it Draft and list completed scope, missing scope, test/build results, and follow-ups. If usage reaches 99%, immediately raise a PR for the reviewable work completed so far; do not leave it only in the session or in an uncommitted tree.
- Report the PR URL and exact verification performed. Never describe a partial implementation as both add-ons complete.


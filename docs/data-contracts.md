# Shared engine data contracts (v1)

This document is the source of truth for the shapes exchanged by RegexLab's engine passes and for the JSON wire format returned across the C++/WASM boundary. The TypeScript prototype and C++ engine intentionally use different in-memory containers; the wire representation is a third, frontend-friendly form. Do not treat those representations as interchangeable.

The v1 snapshot covers the currently implemented Core pipeline: parse a pattern, build its AST, NFA, DFA and minimized DFA, then match an input string. The optional AST simplifier in issue #45 is deferred for the current scope and is not part of this pipeline. If the team later reactivates it and chooses to expose simplifier output or counts in the snapshot, agree on and land that contract change before implementing the new output.

## 1. AST

The AST is recursive and has four variants:

```ts
type ASTNode =
  | { kind: "char"; value: string }
  | { kind: "concat"; left: ASTNode; right: ASTNode }
  | { kind: "alt"; left: ASTNode; right: ASTNode }
  | { kind: "star"; child: ASTNode };
```

`char.value` is one ASCII character accepted by the parser. The C++ representation is an `ASTNode` whose `node` is a `std::variant<CharNode, ConcatNode, AltNode, StarNode>`; `CharNode.value` is a `char`. The JSON representation uses the same tagged objects shown above. A character node has only `kind` and `value`; each compound node has `kind` and the named child field(s).

The current grammar supports literals, concatenation, alternation (`|`), Kleene star (`*`), groups, and backslash escapes. `+`, `?`, and character classes are not part of this v1 contract.

## 2. Automaton

All three automaton stages share one logical shape:

```ts
type Automaton = {
  stateCount: number;
  startState: number;
  acceptStates: Set<number>;
  transitions: Map<number, Map<string, number[]>>;
};
```

| Field | Meaning |
|---|---|
| `stateCount` | Number of states in the automaton. |
| `startState` | State ID from which execution starts. |
| `acceptStates` | Set of accepting state IDs. |
| `transitions` | Mapping from source state and symbol to one or more destination state IDs. |

The TypeScript prototype uses `Set<number>` and nested `Map<number, Map<string, number[]>>`. C++ uses `std::unordered_set<int>` and nested unordered maps to vectors. Those are internal representations; consumers must not depend on set/map iteration order.

In JSON, `acceptStates` is an array of numbers and `transitions` is a JSON object. JSON object keys are strings, so each source state ID is its base-10 string. Each source maps symbol strings to arrays of destination state IDs. A symbol is one character. The reserved key `"eps"` denotes an epsilon transition in the NFA; it consumes no input character. The DFA and minimized DFA contain no epsilon transitions.

```json
{
  "stateCount": 2,
  "startState": 0,
  "acceptStates": [1],
  "transitions": {
    "0": { "a": [1] }
  }
}
```

`acceptStates` is semantically a set, so its array order is not significant. Transition destination arrays are arrays, and state IDs in all fields refer to the same automaton.

## 3. Match trace

The trace records the minimized-DFA walk for the input:

| Field | Meaning |
|---|---|
| `steps` | One entry for each input character successfully consumed. |
| `result` | `"match"` or `"no-match"`. |
| `failurePosition` | Zero-based index of the first character with no outgoing transition, or `null` if every input character had a transition. |

The TS prototype's in-memory shape is:

```ts
type MatchTrace = {
  steps: { char: string; activeStates: number[] }[];
  result: "match" | "no-match";
  failurePosition?: number;
};
```

Each wire step has `{ "ch": string, "activeStates": number[] }`. `activeStates` contains the state reached after consuming `ch` (currently one state because matching runs over a DFA). The initial state is not a step. If a transition is missing, the failing character is not consumed: the trace stops before it and `failurePosition` identifies it. If all input is consumed but the final state is not accepting, the result is `"no-match"` and `failurePosition` is `null`.

The in-memory TS prototype calls the character field `char` and omits `failurePosition` when it is undefined. The C++ type calls the field `ch` and represents the position as `std::optional<int>`. The JSON bridge normalizes both cases to `ch` and an always-present `failurePosition` whose value is a number or `null`.

## 4. Parse error

A parse error has this logical shape:

```ts
type ParseError = {
  type:
    | "UnmatchedParen"
    | "UnexpectedToken"
    | "EmptyGroup"
    | "DanglingOperator"
    | "PatternTooComplex";
  position: number;
  expected: string | null;
  found: string | null;
};
```

`position` is a zero-based position in the pattern. Legal patterns are ASCII, so the TS prototype's UTF-16 positions and the C++ parser's byte positions agree for the accepted pattern alphabet. The TS prototype represents `expected` and `found` as optional strings; C++ uses `std::optional<std::string>`. The wire format always includes both keys and uses JSON `null` when an optional value is absent. Their string contents are error-specific; the type and position are the stable machine-readable fields.

`PatternTooComplex` is used for parser safety limits. Defaults are a 500-character pattern limit and a 1,000-level group nesting limit; for ordinary production calls, the length limit is reached before the nesting limit.

The parser's normal result is internal to the engine. The public pipeline JSON is instead a success/error union described below; it does not return the internal `ParseResult` object. `expected` and `found` are human-readable hints; clients should display them, not parse their wording.

## 5. Complete pipeline JSON wire format

The frontend calls the Embind `runPipeline(pattern, input)` function. It receives a JSON **string** and parses it into the `PipelineSnapshot` union in `frontend/src/types/engine.ts`.

On success, the object contains `ok`, `ast`, `nfa`, `dfa`, `minDfa`, and `trace`. There is no `error` field:

```ts
type PipelineSuccess = {
  ok: true;
  ast: ASTNode;
  nfa: Automaton;
  dfa: Automaton;
  minDfa: Automaton;
  trace: {
    steps: { ch: string; activeStates: number[] }[];
    result: "match" | "no-match";
    failurePosition: number | null;
  };
};
```

For example, matching `"a"` against pattern `"a"` produces this shape:

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

On parse failure, the object contains only `ok` and `error`; it does not contain partial AST/automaton stages or a trace:

```ts
type PipelineFailure = {
  ok: false;
  error: ParseError;
};
type PipelineSnapshot = PipelineSuccess | PipelineFailure;
```

For example, pattern `"(a"` produces:

```json
{
  "ok": false,
  "error": {
    "type": "UnmatchedParen",
    "position": 0,
    "expected": "')'",
    "found": "end of input"
  }
}
```

## 6. Change procedure

Treat the JSON contract and the corresponding TS/C++ shapes as one change. A proposed shape change must update this document, `engine/types.ts`, `engine/include/regexlab/types.hpp`, the JSON bridge, and the frontend mirror together; update or add boundary tests as appropriate. Coordinate changes that affect consumers before implementation so the TS prototype, C++/WASM engine, and frontend cannot silently drift.

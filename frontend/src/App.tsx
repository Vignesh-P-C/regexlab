import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { PatternInput } from "./components/PatternInput";
import { AutomatonView } from "./components/AutomatonView";
import { PlaybackControls } from "./components/PlaybackControls";
import { TestStringStrip } from "./components/TestStringStrip";
import { useRegexEngine } from "./hooks/useRegexEngine";
import type { PipelineSnapshot, Stage } from "./types/engine";
import { computeNfaSteps, computeDfaSteps, computeAstSteps, PLAYBACK_MAX_CHARS, type Step } from "./lib/steps";
import { clampStepIndex } from "./lib/playbackIndex";

const DEBOUNCE_MS = 150;

function App() {
  const { state, runPipeline } = useRegexEngine();
  const [pattern, setPattern] = useState("(a|b)*ab");
  const [input, setInput] = useState("aab");
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null);
  const [activeStage, setActiveStage] = useState<Stage>("ast");
  // #52: NFA/DFA/min-DFA share one "chars consumed" index; the AST index
  // is independent (it walks the tree, not the input string).
  const [inputStepIndex, setInputStepIndex] = useState(0);
  const [astStepIndex, setAstStepIndex] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status !== "ready") return;
    const handle = setTimeout(() => {
      try {
        setSnapshot(runPipeline(pattern, input));
        setEngineError(null);
      } catch (err) {
        // D5 fix: a thrown exception (e.g. non-ASCII input hitting the
        // WASM boundary) must never leave the previous pattern's result
        // on screen looking like a current, correct answer.
        console.error(err);
        setSnapshot(null);
        setEngineError(err instanceof Error ? err.message : "The engine failed to process this pattern.");
      }
      setInputStepIndex(0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, input, state.status]);

  // #52: the AST index resets only when the pattern itself changes, not
  // when just the test string changes -- it walks the tree, not the input.
  useEffect(() => {
    setAstStepIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern]);

  const error = snapshot && !snapshot.ok ? snapshot.error : null;

  const nfaSteps = useMemo<Step[] | null>(
    () => (snapshot && snapshot.ok ? computeNfaSteps(snapshot.nfa, input) : null),
    [snapshot, input],
  );
  const dfaSteps = useMemo<Step[] | null>(
    () => (snapshot && snapshot.ok ? computeDfaSteps(snapshot.dfa, input, snapshot.nfa) : null),
    [snapshot, input],
  );
  const minDfaSteps = useMemo<Step[] | null>(
    () => (snapshot && snapshot.ok ? computeDfaSteps(snapshot.minDfa, input) : null),
    [snapshot, input],
  );
  const astSteps = useMemo(() => (snapshot && snapshot.ok ? computeAstSteps(snapshot.ast) : null), [snapshot]);

  const activeSteps: Step[] | null =
    activeStage === "nfa" ? nfaSteps : activeStage === "dfa" ? dfaSteps : activeStage === "minDfa" ? minDfaSteps : null;

  const clampedInputIndex = activeSteps ? clampStepIndex(inputStepIndex, activeSteps.length) : 0;
  const clampedAstIndex = astSteps ? clampStepIndex(astStepIndex, astSteps.length) : 0;

  const activeStates = activeStage !== "ast" && activeSteps ? activeSteps[clampedInputIndex].activeStates : [];
  const traversedEdges = activeStage !== "ast" && activeSteps ? activeSteps[clampedInputIndex].traversedEdges : [];
  const astNodeIndex = activeStage === "ast" && astSteps ? astSteps[clampedAstIndex].nodeIndex : null;

  const caption =
    activeStage === "ast" ? (astSteps?.[clampedAstIndex]?.caption ?? "") : (activeSteps?.[clampedInputIndex]?.caption ?? "");

  const stepCountForControls = activeStage === "ast" ? (astSteps?.length ?? 1) : (activeSteps?.length ?? 1);
  const indexForControls = activeStage === "ast" ? clampedAstIndex : clampedInputIndex;
  const onStepChangeForControls = (i: number) => {
    if (activeStage === "ast") setAstStepIndex(i);
    else setInputStepIndex(i);
  };

  // #52: min-DFA trusts the engine's own trace result (it actually ran the
  // compiled matcher); NFA/DFA have no engine trace, so they use steps.ts's
  // own final-step verdict instead -- the two are proven to agree (PR 1's
  // per-prefix invariant tests), but min-DFA's displayed verdict should
  // never depend on the frontend's re-derivation when the engine's own
  // answer is right there.
  const overallVerdict: "match" | "no-match" | "stuck" | null =
    activeStage === "minDfa"
      ? snapshot && snapshot.ok
        ? snapshot.trace.failurePosition !== null
          ? "stuck"
          : snapshot.trace.result
        : null
      : activeStage === "ast"
        ? null
        : activeSteps
          ? activeSteps[activeSteps.length - 1].verdict === "pending"
            ? null
            : (activeSteps[activeSteps.length - 1].verdict as "match" | "no-match" | "stuck")
          : null;

  const automatonForStage = useMemo(() => {
    if (!snapshot || !snapshot.ok || activeStage === "ast") return null;
    return snapshot[activeStage];
  }, [snapshot, activeStage]);

  const tooLong = input.length > PLAYBACK_MAX_CHARS;

  return (
    <div className="app">
      <h1>RegexLab</h1>

      {state.status === "loading" && <p>Loading engine…</p>}
      {state.status === "error" && <p className="engine-error">{state.message}</p>}
      {engineError && <p className="engine-error">{engineError}</p>}

      <PatternInput
        pattern={pattern}
        input={input}
        onPatternChange={setPattern}
        onInputChange={setInput}
        error={error}
      />

      {snapshot && snapshot.ok && (
        <>
          <PlaybackControls
            activeStage={activeStage}
            onStageChange={setActiveStage}
            stepCount={stepCountForControls}
            activeStep={indexForControls}
            onStepChange={onStepChangeForControls}
            caption={caption}
            tooLong={tooLong}
          />
          {activeStage === "ast" && (
            <p className="step-hint">
              Steps show the order Thompson's construction would build this pattern's NFA in (not a run over the test
              string).
            </p>
          )}
          <AutomatonView
            stage={activeStage}
            ast={snapshot.ast}
            automaton={automatonForStage}
            activeStates={activeStates}
            traversedEdges={traversedEdges}
            astNodeIndex={astNodeIndex}
          />
          {activeStage !== "ast" && overallVerdict && (
            <TestStringStrip input={input} steps={activeSteps ?? []} stepIndex={clampedInputIndex} verdict={overallVerdict} />
          )}
          <p className="match-result">
            Result: <strong>{snapshot.trace.result}</strong>
            {snapshot.trace.failurePosition !== null && ` (failed at position ${snapshot.trace.failurePosition})`}
          </p>
        </>
      )}
    </div>
  );
}

export default App;

import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { PatternInput } from "./components/PatternInput";
import { AutomatonView } from "./components/AutomatonView";
import { PlaybackControls } from "./components/PlaybackControls";
import { useRegexEngine } from "./hooks/useRegexEngine";
import type { PipelineSnapshot, Stage } from "./types/engine";

const DEBOUNCE_MS = 150;

function App() {
  const { state, runPipeline } = useRegexEngine();
  const [pattern, setPattern] = useState("(a|b)*ab");
  const [input, setInput] = useState("aab");
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null);
  const [activeStage, setActiveStage] = useState<Stage>("ast");
  const [activeStep, setActiveStep] = useState(0);
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
      setActiveStep(0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, input, state.status]);

  const error = snapshot && !snapshot.ok ? snapshot.error : null;

  const automatonForStage = useMemo(() => {
    if (!snapshot || !snapshot.ok || activeStage === "ast") return null;
    return snapshot[activeStage];
  }, [snapshot, activeStage]);

  const activeStates =
    snapshot && snapshot.ok && activeStage === "minDfa"
      ? snapshot.trace.steps[activeStep]?.activeStates ?? [snapshot.minDfa.startState]
      : [];

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
            stepCount={snapshot.trace.steps.length}
            activeStep={activeStep}
            onStepChange={setActiveStep}
          />
          <AutomatonView stage={activeStage} ast={snapshot.ast} automaton={automatonForStage} activeStates={activeStates} />
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

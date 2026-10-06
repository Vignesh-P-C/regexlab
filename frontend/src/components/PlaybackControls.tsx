import type { Stage } from "../types/engine";

const STAGES: { key: Stage; label: string }[] = [
  { key: "ast", label: "AST" },
  { key: "nfa", label: "NFA" },
  { key: "dfa", label: "DFA" },
  { key: "minDfa", label: "min-DFA" },
];

type Props = {
  activeStage: Stage;
  onStageChange: (stage: Stage) => void;
  stepCount: number;
  activeStep: number;
  onStepChange: (step: number) => void;
};

/** Two independent navigation axes: pipeline stage, and match-trace step. */
export function PlaybackControls({ activeStage, onStageChange, stepCount, activeStep, onStepChange }: Props) {
  return (
    <div className="playback-controls">
      <div className="stage-tabs" role="tablist">
        {STAGES.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={activeStage === s.key}
            className={activeStage === s.key ? "active" : ""}
            onClick={() => onStageChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {stepCount > 0 && (
        <div className="step-scrubber">
          <button onClick={() => onStepChange(Math.max(0, activeStep - 1))} disabled={activeStep <= 0}>
            ◀
          </button>
          <input
            type="range"
            min={0}
            max={stepCount - 1}
            value={activeStep}
            onChange={(e) => onStepChange(Number(e.target.value))}
          />
          <button
            onClick={() => onStepChange(Math.min(stepCount - 1, activeStep + 1))}
            disabled={activeStep >= stepCount - 1}
          >
            ▶
          </button>
          <span>
            step {activeStep + 1} / {stepCount}
          </span>
        </div>
      )}
    </div>
  );
}

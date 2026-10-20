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
  caption: string;
  /** #52: the test string is longer than PLAYBACK_MAX_CHARS -- show a
   *  one-line notice instead of the scrubber on the three input-driven
   *  tabs. The AST tab's step count depends only on the pattern, so it
   *  is never affected by this. */
  tooLong: boolean;
};

/** Two independent navigation axes: pipeline stage, and playback step. */
export function PlaybackControls({ activeStage, onStageChange, stepCount, activeStep, onStepChange, caption, tooLong }: Props) {
  const showNotice = tooLong && activeStage !== "ast";

  return (
    <div className="playback-controls">
      <div className="stage-tabs" role="tablist" aria-label="Playback stage">
        {STAGES.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={activeStage === s.key}
            className={activeStage === s.key ? "active" : ""}
            onClick={() => onStageChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {showNotice ? (
        <p className="step-hint">Test string is longer than playback supports here -- showing the overall result only.</p>
      ) : (
        stepCount > 1 && (
          <div className="step-scrubber">
            <button
              type="button"
              aria-label="Previous step"
              onClick={() => onStepChange(Math.max(0, activeStep - 1))}
              disabled={activeStep <= 0}
            >
              ◀
            </button>
            <input
              type="range"
              aria-label="Playback step"
              min={0}
              max={stepCount - 1}
              value={activeStep}
              onChange={(e) => onStepChange(Number(e.target.value))}
            />
            <button
              type="button"
              aria-label="Next step"
              onClick={() => onStepChange(Math.min(stepCount - 1, activeStep + 1))}
              disabled={activeStep >= stepCount - 1}
            >
              ▶
            </button>
            <span>{activeStep === 0 ? "start" : `step ${activeStep} of ${stepCount - 1}`}</span>
          </div>
        )
      )}

      {!showNotice && <p className="step-caption" aria-live="polite">{caption}</p>}
    </div>
  );
}

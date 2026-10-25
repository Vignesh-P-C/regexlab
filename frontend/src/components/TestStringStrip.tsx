import type { Step } from "../lib/steps";

type Props = {
  input: string;
  steps: Step[];
  stepIndex: number; // clamped trace step; successful steps equal the number of consumed characters
  verdict: "match" | "no-match" | "stuck";
};

/** #52: shows which characters the current playback step has consumed,
 *  which is "next", and (once scrubbed there) which one the run got
 *  stuck on -- plus the overall accept/reject verdict, which always
 *  reflects the FULL run, independent of where the slider currently is. */
export function TestStringStrip({ input, steps, stepIndex, verdict }: Props) {
  const currentStep = steps[stepIndex];
  // Step zero is before input. Step k consumes input[k - 1], so a terminal
  // stuck step highlights its character at stepIndex - 1 rather than the
  // following character.
  const stuckCharacterIndex = currentStep?.verdict === "stuck" ? stepIndex - 1 : -1;
  const chars = input.split("");

  return (
    <div className="test-string-strip">
      <span className="chars">
        {chars.map((ch, i) => {
          let cls = "not-yet";
          if (i === stuckCharacterIndex) cls = "stuck";
          else if (i < (stuckCharacterIndex >= 0 ? stuckCharacterIndex : stepIndex)) cls = "consumed";
          else if (currentStep?.verdict !== "stuck" && i === stepIndex) cls = "next";
          return (
            <span key={i} className={cls}>
              {ch}
            </span>
          );
        })}
      </span>
      <span className="verdict-badge">{verdict === "match" ? "✓ Accepted" : "✗ Rejected"}</span>
      <small className="strip-legend">consumed · next · stuck char underlined</small>
    </div>
  );
}

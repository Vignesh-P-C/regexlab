import type { Step } from "../lib/steps";

type Props = {
  input: string;
  steps: Step[];
  stepIndex: number; // clamped, "chars consumed" by the shared-index convention
  verdict: "match" | "no-match" | "stuck";
};

/** #52: shows which characters the current playback step has consumed,
 *  which is "next", and (once scrubbed there) which one the run got
 *  stuck on -- plus the overall accept/reject verdict, which always
 *  reflects the FULL run, independent of where the slider currently is. */
export function TestStringStrip({ input, steps, stepIndex, verdict }: Props) {
  const stuckHere = steps[stepIndex]?.verdict === "stuck";
  const chars = input.split("");

  return (
    <div className="test-string-strip">
      <span className="chars">
        {chars.map((ch, i) => {
          const cls = stuckHere && i === stepIndex ? "stuck" : i < stepIndex ? "consumed" : i === stepIndex ? "next" : "not-yet";
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

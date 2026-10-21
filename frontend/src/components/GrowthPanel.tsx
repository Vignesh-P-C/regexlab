// issue #68 — Subset Growth / NFA Structure Lab (PR A).
//
// Opt-in panel: nothing here runs until the learner explicitly opens it
// (the "Show Growth Analysis" button) or asks to verify a specific
// what-if edit — never on every keystroke, matching the MD's "normal
// compile is not exhaustive search" principle (see useRegexEngine.ts's
// comment on runGrowthAnalysis/verifyCandidate).

import { useState } from "react";
import type { Automaton, CandidateResponse, GrowthAnalysisResult } from "../types/engine";
import { listEligibleEpsilonEdges } from "../lib/growth";

type Props = {
  pattern: string;
  nfa: Automaton;
  runGrowthAnalysis: (pattern: string) => GrowthAnalysisResult | null;
  verifyCandidate: (pattern: string, edgeSource: number, edgeTarget: number) => CandidateResponse | null;
};

export function GrowthPanel({ pattern, nfa, runGrowthAnalysis, verifyCandidate }: Props) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<GrowthAnalysisResult | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{ source: number; target: number } | null>(null);
  const [verification, setVerification] = useState<CandidateResponse | null>(null);

  function openPanel() {
    setOpen(true);
    setAnalysis(runGrowthAnalysis(pattern));
    setVerification(null);
    setSelectedEdge(null);
  }

  function verify(source: number, target: number) {
    setSelectedEdge({ source, target });
    setVerification(verifyCandidate(pattern, source, target));
  }

  if (!open) {
    return (
      <button className="growth-panel-toggle" onClick={openPanel}>
        Show Growth Analysis (Subset Growth Lab)
      </button>
    );
  }

  const eligibleEdges = listEligibleEpsilonEdges(nfa);

  return (
    <section className="growth-panel">
      <div className="growth-panel-header">
        <h2>Subset Growth Lab</h2>
        <button onClick={() => setOpen(false)}>Hide</button>
      </div>

      {!analysis && <p>Computing…</p>}
      {analysis && !analysis.ok && <p className="engine-error">Pattern error: {analysis.error.type}</p>}

      {analysis && analysis.ok && (
        <>
          <dl className="growth-counts">
            <div><dt>NFA states</dt><dd>{analysis.analysis.nfaMetrics.rawStateCount}</dd></div>
            <div><dt>Reachable subset-DFA states (pre-minimization)</dt><dd>{analysis.analysis.reachableSubsetStateCount}</dd></div>
            <div><dt>Minimized DFA states</dt><dd>{analysis.analysis.minimizedStateCount}</dd></div>
            <div><dt>Powerset ceiling (2^n)</dt><dd title={analysis.analysis.powersetCeiling.exactDecimal}>2^{analysis.analysis.powersetCeiling.exponent} ({analysis.analysis.powersetCeiling.exactDecimal.length}-digit number)</dd></div>
          </dl>

          <p className="growth-bound-status">
            Structural upper bound: <strong>{analysis.analysis.bound.status === "not-computed" ? "Not computed" : "Computed"}</strong>
            {analysis.analysis.bound.status === "not-computed" && <> — {analysis.analysis.bound.reason}</>}
          </p>

          <details className="growth-trace">
            <summary>Subset-construction trace ({analysis.analysis.subsetTrace.steps.length} steps)</summary>
            <table>
              <thead>
                <tr><th>Source</th><th>Symbol</th><th>Move</th><th>ε-closure (target)</th><th>Target id</th><th>New?</th><th>Accepting?</th></tr>
              </thead>
              <tbody>
                {analysis.analysis.subsetTrace.steps.map((step, i) => (
                  <tr key={i}>
                    <td>{`{${step.sourceNfaStates.join(",")}}`}</td>
                    <td>{step.symbol}</td>
                    <td>{`{${step.moveNfaStates.join(",")}}`}</td>
                    <td>{`{${step.closureNfaStates.join(",")}}`}</td>
                    <td>{step.targetId}</td>
                    <td>{step.isNew ? "new" : "known"}</td>
                    <td>{step.isAccepting ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <div className="growth-whatif">
            <h3>What-if: delete one ε-edge (candidate copy — baseline unchanged)</h3>
            {eligibleEdges.length === 0 && <p>No ε-edges in this NFA.</p>}
            <ul>
              {eligibleEdges.map((edge) => (
                <li key={`${edge.source}-${edge.target}`}>
                  {edge.source} --ε--&gt; {edge.target}{" "}
                  <button onClick={() => verify(edge.source, edge.target)}>Verify deletion</button>
                </li>
              ))}
            </ul>

            {selectedEdge && verification && verification.ok && (
              <div className={`growth-verdict growth-verdict--${verification.candidate.equivalence.status}`}>
                <p>
                  Deleting {selectedEdge.source} --ε--&gt; {selectedEdge.target}:{" "}
                  {verification.candidate.equivalence.status === "equivalent" && (
                    <strong>Equivalent — verified within the completed exact check.</strong>
                  )}
                  {verification.candidate.equivalence.status === "different" && (
                    <strong>
                      Different. Shortest distinguishing word:{" "}
                      {verification.candidate.equivalence.witness.isEmpty ? "ε (empty input)" : `"${verification.candidate.equivalence.witness.word}"`} —
                      baseline {verification.candidate.equivalence.witness.baselineAccepts ? "accepts" : "rejects"} it, candidate{" "}
                      {verification.candidate.equivalence.witness.candidateAccepts ? "accepts" : "rejects"} it.
                    </strong>
                  )}
                  {verification.candidate.equivalence.status === "inconclusive" && (
                    <strong>Inconclusive — resource limit reached. {verification.candidate.equivalence.reason}</strong>
                  )}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

import { useState } from "react";
import type {
  Automaton,
  BoundedOptimizationResponse,
  CandidateEdgeId,
  CandidateResponse,
  GrowthAnalysisResult,
} from "../types/engine";
import { listEligibleEpsilonEdges } from "../lib/growth";
import { BoundedOptimizationExplorer } from "./BoundedOptimizationExplorer";

type Props = {
  pattern: string;
  nfa: Automaton;
  runGrowthAnalysis: (pattern: string) => GrowthAnalysisResult | null;
  verifyCandidate: (pattern: string, edges: CandidateEdgeId[]) => CandidateResponse | null;
  runBoundedOptimization: (
    pattern: string,
    maxEditDepth: number,
    maxCandidates: number,
  ) => BoundedOptimizationResponse | null;
};

function edgeKey(edge: CandidateEdgeId): string {
  return String(edge.source) + ":" + String(edge.target);
}

function powersetLabel(exactDecimal: string): string {
  if (exactDecimal.length <= 15) {
    return BigInt(exactDecimal).toLocaleString() + " possible subsets";
  }
  return "exact value has " + exactDecimal.length + " digits";
}

export function GrowthPanel({ pattern, nfa, runGrowthAnalysis, verifyCandidate, runBoundedOptimization }: Props) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<GrowthAnalysisResult | null>(null);
  const [analysisPattern, setAnalysisPattern] = useState<string | null>(null);
  const [selectedEdgeKeys, setSelectedEdgeKeys] = useState<Set<string>>(() => new Set<string>());
  const [verifiedEdges, setVerifiedEdges] = useState<CandidateEdgeId[]>([]);
  const [verification, setVerification] = useState<CandidateResponse | null>(null);

  function refreshAnalysis() {
    setAnalysis(runGrowthAnalysis(pattern));
    setAnalysisPattern(pattern);
    setSelectedEdgeKeys(new Set<string>());
    setVerifiedEdges([]);
    setVerification(null);
  }

  function openPanel() {
    setOpen(true);
    refreshAnalysis();
  }

  function updateSelection(next: Set<string>) {
    setSelectedEdgeKeys(next);
    setVerifiedEdges([]);
    setVerification(null);
  }

  function toggleEdge(edge: CandidateEdgeId) {
    const key = edgeKey(edge);
    const next = new Set<string>(selectedEdgeKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateSelection(next);
  }

  if (!open) {
    return (
      <button className="growth-panel-toggle" onClick={openPanel}>
        <span>
          <strong>Explore subset growth</strong>
          <small>Compare the Thompson NFA, reachable DFA subsets, and minimized DFA</small>
        </span>
        <span className="growth-panel-toggle-action">Open analysis <span aria-hidden="true">→</span></span>
      </button>
    );
  }

  const eligibleEdges = listEligibleEpsilonEdges(nfa);
  const selectedEdges = eligibleEdges.filter((edge) => selectedEdgeKeys.has(edgeKey(edge)));
  const analysisIsStale = analysisPattern !== pattern;

  return (
    <section className="growth-panel" aria-labelledby="growth-panel-title">
      <header className="growth-panel-header">
        <div className="growth-panel-heading">
          <span className="growth-eyebrow">Automata analysis</span>
          <h2 id="growth-panel-title">Subset Growth Lab</h2>
          <p>See how NFA state sets become DFA states, then test whether selected ε-edge removals preserve the language.</p>
        </div>
        <div className="growth-panel-actions">
          <button className="growth-button growth-button--quiet" onClick={refreshAnalysis}>Refresh</button>
          <button className="growth-button growth-button--quiet" onClick={() => setOpen(false)}>Hide</button>
        </div>
      </header>

      <div className="growth-pattern-line">
        <span>Analyzing pattern</span>
        <code>{pattern}</code>
      </div>

      {analysisIsStale && (
        <div className="growth-alert growth-alert--warning" role="status">
          <div>
            <strong>The pattern changed.</strong>
            <p>Refresh to replace the old counts and edge choices with results for this pattern.</p>
          </div>
          <button className="growth-button" onClick={refreshAnalysis}>Refresh analysis</button>
        </div>
      )}
      {!analysisIsStale && !analysis && <p className="growth-loading">Computing analysis…</p>}
      {!analysisIsStale && analysis && !analysis.ok && (
        <div className="growth-alert growth-alert--error" role="alert">
          Pattern error: {analysis.error.type}
        </div>
      )}

      {!analysisIsStale && analysis?.ok && (
        <>
          <section className="growth-section" aria-labelledby="growth-overview-title">
            <div className="growth-section-heading">
              <div>
                <span className="growth-eyebrow">Measured from this NFA</span>
                <h3 id="growth-overview-title">Machine size</h3>
              </div>
              <p>A DFA state is a set of NFA states. The first two counts show the construction; the last shows the effect of minimization.</p>
            </div>

            <dl className="growth-counts">
              <div className="growth-metric">
                <dt>NFA states</dt>
                <dd>{analysis.analysis.nfaMetrics.rawStateCount}</dd>
                <small>Thompson construction</small>
              </div>
              <div className="growth-metric">
                <dt>Reachable subset-DFA states</dt>
                <dd>{analysis.analysis.reachableSubsetStateCount}</dd>
                <small>Before minimization</small>
              </div>
              <div className="growth-metric">
                <dt>Minimized DFA states</dt>
                <dd>{analysis.analysis.minimizedStateCount}</dd>
                <small>After equivalent states merge</small>
              </div>
              <div className="growth-metric growth-metric--ceiling">
                <dt>Powerset ceiling</dt>
                <dd>{"2^" + analysis.analysis.powersetCeiling.exponent}</dd>
                <small title={analysis.analysis.powersetCeiling.exactDecimal}>
                  {powersetLabel(analysis.analysis.powersetCeiling.exactDecimal)} at most
                </small>
              </div>
            </dl>
            <p className="growth-counts-note">
              The ceiling is a theoretical maximum, not a prediction. Here the construction reaches{" "}
              <strong>{analysis.analysis.reachableSubsetStateCount}</strong> subsets.
            </p>
          </section>

          <details className="growth-trace growth-section">
            <summary>
              <span>
                <strong>Subset-construction trace</strong>
                <small>Follow each symbol move and ε-closure</small>
              </span>
              <span className="growth-status-pill">{analysis.analysis.subsetTrace.steps.length} transitions</span>
            </summary>
            <div className="growth-trace-content">
              <p>Each row shows one worklist transition. “New” means the target subset creates a DFA state; “Known” means that subset was already discovered.</p>
              <div className="growth-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Source subset</th>
                      <th scope="col">Symbol</th>
                      <th scope="col">Move</th>
                      <th scope="col">ε-closure / target</th>
                      <th scope="col">DFA id</th>
                      <th scope="col">Discovery</th>
                      <th scope="col">Accepting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.analysis.subsetTrace.steps.map((step, i) => (
                      <tr key={String(step.sourceId) + "-" + step.symbol + "-" + String(step.targetId) + "-" + String(i)}>
                        <td><code>{"{" + step.sourceNfaStates.join(", ") + "}"}</code></td>
                        <td><code>{step.symbol}</code></td>
                        <td><code>{"{" + step.moveNfaStates.join(", ") + "}"}</code></td>
                        <td><code>{"{" + step.closureNfaStates.join(", ") + "}"}</code></td>
                        <td>{step.targetId}</td>
                        <td><span className={"growth-discovery " + (step.isNew ? "is-new" : "is-known")}>{step.isNew ? "New" : "Known"}</span></td>
                        <td>{step.isAccepting ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          <section className="growth-whatif growth-section" aria-labelledby="growth-whatif-title">
            <div className="growth-section-heading">
              <div>
                <span className="growth-eyebrow">What-if experiment</span>
                <h3 id="growth-whatif-title">Remove ε-edges together</h3>
              </div>
              <p>Choose one or more edges. RegexLab applies all selected removals to a copy, then checks that candidate against the original language.</p>
            </div>

            {eligibleEdges.length === 0 ? (
              <p className="growth-empty">This NFA has no ε-edges to test.</p>
            ) : (
              <>
                <div className="growth-selection-toolbar">
                  <p><strong>{selectedEdges.length}</strong> of {eligibleEdges.length} ε-edges selected</p>
                  <div>
                    <button
                      className="growth-button growth-button--quiet"
                      onClick={() => updateSelection(new Set(eligibleEdges.map(edgeKey)))}
                      disabled={selectedEdges.length === eligibleEdges.length}
                    >
                      Select all
                    </button>
                    <button
                      className="growth-button growth-button--quiet"
                      onClick={() => updateSelection(new Set<string>())}
                      disabled={selectedEdges.length === 0}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <ul className="growth-edge-list" aria-label="Epsilon edges available for deletion">
                  {eligibleEdges.map((edge) => {
                    const selected = selectedEdgeKeys.has(edgeKey(edge));
                    return (
                      <li key={edgeKey(edge)}>
                        <label className={selected ? "is-selected" : ""}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleEdge(edge)}
                          />
                          <span className="growth-edge-source">{edge.source}</span>
                          <span className="growth-edge-arrow" aria-label="epsilon transition">— ε →</span>
                          <span className="growth-edge-target">{edge.target}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>

                <div className="growth-verify-row">
                  <p>Verification searches for any string that distinguishes the candidate from the original. Large checks may return inconclusive at the safety limit.</p>
                  <button
                    className="growth-button growth-button--primary"
                    onClick={() => {
                      if (analysisPattern !== pattern || selectedEdges.length === 0) return;
                      setVerifiedEdges(selectedEdges);
                      setVerification(verifyCandidate(pattern, selectedEdges));
                    }}
                    disabled={analysisIsStale || selectedEdges.length === 0}
                  >
                    Verify {selectedEdges.length || "selected"} deletion{selectedEdges.length === 1 ? "" : "s"}
                  </button>
                </div>

                {verification && (
                  <div className="growth-result">
                    <div className="growth-result-selection">
                      <strong>Combined candidate:</strong>
                      <ul>
                        {verifiedEdges.map((edge) => (
                          <li key={edgeKey(edge)}><code>{edge.source} — ε → {edge.target}</code></li>
                        ))}
                      </ul>
                    </div>
                    {!verification.ok && (
                      <div className="growth-alert growth-alert--error" role="alert">
                        {"message" in verification.error ? verification.error.message : "Pattern error: " + verification.error.type}
                      </div>
                    )}
                    {verification.ok && verification.candidate.equivalence.status === "equivalent" && (
                      <div className="growth-alert growth-alert--success" role="status">
                        <strong>Equivalent.</strong> The selected deletions preserve the language; the check completed.
                      </div>
                    )}
                    {verification.ok && verification.candidate.equivalence.status === "different" && (
                      <div className="growth-alert growth-alert--error" role="status">
                        <strong>Different.</strong> Shortest distinguishing input:{" "}
                        <code>{verification.candidate.equivalence.witness.isEmpty ? "ε (empty string)" : "\"" + verification.candidate.equivalence.witness.word + "\""}</code>.
                        The original {verification.candidate.equivalence.witness.baselineAccepts ? "accepts" : "rejects"} it; the candidate{" "}
                        {verification.candidate.equivalence.witness.candidateAccepts ? "accepts" : "rejects"} it.
                      </div>
                    )}
                    {verification.ok && verification.candidate.equivalence.status === "inconclusive" && (
                      <div className="growth-alert growth-alert--warning" role="status">
                        <strong>Inconclusive.</strong> The verifier reached its resource limit. {verification.candidate.equivalence.reason}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <BoundedOptimizationExplorer
            pattern={pattern}
            baselineNfa={nfa}
            runBoundedOptimization={runBoundedOptimization}
          />
        </>
      )}
    </section>
  );
}

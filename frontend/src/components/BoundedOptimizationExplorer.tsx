import { useMemo, useState } from "react";
import type {
  Automaton,
  BoundedAutomatonMetrics,
  BoundedOptimizationCandidate,
  BoundedOptimizationResponse,
} from "../types/engine";
import { AutomatonView } from "./AutomatonView";

type Props = {
  pattern: string;
  baselineNfa: Automaton;
  runBoundedOptimization: (
    pattern: string,
    maxEditDepth: number,
    maxCandidates: number,
  ) => BoundedOptimizationResponse | null;
};

function statusLabel(candidate: BoundedOptimizationCandidate): string {
  if (candidate.equivalence.status === "equivalent") return "Verified equivalent";
  if (candidate.equivalence.status === "different") return "Different language";
  return "Inconclusive";
}

function edgeLabel(candidate: BoundedOptimizationCandidate): string {
  return candidate.edits.map((edge) => String(edge.source) + " -> " + String(edge.target)).join(", ");
}

function stopReasonLabel(reason: string, maxEligibleEdges: number): string {
  if (reason === "eligible-edge-limit") {
    return "Only the first " + maxEligibleEdges + " epsilon edges in stable order were considered.";
  }
  if (reason === "candidate-limit") return "The candidate evaluation cap was reached; this result is partial.";
  return "The baseline could not be determinized within the configured safety limits, so no candidate was marked safe.";
}

function BoundedMetricsGrid({ metrics }: { metrics: BoundedAutomatonMetrics }) {
  return (
    <>
      <dl className="growth-counts bounded-metrics">
        <div className="growth-metric"><dt>Raw NFA states</dt><dd>{metrics.nfa.rawStateCount}</dd></div>
        <div className="growth-metric"><dt>Reachable NFA states</dt><dd>{metrics.nfa.reachableStateCount}</dd></div>
        <div className="growth-metric"><dt>Useful (trim) states</dt><dd>{metrics.nfa.trimStateCount}</dd></div>
        <div className="growth-metric"><dt>Epsilon edges</dt><dd>{metrics.nfa.epsilonEdgeCount}</dd></div>
        <div className="growth-metric"><dt>Consuming edges</dt><dd>{metrics.nfa.consumingEdgeCount}</dd></div>
        <div className="growth-metric"><dt>Total transitions</dt><dd>{metrics.nfa.totalTransitionCount}</dd></div>
        <div className="growth-metric"><dt>NFA label alphabet size</dt><dd>{metrics.nfa.alphabetSize}</dd></div>
        <div className="growth-metric">
          <dt>Reachable subset-DFA states</dt>
          <dd>{metrics.reachableSubsetStateCount ?? "Not computed"}</dd>
        </div>
        <div className="growth-metric">
          <dt>Minimized DFA states</dt>
          <dd>{metrics.minimizedStateCount ?? "Not computed"}</dd>
        </div>
      </dl>
      {metrics.subsetAnalysisReason && <p className="bounded-metric-note">Subset metrics unavailable: {metrics.subsetAnalysisReason}</p>}
      {metrics.minimizationReason && <p className="bounded-metric-note">Minimized-DFA diagnostic unavailable: {metrics.minimizationReason}</p>}
    </>
  );
}

export function BoundedOptimizationExplorer({ pattern, baselineNfa, runBoundedOptimization }: Props) {
  const [maxEditDepth, setMaxEditDepth] = useState(2);
  const [maxCandidates, setMaxCandidates] = useState(24);
  const [response, setResponse] = useState<BoundedOptimizationResponse | null>(null);
  const [searchedPattern, setSearchedPattern] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("baseline");

  const searchIsStale = searchedPattern !== null && searchedPattern !== pattern;
  const search = response?.ok && !searchIsStale ? response.search : null;
  const selectedCandidate = useMemo(
    () => search?.candidates.find((candidate) => candidate.id === selectedId) ?? null,
    [search, selectedId],
  );
  const previewNfa = selectedCandidate?.nfa ?? baselineNfa;

  function runSearch() {
    const next = runBoundedOptimization(pattern, maxEditDepth, maxCandidates);
    setResponse(next);
    setSearchedPattern(pattern);
    setSelectedId("baseline");
    if (next?.ok && next.search.paretoFrontierIds.length > 0) {
      setSelectedId(next.search.paretoFrontierIds[0]);
    }
  }

  return (
    <section className="bounded-explorer growth-section" aria-labelledby="bounded-explorer-title">
      <div className="growth-section-heading">
        <div>
          <span className="growth-eyebrow">Bounded search</span>
          <h3 id="bounded-explorer-title">Find verified NFA variants</h3>
        </div>
        <p>
          Search combinations of epsilon-edge deletions on copies of this NFA. Each candidate is checked against the
          original language; this does not search for a globally smallest NFA.
        </p>
      </div>

      <div className="bounded-controls">
        <label>
          <span>Maximum deletions in one candidate</span>
          <select value={maxEditDepth} onChange={(event) => setMaxEditDepth(Number(event.target.value))}>
            <option value={1}>1 edge</option>
            <option value={2}>2 edges</option>
            <option value={3}>3 edges</option>
          </select>
        </label>
        <label>
          <span>Maximum candidates to evaluate</span>
          <select value={maxCandidates} onChange={(event) => setMaxCandidates(Number(event.target.value))}>
            <option value={8}>8 candidates</option>
            <option value={24}>24 candidates</option>
            <option value={64}>64 candidates</option>
          </select>
        </label>
        <button className="growth-button growth-button--primary" onClick={runSearch}>
          Run bounded search
        </button>
      </div>

      <p className="bounded-budget-note">
        Limits: at most 12 epsilon edges considered; 128 DFA states and 100,000 determinization work units per
        automaton; 10,000 product-state pairs per equivalence check. Search order is fixed, and resource-limited
        checks remain inconclusive.
      </p>

      {searchIsStale && (
        <div className="growth-alert growth-alert--warning" role="status">
          The pattern changed. Run the search again to replace these results.
        </div>
      )}
      {response && !searchIsStale && !response.ok && (
        <div className="growth-alert growth-alert--error" role="alert">
          {response.error.message ?? `Pattern error: ${response.error.type}`}
        </div>
      )}
      {response?.ok && !searchIsStale && search && (
        <>
          <div className="bounded-summary" aria-label="Search summary">
            <div><strong>{search.totalEligibleEdgeCount}</strong><span>eligible epsilon edges</span></div>
            <div><strong>{search.searchSpaceCandidateCount}</strong><span>sets in this search space</span></div>
            <div><strong>{search.evaluatedCandidateCount}</strong><span>candidates evaluated</span></div>
            <div><strong>{search.equivalentCandidateCount}</strong><span>verified equivalent</span></div>
            <div><strong>{search.differentCandidateCount}</strong><span>different language</span></div>
            <div><strong>{search.inconclusiveCandidateCount}</strong><span>inconclusive</span></div>
          </div>

          {search.stopReasons.length === 0 ? (
            <div className="growth-alert growth-alert--success" role="status">
              The declared search space was exhausted. Results describe this bounded edit family only.
            </div>
          ) : (
            <div className="growth-alert growth-alert--warning" role="status">
              {search.stopReasons.map((reason) => (
                <p key={reason}>{stopReasonLabel(reason, search.limits.maxEligibleEdges)}</p>
              ))}
            </div>
          )}

          <div className="bounded-frontier">
            <strong>Pareto frontier</strong>
            <p>Non-dominated language-equivalent variants, comparing epsilon edges, total transitions, and reachable subset-DFA states. The minimized-DFA count is shown as an invariant check, not an optimization target.</p>
            {search.paretoFrontierIds.length === 0 ? (
              <p className="growth-empty">No fully verified variant could be placed on the frontier.</p>
            ) : (
              <ul>
                {search.paretoFrontierIds.map((id) => (
                  <li key={id}>
                    <button
                      className={selectedId === id ? "bounded-variant is-selected" : "bounded-variant"}
                      onClick={() => setSelectedId(id)}
                    >
                      <span>{id === "baseline" ? "Original NFA" : "Candidate " + id}</span>
                      <small>{id === "baseline" ? "Reference" : "Verified equivalent"}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {search.candidates.length > 0 && (
            <details className="bounded-candidate-details" open>
              <summary>
                <strong>All evaluated candidates</strong>
                <span className="growth-status-pill">{search.candidates.length}</span>
              </summary>
              <ul className="bounded-candidate-list">
                {search.candidates.map((candidate) => {
                  const isFrontier = search.paretoFrontierIds.includes(candidate.id);
                  const isSelected = selectedId === candidate.id;
                  return (
                    <li key={candidate.id}>
                      <button
                        className={isSelected ? "bounded-candidate is-selected" : "bounded-candidate"}
                        onClick={() => setSelectedId(candidate.id)}
                      >
                        <span className="bounded-candidate-title">
                          <strong>{edgeLabel(candidate)}</strong>
                          <span className={"bounded-status bounded-status--" + candidate.equivalence.status}>
                            {statusLabel(candidate)}
                          </span>
                        </span>
                        <span className="bounded-candidate-subtitle">
                          {candidate.edits.length} deletion{candidate.edits.length === 1 ? "" : "s"}
                          {isFrontier ? "  |  Pareto frontier" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <div className="bounded-selected">
            <h4>{selectedId === "baseline" ? "Original NFA" : "Selected candidate"}</h4>
            {selectedCandidate && (
              <>
                <p className="bounded-edit-summary">Remove: {edgeLabel(selectedCandidate)}</p>
                <BoundedMetricsGrid metrics={selectedCandidate.metrics} />
                {selectedCandidate.equivalence.status === "equivalent" && (
                  <div className="growth-alert growth-alert--success" role="status">
                    Exact check completed: this candidate recognizes the same language as the original.
                  </div>
                )}
                {selectedCandidate.equivalence.status === "different" && (
                  <div className="growth-alert growth-alert--error" role="status">
                    Shortest distinguishing input:{" "}
                    <code>{selectedCandidate.equivalence.witness.isEmpty ? "epsilon (empty string)" : JSON.stringify(selectedCandidate.equivalence.witness.word)}</code>.
                    The original {selectedCandidate.equivalence.witness.baselineAccepts ? "accepts" : "rejects"} it; this candidate{" "}
                    {selectedCandidate.equivalence.witness.candidateAccepts ? "accepts" : "rejects"} it.
                  </div>
                )}
                {selectedCandidate.equivalence.status === "inconclusive" && (
                  <div className="growth-alert growth-alert--warning" role="status">
                    Not classified as safe. {selectedCandidate.equivalence.reason}
                  </div>
                )}
                {selectedCandidate.minimizedStateCountMatchesBaseline === false && (
                  <div className="growth-alert growth-alert--error" role="alert">
                    Diagnostic mismatch: equivalent candidates should have the same minimized-DFA state count as the baseline.
                  </div>
                )}
              </>
            )}
            {selectedCandidate === null && (
              <BoundedMetricsGrid metrics={search.baselineMetrics} />
            )}
            {selectedCandidate === null && search.baselineMetrics.minimizedStateCount === null && (
              <div className="growth-alert growth-alert--warning" role="status">
                {search.baselineMetrics.subsetAnalysisReason ?? search.baselineMetrics.minimizationReason ?? "Baseline metrics unavailable."}
              </div>
            )}
            <p className="bounded-preview-note">Automaton preview only; this experiment never changes the pipeline's original NFA.</p>
            <AutomatonView
              stage="nfa"
              ast={null}
              automaton={previewNfa}
              activeStates={[]}
              traversedEdges={[]}
              astNodeIndex={null}
            />
          </div>
        </>
      )}
    </section>
  );
}

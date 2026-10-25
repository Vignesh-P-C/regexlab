// JSON serialization at the JS/WASM boundary.
#include "regexlab/json_bridge.hpp"
#include <nlohmann/json.hpp>
#include <variant>
#include <set>
#include "regexlab/candidate.hpp"
#include "regexlab/bounded-optimization.hpp"
#include "regexlab/pipeline.hpp"
#include "regexlab/growth-analysis.hpp"
#include "regexlab/passes/parser-pass.hpp"
#include "regexlab/passes/thompson-pass.hpp"
namespace regexlab {
namespace {
using json = nlohmann::json;
json toJson(const ParseError& e) {
    static const char* names[] = {"UnmatchedParen","UnexpectedToken","EmptyGroup","DanglingOperator","PatternTooComplex","InvalidCharacterClass","AutomatonTooComplex"};
    static_assert(sizeof(names)/sizeof(names[0]) == static_cast<size_t>(ParseErrorType::AutomatonTooComplex)+1, "error names must match ParseErrorType");
    return json{{"type",names[static_cast<int>(e.type)]},{"position",e.position},
        {"expected",e.expected ? json(*e.expected) : json(nullptr)},{"found",e.found ? json(*e.found) : json(nullptr)}};
}
json toJson(const ASTNodePtr& node) {
    return std::visit([&](auto&& n)->json {
        using T=std::decay_t<decltype(n)>;
        if constexpr(std::is_same_v<T,CharNode>) return json{{"kind","char"},{"value",std::string(1,n.value)}};
        else if constexpr(std::is_same_v<T,CharacterSetNode>) return json{{"kind","charset"},{"characters",n.characters},{"label",n.label}};
        else if constexpr(std::is_same_v<T,ConcatNode>) return json{{"kind","concat"},{"left",toJson(n.left)},{"right",toJson(n.right)}};
        else if constexpr(std::is_same_v<T,AltNode>) return json{{"kind","alt"},{"left",toJson(n.left)},{"right",toJson(n.right)}};
        else if constexpr(std::is_same_v<T,StarNode>) return json{{"kind","star"},{"child",toJson(n.child)}};
        else if constexpr(std::is_same_v<T,PlusNode>) return json{{"kind","plus"},{"child",toJson(n.child)}};
        else return json{{"kind","optional"},{"child",toJson(n.child)}};
    },node->node);
}
json toJson(const Automaton& a) {
    json j; j["stateCount"]=a.stateCount; j["startState"]=a.startState; j["acceptStates"]=a.acceptStates;
    json transitions=json::object();
    for(const auto& [state,bySymbol]:a.transitions) { json symbols=json::object(); for(const auto& [symbol,targets]:bySymbol) symbols[symbol]=targets; transitions[std::to_string(state)]=symbols; }
    j["transitions"]=transitions; return j;
}
json toJson(const MatchStep& s) { return json{{"ch",std::string(1,s.ch)},{"activeStates",s.activeStates}}; }
json toJson(const MatchTrace& t) {
    json j; j["steps"]=json::array(); for(const auto& step:t.steps) j["steps"].push_back(toJson(step));
    j["result"]=t.result==MatchResultType::Match?"match":"no-match";
    j["failurePosition"]=t.failurePosition?json(*t.failurePosition):json(nullptr); return j;
}
json toJson(const PipelineResult& r) {
    json j; j["ok"]=r.ok;
    if(r.ok) { j["ast"]=toJson(r.ast);j["nfa"]=toJson(r.nfa);j["dfa"]=toJson(r.dfa);j["minDfa"]=toJson(r.minDfa);j["trace"]=toJson(r.trace); }
    else j["error"]=toJson(r.error);
    return j;
}

// issue #68 — Subset Growth / NFA Structure Lab (PR A) serializers.
json toJson(const SubsetConstructionStep& s) {
    return json{{"sourceId",s.sourceId},{"sourceNfaStates",s.sourceNfaStates},{"symbol",s.symbol},
        {"moveNfaStates",s.moveNfaStates},{"closureNfaStates",s.closureNfaStates},
        {"targetId",s.targetId},{"isNew",s.isNew},{"isAccepting",s.isAccepting}};
}
json toJson(const SubsetTrace& t) {
    json steps=json::array(); for(const auto& s:t.steps) steps.push_back(toJson(s));
    return json{{"steps",steps},{"subsetCount",t.subsetCount}};
}
json toJson(const PowersetCeiling& p) { return json{{"exponent",p.exponent},{"exactDecimal",p.exactDecimal}}; }
json toJson(const AutomatonMetrics& m) {
    return json{{"rawStateCount",m.rawStateCount},{"reachableStateCount",m.reachableStateCount},
        {"trimStateCount",m.trimStateCount},{"epsilonEdgeCount",m.epsilonEdgeCount},
        {"consumingEdgeCount",m.consumingEdgeCount},{"totalTransitionCount",m.totalTransitionCount},
        {"alphabetSize",m.alphabetSize}};
}
json toJson(const BoundResult& b) {
    if (b.status == BoundStatus::NotComputed) return json{{"status","not-computed"},{"reason",b.reason}};
    return json{{"status","computed"},{"representation",b.representation},{"method",b.method},{"value",b.value}};
}
json toJson(const GrowthAnalysis& g) {
    return json{{"nfaMetrics",toJson(g.nfaMetrics)},{"subsetTrace",toJson(g.subsetTrace)},
        {"reachableSubsetStateCount",g.reachableSubsetStateCount},{"minimizedStateCount",g.minimizedStateCount},
        {"powersetCeiling",toJson(g.powersetCeiling)},{"bound",toJson(g.bound)}};
}
json toJson(const EquivalenceWitness& w) {
    return json{{"word",w.word},{"isEmpty",w.isEmpty},{"baselineAccepts",w.baselineAccepts},{"candidateAccepts",w.candidateAccepts}};
}
json toJson(const EquivalenceResult& e) {
    if (e.status == EquivalenceStatus::Equivalent) return json{{"status","equivalent"}};
    if (e.status == EquivalenceStatus::Different) return json{{"status","different"},{"witness",toJson(e.witness)}};
    return json{{"status","inconclusive"},{"reason",e.reason}};
}
json toJson(const CandidateResult& c) {
    return json{{"nfa",toJson(c.nfa)},{"metrics",toJson(c.metrics)},{"equivalence",toJson(c.equivalence)}};
}
json toJson(const CandidateEdgeId& e) {
    return json{{"source",e.source},{"symbol",e.symbol},{"target",e.target}};
}
json toJson(const BoundedSearchLimits& l) {
    return json{{"maxEligibleEdges",l.maxEligibleEdges},{"maxEditDepth",l.maxEditDepth},
        {"maxCandidates",l.maxCandidates},{"maxDfaStates",l.maxDfaStates},
        {"maxWorkUnitsPerCheck",l.maxWorkUnitsPerCheck},{"maxProductStatePairs",l.maxProductStatePairs}};
}
json toJson(const BoundedAutomatonMetrics& m) {
    return json{{"nfa",toJson(m.nfa)},
        {"reachableSubsetStateCount",m.reachableSubsetStateCount ? json(*m.reachableSubsetStateCount) : json(nullptr)},
        {"minimizedStateCount",m.minimizedStateCount ? json(*m.minimizedStateCount) : json(nullptr)},
        {"subsetAnalysisReason",m.subsetAnalysisReason.empty() ? json(nullptr) : json(m.subsetAnalysisReason)},
        {"minimizationReason",m.minimizationReason.empty() ? json(nullptr) : json(m.minimizationReason)}};
}
json toJson(const BoundedOptimizationCandidate& c) {
    json edits = json::array();
    for (const auto& edge : c.edits) edits.push_back(toJson(edge));
    return json{{"id",c.id},{"edits",edits},{"nfa",toJson(c.nfa)},
        {"metrics",toJson(c.metrics)},{"equivalence",toJson(c.equivalence)},
        {"minimizedStateCountMatchesBaseline",c.minimizedStateCountMatchesBaseline
            ? json(*c.minimizedStateCountMatchesBaseline) : json(nullptr)}};
}
json toJson(const BoundedOptimizationResult& r) {
    json candidates = json::array();
    for (const auto& candidate : r.candidates) candidates.push_back(toJson(candidate));
    return json{{"limits",toJson(r.limits)},
        {"totalEligibleEdgeCount",r.totalEligibleEdgeCount},{"consideredEdgeCount",r.consideredEdgeCount},
        {"searchSpaceCandidateCount",r.searchSpaceCandidateCount},{"generatedCandidateCount",r.generatedCandidateCount},
        {"evaluatedCandidateCount",r.evaluatedCandidateCount},{"equivalentCandidateCount",r.equivalentCandidateCount},
        {"differentCandidateCount",r.differentCandidateCount},{"inconclusiveCandidateCount",r.inconclusiveCandidateCount},
        {"duplicateAutomataSkipped",r.duplicateAutomataSkipped},{"stopReasons",r.stopReasons},
        {"baselineMetrics",toJson(r.baselineMetrics)},{"candidates",candidates},
        {"paretoFrontierIds",r.paretoFrontierIds}};
}
}
std::string runPipelineJson(const std::string& pattern,const std::string& input) { return toJson(runPipeline(pattern,input)).dump(); }

std::string runGrowthAnalysisJson(const std::string& pattern) {
    ParseResult parsed = parse(pattern);
    json j;
    if (!parsed.ok) { j["ok"]=false; j["error"]=toJson(parsed.error); return j.dump(); }
    Automaton nfa = thompsonConstruction(parsed.ast);
    j["ok"]=true; j["analysis"]=toJson(computeGrowthAnalysis(nfa));
    return j.dump();
}

std::string verifyCandidateJson(const std::string& pattern, int edgeSource, int edgeTarget) {
    ParseResult parsed = parse(pattern);
    json j;
    if (!parsed.ok) { j["ok"]=false; j["error"]=toJson(parsed.error); return j.dump(); }
    Automaton nfa = thompsonConstruction(parsed.ast);
    CandidateEdit edit{CandidateEditKind::DeleteEpsilonEdge, CandidateEdgeId{edgeSource, "eps", edgeTarget}, {}};
    j["ok"]=true; j["candidate"]=toJson(verifyCandidate(nfa, edit));
    return j.dump();
}

std::string verifyCandidateEdgesJson(const std::string& pattern, const std::string& edgesJson) {
    ParseResult parsed = parse(pattern);
    if (!parsed.ok) return json{{"ok", false}, {"error", toJson(parsed.error)}}.dump();

    Automaton nfa = thompsonConstruction(parsed.ast);
    json requested;
    try {
        requested = json::parse(edgesJson);
    } catch (const json::exception&) {
        return json{{"ok", false}, {"error", {
            {"type", "InvalidCandidateEdit"},
            {"message", "The selected edge list is not valid JSON."}
        }}}.dump();
    }

    if (!requested.is_array() || requested.empty()) {
        return json{{"ok", false}, {"error", {
            {"type", "InvalidCandidateEdit"},
            {"message", "Select at least one epsilon edge to verify."}
        }}}.dump();
    }

    const std::vector<CandidateEdgeId> eligible = listEligibleEpsilonEdges(nfa);
    std::set<std::pair<int, int>> allowed;
    for (const CandidateEdgeId& edge : eligible) allowed.emplace(edge.source, edge.target);

    std::set<std::pair<int, int>> seen;
    std::vector<CandidateEdgeId> edges;
    for (const json& item : requested) {
        if (!item.is_object() || !item.contains("source") || !item.contains("target") ||
            !item["source"].is_number_integer() || !item["target"].is_number_integer()) {
            return json{{"ok", false}, {"error", {
                {"type", "InvalidCandidateEdit"},
                {"message", "Each selected edge must include integer source and target state ids."}
            }}}.dump();
        }
        if (item.contains("symbol") && (!item["symbol"].is_string() || item["symbol"] != "eps")) {
            return json{{"ok", false}, {"error", {
                {"type", "InvalidCandidateEdit"},
                {"message", "Only epsilon edges can be deleted in this analysis."}
            }}}.dump();
        }

        const int source = item["source"].get<int>();
        const int target = item["target"].get<int>();
        const std::pair<int, int> key{source, target};
        if (!allowed.count(key)) {
            return json{{"ok", false}, {"error", {
                {"type", "InvalidCandidateEdit"},
                {"message", "A selected epsilon edge does not exist in the baseline NFA."}
            }}}.dump();
        }
        if (!seen.insert(key).second) {
            return json{{"ok", false}, {"error", {
                {"type", "InvalidCandidateEdit"},
                {"message", "The same epsilon edge was selected more than once."}
            }}}.dump();
        }
        edges.push_back(CandidateEdgeId{source, "eps", target});
    }

    CandidateEdit edit;
    edit.kind = CandidateEditKind::DeleteEpsilonEdges;
    edit.edges = std::move(edges);
    return json{{"ok", true}, {"candidate", toJson(verifyCandidate(nfa, edit))}}.dump();
}

std::string runBoundedOptimizationJson(const std::string& pattern, int maxEditDepth, int maxCandidates) {
    ParseResult parsed = parse(pattern);
    if (!parsed.ok) return json{{"ok", false}, {"error", toJson(parsed.error)}}.dump();

    Automaton nfa = thompsonConstruction(parsed.ast);
    BoundedSearchLimits limits;
    if (maxEditDepth > 0) limits.maxEditDepth = static_cast<std::size_t>(maxEditDepth);
    if (maxCandidates > 0) limits.maxCandidates = static_cast<std::size_t>(maxCandidates);
    return json{{"ok", true}, {"search", toJson(searchBoundedEpsilonDeletions(nfa, limits))}}.dump();
}
}

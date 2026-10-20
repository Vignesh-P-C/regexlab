// JSON serialization at the JS/WASM boundary.
#include "regexlab/json_bridge.hpp"
#include <nlohmann/json.hpp>
#include <variant>
#include "regexlab/pipeline.hpp"
namespace regexlab {
namespace {
using json = nlohmann::json;
json toJson(const ParseError& e) {
    static const char* names[] = {"UnmatchedParen","UnexpectedToken","EmptyGroup","DanglingOperator","PatternTooComplex","InvalidCharacterClass"};
    static_assert(sizeof(names)/sizeof(names[0]) == static_cast<size_t>(ParseErrorType::InvalidCharacterClass)+1, "error names must match ParseErrorType");
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
}
std::string runPipelineJson(const std::string& pattern,const std::string& input) { return toJson(runPipeline(pattern,input)).dump(); }
}

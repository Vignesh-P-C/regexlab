// tests/json_bridge_test.cpp
//
// Tests the actual WASM boundary logic natively — no Emscripten needed
// for this, since json_bridge.cpp doesn't touch anything Emscripten-
// specific. Parses the JSON string back and checks fields, rather than
// just checking the output string looks plausible.

#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include "regexlab/json_bridge.hpp"
#include "regexlab/character-set.hpp"

using namespace regexlab;
using json = nlohmann::json;

TEST_CASE("json_bridge — successful match serializes correctly", "[json_bridge]") {
    std::string raw = runPipelineJson("ab", "ab");
    json j = json::parse(raw);  // must be valid JSON at all — this alone is a real check

    REQUIRE(j["ok"].get<bool>() == true);
    REQUIRE(j["trace"]["result"].get<std::string>() == "match");
    REQUIRE(j["trace"]["steps"].size() == 2);
    REQUIRE(j["trace"]["steps"][0]["ch"].get<std::string>() == "a");
    REQUIRE(j["trace"]["steps"][0]["activeStates"].size() == 1);
    REQUIRE(j["trace"]["failurePosition"].is_null());
}

TEST_CASE("json_bridge — no-match with a dead end serializes the failure position", "[json_bridge]") {
    std::string raw = runPipelineJson("ab", "ac");
    json j = json::parse(raw);

    REQUIRE(j["ok"].get<bool>() == true);
    REQUIRE(j["trace"]["result"].get<std::string>() == "no-match");
    REQUIRE(j["trace"]["failurePosition"].get<int>() == 1);
    REQUIRE(j["trace"]["steps"].size() == 1);  // stopped before consuming 'c'
}

TEST_CASE("json_bridge — no-match with no dead end has a null failure position", "[json_bridge]") {
    std::string raw = runPipelineJson("ab", "a");
    json j = json::parse(raw);

    REQUIRE(j["trace"]["result"].get<std::string>() == "no-match");
    REQUIRE(j["trace"]["failurePosition"].is_null());
}

TEST_CASE("json_bridge — parse failure serializes the error, not a trace", "[json_bridge]") {
    std::string raw = runPipelineJson("(a", "a");
    json j = json::parse(raw);

    REQUIRE(j["ok"].get<bool>() == false);
    REQUIRE(j.contains("error"));
    REQUIRE_FALSE(j.contains("trace"));  // must not emit a trace field at all on failure
    REQUIRE(j["error"]["type"].get<std::string>() == "UnmatchedParen");
    REQUIRE(j["error"]["position"].get<int>() == 0);
    REQUIRE(j["error"]["expected"].get<std::string>() == "')'");
    REQUIRE(j["error"]["found"].get<std::string>() == "end of input");
}

TEST_CASE("json_bridge — empty match produces an empty steps array, not null", "[json_bridge]") {
    std::string raw = runPipelineJson("a*", "");
    json j = json::parse(raw);

    REQUIRE(j["ok"].get<bool>() == true);
    REQUIRE(j["trace"]["result"].get<std::string>() == "match");
    REQUIRE(j["trace"]["steps"].is_array());
    REQUIRE(j["trace"]["steps"].empty());
}

TEST_CASE("json_bridge — success carries every pipeline stage, not just the trace",
          "[json_bridge]") {
    std::string raw = runPipelineJson("a|b", "a");
    json j = json::parse(raw);

    REQUIRE(j["ok"].get<bool>() == true);
    REQUIRE(j["ast"]["kind"].get<std::string>() == "alt");
    REQUIRE(j["ast"]["left"]["value"].get<std::string>() == "a");
    REQUIRE(j["ast"]["right"]["value"].get<std::string>() == "b");
    REQUIRE(j["nfa"]["stateCount"].get<int>() == 6);
    REQUIRE(j["dfa"]["stateCount"].get<int>() > 0);
    REQUIRE(j["minDfa"]["stateCount"].get<int>() > 0);
    REQUIRE(j["minDfa"]["stateCount"].get<int>() < j["nfa"]["stateCount"].get<int>());
    REQUIRE(j["trace"]["result"].get<std::string>() == "match");
}

TEST_CASE("json_bridge — pathological nesting reports PatternTooComplex end to end",
          "[json_bridge]") {
    // With default limits the 500-char length cap fires first on this pattern;
    // the depth guard itself is covered in parser_pass_test.cpp with the cap
    // lifted. This test pins the end-to-end behavior: graceful JSON error.
    std::string pathological(1500, '(');
    pathological += "a";
    pathological += std::string(1500, ')');

    std::string raw = runPipelineJson(pathological, "a");
    json j = json::parse(raw);

    REQUIRE(j["ok"].get<bool>() == false);
    REQUIRE(j["error"]["type"].get<std::string>() == "PatternTooComplex");
}

TEST_CASE("json_bridge — pattern one past the length cap reports the length error",
          "[json_bridge]") {
    json atCap = json::parse(runPipelineJson(std::string(500, 'a'), "a"));
    REQUIRE(atCap["ok"].get<bool>() == true);

    json pastCap = json::parse(runPipelineJson(std::string(501, 'a'), "a"));
    REQUIRE(pastCap["ok"].get<bool>() == false);
    REQUIRE(pastCap["error"]["type"].get<std::string>() == "PatternTooComplex");
    REQUIRE(pastCap["error"]["position"].get<int>() == 500);
    REQUIRE(pastCap["error"]["expected"].get<std::string>() == "pattern length <= 500");
}

TEST_CASE("json_bridge — non-ASCII pattern reports UnexpectedToken instead of throwing",
          "[json_bridge]") {
    // Regression for D4: this used to throw nlohmann type_error.316 (a lone
    // byte of a multi-byte character is invalid UTF-8), which crossed the WASM
    // boundary as an opaque exception.
    std::string raw;
    REQUIRE_NOTHROW(raw = runPipelineJson(std::string("caf\xC3\xA9"), "a"));
    json j = json::parse(raw);

    REQUIRE(j["ok"].get<bool>() == false);
    REQUIRE(j["error"]["type"].get<std::string>() == "UnexpectedToken");
    REQUIRE(j["error"]["position"].get<int>() == 3);
    REQUIRE(j["error"]["expected"].get<std::string>() == "an ASCII character");
    REQUIRE(j["error"]["found"].get<std::string>() == "non-ASCII character");
}

TEST_CASE("json_bridge — non-ASCII in the test string alone stays safe", "[json_bridge]") {
    // Pins current behavior: only the pattern is restricted to ASCII.
    std::string raw;
    REQUIRE_NOTHROW(raw = runPipelineJson("a", std::string("\xC3\xA9")));
    json j = json::parse(raw);
    REQUIRE(j["ok"].get<bool>() == true);
}


TEST_CASE("json_bridge — charset AST and symbolic NFA labels serialize across the boundary", "[json_bridge][extended]") {
    const json j = json::parse(runPipelineJson("[a-c]+", "bc"));
    REQUIRE(j["ok"].get<bool>());
    REQUIRE(j["ast"]["kind"] == "plus");
    REQUIRE(j["ast"]["child"]["kind"] == "charset");
    REQUIRE(j["ast"]["child"]["characters"] == json::array({97,98,99}));
    REQUIRE(j["ast"]["child"]["label"] == "[a-c]");
    const auto encoded = encodeCharacterSet({97,98,99});
    REQUIRE(j["nfa"]["transitions"]["0"][encoded] == json::array({1}));
    REQUIRE(j["trace"]["result"] == "match");
}

TEST_CASE("json_bridge — invalid class reports the structured error name", "[json_bridge][extended]") {
    const json j = json::parse(runPipelineJson("[z-a]", "z"));
    REQUIRE_FALSE(j["ok"].get<bool>());
    REQUIRE(j["error"]["type"] == "InvalidCharacterClass");
    REQUIRE(j["error"]["position"] == 2);
}


TEST_CASE("json_bridge — shorthand AST members serialize in sorted ASCII order", "[json_bridge][extended]") {
    const json j = json::parse(runPipelineJson(R"(\w)", "A_9"));
    REQUIRE(j["ok"].get<bool>());
    REQUIRE(j["ast"]["kind"] == "charset");
    REQUIRE(j["ast"]["characters"].size() == 63);
    REQUIRE(j["ast"]["characters"][0] == 48);
    REQUIRE(j["ast"]["characters"][9] == 57);
    REQUIRE(j["ast"]["characters"][10] == 65);
}

// issue #68 — Subset Growth / NFA Structure Lab (PR A) JSON boundary.

TEST_CASE("json_bridge — runGrowthAnalysis serializes distinct counts and an honest not-computed bound", "[json_bridge][growth]") {
    std::string raw = runGrowthAnalysisJson("(a|b)*c");
    json j = json::parse(raw);

    REQUIRE(j["ok"].get<bool>() == true);
    const json& a = j["analysis"];
    REQUIRE(a["subsetTrace"]["subsetCount"].get<int>() == a["reachableSubsetStateCount"].get<int>());
    REQUIRE(a["minimizedStateCount"].get<int>() <= a["reachableSubsetStateCount"].get<int>());
    REQUIRE(a["bound"]["status"].get<std::string>() == "not-computed");
    REQUIRE(a["powersetCeiling"]["exactDecimal"].is_string());
}

TEST_CASE("json_bridge — runGrowthAnalysis on an invalid pattern returns the ParseError, not a crash", "[json_bridge][growth]") {
    std::string raw = runGrowthAnalysisJson("(a");
    json j = json::parse(raw);
    REQUIRE(j["ok"].get<bool>() == false);
    REQUIRE(j["error"]["type"].get<std::string>() == "UnmatchedParen");
}

TEST_CASE("json_bridge — verifies multiple selected epsilon deletions as one candidate", "[json_bridge][growth]") {
    const std::string raw = verifyCandidateEdgesJson(
        "a|a", R"([{"source":4,"target":0},{"source":4,"target":2}])");
    const json j = json::parse(raw);

    REQUIRE(j["ok"].get<bool>());
    const json& eq = j["candidate"]["equivalence"];
    REQUIRE(eq["status"] == "different");
    REQUIRE(eq["witness"]["word"] == "a");
    REQUIRE(eq["witness"]["baselineAccepts"] == true);
    REQUIRE(eq["witness"]["candidateAccepts"] == false);
}

TEST_CASE("json_bridge — rejects duplicate or nonexistent selected epsilon edges", "[json_bridge][growth]") {
    const json duplicate = json::parse(verifyCandidateEdgesJson(
        "a|a", R"([{"source":4,"target":0},{"source":4,"target":0}])"));
    REQUIRE_FALSE(duplicate["ok"].get<bool>());
    REQUIRE(duplicate["error"]["type"] == "InvalidCandidateEdit");

    const json missing = json::parse(verifyCandidateEdgesJson(
        "a|a", R"([{"source":4,"target":99}])"));
    REQUIRE_FALSE(missing["ok"].get<bool>());
    REQUIRE(missing["error"]["type"] == "InvalidCandidateEdit");
}

TEST_CASE("json_bridge — verifyCandidate reports the 'a*' skip-edge deletion as different with an empty-string witness", "[json_bridge][growth]") {
    // Thompson's star fragment for "a*": the inner 'a' CharNode fragment is
    // built FIRST (states 0=inner.start, 1=inner.accept), then star's own
    // wrapper states are allocated (2=start, 3=accept). So the overall NFA
    // is start=2, accept={3}, and the skip edge ("zero repetitions") is
    // start(2) --eps--> accept(3) — confirmed against
    // listEligibleEpsilonEdges() in growth_analysis_test.cpp's equivalent
    // 'a*' case, which finds this edge via nfa.startState/acceptStates
    // rather than a hardcoded literal.
    std::string raw = verifyCandidateJson("a*", 2, 3);
    json j = json::parse(raw);
    REQUIRE(j["ok"].get<bool>() == true);
    const json& eq = j["candidate"]["equivalence"];
    REQUIRE(eq["status"].get<std::string>() == "different");
    REQUIRE(eq["witness"]["word"].get<std::string>() == "");
    REQUIRE(eq["witness"]["baselineAccepts"].get<bool>() == true);
    REQUIRE(eq["witness"]["candidateAccepts"].get<bool>() == false);
}


TEST_CASE("json_bridge -- minimization safety guard serializes its error name", "[json_bridge]") {
    // 500 literals stay within the parser's pattern-length limit. Their many
    // distinct alphabet columns make Moore refinement exceed its work budget.
    const std::string symbols = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&,-/:;<=>@^_";
    std::string pattern;
    pattern.reserve(500);
    for (size_t i = 0; i < 500; ++i) pattern.push_back(symbols[i % symbols.size()]);

    json j = json::parse(runPipelineJson(pattern, ""));
    REQUIRE_FALSE(j["ok"].get<bool>());
    REQUIRE(j["error"]["type"].get<std::string>() == "AutomatonTooComplex");
    REQUIRE(j["error"]["position"].get<int>() == 0);
}

// tests/json_bridge_test.cpp
//
// Tests the actual WASM boundary logic natively — no Emscripten needed
// for this, since json_bridge.cpp doesn't touch anything Emscripten-
// specific. Parses the JSON string back and checks fields, rather than
// just checking the output string looks plausible.

#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>

#include "regexlab/json_bridge.hpp"

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

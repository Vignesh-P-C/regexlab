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

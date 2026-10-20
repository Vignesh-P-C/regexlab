// Parser parity layer -- the C++ half.
//
// Reads tests/fixtures/parser-cases.json, the SAME file that
// engine/__tests__/parity/parser-cases.test.ts reads, and asserts that the C++
// parser produces the listed outcome for every case. The TS test asserts the
// same table, so any divergence between the two engines fails one side and not
// the other instead of going unnoticed.
//
// Why a shared file rather than two hand-written suites: the 500-unit cap
// (issue #29, implemented in PR #33) and the ASCII-only rule (issue #30)
// produced different error paths for a 300-character accented pattern. TS
// passed its length check then returned UnexpectedToken@0; the old C++ byte
// check returned PatternTooComplex@500 before parsing. This fixture now pins
// parity for those outcomes.
//
// REGEXLAB_FIXTURES_DIR is injected by CMakeLists.txt so the test finds the
// fixture no matter which directory ctest runs it from.

#include <catch2/catch_test_macros.hpp>
#include <fstream>
#include <string>

#include <nlohmann/json.hpp>

#include "regexlab/passes/parser-pass.hpp"

using namespace regexlab;

namespace {

std::string typeName(ParseErrorType t) {
    switch (t) {
        case ParseErrorType::UnmatchedParen:    return "UnmatchedParen";
        case ParseErrorType::UnexpectedToken:   return "UnexpectedToken";
        case ParseErrorType::EmptyGroup:        return "EmptyGroup";
        case ParseErrorType::DanglingOperator:  return "DanglingOperator";
        case ParseErrorType::PatternTooComplex: return "PatternTooComplex";
        case ParseErrorType::InvalidCharacterClass: return "InvalidCharacterClass";
    }
    return "<unknown>";
}

}  // namespace

TEST_CASE("ParserPass — shared parity fixture", "[parser][parity]") {
    const std::string path = std::string(REGEXLAB_FIXTURES_DIR) + "/parser-cases.json";
    std::ifstream in(path);
    REQUIRE(in.is_open());

    nlohmann::json doc = nlohmann::json::parse(in);
    const auto& cases = doc.at("cases");

    // A fixture that failed to load would otherwise make this test pass
    // vacuously, which is the one way a parity check can silently stop working.
    // The fixture currently holds 35 cases; raise this guard whenever cases are added.
    REQUIRE(cases.size() >= 56);

    for (const auto& c : cases) {
        const std::string name = c.at("name").get<std::string>();
        // nlohmann decodes the fixture's \uXXXX escapes to UTF-8, which is
        // exactly what the C++ parser indexes over.
        const std::string pattern = c.at("pattern").get<std::string>();
        const auto& expected = c.at("expected");

        // INFO so a failure names the case instead of just a line number.
        INFO("case: " << name);

        ParseResult result = parse(pattern);

        if (expected.contains("ok")) {
            CHECK(result.ok);
            if (!result.ok) {
                INFO("unexpected error: " << typeName(result.error.type) << "@"
                                          << result.error.position);
                CHECK(false);
            }
        } else {
            CHECK_FALSE(result.ok);
            if (!result.ok) {
                CHECK(typeName(result.error.type) == expected.at("type").get<std::string>());
                CHECK(result.error.position == expected.at("position").get<int>());
            }
        }
    }
}

cmake_minimum_required(VERSION 3.16)
project(regexlab_engine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

include(FetchContent)

# --- nlohmann/json -----------------------------------------------------
# Header-only. Per CLAUDE.md v2 §5 Track B, this is used ONLY at the
# pipeline boundary (serializing Automaton/MatchTrace for the frontend to
# consume) — never inside pass logic itself.
FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(json)

# --- Catch2 v3 -----------------------------------------------------------
# Test framework, per CLAUDE.md v2 §5 Track B ("Catch2 or a hand-rolled
# assertion harness"). Run natively via ctest — no browser/WASM needed
# for this, per the Track B sequencing note.
FetchContent_Declare(
  Catch2
  GIT_REPOSITORY https://github.com/catchorg/Catch2.git
  GIT_TAG v3.5.4
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(Catch2)

# --- Engine library --------------------------------------------------
# STATIC now that all 5 passes are implemented.
add_library(regexlab_engine STATIC
    engine/pipeline.cpp
    engine/passes/parser-pass.cpp
    engine/passes/thompson-pass.cpp
    engine/passes/subset-construction-pass.cpp
    engine/passes/minimization-pass.cpp
    engine/passes/matcher-pass.cpp
)
target_include_directories(regexlab_engine PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/engine/include
)
target_link_libraries(regexlab_engine PUBLIC nlohmann_json::nlohmann_json)

# --- Tests -------------------------------------------------------------
enable_testing()
add_executable(engine_tests
    tests/smoke_test.cpp
    tests/parser_pass_test.cpp
    tests/thompson_pass_test.cpp
    tests/subset_construction_pass_test.cpp
    tests/minimization_pass_test.cpp
    tests/matcher_pass_test.cpp
    tests/pipeline_test.cpp
)
target_link_libraries(engine_tests PRIVATE regexlab_engine Catch2::Catch2WithMain)

list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
include(CTest)
include(Catch)
catch_discover_tests(engine_tests)

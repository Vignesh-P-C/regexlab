cmake_minimum_required(VERSION 3.16)
project(regexlab_engine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
# WASM builds must be optimized -- an unoptimized (-O0) Emscripten build
# overflows the browser's JS stack at a far shallower recursion depth than
# the parser's own kMaxNestingDepth guard (parser-pass.cpp), making that
# guard effectively untested in production. Default to Release unless the
# invoker explicitly overrides it.
if(EMSCRIPTEN AND NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# Applies only to our own targets (added per-target below), never to
# FetchContent'd third-party code (Catch2, nlohmann/json).
set(REGEXLAB_WARNING_FLAGS -Wall -Wextra)

include(FetchContent)

FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(json)

FetchContent_Declare(
  Catch2
  GIT_REPOSITORY https://github.com/catchorg/Catch2.git
  GIT_TAG v3.5.4
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(Catch2)

add_library(regexlab_engine STATIC
    engine/pipeline.cpp
    engine/json_bridge.cpp
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
target_compile_options(regexlab_engine PRIVATE ${REGEXLAB_WARNING_FLAGS})

if(EMSCRIPTEN)
    target_compile_options(regexlab_engine PRIVATE -fexceptions)
endif()

enable_testing()
add_executable(engine_tests
    tests/smoke_test.cpp
    tests/parser_pass_test.cpp
    tests/thompson_pass_test.cpp
    tests/subset_construction_pass_test.cpp
    tests/minimization_pass_test.cpp
    tests/matcher_pass_test.cpp
    tests/pipeline_test.cpp
    tests/differential_test.cpp
    tests/json_bridge_test.cpp
)
target_link_libraries(engine_tests PRIVATE regexlab_engine Catch2::Catch2WithMain)
target_compile_options(engine_tests PRIVATE ${REGEXLAB_WARNING_FLAGS})

list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
include(CTest)
include(Catch)
catch_discover_tests(engine_tests)

if(EMSCRIPTEN)
    add_executable(regexlab_wasm engine/wasm/bindings.cpp)
    target_link_libraries(regexlab_wasm PRIVATE regexlab_engine)
    target_compile_options(regexlab_wasm PRIVATE -fexceptions ${REGEXLAB_WARNING_FLAGS})
    target_link_options(regexlab_wasm PRIVATE
        "-fexceptions"
        "-lembind"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sEXPORT_NAME=RegexLabModule"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sENVIRONMENT=web,node"
        "-sSTACK_SIZE=5242880"
    )
    set_target_properties(regexlab_wasm PROPERTIES OUTPUT_NAME "regexlab")
endif()

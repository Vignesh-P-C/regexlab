Copy `regexlab.js` and `regexlab.wasm` here after running the Emscripten
build (`emcmake cmake .. && emmake make`, per CMakeLists.txt's EMSCRIPTEN
branch, target `regexlab_wasm`). `useRegexEngine.ts` loads them from
`/wasm/regexlab.js` at runtime.

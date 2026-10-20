# Build the WASM engine

This guide builds the C++ engine as an Emscripten WebAssembly module and places the generated files where the frontend loads them. Run the commands in a Linux or macOS shell, or in a WSL shell on Windows, from the repository root unless a step says otherwise. In WSL, use the checkout's Linux path (for example, `~/regexlab` or `/mnt/d/...`), not a Windows `cmd.exe` prompt or a `\\wsl.localhost\...` working directory.

## 1. Install and activate Emscripten

If the Emscripten SDK (`emsdk`) is not installed yet:

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
```

At the start of each new shell session, activate the SDK environment. If you cloned `emsdk` somewhere else, use that path instead:

```bash
source ~/emsdk/emsdk_env.sh
emcc --version
```

`emcc --version` should print the active Emscripten compiler version. The repository currently does not pin an Emscripten SDK version; CI/toolchain pinning is tracked separately in issue #22.

## 2. Configure and build the WASM target

From the repository root:

```bash
mkdir -p build-wasm
cd build-wasm
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
emmake make regexlab_wasm
cd ..
```

`regexlab_wasm` is defined in the root `CMakeLists.txt` inside the `if(EMSCRIPTEN)` block. Use the Release build: the CMake configuration defaults Emscripten builds to Release, and the parser's browser stack guard was validated against an optimized build.

The target writes these files to `build-wasm/`:

- `build-wasm/regexlab.js` — Emscripten JavaScript loader/module.
- `build-wasm/regexlab.wasm` — compiled WebAssembly binary.

The generated module uses Embind and is configured with `MODULARIZE=1`, `EXPORT_ES6=1`, and `EXPORT_NAME=RegexLabModule`. It exposes `runPipeline(pattern, input)`, which returns the pipeline result as a JSON string. The JSON shape is documented in [data-contracts.md](data-contracts.md).

## 3. Copy the module into the frontend

The generated files are intentionally ignored by Git. Copy them to the frontend's public WASM directory:

```bash
mkdir -p frontend/public/wasm
cp build-wasm/regexlab.js build-wasm/regexlab.wasm frontend/public/wasm/
```

The frontend loads `/wasm/regexlab.js` and asks Emscripten to locate its sibling `regexlab.wasm` under `/wasm/`.

## 4. Run and verify the frontend

```bash
cd frontend
npm install
npm run build
npm run dev
```

Open the local URL printed by Vite. The engine is loaded from the two files in `frontend/public/wasm/`. To re-run the engine's WASM guard probes after rebuilding, stop the frontend server, return to the repository root, and run:

```bash
node scripts/check-wasm-limits.mjs
```

## Independent cold verification

Issue #17 requires someone other than the author to follow these steps on their own machine. For that check, start with a clean shell, activate the SDK, build the target, copy both files, and run the frontend. Record the `emcc --version` output and report whether the generated files appeared at the documented paths and the app loaded the real engine. Do not close #17 until that independent run succeeds.

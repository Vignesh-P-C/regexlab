// check-wasm-limits.mjs
// Probes the compiled RegexLab WASM module for the acceptance cases and for
// stack-depth robustness. Each probe runs in its own child process with a
// timeout, because a linear-memory stack overflow corrupts the module
// instance (and can hang), so probes must never share an instance.
//
// Usage (from ~/regexlab):
//   node scripts/check-wasm-limits.mjs [path/to/regexlab.js]
// Default path: frontend/public/wasm/regexlab.js

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const wasmJs = resolve(process.argv[2] ?? "frontend/public/wasm/regexlab.js");

// ---- child mode: run ONE pattern on a fresh instance, report via exit code ----
if (process.argv[2] === "--child") {
  const [, , , jsPath, pattern64, input] = process.argv;
  const pattern = Buffer.from(pattern64, "base64").toString("utf8");
  const { default: Module } = await import(pathToFileURL(jsPath).href);
  const m = await Module();
  try {
    const r = JSON.parse(m.runPipeline(pattern, input));
    // exit 0 = engine returned a well-formed result; print a short summary
    console.log(r.ok ? `ok ${r.trace.result}` : `${r.error.type}@${r.error.position}`);
    process.exit(0);
  } catch (e) {
    console.log("THREW " + (e && e.message ? e.message : typeof e));
    process.exit(3);
  }
}

// ---- parent mode ----
function probe(pattern, input = "a") {
  const res = spawnSync(
    process.execPath,
    [new URL(import.meta.url).pathname, "--child", wasmJs, Buffer.from(pattern, "utf8").toString("base64"), input],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (res.error || res.status === null) return { handled: false, text: "TIMEOUT/HANG" };
  return { handled: res.status === 0, text: (res.stdout || "").trim() };
}

const rows = [];
function check(label, pattern, input, expectation) {
  const { handled, text } = probe(pattern, input);
  const pass = expectation ? handled && text.startsWith(expectation) : handled;
  rows.push({ label, text, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(30)} ${text}`);
}

console.log(`WASM under test: ${wasmJs}\n`);
console.log("-- #14 acceptance cases --");
check("(a|b)*ab on aab", "(a|b)*ab", "aab", "ok match");
check("(a|b)*ab on aba", "(a|b)*ab", "aba", "ok no-match");
check("(ab on ab", "(ab", "ab", "UnmatchedParen@0");

console.log("\n-- depth guard: nested parens (1000 ok, 1001 must be PatternTooComplex) --");
for (const d of [100, 304, 500, 999, 1000]) {
  check(`nested depth ${d}`, "(".repeat(d) + "a" + ")".repeat(d), "a", "ok");
}
check("nested depth 1001", "(".repeat(1001) + "a" + ")".repeat(1001), "a", "PatternTooComplex");
check("nested depth 13000", "(".repeat(13000) + "a" + ")".repeat(13000), "a", "PatternTooComplex");

console.log("\n-- D2 class: long paren-free patterns (must be handled, never crash) --");
for (const n of [222, 500, 1000, 2000, 5000]) {
  check(`literal x${n}`, "a".repeat(n), "a");
}
for (const n of [222, 500, 1000]) {
  check(`alternation x${n}`, Array(n).fill("a").join("|"), "a");
}
for (const n of [221, 500, 1000]) {
  check(`star chain x${n}`, "a*".repeat(n), "a");
}

console.log("\n-- D4/D5: non-ASCII --");
check("non-ASCII pattern (cafe+accent)", "caf\u00e9", "a"); // today: throws CppException
check("non-ASCII input only", "a", "\u00e9", "ok no-match");

const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);

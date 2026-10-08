// check-wasm-limits.mjs
// Probes the compiled RegexLab WASM module for the acceptance cases, the
// pattern-length cap (issue #29) and stack robustness. Each probe runs in its own child process with a
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

console.log("\n-- D2: pattern-length cap (500 ok, 501 must be PatternTooComplex@500) --");
check("literal x500", "a".repeat(500), "a", "ok");
check("literal x501", "a".repeat(501), "a", "PatternTooComplex@500");
check("literal x1000", "a".repeat(1000), "a", "PatternTooComplex@500");
check("literal x5000 (was a hang)", "a".repeat(5000), "a", "PatternTooComplex@500");
check("alternation 250 terms (499 chars)", Array(250).fill("a").join("|"), "a", "ok");
check("alternation 251 terms (501 chars)", Array(251).fill("a").join("|"), "a", "PatternTooComplex@500");
check("star chain x250 (500 chars)", "a*".repeat(250), "a", "ok");
check("star chain x251 (502 chars)", "a*".repeat(251), "a", "PatternTooComplex@500");

console.log("\n-- nesting: the 500-char cap fires before the depth-1000 guard --");
// 249 pairs + 'a' = 499 chars (allowed); 250 pairs = 501 chars (over the cap).
check("nested depth 100", "(".repeat(100) + "a" + ")".repeat(100), "a", "ok");
check("nested depth 249 (499 chars)", "(".repeat(249) + "a" + ")".repeat(249), "a", "ok");
check("nested depth 250 (501 chars)", "(".repeat(250) + "a" + ")".repeat(250), "a", "PatternTooComplex@500");
check("nested depth 1001", "(".repeat(1001) + "a" + ")".repeat(1001), "a", "PatternTooComplex@500");
check("nested depth 13000", "(".repeat(13000) + "a" + ")".repeat(13000), "a", "PatternTooComplex@500");

console.log("\n-- D4/D5: non-ASCII --");
check("non-ASCII pattern (cafe+accent)", "caf\u00e9", "a"); // today: throws CppException
check("non-ASCII input only", "a", "\u00e9", "ok no-match");

const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);

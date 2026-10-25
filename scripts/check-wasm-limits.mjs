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
if (process.argv[2] === "--search-child") {
  const [, , , jsPath, pattern64, maxEditDepth, maxCandidates] = process.argv;
  const pattern = Buffer.from(pattern64, "base64").toString("utf8");
  const { default: Module } = await import(pathToFileURL(jsPath).href);
  const m = await Module();
  try {
    const r = JSON.parse(m.runBoundedOptimization(pattern, Number(maxEditDepth), Number(maxCandidates)));
    if (!r.ok) {
      console.log(`ERROR ${r.error.type}@${r.error.position}`);
      process.exit(3);
    }
    const search = r.search;
    console.log(
      "ok evaluated=" + search.evaluatedCandidateCount +
      " equivalent=" + search.equivalentCandidateCount +
      " different=" + search.differentCandidateCount +
      " inconclusive=" + search.inconclusiveCandidateCount,
    );
    process.exit(0);
  } catch (e) {
    console.log("THREW " + (e && e.message ? e.message : typeof e));
    process.exit(3);
  }
}


// ---- parent mode ----
// probe() sends the pattern base64-encoded as one argv entry; keep raw
// patterns under ~90,000 bytes (Linux per-argument limit is 131,072).
function probe(pattern, input = "a") {
  const res = spawnSync(
    process.execPath,
    [new URL(import.meta.url).pathname, "--child", wasmJs, Buffer.from(pattern, "utf8").toString("base64"), input],
    { encoding: "utf8", timeout: 10_000 },
  );
  // A genuine hang/timeout kills the child via SIGTERM and sets error.code
  // to ETIMEDOUT. Any other res.error (e.g. E2BIG from an oversized argv)
  // means the child never ran at all -- that's a harness problem, not an
  // engine hang, so it gets its own label instead of being lumped in here.
  if (res.error && res.error.code === "ETIMEDOUT") return { handled: false, text: "TIMEOUT/HANG" };
  if (res.error) return { handled: false, text: `HARNESS ERROR: ${res.error.code}` };
  if (res.status === null) return { handled: false, text: "TIMEOUT/HANG" };
  return { handled: res.status === 0, text: (res.stdout || "").trim() };
}

function probeBoundedSearch(pattern, maxEditDepth = 2, maxCandidates = 24) {
  const res = spawnSync(
    process.execPath,
    [
      new URL(import.meta.url).pathname,
      "--search-child",
      wasmJs,
      Buffer.from(pattern, "utf8").toString("base64"),
      String(maxEditDepth),
      String(maxCandidates),
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (res.error && res.error.code === "ETIMEDOUT") return { handled: false, text: "TIMEOUT/HANG" };
  if (res.error) return { handled: false, text: `HARNESS ERROR: ${res.error.code}` };
  if (res.status === null) return { handled: false, text: "TIMEOUT/HANG" };
  return { handled: res.status === 0, text: (res.stdout || "").trim() };
}

const rows = [];
function check(label, pattern, input, expectation) {
  const { handled, text } = probe(pattern, input);
  const pass = expectation ? handled && text.startsWith(expectation) : handled;
  rows.push({ label, text, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(30)} ${text}`);
}

/**
 * Like check(), but also asserts a wall-clock budget for the whole
 * spawned-child probe (module load + runPipeline). Added for the issue
 * #64 follow-up (MinimizationPass alphabet-compression fix): these probes
 * sit at the largest LEGAL (under the 500-char cap) sizes for each
 * extended-syntax construct, which is exactly the shape that was ~6.8s
 * pre-fix for `.` x500 alone. maxMs is deliberately generous over the
 * measured in-process minimize() time (which does not include per-probe
 * Node startup + WASM instantiation overhead) so the probe doesn't flake
 * on a loaded machine, while staying far below the pre-fix regression
 * time -- so if the compression fix is ever lost, these probes fail loud
 * well before the old ~6.8s shows up.
 */
function checkTimed(label, pattern, input, expectation, maxMs) {
  const t0 = Date.now();
  const { handled, text } = probe(pattern, input);
  const elapsedMs = Date.now() - t0;
  const outcomeOk = expectation ? handled && text.startsWith(expectation) : handled;
  const pass = outcomeOk && elapsedMs <= maxMs;
  rows.push({ label, text, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(30)} ${text}  (${elapsedMs}ms, budget ${maxMs}ms)`);
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

console.log("\n-- D4: non-ASCII (pattern restricted to ASCII; error must be a clean result, not an exception) --");
check("non-ASCII pattern (cafe+accent)", "caf\u00e9", "a", "UnexpectedToken@3");
check("non-ASCII at start", "\u00e9", "a", "UnexpectedToken@0");
check("emoji in pattern", "a\u{1F600}", "a", "UnexpectedToken@1");
check("non-ASCII after a syntax error", ")\u00e9", "a", "DanglingOperator@0");
check("non-ASCII input only", "a", "\u00e9", "ok no-match");

console.log("\n-- length-cap parity probes (issue #29, PR #33; ASCII-only rule #30) --");
check("escaped non-ASCII", "a\\\u00e9", "a", "UnexpectedToken@2");
check("non-ASCII at 499 then long ASCII tail", "a".repeat(499) + "\u00e9" + "a".repeat(50000), "a", "UnexpectedToken@499");
check("crossover e-acute x300", "\u00e9".repeat(300), "a", "UnexpectedToken@0");
check("escaped non-ASCII + long tail", "\\\u00e9" + "a".repeat(5000), "a", "UnexpectedToken@1");

console.log("\n-- issue #64 follow-up: largest LEGAL (<=500 char) extended-syntax sizes, with a time budget --");
// Thresholds derived from measured in-process WASM timings post-fix (3-run
// means): `.` x500 ~326ms, `\w` x250 (500 chars) ~74ms, `[^a]` x125 (500
// chars) ~56ms, a short mixed pattern ~3ms. Each threshold below gives
// roughly 5-6x headroom over that measurement for spawned-child overhead
// (fresh Node process + WASM instantiation per probe), while staying far
// under the ~6.8s this exact `.` x500 case cost before the alphabet-
// compression fix -- so a regression back to the old cost still fails loud.
checkTimed("dot x500 (500 chars, at the cap)", ".".repeat(500), "a", "ok", 2000);
checkTimed("shorthand-w x250 (500 chars, at the cap)", "\\w".repeat(250), "a", "ok", 1000);
checkTimed("negclass x125 (500 chars, at the cap)", "[^a]".repeat(125), "a", "ok", 1000);
checkTimed("mixed .*a\\w*b", ".*a\\w*b", "xxaab", "ok match", 500);

console.log("\n-- B: bounded optimization WASM contract --");
{
  const { handled, text } = probeBoundedSearch("a|a", 2, 24);
  const pass = handled && text === "ok evaluated=10 equivalent=6 different=4 inconclusive=0";
  rows.push({ label: "bounded search on a|a", text, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  bounded search on a|a          ${text}`);
}

const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);

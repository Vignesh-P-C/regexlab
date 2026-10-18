/**
 * Parser parity layer — the TypeScript half.
 *
 * Reads tests/fixtures/parser-cases.json, the SAME file that
 * tests/parser_cases_fixture_test.cpp reads, and asserts that the TS parser
 * produces the listed outcome for every case. The C++ test asserts the same
 * table, so any divergence between the two engines fails one side and not the
 * other instead of going unnoticed.
 *
 * Why a shared file rather than two hand-written suites: PR #32 added the
 * 500-unit cap to both parsers, but TS measured UTF-16 code units while C++
 * measured UTF-8 bytes, so "é" x 300 was accepted by one and rejected by the
 * other. Nothing failed, because no test compared the two. This file is that
 * comparison (issue #36).
 *
 * The existing golden suites stay as they are; this adds a layer, it does not
 * replace one.
 */
import { describe, it, expect } from "vitest";
import { parse } from "../../passes/parser-pass.js";
// Imported, not read with fs, so this suite needs no Node typings at the repo
// root. The \uXXXX escapes in the fixture are decoded by the JSON loader,
// exactly as nlohmann decodes them for the C++ half.
import fixtureJson from "../../../tests/fixtures/parser-cases.json";

type ExpectedOutcome = { ok: true } | { type: string; position: number };
type FixtureCase = { name: string; pattern: string; expected: ExpectedOutcome };

const fixture = fixtureJson as unknown as { cases: FixtureCase[] };

describe("ParserPass — shared parity fixture", () => {
  it("the fixture is non-empty (a silently empty table would pass vacuously)", () => {
    // The fixture currently holds 35 cases; raise this guard whenever cases are added.
    expect(fixture.cases.length).toBeGreaterThanOrEqual(35);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const result = parse(c.pattern);
      if ("ok" in c.expected) {
        // Surface the real error rather than just "false !== true".
        expect(result.ok ? null : result.error).toBeNull();
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.type).toBe(c.expected.type);
          expect(result.error.position).toBe(c.expected.position);
        }
      }
    });
  }
});

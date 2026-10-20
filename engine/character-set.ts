/** Compact cross-language encoding for symbolic ASCII-set transitions. */
export const CHARSET_PREFIX = "cs:";
const HEX = "0123456789abcdef";
export function encodeCharacterSet(characters: Iterable<number>): string {
  const nibbles = new Array<number>(32).fill(0);
  for (const code of characters) {
    if (!Number.isInteger(code) || code < 0 || code > 127) throw new RangeError("ASCII character set expected");
    nibbles[code >> 2] |= 1 << (code & 3);
  }
  return CHARSET_PREFIX + nibbles.map((n) => HEX[n]).join("");
}
export function decodeCharacterSet(label: string): number[] | null {
  if (!label.startsWith(CHARSET_PREFIX) || label.length !== 35) return null;
  const result: number[] = [];
  for (let i = 0; i < 32; i++) {
    const n = Number.parseInt(label[3 + i], 16);
    if (!Number.isFinite(n)) return null;
    for (let bit = 0; bit < 4; bit++) if (n & (1 << bit)) result.push(i * 4 + bit);
  }
  return result;
}
export function transitionMatches(label: string, char: string): boolean {
  if (label === "eps" || char.length !== 1 || char.charCodeAt(0) > 127) return false;
  const set = decodeCharacterSet(label);
  return set ? set.includes(char.charCodeAt(0)) : label === char;
}
function escapeCode(code: number, first: boolean): string {
  const special: Record<number, string> = { 0: "\\x00", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 45: "\\-", 92: "\\\\", 93: "\\]" };
  if (code === 94 && first) return "\\^";
  if (special[code]) return special[code];
  if (code < 32 || code === 127) return `\\x${code.toString(16).padStart(2, "0")}`;
  return String.fromCharCode(code);
}
export function formatCharacterSet(values: Iterable<number>): string {
  const chars = [...new Set(values)].sort((a, b) => a - b);
  const same = (a: number[]) => a.length === chars.length && a.every((x, i) => x === chars[i]);
  const digits = Array.from({ length: 10 }, (_, i) => 48 + i);
  const word = [...Array.from({ length: 26 }, (_, i) => 65 + i), ...digits, 95, ...Array.from({ length: 26 }, (_, i) => 97 + i)].sort((a, b) => a - b);
  if (same(digits)) return "\\d";
  if (same(word)) return "\\w";
  if (same([9, 10, 11, 12, 13, 32])) return "\\s";
  const allAscii = Array.from({ length: 128 }, (_, i) => i);
  if (same(allAscii.filter((x) => x !== 10 && x !== 13))) return ".";
  if (same(allAscii.filter((x) => x < 48 || x > 57))) return "\\D";
  if (same(allAscii.filter((x) => !word.includes(x)))) return "\\W";
  if (same(allAscii.filter((x) => ![9, 10, 11, 12, 13, 32].includes(x)))) return "\\S";
  const ranges: [number, number][] = [];
  for (const c of chars) {
    const tail = ranges[ranges.length - 1];
    if (tail && tail[1] + 1 === c) tail[1] = c; else ranges.push([c, c]);
  }
  const body = ranges.map(([a, b], i) => b - a >= 2
    ? `${escapeCode(a, i === 0)}-${escapeCode(b, false)}`
    : a === b ? escapeCode(a, i === 0) : escapeCode(a, i === 0) + escapeCode(b, false)).join("");
  return `[${body}]`;
}
export function formatTransitionSymbols(symbols: string[]): string {
  const epsilon = symbols.includes("eps"), chars = new Set<number>();
  for (const symbol of symbols) {
    if (symbol === "eps") continue;
    const set = decodeCharacterSet(symbol);
    if (set) set.forEach((x) => chars.add(x));
    else if (symbol.length === 1 && symbol.charCodeAt(0) <= 127) chars.add(symbol.charCodeAt(0));
  }
  const label = chars.size ? formatCharacterSet(chars) : "";
  return [epsilon ? "ε" : "", label].filter(Boolean).join(", ");
}

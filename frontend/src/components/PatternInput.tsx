import type { ParseError } from "../types/engine";

// Mirrors DEFAULT_MAX_PATTERN_LENGTH in engine/passes/parser-pass.ts (issue #29).
const MAX_PATTERN_LENGTH = 500;
// UI-only cap so a huge paste can't build a giant trace. Adjust if you want.
const MAX_INPUT_LENGTH = 1000;

function Counter({ length, max }: { length: number; max: number }) {
  const nearLimit = length >= max * 0.9;
  return (
    <small className={nearLimit ? "char-counter near-limit" : "char-counter"}>
      {length} / {max}
    </small>
  );
}

type Props = {
  pattern: string;
  input: string;
  onPatternChange: (pattern: string) => void;
  onInputChange: (input: string) => void;
  error: ParseError | null;
};

/** Owns the raw pattern/input text; App debounces and calls the engine. */
export function PatternInput({ pattern, input, onPatternChange, onInputChange, error }: Props) {
  return (
    <div className="pattern-input">
      <label>
        Pattern
        <input
          value={pattern}
          onChange={(e) => onPatternChange(e.target.value)}
          placeholder="(a|b)*ab"
          spellCheck={false}
          maxLength={MAX_PATTERN_LENGTH}
        />
        <Counter length={pattern.length} max={MAX_PATTERN_LENGTH} />
      </label>
      <label>
        Test string
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="aab"
          spellCheck={false}
          maxLength={MAX_INPUT_LENGTH}
        />
        <Counter length={input.length} max={MAX_INPUT_LENGTH} />
      </label>
      {error && (
        <div className="parse-error" role="alert">
          {error.type} at position {error.position}
          {error.expected ? ` — expected ${error.expected}` : ""}
          {error.found ? `, found "${error.found}"` : ""}
          {/* Reserved slot for the AI suggestion layer (not built yet):
              <SuggestionBanner error={error} suggestion={...} onAccept={...} /> */}
        </div>
      )}
    </div>
  );
}
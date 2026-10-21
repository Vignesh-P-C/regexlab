import type { ParseError } from "../types/engine";

// Mirrors DEFAULT_MAX_PATTERN_LENGTH in engine/passes/parser-pass.ts (issue #29).
// Deliberately NOT enforced with maxLength: a silently truncated paste would
// match a different pattern. The engine reports PatternTooComplex instead.
const MAX_PATTERN_LENGTH = 500;

function Counter({ length, max }: { length: number; max: number }) {
  const cls =
    length > max ? "char-counter over-limit" : length >= max * 0.9 ? "char-counter near-limit" : "char-counter";
  return (
    <small className={cls}>
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
        />
        <span className="field-meta">
          <small>ASCII · | concat · * + ? · . · [a-z] · \d \w \s · max {MAX_PATTERN_LENGTH}</small>
          <Counter length={pattern.length} max={MAX_PATTERN_LENGTH} />
        </span>
      </label>
      <label>
        Test string
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="aab"
          spellCheck={false}
        />
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
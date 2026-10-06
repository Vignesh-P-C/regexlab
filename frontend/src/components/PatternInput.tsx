import type { ParseError } from "../types/engine";

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

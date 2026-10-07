import type { ParseError } from "../types/engine";

type Props = {
  error: ParseError | null;
  suggestion: string | null;
  onAccept: (suggestion: string) => void;
};

/**
 * Stub for the AI suggestion layer (15% weight, 0% built — not in scope
 * yet). Props are shaped for the eventual flow: a suggestion only ever
 * renders after round-tripping back through the local parser, so this
 * component itself does no validation. Unwired — not rendered by App yet.
 */
export function SuggestionBanner({ error, suggestion, onAccept }: Props) {
  if (!error || !suggestion) return null;
  return (
    <div className="suggestion-banner">
      Did you mean <code>{suggestion}</code>? <button onClick={() => onAccept(suggestion)}>Use this</button>
    </div>
  );
}

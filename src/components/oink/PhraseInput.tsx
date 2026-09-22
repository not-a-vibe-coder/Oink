import { useMemo, type ClipboardEvent } from "react";
import { wordlist } from "@scure/bip39/wordlists/english";

/**
 * Twelve fields, not one textarea: people read their phrase off paper one word
 * at a time, and a numbered grid is the only layout that matches that. Pasting
 * all twelve at once still works — the paste is split across the fields.
 */
export function PhraseInput({
  words,
  onChange,
  disabled = false,
}: {
  words: string[];
  onChange: (words: string[]) => void;
  disabled?: boolean;
}) {
  const dictionary = useMemo(() => new Set(wordlist), []);

  function setWord(index: number, value: string) {
    const next = [...words];
    next[index] = value.trim().toLowerCase();
    onChange(next);
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").trim();
    if (!/\s/.test(pasted)) return;

    event.preventDefault();
    const parts = pasted.split(/\s+/).map((part) => part.toLowerCase());
    const next = [...words];
    for (let i = 0; i < parts.length && index + i < next.length; i += 1) {
      next[index + i] = parts[i];
    }
    onChange(next);
  }

  return (
    <div className="phrase-grid">
      {words.map((word, index) => {
        const known = word.length === 0 || dictionary.has(word);
        return (
          <div className="phrase-cell" key={index}>
            <label className="phrase-index tnum" htmlFor={`phrase-word-${index}`}>
              {index + 1}
            </label>
            <input
              id={`phrase-word-${index}`}
              className="phrase-input"
              value={word}
              onChange={(event) => setWord(index, event.target.value)}
              onPaste={(event) => handlePaste(index, event)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={disabled}
              aria-invalid={!known || undefined}
              aria-label={`Word ${index + 1}`}
            />
          </div>
        );
      })}
    </div>
  );
}

export function emptyPhrase(): string[] {
  return Array.from({ length: 12 }, () => "");
}

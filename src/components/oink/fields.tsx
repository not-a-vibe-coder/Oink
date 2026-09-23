import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Form controls shared by enrollment, unlock, recovery and settings.
 *
 * All of them are ordinary inputs inside ordinary forms with the right
 * autocomplete tokens, because a password manager filling these is a feature,
 * not an attack — see docs/06 §11.
 */

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = "current-password",
  placeholder,
  hint,
  showStrength = false,
  autoFocus = false,
  invalid = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: "current-password" | "new-password";
  placeholder?: string;
  hint?: string;
  showStrength?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const score = usePasswordScore(showStrength ? value : "");

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="input-group">
        <input
          id={id}
          className="input"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          spellCheck={false}
        />
        <button
          type="button"
          className="input-trail"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          style={{ background: "none", border: 0, cursor: "pointer", minHeight: 44 }}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>

      {showStrength && (
        <>
          <div className="meter" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className="meter-seg"
                data-on={value.length > 0 && index <= score.filled - 1}
                data-level={score.level}
              />
            ))}
          </div>
          <p className="hint" role="status">
            {value.length === 0
              ? "At least 10 characters. Longer beats complicated."
              : score.message}
          </p>
        </>
      )}

      {hint && !showStrength && <p className="hint">{hint}</p>}
    </div>
  );
}

type Strength = { filled: number; level: "weak" | "fair" | "strong"; message: string };

const FALLBACK: Strength = { filled: 0, level: "weak", message: "Too short." };

/** zxcvbn is ~400kB of dictionaries; it loads only once someone starts typing. */
function usePasswordScore(password: string): Strength {
  const [strength, setStrength] = useState<Strength>(FALLBACK);

  useEffect(() => {
    if (!password) {
      setStrength(FALLBACK);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const [{ zxcvbn, zxcvbnOptions }, common] = await Promise.all([
          import("@zxcvbn-ts/core"),
          import("@zxcvbn-ts/language-common"),
        ]);
        zxcvbnOptions.setOptions({
          dictionary: common.dictionary,
          graphs: common.adjacencyGraphs,
        });
        const result = zxcvbn(password);
        if (cancelled) return;

        if (password.length < 10) {
          setStrength({
            filled: 1,
            level: "weak",
            message: `${10 - password.length} more character${10 - password.length === 1 ? "" : "s"} to go.`,
          });
          return;
        }

        const filled = Math.max(1, Math.min(4, result.score));
        const level = result.score <= 1 ? "weak" : result.score === 2 ? "fair" : "strong";
        const message =
          level === "strong"
            ? "Strong. Write it down somewhere only you can reach."
            : result.feedback.warning ||
              result.feedback.suggestions[0] ||
              "Add another word or two.";
        setStrength({ filled, level, message });
      })().catch(() => {
        if (!cancelled) {
          setStrength({
            filled: password.length >= 10 ? 3 : 1,
            level: password.length >= 10 ? "fair" : "weak",
            message: password.length >= 10 ? "Long enough." : "At least 10 characters.",
          });
        }
      });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password]);

  return strength;
}

export function CodeField({
  id,
  label = "6-digit code",
  value,
  onChange,
  hint,
  autoFocus = false,
  invalid = false,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input input-code"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        autoComplete="one-time-code"
        placeholder="––––––"
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        spellCheck={false}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/**
 * Sign-in and recovery take either the account ID or the tag in one box. No "@" lead-in,
 * because most people won't have a tag; a leading "@" typed out of habit is kept and the
 * API strips it.
 */
export function IdentifierField({
  id,
  value,
  onChange,
  autoFocus = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Account ID or tag
      </label>
      <input
        id={id}
        className="input mono"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value.trim().toLowerCase())}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="oink-k7p2-9xqm or @pascal"
        autoFocus={autoFocus}
        maxLength={21}
      />
    </div>
  );
}

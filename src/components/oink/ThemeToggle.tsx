import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "@/lib/theme";

/**
 * A solid pill with a glass lens that slides to the chosen end, overshooting a little on
 * arrival. The word sits on the side the lens left, so the pill always names the mode
 * you are in and the lens holds its icon.
 */
export function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      className="theme-toggle"
      data-theme-state={theme}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <span className="theme-toggle-word" aria-hidden="true">
        {dark ? "Dark" : "Light"}
      </span>
      <span className="glass-lens theme-toggle-lens" aria-hidden="true">
        {dark ? <Moon size={15} strokeWidth={2.2} /> : <Sun size={15} strokeWidth={2.2} />}
      </span>
    </button>
  );
}

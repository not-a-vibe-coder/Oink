/**
 * Light / dark for the wallet.
 *
 * The choice lives on <html data-theme> so the portalled sheets inherit it, but the dark
 * tokens in app.css only bite under `:has(.app)` — the landing page and the unlock screens
 * stay on paper whatever was picked. THEME_BOOT runs in <head> before first paint so a
 * dark-mode user never sees a white flash; it and this module must agree on the key.
 */
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "oink-theme";
const listeners = new Set<() => void>();

export const THEME_BOOT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;

function read(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be blocked; the choice still holds for this page load.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "light");
}

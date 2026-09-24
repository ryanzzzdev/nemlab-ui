import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Theme = "auto" | "light" | "dark";
const ThemeContext = createContext({
  preference: "auto" as Theme,
  dark: false,
  setPreference: (_preference: Theme) => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark"
      ? "dark"
      : document.documentElement.dataset.theme === "light"
        ? "light"
        : "auto",
  );
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    const sync = (event: StorageEvent) => {
      if (event.key !== "nemlab-theme" && event.key !== null) return;
      setPreference(
        event.newValue === "light" || event.newValue === "dark" ? event.newValue : "auto",
      );
    };
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function changePreference(next: Theme) {
    document.documentElement.dataset.theme = next;
    setPreference(next);
    try {
      localStorage.setItem("nemlab-theme", next);
    } catch {
      // The preference still works for this visit.
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = preference;
  }, [preference]);

  return (
    <ThemeContext.Provider
      value={{
        preference,
        dark: preference === "auto" ? systemDark : preference === "dark",
        setPreference: changePreference,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

export function ThemePicker() {
  const { preference, setPreference } = useTheme();
  return (
    <label className="theme-picker">
      <span>Appearance</span>
      <select value={preference} onChange={(event) => setPreference(event.target.value as Theme)}>
        <option value="auto">Auto</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

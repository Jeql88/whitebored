import { Sun, Moon } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";

export default function ThemeToggle({ className = "" }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      title="Toggle theme"
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--surface-muted)] transition-colors hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-600/15 ${className}`}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

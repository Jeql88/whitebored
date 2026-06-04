import { useState } from "react";
import ThemeToggle from "../ThemeToggle";

// Full-bleed splash background with a floating, elevated auth card on top.
// The image is rendered as an <img> and faded in only once fully decoded, so
// there's no progressive top-to-bottom paint. The token background color shows
// underneath until then (and if the image is missing).
export default function AuthLayout({ title, subtitle, children, footer }) {
  const [bgLoaded, setBgLoaded] = useState(false);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--surface-bg)] px-4">
      {/* Splash image — fades in on load */}
      <img
        src="/background.jpg"
        alt=""
        aria-hidden
        onLoad={() => setBgLoaded(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
          bgLoaded ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* Theme-aware scrim for contrast: light wash in light mode, darken in dark */}
      <div className="absolute inset-0 bg-white/30 dark:bg-slate-950/65" aria-hidden />

      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <p className="absolute bottom-4 left-0 right-0 z-10 text-center text-xs text-white/60">
        Built by{" "}
        <a href="https://jeql8.vercel.app/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/90">Josh Lui</a>
        {" · "}
        <a href="https://www.linkedin.com/in/joshedlui/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/90">LinkedIn</a>
      </p>

      <div className="animate-fade-in relative z-10 w-full max-w-sm rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-8 shadow-xl shadow-black/10 backdrop-blur-sm">
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
              W
            </div>
            <span className="text-xl font-extrabold tracking-tight text-[var(--surface-text)]">
              Whitebored
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--surface-text)]">{title}</h1>
          <p className="mt-1 text-sm text-[var(--surface-muted)]">{subtitle}</p>
        </div>
        {children}
        {footer && (
          <p className="mt-5 text-center text-sm text-[var(--surface-muted)]">
            {footer}
          </p>
        )}
      </div>
    </div>
  );
}

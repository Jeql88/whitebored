import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authClient } from "../../lib/auth-client";
import { API_BASE } from "../../api/config";
import AuthLayout from "./AuthLayout";

function GoogleButton({ label, returnTo = "/whiteboards" }) {
  const handleGoogle = () => {
    const callbackURL = returnTo.startsWith("http")
      ? returnTo
      : `${window.location.origin}${returnTo}`;
    const errorCallbackURL = `${window.location.origin}/login?returnTo=${encodeURIComponent(returnTo)}`;
    // Navigate directly to the server's OAuth shim — first-party navigation so
    // the state cookie is set on onrender.com and survives the Google callback.
    const params = new URLSearchParams({ callbackURL, errorCallbackURL });
    window.location.assign(`${API_BASE}/api/oauth/google?${params}`);
  };
  return (
    <button
      type="button"
      onClick={handleGoogle}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-2.5 text-sm font-medium text-[var(--surface-text)] transition-colors hover:bg-[var(--surface-border)]"
    >
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      {label}
    </button>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2.5 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

const OAUTH_ERRORS = {
  unable_to_link_account: "This email is already registered with a password. Please sign in with your password instead.",
  account_already_linked_to_different_user: "This Google account is already linked to a different account.",
};

export default function Login() {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get("returnTo") || "/whiteboards";
  const returnTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/whiteboards";
  const oauthError = searchParams.get("error");
  const oauthErrorMsg = oauthError ? (OAUTH_ERRORS[oauthError] ?? "Google sign-in failed. Please try again.") : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showWakeNotice, setShowWakeNotice] = useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShowWakeNotice(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: err } = await authClient.signIn.email({ email, password });
    if (err) {
      setError(err.message || "Login failed");
      setLoading(false);
    } else {
      window.location.assign(returnTo);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to Whitebored"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link to="/register" className="font-semibold text-brand-600 hover:underline">
            Register
          </Link>
        </>
      }
    >
      <div className="space-y-3">
        {oauthErrorMsg && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {oauthErrorMsg}
          </div>
        )}
        <GoogleButton label="Continue with Google" returnTo={returnTo} />
        <div className="flex items-center gap-3 text-xs text-[var(--surface-muted)]">
          <div className="flex-1 border-t border-[var(--surface-border)]" />
          or
          <div className="flex-1 border-t border-[var(--surface-border)]" />
        </div>
        {showWakeNotice && (
          <p className="text-center text-xs text-[var(--surface-muted)]">
            Server may be waking up — first load can take ~30s
          </p>
        )}
      </div>
      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className={inputCls}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          className={inputCls}
        />
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10">
            {error}
          </div>
        )}
        <div className="text-right">
          <Link to="/forgot" className="text-xs font-medium text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Login"}
        </button>
      </form>
    </AuthLayout>
  );
}

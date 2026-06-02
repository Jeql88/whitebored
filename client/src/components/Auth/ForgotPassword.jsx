import React, { useState } from "react";
import { Link } from "react-router-dom";
import { authClient } from "../../lib/auth-client";
import AuthLayout from "./AuthLayout";

const inputCls =
  "w-full rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2.5 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await authClient.forgetPassword({
      email,
      redirectTo: `${window.location.origin}/reset`,
    }).catch(() => {});
    // Always show success — don't reveal whether email exists.
    setSent(true);
    setLoading(false);
  };

  return (
    <AuthLayout
      title="Reset password"
      subtitle="We'll email you a link to set a new password"
      footer={
        <Link to="/login" className="font-semibold text-brand-600 hover:underline">
          Back to login
        </Link>
      }
    >
      {sent ? (
        <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-[var(--surface-text)] dark:bg-brand-600/15">
          If an account exists for <strong>{email}</strong>, a reset link is on its
          way. Check your inbox (and spam).
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your account email"
            required
            className={inputCls}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

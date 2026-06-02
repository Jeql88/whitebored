import { useSession, authClient } from "../lib/auth-client";
import { MailWarning, X } from "lucide-react";
import { useState } from "react";

export default function VerifyBanner() {
  const { data: session } = useSession();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("verifyBannerDismissed") === "1"
  );
  const [resent, setResent] = useState(false);

  if (dismissed || !session?.user) return null;
  if (session.user.emailVerified) return null;

  const dismiss = () => {
    sessionStorage.setItem("verifyBannerDismissed", "1");
    setDismissed(true);
  };

  const resend = async () => {
    await authClient.sendVerificationEmail({
      email: session.user.email,
      callbackURL: "/whiteboards",
    }).catch(() => {});
    setResent(true);
  };

  return (
    <div className="flex items-center gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <MailWarning size={16} className="shrink-0" />
      <span className="flex-1">
        {resent ? (
          <>Verification email re-sent to <strong>{session.user.email}</strong>. Check your inbox.</>
        ) : (
          <>Please verify your email (<strong>{session.user.email}</strong>) to secure your account.</>
        )}
      </span>
      {!resent && (
        <button
          onClick={resend}
          className="rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline"
        >
          Resend email
        </button>
      )}
      <button onClick={dismiss} title="Dismiss" className="rounded-md p-1 hover:bg-amber-100 dark:hover:bg-amber-500/20">
        <X size={15} />
      </button>
    </div>
  );
}

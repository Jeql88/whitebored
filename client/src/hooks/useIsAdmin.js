import { useEffect, useState } from "react";
import { apiFetch } from "../api/config";

// Whether the current user has admin access.
//
// The check is made ONCE per page load and shared by every caller. It used to run
// on each mount, so an ordinary user re-asked on every navigation and every visit
// logged a 403 in their console — noise that looked like a bug and buried real
// errors. Admin status cannot change mid-session, so one answer is enough.
//
// The promise (not just the result) is cached, so components mounting together
// share a single in-flight request rather than racing several.
let pending = null;
let resolved = null;

function checkAdmin() {
  if (resolved !== null) return Promise.resolve(resolved);
  if (pending) return pending;

  pending = apiFetch("/api/admin/me", { auth: false })
    .then((res) => {
      resolved = res?.ok === true;
      return resolved;
    })
    .catch(() => {
      // A 403 is the EXPECTED answer for a non-admin, not a failure worth
      // reporting. Treat any error as "not an admin" and remember it.
      resolved = false;
      return false;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(() => resolved === true);
  const [checked, setChecked] = useState(() => resolved !== null);

  useEffect(() => {
    if (resolved !== null) return undefined;

    let cancelled = false;
    checkAdmin().then((value) => {
      if (cancelled) return;
      setIsAdmin(value);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { isAdmin, checked };
}

// Tests need each case to start from a clean slate; nothing in the app calls this.
export function __resetAdminCache() {
  pending = null;
  resolved = null;
}

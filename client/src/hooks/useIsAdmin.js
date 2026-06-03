import { useEffect, useState } from "react";
import { apiFetch } from "../api/config";

// Checks once per session whether the current user has admin access.
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    apiFetch("/api/admin/me")
      .then((res) => setIsAdmin(res.ok === true))
      .catch(() => setIsAdmin(false))
      .finally(() => setChecked(true));
  }, []);

  return { isAdmin, checked };
}

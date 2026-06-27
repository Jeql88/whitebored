import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { API_BASE } from "../api/config";

export const authClient = createAuthClient({
  baseURL: API_BASE,
  plugins: [adminClient()],
  fetchOptions: {
    credentials: "include",
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;

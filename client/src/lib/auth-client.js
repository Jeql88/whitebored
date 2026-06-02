import { createAuthClient } from "better-auth/react";
import { API_BASE } from "../api/config";

export const authClient = createAuthClient({
  baseURL: API_BASE,
});

export const { useSession, signIn, signUp, signOut } = authClient;

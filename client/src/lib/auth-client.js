import { createAuthClient } from "better-auth/react";
import { adminClient, oneTimeTokenClient } from "better-auth/client/plugins";
import { API_BASE } from "../api/config";

export const authClient = createAuthClient({
  baseURL: API_BASE,
  plugins: [adminClient(), oneTimeTokenClient()],
  fetchOptions: {
    credentials: "include",
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;

// Exchange a one-time-token for a session cookie. Call this on page load when
// ?ott= is present in the URL (set after cross-origin Google OAuth callback).
export async function exchangeOtt(token) {
  return authClient.oneTimeToken.verify({ token });
}

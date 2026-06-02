// Auth API is handled by BetterAuth's client (src/lib/auth-client.js).
// This file is kept for any custom server-side auth endpoints.
export { authClient, useSession, signIn, signUp, signOut } from "../lib/auth-client";

const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("@better-auth/mongo-adapter");
const { admin } = require("better-auth/plugins");
const { client, db } = require("./db");
const { sendVerifyEmail, sendResetEmail } = require("./email");
const { BETTER_AUTH_SECRET, BETTER_AUTH_URL, CLIENT_ORIGIN } = require("./config");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

const auth = betterAuth({
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,
  trustedOrigins: [
    CLIENT_ORIGIN,
    BETTER_AUTH_URL,
    "http://localhost:5173",
    "http://localhost:4000",
  ].filter(Boolean),
  advanced: {
    crossSubdomainCookies: { enabled: false },
  },

  database: mongodbAdapter(db, { client }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerifyEmail(user.email, url).catch((err) =>
        console.error("[auth] verify email send failed:", err.message)
      );
    },
    sendResetPassword: async ({ user, url }) => {
      await sendResetEmail(user.email, url).catch((err) =>
        console.error("[auth] reset email send failed:", err.message)
      );
    },
  },

  // Google OAuth — only active when credentials are set in env
  ...(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? {
    socialProviders: {
      google: {
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        // Google already verified the email — trust it and mark the user verified.
        mapProfileToUser: (profile) => ({
          emailVerified: profile.email_verified === true,
        }),
      },
    },
  } : {}),

  user: {
    additionalFields: {
      username: {
        type: "string",
        required: false,
        defaultValue: "",
      },
    },
  },

  plugins: [admin()],
});

module.exports = { auth };

const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { client } = require("./db");
const { sendVerifyEmail, sendResetEmail } = require("./email");
const { BETTER_AUTH_SECRET, BETTER_AUTH_URL, CLIENT_ORIGIN } = require("./config");

const auth = betterAuth({
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,
  trustedOrigins: [CLIENT_ORIGIN, BETTER_AUTH_URL].filter(Boolean),

  database: mongodbAdapter(client),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // soft verification — same as old system
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

  user: {
    additionalFields: {
      username: {
        type: "string",
        required: false,
        defaultValue: "",
      },
    },
  },
});

module.exports = { auth };

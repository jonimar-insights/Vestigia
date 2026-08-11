import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

const GMAIL_SEND_VIA_USER = process.env.GMAIL_SEND_VIA_USER === "true";
const GOOGLE_SCOPES = ["openid", "email", "profile"];
if (GMAIL_SEND_VIA_USER) {
  GOOGLE_SCOPES.push("https://www.googleapis.com/auth/gmail.send");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  logger: {
    error(error) {
      console.error("[AUTH ERROR]", error.name, error.message, error.stack);
    },
  },
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    async jwt({ token, user, account }) {
      // Store Google-authenticated users in the users table (upsert), so
      // gmail.send tokens persist server-side for the OAuth invite emails
      // (only when the gmail.send scope is requested via GMAIL_SEND_VIA_USER).
      if (user?.email && account?.provider === "google") {
        try {
          const db = getDb();
          const existing = await db
            .select()
            .from(users)
            .where(eq(users.username, user.email))
            .limit(1);
          await db
            .insert(users)
            .values({
              username: user.email,
              passwordHash: "google-auth",
              name: user.name || user.email.split("@")[0],
              role: "member",
              gmailAccessToken: GMAIL_SEND_VIA_USER ? (account.access_token ?? null) : null,
              gmailRefreshToken: GMAIL_SEND_VIA_USER ? (account.refresh_token ?? null) : null,
              gmailTokenExpiresAt:
                GMAIL_SEND_VIA_USER && account.expires_at
                  ? String(account.expires_at)
                  : null,
            })
            .onConflictDoUpdate({
              target: users.username,
              set: {
                name: user.name ?? existing[0]?.name,
                role: existing[0]?.role ?? "member",
                gmailAccessToken: GMAIL_SEND_VIA_USER
                  ? (account.access_token ?? existing[0]?.gmailAccessToken)
                  : null,
                gmailRefreshToken: GMAIL_SEND_VIA_USER
                  ? (account.refresh_token ?? existing[0]?.gmailRefreshToken)
                  : null,
                gmailTokenExpiresAt: GMAIL_SEND_VIA_USER
                  ? account.expires_at
                    ? String(account.expires_at)
                    : existing[0]?.gmailTokenExpiresAt
                  : null,
              },
            });
        } catch (err) {
          console.error("[AUTH] Failed to store Google user:", err);
        }
      }
      // Use Google's stable providerAccountId as the user identifier.
      // token.sub and user.id are NextAuth-internal UUIDs that change between sessions.
      if (account?.providerAccountId) {
        token.id = account.providerAccountId;
      } else if (!token.id) {
        token.id = token.sub ?? user?.id;
      }
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
});

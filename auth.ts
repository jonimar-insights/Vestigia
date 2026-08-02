import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/gmail.send",
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
      // gmail.send tokens persist server-side for the OAuth invite emails.
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
              gmailAccessToken: account.access_token ?? null,
              gmailRefreshToken: account.refresh_token ?? null,
              gmailTokenExpiresAt: account.expires_at ? String(account.expires_at) : null,
            })
            .onConflictDoUpdate({
              target: users.username,
              set: {
                name: user.name ?? existing[0]?.name,
                role: existing[0]?.role ?? "member",
                gmailAccessToken: account.access_token ?? existing[0]?.gmailAccessToken,
                gmailRefreshToken: account.refresh_token ?? existing[0]?.gmailRefreshToken,
                gmailTokenExpiresAt: account.expires_at
                  ? String(account.expires_at)
                  : existing[0]?.gmailTokenExpiresAt,
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

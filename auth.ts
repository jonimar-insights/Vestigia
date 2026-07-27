import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/youtube",
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

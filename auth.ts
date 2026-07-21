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
        url: new URL(
          "https://accounts.google.com/o/oauth2/v2/auth?scope=openid+email+profile+https://www.googleapis.com/auth/youtube"
        ),
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
      if (user) {
        token.id = user.id;
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
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
});

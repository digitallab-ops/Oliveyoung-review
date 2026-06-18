import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: { hd: "cms-lab.co.kr" },
      },
    }),
  ],
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider === "google") {
        return profile?.email?.endsWith("@cms-lab.co.kr") ?? false
      }
      return false
    },
  },
  pages: {
    signIn: "/login",
  },
})

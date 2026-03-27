import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

// Hardcoded users — add more here as needed
const USERS = [
  {
    id: "1",
    email: "pekka@webso.fi",
    name: "Pekka",
    // bcrypt hash of "Pekka123"
    passwordHash: bcrypt.hashSync("Pekka123", 10),
  },
];

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        const password = credentials?.password as string;

        if (!email || !password) return null;

        const user = USERS.find((u) => u.email === email.toLowerCase());
        if (!user) return null;

        const valid = bcrypt.compareSync(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
});

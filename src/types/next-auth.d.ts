import NextAuth, { DefaultSession } from "next-auth"

declare module "next-auth" {
    /**
     * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
     */
    interface Session {
        user: {
            organizationId?: string
            role?: string
        } & DefaultSession["user"]
    }

    interface User {
        organizationId?: string | null
        role?: string
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        organizationId?: string | null
        role?: string
    }
}

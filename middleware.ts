export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect everything except login, API auth routes, and static files
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};

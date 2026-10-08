import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

/** Call at the top of every server action / route that touches data. */
export async function requireAuth() {
  const jar = await cookies();
  const ok = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!ok) redirect("/login");
}

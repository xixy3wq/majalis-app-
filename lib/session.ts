import { SignJWT, jwtVerify } from "jose";
export const SESSION_COOKIE = "majalis_session";
const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET مفقود أو أقصر من 32 حرفاً");
  return new TextEncoder().encode(s);
};
export async function signSession(sub: string) {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("60d").sign(secret());
}
export async function verifySession(token?: string): Promise<string | null> {
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, secret()); return (payload.sub as string) || null; } catch { return null; }
}

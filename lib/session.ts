import { SignJWT, jwtVerify } from "jose";
import { createHash } from "node:crypto";
export const SESSION_COOKIE = "majalis_session";
// AUTH_SECRET اختياري: إذا ما انضاف، يُشتق سر ثابت من رابط القاعدة (وهو سري أصلًا)
const secret = () => {
  const s = process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32
    ? process.env.AUTH_SECRET
    : createHash("sha256").update("majalis:" + (process.env.DATABASE_URL || "")).digest("hex");
  return new TextEncoder().encode(s);
};
export async function signSession(sub: string) {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("60d").sign(secret());
}
export async function verifySession(token?: string): Promise<string | null> {
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, secret()); return (payload.sub as string) || null; } catch { return null; }
}

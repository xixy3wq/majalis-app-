import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "./db";
import { SESSION_COOKIE, verifySession } from "./session";

export async function currentUser() {
  const id = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

export class ApiError extends Error { status: number; constructor(msg: string, status = 400) { super(msg); this.status = status; } }
export const fail = (msg: string, status = 400): never => { throw new ApiError(msg, status); };
export async function requireUser() {
  const u = await currentUser();
  if (!u) fail("سجّل دخولك", 401);
  // الحساب اللي ما وافق عليه المدير ما يدخل أي صفحة
  if (u!.role !== "admin" && !u!.approved) fail("حسابك بانتظار موافقة المدير", 401);
  return u!;
}
export function handle(fn: () => Promise<unknown>) {
  return fn().then(
    (r) => (r instanceof Response ? r : NextResponse.json(r ?? { ok: true })),
    (e) => {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: "حدث خطأ في الخادم، حاول مرة ثانية" }, { status: 500 });
    }
  );
}
export const cleanUsername = (s: unknown) => String(s ?? "").trim().toLowerCase();
export const text = (v: unknown, max = 20000) => String(v ?? "").slice(0, max);
export const ID_RE = /^[a-z0-9]{6,40}$/;

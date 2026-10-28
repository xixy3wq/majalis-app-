import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signSession, SESSION_COOKIE } from "@/lib/session";
import { cleanUsername } from "@/lib/auth";
export const dynamic = "force-dynamic";

// تسجيل حساب جديد: يستخدم الدفتر على طول، والذكاء الاصطناعي بعد موافقة المدير
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "قاعدة البيانات غير مربوطة بعد" }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const username = cleanUsername(b.username);
  const password = String(b.password ?? "");
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "اكتب اسمك" }, { status: 400 });
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) return NextResponse.json({ error: "اسم المستخدم: حروف إنجليزية صغيرة أو أرقام، من ٣ أحرف أو أكثر" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "كلمة المرور لازم تكون ٨ أحرف أو أكثر" }, { status: 400 });
  if ((await prisma.user.count()) === 0) return NextResponse.json({ error: "الموقع جديد: أول حساب ينشأ من شاشة الإعداد" }, { status: 409 });
  if (await prisma.user.findUnique({ where: { username } })) return NextResponse.json({ error: "اسم المستخدم مأخوذ، اختر غيره" }, { status: 409 });
  const u = await prisma.user.create({ data: { name, username, passwordHash: await bcrypt.hash(password, 10) } });
  const token = await signSession(u.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 60 });
  return res;
}

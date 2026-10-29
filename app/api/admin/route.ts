import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { cleanUsername, fail, handle, requireUser } from "@/lib/auth";
import { dailyLimit } from "@/lib/limits";
import { intlPhone, saveWa, smartLogin, waCfg, waSend } from "@/lib/wa";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const me = await requireUser();
  if (me.role !== "admin") fail("هذي الصفحة للمدير فقط", 403);
  return me;
}

// قائمة المستخدمين للمدير
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const users = await prisma.user.findMany({
      orderBy: [{ approved: "asc" }, { createdAt: "desc" }],
      select: { id: true, name: true, username: true, role: true, aiAllowed: true, approved: true, about: true, createdAt: true, _count: { select: { majalis: true } } },
    });
    const jobs = await prisma.aiJob.groupBy({ by: ["userId"], where: { createdAt: { gte: since }, status: { not: "tool" } }, _count: { _all: true } });
    const jm: Record<string, number> = {};
    jobs.forEach((j) => { jm[j.userId] = j._count._all; });
    return {
      limit: await dailyLimit(),
      users: users.map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, aiAllowed: u.aiAllowed, approved: u.role === "admin" || u.approved, about: u.about, createdAt: u.createdAt.getTime(), majalis: u._count.majalis, ai30: jm[u.id] || 0 })),
    };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireAdmin();
    const b = await req.json().catch(() => ({}));
    if (b.op === "setAi") {
      const u = await prisma.user.findUnique({ where: { id: String(b.id || "") } });
      if (!u) fail("ما لقيت المستخدم", 404);
      if (u!.id === me.id) fail("حسابك مدير، ما يحتاج");
      await prisma.user.update({ where: { id: u!.id }, data: { aiAllowed: !!b.allowed } });
      return { ok: true };
    }
    if (b.op === "setApproved") {
      const u = await prisma.user.findUnique({ where: { id: String(b.id || "") } });
      if (!u) fail("ما لقيت المستخدم", 404);
      if (u!.role === "admin") fail("حساب المدير ما يحتاج موافقة");
      await prisma.user.update({ where: { id: u!.id }, data: { approved: !!b.approved } });
      return { ok: true };
    }
    if (b.op === "createUser") {
      const name = String(b.name ?? "").trim().slice(0, 60);
      const username = cleanUsername(b.username);
      const pw = String(b.password ?? "");
      if (!name) fail("اكتب الاسم");
      if (!/^[a-z0-9_.]{3,30}$/.test(username)) fail("اسم المستخدم: حروف إنجليزية صغيرة أو أرقام، من ٣ أحرف أو أكثر");
      if (pw.length < 8) fail("كلمة المرور لازم تكون ٨ أحرف أو أكثر");
      if (await prisma.user.findUnique({ where: { username } })) fail("اسم المستخدم مأخوذ، اختر غيره");
      await prisma.user.create({ data: { name, username, approved: true, aiAllowed: !!b.ai, passwordHash: await bcrypt.hash(pw, 10) } });
      return { ok: true };
    }
    if (b.op === "setPassword") {
      const u = await prisma.user.findUnique({ where: { id: String(b.id || "") } });
      if (!u) fail("ما لقيت المستخدم", 404);
      if (u!.role === "admin") fail("كلمة مرور المدير تتغير من متغيرات Vercel");
      const pw = String(b.password ?? "");
      if (pw.length < 8) fail("كلمة المرور لازم تكون ٨ أحرف أو أكثر");
      await prisma.user.update({ where: { id: u!.id }, data: { passwordHash: await bcrypt.hash(pw, 10) } });
      return { ok: true };
    }
    if (b.op === "setLimit") {
      const n = Math.max(0, Math.min(50, Math.floor(Number(b.limit))));
      if (!Number.isFinite(n)) fail("اكتب رقم");
      await prisma.setting.upsert({ where: { key: "ai_daily_limit" }, create: { key: "ai_daily_limit", value: String(n) }, update: { value: String(n) } });
      return { ok: true, limit: n };
    }
    // ---------- إشعارات واتساب ----------
    if (b.op === "waGet") {
      const c = await waCfg();
      return { linked: !!(c.jwt && c.device), choosing: !!(c.jwt && !c.device), notifyPhone: c.notifyPhone, onRegister: c.onRegister, onReminder: c.onReminder };
    }
    if (b.op === "waLink") {
      const r: any = await smartLogin(String(b.phone || ""), String(b.password || ""));
      if (r.error) fail(r.error);
      const c = await waCfg();
      c.jwt = r.jwt; c.device = r.devices.length === 1 ? r.devices[0].id : "";
      if (!c.notifyPhone) c.notifyPhone = String(b.phone || "");
      await saveWa(c);
      if (!r.devices.length) fail("دخلنا حسابك بس ما لقينا رقم واتساب مربوط فيه. اربط جوالك من موقع الواتس الذكي (امسح الباركود) وارجع اضغط «اربط».");
      return { linked: !!c.device, devices: r.devices.length > 1 ? r.devices : [] };
    }
    if (b.op === "waPick") {
      const c = await waCfg();
      if (!c.jwt) fail("اربط حسابك أول");
      if (!/^[a-f0-9]{24}$/i.test(String(b.device || ""))) fail("اختر رقم من القائمة");
      c.device = String(b.device); await saveWa(c);
      return { linked: true };
    }
    if (b.op === "waSave") {
      const c = await waCfg();
      const phone = String(b.notifyPhone || "").trim();
      if (phone && !intlPhone(phone)) fail("رقم الجوال غير صحيح");
      c.notifyPhone = phone; c.onRegister = !!b.onRegister; c.onReminder = !!b.onReminder;
      await saveWa(c);
      return { ok: true };
    }
    if (b.op === "waTest") {
      const c = await waCfg();
      if (!c.jwt || !c.device) fail("اربط حسابك في الواتس الذكي أول");
      if (!intlPhone(c.notifyPhone)) fail("اكتب رقمك واحفظ أول");
      const r = await waSend(c, c.notifyPhone, "رسالة تجريبية من دفتر مجالس المشايخ. الإشعارات شغالة.");
      if (!r.ok) fail("ما وصلت الرسالة للمزوّد: " + r.resp.slice(0, 150));
      return { ok: true };
    }
    if (b.op === "waUnlink") {
      const c = await waCfg(); c.jwt = ""; c.device = ""; await saveWa(c);
      return { ok: true };
    }
    if (b.op === "deleteUsers" || b.op === "approveMany") {
      const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 500) : [];
      const where = { id: { in: ids }, role: { not: "admin" } };
      const r = b.op === "deleteUsers" ? await prisma.user.deleteMany({ where }) : await prisma.user.updateMany({ where, data: { approved: true } });
      return { n: r.count };
    }
    if (b.op === "deleteUser") {
      const u = await prisma.user.findUnique({ where: { id: String(b.id || "") } });
      if (!u) fail("ما لقيت المستخدم", 404);
      if (u!.role === "admin") fail("ما تقدر تحذف حساب مدير");
      await prisma.user.delete({ where: { id: u!.id } });
      return { ok: true };
    }
    fail("طلب غير معروف");
  });
}

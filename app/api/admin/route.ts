import { prisma } from "@/lib/db";
import { fail, handle, requireUser } from "@/lib/auth";
import { dailyLimit } from "@/lib/limits";
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
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, username: true, role: true, aiAllowed: true, about: true, createdAt: true, _count: { select: { majalis: true } } },
    });
    const jobs = await prisma.aiJob.groupBy({ by: ["userId"], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const jm: Record<string, number> = {};
    jobs.forEach((j) => { jm[j.userId] = j._count._all; });
    return {
      limit: await dailyLimit(),
      users: users.map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, aiAllowed: u.aiAllowed, about: u.about, createdAt: u.createdAt.getTime(), majalis: u._count.majalis, ai30: jm[u.id] || 0 })),
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
    if (b.op === "setLimit") {
      const n = Math.max(0, Math.min(50, Math.floor(Number(b.limit))));
      if (!Number.isFinite(n)) fail("اكتب رقم");
      await prisma.setting.upsert({ where: { key: "ai_daily_limit" }, create: { key: "ai_daily_limit", value: String(n) }, update: { value: String(n) } });
      return { ok: true, limit: n };
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

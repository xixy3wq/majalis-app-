import { prisma } from "@/lib/db";
import { fail, handle, requireUser } from "@/lib/auth";
import { aiReady } from "@/lib/claude";
import { blobReady } from "@/lib/blob";
import { asrReady } from "@/lib/asr";
import { dailyLimit, usedToday } from "@/lib/limits";
export const dynamic = "force-dynamic";

// قائمة المجالس مع عدد الأسئلة وعدد اللي انسألت
export async function GET() {
  return handle(async () => {
    if (!process.env.DATABASE_URL) fail("قاعدة البيانات غير مربوطة بعد. من Vercel: Storage ← Neon، ثم Redeploy.", 503);
    const me = await requireUser();
    const list = await prisma.majlis.findMany({
      where: { userId: me.id },
      select: { id: true, sheikh: true, topic: true, date: true, place: true, createdAt: true, _count: { select: { questions: true } } },
      orderBy: { createdAt: "desc" },
    });
    const asked = await prisma.question.groupBy({ by: ["majlisId"], where: { asked: true, majlis: { userId: me.id } }, _count: { _all: true } });
    const am: Record<string, number> = {};
    asked.forEach((a) => { am[a.majlisId] = a._count._all; });
    const pending = me.role === "admin" ? await prisma.user.count({ where: { approved: false, role: { not: "admin" } } }) : 0;
    return {
      me: { id: me.id, name: me.name, role: me.role, about: me.about },
      pending,
      ai: { ready: aiReady(), allowed: me.role === "admin" || me.aiAllowed, admin: me.role === "admin", store: blobReady(), asr: asrReady(), limit: me.role === "admin" ? null : await dailyLimit(), used: await usedToday(me.id) },
      majalis: list.map((m) => ({ id: m.id, sheikh: m.sheikh, topic: m.topic, date: m.date, place: m.place, createdAt: m.createdAt.getTime(), qCount: m._count.questions, askedCount: am[m.id] || 0 })),
    };
  });
}

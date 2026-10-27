import { prisma } from "@/lib/db";
import { handle, requireUser } from "@/lib/auth";
export const dynamic = "force-dynamic";

// قائمة المجالس مع عدد الأسئلة وعدد اللي انسألت
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    const list = await prisma.majlis.findMany({
      where: { userId: me.id },
      select: { id: true, sheikh: true, topic: true, date: true, place: true, createdAt: true, _count: { select: { questions: true } } },
      orderBy: { createdAt: "desc" },
    });
    const asked = await prisma.question.groupBy({ by: ["majlisId"], where: { asked: true, majlis: { userId: me.id } }, _count: { _all: true } });
    const am: Record<string, number> = {};
    asked.forEach((a) => { am[a.majlisId] = a._count._all; });
    return {
      me: { name: me.name },
      majalis: list.map((m) => ({ id: m.id, sheikh: m.sheikh, topic: m.topic, date: m.date, place: m.place, createdAt: m.createdAt.getTime(), qCount: m._count.questions, askedCount: am[m.id] || 0 })),
    };
  });
}

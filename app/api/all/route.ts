import { prisma } from "@/lib/db";
import { handle, requireUser } from "@/lib/auth";
export const dynamic = "force-dynamic";

const ORDER: Record<string, number> = { core: 0, ask: 1, spare: 2 };

// كل جلسات المستخدم بأسئلتها: للبحث وصفحة الشيخ والمكتبة والتصدير والنسخة الاحتياطية
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    const rows = await prisma.majlis.findMany({ where: { userId: me.id }, include: { questions: true }, orderBy: { createdAt: "desc" } });
    return {
      exportedAt: new Date().toISOString(),
      majalis: rows.map((r: any) => {
        const { userId, shareToken, questions, createdAt, updatedAt, ...m } = r;
        return {
          ...m,
          createdAt: createdAt.getTime(),
          updatedAt: updatedAt.getTime(),
          questions: [...questions]
            .sort((a: any, b: any) => (ORDER[a.grp] ?? 0) - (ORDER[b.grp] ?? 0) || a.pos - b.pos)
            .map((q: any) => ({ id: q.id, text: q.text, why: q.why, group: q.grp, order: q.pos, asked: q.asked, answer: q.answer })),
        };
      }),
    };
  });
}

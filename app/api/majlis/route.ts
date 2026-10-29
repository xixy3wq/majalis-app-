import { prisma } from "@/lib/db";
import { fail, handle, requireUser } from "@/lib/auth";
export const dynamic = "force-dynamic";

// مجلس واحد بكامل حقوله وأسئلته
export async function GET(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const id = new URL(req.url).searchParams.get("id") || "";
    const m = await prisma.majlis.findFirst({ where: { id, userId: me.id }, include: { questions: true } });
    if (!m) fail("ما لقيت هذا المجلس", 404);
    const { questions, ...meta } = m!;
    const job = await prisma.aiJob.findFirst({ where: { majlisId: m!.id, userId: me.id }, select: { id: true } }).catch(() => null);
    return {
      ai: !!job,
      majlis: { ...meta, createdAt: meta.createdAt.getTime(), updatedAt: meta.updatedAt.getTime() },
      questions: questions.map((q) => ({ id: q.id, text: q.text, why: q.why, group: q.grp, order: q.pos, asked: q.asked, answer: q.answer })),
    };
  });
}

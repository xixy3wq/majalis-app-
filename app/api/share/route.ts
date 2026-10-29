import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";

// جلسة مشاركة للقراءة فقط: بدون تسجيل دخول، وبدون التحضير وتحليل الشخصية
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return NextResponse.json({ error: "الرابط غير صحيح" }, { status: 404 });
  const m = await prisma.majlis.findUnique({ where: { shareToken: t }, include: { questions: true } });
  if (!m) return NextResponse.json({ error: "هذي الجلسة ما عادت مشاركة، أو الرابط غير صحيح" }, { status: 404 });
  const ORDER: Record<string, number> = { core: 0, ask: 1, spare: 2 };
  return NextResponse.json({
    majlis: { sheikh: m.sheikh, topic: m.topic, date: m.date, place: m.place, books: m.books, general: m.general },
    questions: [...m.questions]
      .sort((a, b) => (ORDER[a.grp] ?? 0) - (ORDER[b.grp] ?? 0) || a.pos - b.pos)
      .map((q) => ({ text: q.text, answer: q.answer, asked: q.asked })),
  }, { headers: { "Cache-Control": "no-store" } });
}

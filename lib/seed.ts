import { prisma } from "./db";
import seed from "@/prisma/seed-masaed.json";
// يضيف مجلس الشيخ مساعد الطيار مرة وحدة فقط
export async function seedMasaed(userId: string) {
  const done = await prisma.setting.findUnique({ where: { key: "seeded_masaed" } });
  if (done) return;
  const m: any = (seed as any).majlis;
  await prisma.majlis.create({
    data: {
      userId, sheikh: m.sheikh, topic: m.topic || "", date: m.date || "", place: m.place || "",
      opening: m.opening || "", briefing: m.briefing || "", books: m.books || "", general: m.general || "",
      questions: { create: (seed as any).questions.map((q: any) => ({ text: q.text, why: q.why || "", grp: q.group || "core", pos: q.order || 0 })) },
    },
  });
  await prisma.setting.create({ data: { key: "seeded_masaed", value: "1" } });
}

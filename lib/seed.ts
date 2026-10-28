import { prisma } from "./db";
import masaed from "@/prisma/seed-masaed.json";
import shahri from "@/prisma/seed-shahri.json";
import khudairi from "@/prisma/seed-khudairi.json";

// المجالس الجاهزة تنضاف لحساب المدير مرة وحدة لكل مجلس (لو حذفها ما ترجع)
const SEEDS: { key: string; data: any }[] = [
  { key: "seeded_masaed", data: masaed },
  { key: "seeded_shahri", data: shahri },
  { key: "seeded_khudairi", data: khudairi },
];

export async function seedFor(userId: string) {
  for (const sd of SEEDS) {
    const done = await prisma.setting.findUnique({ where: { key: sd.key } });
    if (done) continue;
    const m = sd.data.majlis;
    await prisma.majlis.create({
      data: {
        userId, sheikh: m.sheikh, topic: m.topic || "", date: m.date || "", place: m.place || "",
        opening: m.opening || "", briefing: m.briefing || "", books: m.books || "", general: m.general || "",
        questions: { create: sd.data.questions.map((q: any) => ({ text: q.text, why: q.why || "", grp: q.group || "core", pos: q.order || 0 })) },
      },
    });
    await prisma.setting.create({ data: { key: sd.key, value: "1" } });
  }
}

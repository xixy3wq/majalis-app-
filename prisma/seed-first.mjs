// يُشغَّل مع كل رفع: يضيف مجلس الشيخ مساعد الطيار مرة وحدة فقط (أول رفع).
// لو حذفته من الموقع ما يرجع، لأن العلامة seeded_masaed تنحفظ في جدول Setting.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const prisma = new PrismaClient();
const username = (process.env.SEED_ADMIN_USERNAME || "").trim().toLowerCase();
try {
  const done = await prisma.setting.findUnique({ where: { key: "seeded_masaed" } });
  const user = username ? await prisma.user.findUnique({ where: { username } }) : null;
  if (done) console.log("SEED skip: already seeded");
  else if (!user) console.log("SEED skip: no account yet");
  else {
    const seed = JSON.parse(readFileSync(new URL("./seed-masaed.json", import.meta.url), "utf8"));
    const m = seed.majlis;
    await prisma.majlis.create({
      data: {
        userId: user.id, sheikh: m.sheikh, topic: m.topic || "", date: m.date || "", place: m.place || "",
        opening: m.opening || "", briefing: m.briefing || "", books: m.books || "", general: m.general || "",
        questions: { create: seed.questions.map((q) => ({ text: q.text, why: q.why || "", grp: q.group || "core", pos: q.order || 0 })) },
      },
    });
    await prisma.setting.create({ data: { key: "seeded_masaed", value: "1" } });
    console.log("SEED ok: masaed");
  }
} finally {
  await prisma.$disconnect();
}

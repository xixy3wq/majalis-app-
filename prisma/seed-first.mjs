// يُشغَّل مع كل رفع: يضيف المجالس الجاهزة لحساب المدير (من متغيرات SEED_ADMIN_*) مرة وحدة لكل مجلس.
// إذا الحساب ينشأ من شاشة أول مرة بدل المتغيرات، الإضافة تصير هناك.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const prisma = new PrismaClient();
const username = (process.env.SEED_ADMIN_USERNAME || "").trim().toLowerCase();
const FILES = [["seeded_masaed", "seed-masaed.json"], ["seeded_shahri", "seed-shahri.json"], ["seeded_khudairi", "seed-khudairi.json"]];
try {
  const user = username ? await prisma.user.findUnique({ where: { username } }) : null;
  if (!user) console.log("SEED skip: no account from SEED_ADMIN_USERNAME");
  else {
    for (const [key, file] of FILES) {
      if (await prisma.setting.findUnique({ where: { key } })) continue;
      const seed = JSON.parse(readFileSync(new URL("./" + file, import.meta.url), "utf8"));
      const m = seed.majlis;
      await prisma.majlis.create({
        data: {
          userId: user.id, sheikh: m.sheikh, topic: m.topic || "", date: m.date || "", place: m.place || "",
          opening: m.opening || "", briefing: m.briefing || "", books: m.books || "", general: m.general || "",
          questions: { create: seed.questions.map((q) => ({ text: q.text, why: q.why || "", grp: q.group || "core", pos: q.order || 0 })) },
        },
      });
      await prisma.setting.create({ data: { key, value: "1" } });
      console.log("SEED ok:", key);
    }
  }
} finally {
  await prisma.$disconnect();
}

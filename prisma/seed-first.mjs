// يُشغَّل مع كل رفع: يضيف المجالس الجاهزة لحساب المدير مرة وحدة لكل مجلس.
// المجالس الأولى تنضاف للحساب اللي في متغيرات SEED_ADMIN_* (إذا الحساب ينشأ من شاشة أول مرة، الإضافة تصير هناك).
// المجالس المضافة بعد إنشاء الحساب (anyAdmin) تنضاف لأقدم حساب مدير إذا ما فيه متغيرات.
// أي خطأ هنا يُسجَّل بس وما يوقف الرفع.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const prisma = new PrismaClient();
const username = (process.env.SEED_ADMIN_USERNAME || "").trim().toLowerCase();
const FILES = [
  ["seeded_masaed", "seed-masaed.json", false],
  ["seeded_shahri", "seed-shahri.json", false],
  ["seeded_khudairi", "seed-khudairi.json", false],
  ["seeded_masaed_majlis_2026_10_28", "seed-masaed-2026-10-28.json", true],
];
try {
  const envUser = username ? await prisma.user.findUnique({ where: { username } }) : null;
  const owner = envUser || (await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } }));
  for (const [key, file, anyAdmin] of FILES) {
    const user = anyAdmin ? owner : envUser;
    if (!user) { console.log("SEED skip " + key + ": no account"); continue; }
    if (await prisma.setting.findUnique({ where: { key } })) continue;
    const seed = JSON.parse(readFileSync(new URL("./" + file, import.meta.url), "utf8"));
    const m = seed.majlis;
    await prisma.majlis.create({
      data: {
        userId: user.id, sheikh: m.sheikh, topic: m.topic || "", date: m.date || "", place: m.place || "",
        opening: m.opening || "", briefing: m.briefing || "", books: m.books || "", general: m.general || "",
        questions: {
          create: seed.questions.map((q) => ({
            text: q.text, why: q.why || "", grp: q.group || "core", pos: q.order || 0,
            asked: !!q.asked, answer: q.answer || "",
          })),
        },
      },
    });
    await prisma.setting.create({ data: { key, value: "1" } });
    console.log("SEED ok:", key);
  }
} catch (e) {
  console.error("SEED error (deploy continues):", e && e.message ? e.message : e);
} finally {
  await prisma.$disconnect();
}

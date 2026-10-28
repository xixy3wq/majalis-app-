// يُشغَّل مع كل رفع على Vercel: يضمن وجود حسابك من متغيرات SEED_ADMIN_*.
// كلمة المرور تُضبط عند الإنشاء فقط. لإعادة ضبطها: أضف SEED_ADMIN_FORCE_PASSWORD=1 ثم Redeploy (واحذفه بعدها).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();
const username = (process.env.SEED_ADMIN_USERNAME || "").trim().toLowerCase();
const password = (process.env.SEED_ADMIN_PASSWORD || "").trim();
const name = (process.env.SEED_ADMIN_NAME || "صاحب الدفتر").trim();
const force = process.env.SEED_ADMIN_FORCE_PASSWORD === "1";
try {
  if (!username || password.length < 8) {
    console.warn("SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD (8+) missing - account not changed");
  } else {
    const ex = await prisma.user.findUnique({ where: { username } });
    if (!ex) {
      await prisma.user.create({ data: { name, username, role: "admin", aiAllowed: true, passwordHash: await bcrypt.hash(password, 10) } });
      console.log("ADMIN_OK created");
    } else if (force) {
      await prisma.user.update({ where: { username }, data: { role: "admin", aiAllowed: true, passwordHash: await bcrypt.hash(password, 10) } });
      console.log("ADMIN_OK password reset");
    } else {
      await prisma.user.update({ where: { username }, data: { role: "admin", aiAllowed: true } });
      console.log("ADMIN_OK exists");
    }
  }
} finally {
  await prisma.$disconnect();
}

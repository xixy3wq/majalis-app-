// يُشغَّل مع كل رفع: يجهز الجداول إذا القاعدة مربوطة، ويتخطى بهدوء إذا ما انربطت بعد
// (عشان أول رفع على Vercel ينجح قبل ربط Neon).
import { execSync } from "node:child_process";
if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL missing - skipping database setup (connect Neon, then Redeploy)");
} else {
  if (!process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
  execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: process.env });
  execSync("node prisma/ensure-admin.mjs", { stdio: "inherit", env: process.env });
  execSync("node prisma/seed-first.mjs", { stdio: "inherit", env: process.env });
}

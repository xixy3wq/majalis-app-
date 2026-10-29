import { prisma } from "./db";
// الحد اليومي لتوليد الجلسات لكل مستخدم (المدير بدون حد)
export async function dailyLimit() {
  const s = await prisma.setting.findUnique({ where: { key: "ai_daily_limit" } });
  const n = Number(s?.value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}
export async function usedToday(userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.aiJob.count({ where: { userId, createdAt: { gte: since }, status: { not: "tool" } } });
}

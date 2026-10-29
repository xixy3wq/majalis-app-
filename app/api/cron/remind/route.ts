import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyAdmin, waCfg } from "@/lib/wa";
export const dynamic = "force-dynamic";

// مهمة يومية من Vercel (vercel.json): تذكير واتساب للمدير بمجالسه اللي بكرة. ما ترسل نفس التذكير مرتين.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const c = await waCfg();
  if (!c.onReminder || !c.jwt || !c.device) return NextResponse.json({ sent: 0, skipped: "off" });
  const riyadh = new Date(Date.now() + 3 * 3600000);
  const t = new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate() + 1));
  const tomorrow = t.toISOString().slice(0, 10);
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  const list = await prisma.majlis.findMany({ where: { date: tomorrow, userId: { in: admins.map((a) => a.id) } } });
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || "";
  let sent = 0;
  for (const m of list) {
    const key = `rem:${m.id}:${m.date}`;
    if (await prisma.setting.findUnique({ where: { key } })) continue;
    await prisma.setting.create({ data: { key, value: "1" } });
    const text = `تذكير: بكرة مجلسك مع ${m.sheikh}` + (m.time ? ` الساعة ${m.time}` : "") + (m.place ? ` في ${m.place}` : "") + "." +
      (m.topic ? `\nالموضوع: ${m.topic}` : "") + (host ? `\nراجع التحضير: https://${host}/#s-${m.id}` : "");
    await notifyAdmin("reminder", text);
    sent++;
  }
  return NextResponse.json({ sent });
}

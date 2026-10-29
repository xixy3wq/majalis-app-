import { NextResponse } from "next/server";
import { blobReady } from "@/lib/blob";
import { makeBackup } from "@/lib/backup";
import { notifyAdmin } from "@/lib/wa";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// مهمة يومية من Vercel (vercel.json): نسخة احتياطية كاملة كل ليلة، وإذا فشلت يوصل المدير واتساب
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!blobReady()) return NextResponse.json({ skipped: "no blob store" });
  try {
    const e = await makeBackup("auto");
    return NextResponse.json({ ok: true, size: e.size, counts: e.counts });
  } catch (err: any) {
    console.error("backup failed", err);
    await notifyAdmin("backup", "تنبيه من دفتر المجالس: النسخة الاحتياطية الليلية ما نجحت. افتح صفحة المستخدمين وخذ نسخة يدوية.\n" + String(err?.message || "").slice(0, 200));
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

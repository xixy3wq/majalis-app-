import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { accessOfUrl } from "@/lib/blob";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// احتياط للتشغيل إذا ما تيسر رابط موقّع: الخادم يقرأ الملف الخاص ويمرره لصاحبه فقط
export async function GET(req: Request) {
  try {
    const me = await requireUser();
    const id = new URL(req.url).searchParams.get("id") || "";
    const r = await prisma.recording.findFirst({ where: { id, userId: me.id } });
    if (!r || !r.url) return new Response("Not found", { status: 404 });
    const g = await get(r.pathname || r.url, { access: accessOfUrl(r.url) });
    if (!g || g.statusCode !== 200) return new Response("Not found", { status: 404 });
    return new Response((g as any).stream, {
      headers: { "Content-Type": (g as any).blob.contentType || r.mime || "audio/webm", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}

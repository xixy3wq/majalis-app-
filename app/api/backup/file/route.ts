import { get } from "@vercel/blob";
import { requireUser } from "@/lib/auth";
import { accessOfUrl } from "@/lib/blob";
import { readLog } from "@/lib/backup";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// احتياط لتنزيل نسخة احتياطية عبر الخادم (للمدير فقط) إذا ما تيسر رابط موقّع
export async function GET(req: Request) {
  try {
    const me = await requireUser();
    if (me.role !== "admin") return new Response("Forbidden", { status: 403 });
    const id = new URL(req.url).searchParams.get("id") || "";
    const e = (await readLog()).find((x) => x.id === id);
    if (!e) return new Response("Not found", { status: 404 });
    const g = await get(e.pathname || e.url, { access: accessOfUrl(e.url) });
    if (!g || g.statusCode !== 200) return new Response("Not found", { status: 404 });
    const name = "majalis-backup-" + String(e.at).slice(0, 10) + ".json.gz";
    return new Response((g as any).stream, {
      headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
    });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}

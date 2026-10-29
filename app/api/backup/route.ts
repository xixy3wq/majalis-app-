import { prisma } from "@/lib/db";
import { fail, handle, requireUser, text } from "@/lib/auth";
import { blobEnvNames, blobReady, readUrl, storageUsed } from "@/lib/blob";
import { addToLog, loadBackup, makeBackup, readLog, restore } from "@/lib/backup";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// النسخ الاحتياطي للمدير: الحالة، نسخة الحين، رابط تنزيل، استرجاع (من نسخة محفوظة أو من ملف مرفوع)
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    if (me.role !== "admin") fail("هذي الصفحة للمدير فقط", 403);
    const b = await req.json().catch(() => ({}));
    if (b.op === "status") {
      const log = blobReady() ? await readLog() : [];
      const users = await prisma.user.findMany({ select: { id: true, name: true, username: true }, orderBy: { createdAt: "asc" } });
      return { ready: blobReady(), env: blobReady() ? [] : blobEnvNames(), log, storage: blobReady() ? await storageUsed() : null, users };
    }
    if (!blobReady()) fail("فعّل مخزن الملفات أول: Vercel ← Storage ← Blob", 503);
    if (b.op === "now") return { entry: await makeBackup("manual") };
    if (b.op === "link") {
      const e = (await readLog()).find((x) => x.id === String(b.id || ""));
      if (!e) fail("ما لقيت النسخة", 404);
      try { return { url: await readUrl(e!.url, e!.pathname, 15) }; } catch (err) { console.error("backup link", err); return { url: "/api/backup/file?id=" + encodeURIComponent(e!.id) }; }
    }
    if (b.op === "restore") {
      const mode = b.mode === "all" ? "all" : "missing";
      const userId = b.userId ? text(b.userId, 60) : null;
      let src: { url: string; pathname: string };
      if (b.id) {
        const e = (await readLog()).find((x) => x.id === String(b.id));
        if (!e) fail("ما لقيت النسخة", 404);
        src = { url: e!.url, pathname: e!.pathname };
      } else {
        const url = text(b.url, 2000), pathname = text(b.pathname, 1000);
        let u: URL | null = null;
        try { u = new URL(url); } catch {}
        if (!u || !/\.blob\.vercel-storage\.com$/i.test(u.hostname) || !pathname.startsWith("backups/upload/")) fail("ملف غير صحيح");
        src = { url, pathname };
      }
      const data = await loadBackup(src.url, src.pathname);
      if (!b.id) {
        // الملف المرفوع ينضاف للسجل عشان يبان ويمديك ترجع له
        await addToLog({ id: Math.random().toString(16).slice(2, 14), url: src.url, pathname: src.pathname, size: Number(b.size) || 0, at: String(data.at || new Date().toISOString()), kind: "upload",
          counts: { users: data.users.length, majalis: data.majalis.length, questions: (data.questions || []).length, recordings: (data.recordings || []).length } });
      }
      const before = await makeBackup("pre-restore");
      const res = await restore(data, mode, userId);
      return { res, before: before.id, at: data.at };
    }
    fail("طلب غير معروف");
  });
}

// مخزن الملفات (Vercel Blob): التسجيلات الصوتية والنسخ الاحتياطية.
// المخزن المفضّل «خاص» (Private): الروابط ما تفتح إلا بتوقيع مؤقت يصدره الموقع.
// لو صاحب الموقع سوّاه «عام» بالغلط، الموقع يكتشف ذلك ويكمل بأسماء ملفات عشوائية ما تنخمّن.
import { del, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { prisma } from "./db";

export type Access = "private" | "public";
export const blobReady = () => !!process.env.BLOB_READ_WRITE_TOKEN;
/** سعة الخطة المجانية في Vercel (Hobby): ١ جيجا. إذا تعداها يقفل المخزن ٣٠ يوم، فنوقف قبلها. */
export const QUOTA = 1024 * 1024 * 1024;
export const SAFE_LIMIT = Math.floor(QUOTA * 0.85);

let accessCache: Access | null = null;
async function setting(key: string) {
  return (await prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value ?? null;
}
async function saveSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } }).catch(() => {});
}

/** نوع المخزن: نجرب نكتب ملف صغير «خاص»، إذا رفض فالمخزن عام. النتيجة تنحفظ. */
export async function blobAccess(): Promise<Access> {
  if (accessCache) return accessCache;
  const s = await setting("blobAccess");
  if (s === "private" || s === "public") return (accessCache = s);
  let mode: Access = "private";
  try {
    await put("system/probe.txt", "ok", { access: "private", allowOverwrite: true, contentType: "text/plain" });
  } catch (e1: any) {
    // إذا العام بعد فشل، فالمشكلة في المخزن نفسه مو في نوعه
    try { await put("system/probe.txt", "ok", { access: "public", addRandomSuffix: true, contentType: "text/plain" }); }
    catch { throw e1; }
    mode = "public";
  }
  accessCache = mode;
  await saveSetting("blobAccess", mode);
  return mode;
}
export const accessOfUrl = (url: string): Access => (/\.public\.blob\.vercel-storage\.com/i.test(url) ? "public" : "private");
/** يتذكر نوع المخزن من رابط رجع من رفع فعلي */
export async function rememberAccess(url: string) {
  const a = accessOfUrl(url);
  if (accessCache !== a) { accessCache = a; await saveSetting("blobAccess", a); }
}

/** رابط قراءة: للعام الرابط نفسه، وللخاص رابط موقّع مؤقت */
export async function readUrl(url: string, pathname: string, minutes = 360) {
  if (accessOfUrl(url) === "public") return url;
  const validUntil = Date.now() + minutes * 60000;
  const tok = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(tok, { operation: "get", pathname, access: "private", validUntil });
  return presignedUrl;
}

/** يكتب ملف من الخادم (النسخ الاحتياطية) */
export async function putFile(pathname: string, body: Buffer | string, contentType: string) {
  const access = await blobAccess();
  const r = await put(pathname, body, { access, contentType, addRandomSuffix: true });
  return { url: r.url, pathname: r.pathname, access };
}

export async function delFiles(urls: string[]) {
  const list = urls.filter(Boolean);
  for (let i = 0; i < list.length; i += 100) {
    await del(list.slice(i, i + 100)).catch((e) => console.error("blob del", e));
  }
}

/** المساحة المستخدمة تقريبًا: التسجيلات + النسخ الاحتياطية (من سجلها) */
export async function storageUsed() {
  const r = await prisma.recording.aggregate({ _sum: { size: true } });
  const recBytes = Number(r._sum.size || 0);
  let backupBytes = 0;
  try { backupBytes = (JSON.parse((await setting("backupLog")) || "[]") as any[]).reduce((a, b) => a + (Number(b.size) || 0), 0); } catch {}
  return { recBytes, backupBytes, total: recBytes + backupBytes, quota: QUOTA, limit: SAFE_LIMIT };
}

/** يحذف ملفات تسجيلات مجالس قبل حذفها من القاعدة (الحذف المتسلسل في القاعدة ما يحذف الملفات) */
export async function delRecordingFiles(where: { majlisId?: { in: string[] } | string; userId?: { in: string[] } | string }) {
  if (!blobReady()) return;
  const recs = await prisma.recording.findMany({ where: where as any, select: { url: true } }).catch(() => []);
  await delFiles(recs.map((r) => r.url));
}

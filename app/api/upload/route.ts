import { handleUpload, handleUploadPresigned } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, requireUser } from "@/lib/auth";
import { blobReady, SAFE_LIMIT, storageUsed } from "@/lib/blob";
export const dynamic = "force-dynamic";

// يصدر إذن رفع مؤقت للمتصفح، والملف يروح من المتصفح للمخزن مباشرة (بدون حد ٤٫٥ ميجا).
// طريقتين حسب ربط المخزن: OIDC (الافتراضي الجديد في Vercel: BLOB_STORE_ID) ← رابط رفع موقّع،
// أو مفتاح BLOB_READ_WRITE_TOKEN ← رمز رفع. ونفس فحوصات /api/rec (prepare) تتكرر هنا.
const MAX_FILE = 500 * 1024 * 1024;
const USER_CAP = 150 * 1024 * 1024;
const REC_TYPES = ["audio/*", "video/*", "application/octet-stream"];

async function check(pathname: string, clientPayload: string | null) {
  const me = await requireUser();
  let p: any = {};
  try { p = JSON.parse(clientPayload || "{}"); } catch {}
  const used = await storageUsed();
  let left = SAFE_LIMIT - used.total;
  if (p.kind === "backup") {
    if (me.role !== "admin") throw new ApiError("للمدير فقط", 403);
    if (!pathname.startsWith("backups/upload/")) throw new ApiError("مسار غير صحيح", 400);
    return { max: Math.max(1, Math.min(200 * 1024 * 1024, left)), types: undefined as string[] | undefined };
  }
  if (me.role !== "admin" && !me.aiAllowed) throw new ApiError("ما عندك صلاحية التسجيل", 403);
  const m = await prisma.majlis.findFirst({ where: { id: String(p.majlisId || ""), userId: me.id }, select: { id: true } });
  if (!m) throw new ApiError("ما لقيت هذا المجلس", 404);
  if (!pathname.startsWith(`rec/${me.id}/${m.id}/`)) throw new ApiError("مسار غير صحيح", 400);
  if (me.role !== "admin") {
    const mine = await prisma.recording.aggregate({ where: { userId: me.id }, _sum: { size: true } });
    left = Math.min(left, USER_CAP - Number(mine._sum.size || 0));
  }
  if (left <= 0) throw new ApiError("مساحة التخزين ما تكفي", 413);
  return { max: Math.min(MAX_FILE, left), types: REC_TYPES };
}

export async function POST(request: Request) {
  if (!blobReady()) return NextResponse.json({ error: "مخزن الملفات غير مفعّل" }, { status: 503 });
  const body: any = await request.json().catch(() => null);
  try {
    if (body?.type === "blob.generate-presigned-url") {
      const json = await handleUploadPresigned({
        body,
        request,
        getSignedToken: async (pathname, clientPayload) => {
          const c = await check(pathname, clientPayload);
          const validUntil = Date.now() + 3 * 3600 * 1000;
          const token = await issueSignedToken({ pathname, operations: ["put"], validUntil, maximumSizeInBytes: c.max, ...(c.types ? { allowedContentTypes: c.types } : {}) });
          return { token, urlOptions: { addRandomSuffix: true, validUntil, maximumSizeInBytes: c.max, ...(c.types ? { allowedContentTypes: c.types } : {}) } };
        },
      });
      return NextResponse.json(json);
    }
    if (body?.type === "blob.generate-client-token") {
      const json = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const c = await check(pathname, clientPayload);
          return { maximumSizeInBytes: c.max, addRandomSuffix: true, validUntil: Date.now() + 3 * 3600 * 1000, ...(c.types ? { allowedContentTypes: c.types } : {}) };
        },
      });
      return NextResponse.json(json);
    }
    return NextResponse.json({ error: "طلب غير صحيح" }, { status: 400 });
  } catch (e: any) {
    console.error("upload token", e);
    return NextResponse.json({ error: e?.message || "تعذّر الرفع" }, { status: e instanceof ApiError ? e.status : 400 });
  }
}

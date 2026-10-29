import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, requireUser } from "@/lib/auth";
import { blobReady, SAFE_LIMIT, storageUsed } from "@/lib/blob";
export const dynamic = "force-dynamic";

// يصدر رمز رفع مؤقت للمتصفح، والملف يروح من المتصفح للمخزن مباشرة (بدون حد ٤٫٥ ميجا).
// نفس فحوصات /api/rec (op: prepare) تتكرر هنا لأن هذا هو اللي يفتح الرفع فعليًا.
const MAX_FILE = 500 * 1024 * 1024;
const USER_CAP = 150 * 1024 * 1024;

export async function POST(request: Request) {
  if (!blobReady()) return NextResponse.json({ error: "مخزن الملفات غير مفعّل" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || body.type !== "blob.generate-client-token") return NextResponse.json({ error: "طلب غير صحيح" }, { status: 400 });
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const me = await requireUser();
        let p: any = {};
        try { p = JSON.parse(clientPayload || "{}"); } catch {}
        const used = await storageUsed();
        let left = SAFE_LIMIT - used.total;
        if (p.kind === "backup") {
          if (me.role !== "admin") throw new ApiError("للمدير فقط", 403);
          if (!pathname.startsWith("backups/upload/")) throw new ApiError("مسار غير صحيح", 400);
          return { maximumSizeInBytes: Math.max(1, Math.min(200 * 1024 * 1024, left)), addRandomSuffix: true };
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
        return {
          allowedContentTypes: ["audio/*", "video/*", "application/octet-stream"],
          maximumSizeInBytes: Math.min(MAX_FILE, left),
          addRandomSuffix: true,
          validUntil: Date.now() + 3 * 3600 * 1000,
        };
      },
    });
    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "تعذّر الرفع" }, { status: e instanceof ApiError ? e.status : 400 });
  }
}

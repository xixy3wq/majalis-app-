import { prisma } from "@/lib/db";
import { handle, requireUser, text } from "@/lib/auth";
export const dynamic = "force-dynamic";

// تعديل «عرّف بنفسك وطلابك» اللي يستخدمه الذكاء الاصطناعي
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const b = await req.json().catch(() => ({}));
    const data: Record<string, string> = {};
    if (typeof b.about === "string") data.about = text(b.about, 600).trim();
    if (typeof b.name === "string" && b.name.trim()) data.name = text(b.name, 60).trim();
    if (Object.keys(data).length) await prisma.user.update({ where: { id: me.id }, data });
    return { ok: true };
  });
}

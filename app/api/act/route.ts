import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { fail, handle, ID_RE, requireUser, text } from "@/lib/auth";
export const dynamic = "force-dynamic";

const META = ["sheikh", "topic", "date", "time", "place", "opening", "briefing", "books", "general"] as const;
const GROUPS = ["core", "ask", "spare"];

async function ownMajlis(userId: string, id: string) {
  const m = await prisma.majlis.findFirst({ where: { id: String(id || ""), userId }, select: { id: true } });
  if (!m) fail("ما لقيت هذا المجلس", 404);
  return m!;
}
async function ownQuestion(userId: string, id: string) {
  const q = await prisma.question.findFirst({ where: { id: String(id || ""), majlis: { userId } }, select: { id: true } });
  if (!q) fail("ما لقيت هذا السؤال", 404);
  return q!;
}
function metaFields(f: any) {
  const data: Record<string, string> = {};
  for (const k of META) if (f && typeof f[k] === "string") data[k] = text(f[k], k === "sheikh" || k === "topic" || k === "place" ? 300 : k === "date" ? 10 : k === "time" ? 5 : 40000);
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) data.date = "";
  if (data.time && !/^\d{2}:\d{2}$/.test(data.time)) data.time = "";
  if ("sheikh" in data && !data.sheikh.trim()) delete data.sheikh;
  return data;
}
function qFields(f: any) {
  const data: Record<string, unknown> = {};
  if (!f) return data;
  if (typeof f.text === "string" && f.text.trim()) data.text = text(f.text, 4000);
  if (typeof f.why === "string") data.why = text(f.why, 1000);
  if (typeof f.group === "string" && GROUPS.includes(f.group)) data.grp = f.group;
  if (Number.isFinite(f.order)) data.pos = Math.floor(f.order);
  if (typeof f.asked === "boolean") data.asked = f.asked;
  if (typeof f.answer === "string") data.answer = text(f.answer, 40000);
  return data;
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const b = await req.json().catch(() => ({}));
    switch (b.op) {
      case "createMajlis": {
        const data = metaFields(b.fields);
        if (!data.sheikh) fail("اكتب اسم الشيخ");
        const id = ID_RE.test(String(b.id || "")) ? b.id : undefined;
        const m = await prisma.majlis.create({ data: { ...data, sheikh: data.sheikh, userId: me.id, ...(id ? { id } : {}) } });
        return { id: m.id };
      }
      case "updateMajlis": {
        await ownMajlis(me.id, b.id);
        const data = metaFields(b.fields);
        if (Object.keys(data).length) await prisma.majlis.update({ where: { id: b.id }, data });
        return { ok: true };
      }
      case "share": {
        await ownMajlis(me.id, b.id);
        if (!b.on) {
          await prisma.majlis.update({ where: { id: b.id }, data: { shareToken: null } });
          return { token: null };
        }
        const cur = await prisma.majlis.findUnique({ where: { id: b.id }, select: { shareToken: true } });
        if (cur?.shareToken) return { token: cur.shareToken };
        const token = randomBytes(18).toString("base64url");
        await prisma.majlis.update({ where: { id: b.id }, data: { shareToken: token } });
        return { token };
      }
      case "deleteMajlis": {
        await ownMajlis(me.id, b.id);
        await prisma.majlis.delete({ where: { id: b.id } });
        return { ok: true };
      }
      case "deleteMajlisMany": {
        const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 500) : [];
        const r = await prisma.majlis.deleteMany({ where: { id: { in: ids }, userId: me.id } });
        return { n: r.count };
      }
      case "deleteQMany": {
        const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 500) : [];
        const r = await prisma.question.deleteMany({ where: { id: { in: ids }, majlis: { userId: me.id } } });
        return { n: r.count };
      }
      case "addQ": {
        await ownMajlis(me.id, b.majlisId);
        const d = qFields(b.fields);
        if (!d.text) fail("اكتب السؤال");
        const id = ID_RE.test(String(b.id || "")) ? b.id : undefined;
        const exists = id ? await prisma.question.findUnique({ where: { id }, select: { id: true } }) : null;
        if (exists) return { id };
        const q = await prisma.question.create({ data: { ...(d as any), majlisId: b.majlisId, ...(id ? { id } : {}) } });
        return { id: q.id };
      }
      case "updateQ": {
        await ownQuestion(me.id, b.id);
        const d = qFields(b.fields);
        if (Object.keys(d).length) await prisma.question.update({ where: { id: b.id }, data: d });
        return { ok: true };
      }
      case "deleteQ": {
        const q = await prisma.question.findFirst({ where: { id: String(b.id || ""), majlis: { userId: me.id } }, select: { id: true } });
        if (q) await prisma.question.delete({ where: { id: q.id } });
        return { ok: true };
      }
      default:
        fail("طلب غير معروف");
    }
  });
}

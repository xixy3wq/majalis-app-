import { prisma } from "@/lib/db";
import { fail, handle, requireUser, text } from "@/lib/auth";
import { aiReady, askClaude } from "@/lib/claude";
import { dailyLimit, usedToday } from "@/lib/limits";
import {
  BRIEF_SYSTEM, PLAN_SYSTEM, RESEARCH_SYSTEM, briefPrompt, buildBriefing, buildOpening, buildQuestions,
  extractJson, planPrompt, researchPrompt, type Brief, type Plan, type Research,
} from "@/lib/gen";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// توليد جلسة على مراحل، كل مرحلة طلب مستقل (عشان ما يطول الطلب الواحد):
// start (بحث في الإنترنت) ← brief (تحليل الشخصية) ← plan (الافتتاح والأسئلة) ← save (إنشاء الجلسة)
function parse<T>(raw: string, what: string): T {
  try { return extractJson<T>(raw); } catch { fail(`ما قدرت أقرأ نتيجة ${what}، جرّب الخطوة مرة ثانية`, 502); }
  return {} as T;
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    if (!aiReady()) fail("الذكاء الاصطناعي غير مفعّل: صاحب الموقع لازم يضيف مفتاح Claude API", 503);
    if (me.role !== "admin" && !me.aiAllowed) fail("حسابك بانتظار موافقة المدير لاستخدام الذكاء الاصطناعي", 403);
    const b = await req.json().catch(() => ({}));

    if (b.op === "start") {
      const sheikh = text(b.sheikh, 120).trim();
      if (sheikh.length < 3) fail("اكتب اسم الشيخ");
      if (me.role !== "admin") {
        const [lim, used] = [await dailyLimit(), await usedToday(me.id)];
        if (used >= lim) fail(lim === 0 ? "التوليد موقوف حاليًا" : `وصلت حدك اليومي (${lim} جلسات). جرّب بكرة`, 429);
      }
      const job = await prisma.aiJob.create({ data: { userId: me.id, sheikh, hint: text(b.hint, 200).trim(), topic: text(b.topic, 300).trim(), status: "new" } });
      return await research(job.id, me.id);
    }

    // إعادة تجهيز جلسة موجودة (من نفس البحث المحفوظ، بدون بحث جديد): redoBrief ثم redoPlan
    if (b.op === "redoBrief" || b.op === "redoPlan") {
      const m = await prisma.majlis.findFirst({ where: { id: String(b.majlisId || ""), userId: me.id }, include: { questions: true } });
      if (!m) fail("ما لقيت هذا المجلس", 404);
      const jj = await prisma.aiJob.findFirst({ where: { majlisId: m!.id, userId: me.id }, orderBy: { createdAt: "desc" } });
      if (!jj || !jj.research) fail("هذي الجلسة ما انجهّزت بالذكاء الاصطناعي، فما عندي بحث عن الشيخ أعيد منه", 400);
      const r = jj!.research as Research;
      if (b.op === "redoBrief") {
        const out = await askClaude({ system: BRIEF_SYSTEM, prompt: briefPrompt(r, m!.topic, me.about), maxTokens: 6000, deadlineMs: 240000 });
        const brief = parse<Brief>(out.text, "تحليل الشخصية");
        await prisma.aiJob.update({ where: { id: jj!.id }, data: { brief: brief as any } });
        await prisma.majlis.update({ where: { id: m!.id }, data: { briefing: buildBriefing(r, brief) } });
        return { ok: true };
      }
      const out = await askClaude({ system: PLAN_SYSTEM, prompt: planPrompt(r, (jj!.brief || {}) as Brief, m!.topic, me.about), maxTokens: 7000, deadlineMs: 240000 });
      const plan = parse<Plan>(out.text, "خطة الجلسة");
      const qs = buildQuestions(plan);
      if (!qs.length) fail("ما طلعت أسئلة، جرّب مرة ثانية", 502);
      // نبقي الأسئلة اللي سألها أو كتب جوابها، ونستبدل الباقي
      const keep = m!.questions.filter((q) => q.asked || q.answer.trim());
      const drop = m!.questions.filter((q) => !(q.asked || q.answer.trim())).map((q) => q.id);
      const base: Record<string, number> = {};
      keep.forEach((q) => { base[q.grp] = Math.max(base[q.grp] ?? -1, q.pos); });
      await prisma.$transaction([
        prisma.question.deleteMany({ where: { id: { in: drop } } }),
        prisma.question.createMany({ data: qs.map((q) => ({ majlisId: m!.id, text: q.text, why: q.why, grp: q.group, pos: (base[q.group] ?? -1) + 1 + q.order })) }),
        prisma.majlis.update({ where: { id: m!.id }, data: { opening: buildOpening(plan) } }),
        prisma.aiJob.update({ where: { id: jj!.id }, data: { plan: plan as any } }),
      ]);
      return { ok: true, kept: keep.length, added: qs.length };
    }

    const job = await prisma.aiJob.findFirst({ where: { id: String(b.id || ""), userId: me.id } });
    if (!job) fail("ما لقيت عملية التوليد", 404);
    const j = job!;
    if (b.op === "research") return await research(j.id, me.id);
    if (b.op === "brief") {
      if (!j.research) fail("ابدأ بالبحث أول");
      if (j.brief) return { id: j.id, status: "brief" };
      const out = await askClaude({ system: BRIEF_SYSTEM, prompt: briefPrompt(j.research as Research, j.topic, me.about), maxTokens: 6000, deadlineMs: 240000 });
      const brief = parse<Brief>(out.text, "تحليل الشخصية");
      await prisma.aiJob.update({ where: { id: j.id }, data: { brief: brief as any, status: "brief", error: null } });
      return { id: j.id, status: "brief" };
    }
    if (b.op === "plan") {
      if (!j.research || !j.brief) fail("كمّل الخطوات اللي قبل أول");
      if (j.plan) return { id: j.id, status: "plan" };
      const out = await askClaude({ system: PLAN_SYSTEM, prompt: planPrompt(j.research as Research, j.brief as Brief, j.topic, me.about), maxTokens: 6000, deadlineMs: 240000 });
      const plan = parse<Plan>(out.text, "الأسئلة");
      if (!buildQuestions(plan).length) fail("ما طلعت أسئلة، جرّب الخطوة مرة ثانية", 502);
      await prisma.aiJob.update({ where: { id: j.id }, data: { plan: plan as any, status: "plan", error: null } });
      return { id: j.id, status: "plan" };
    }
    if (b.op === "save") {
      if (j.majlisId) return { id: j.id, status: "saved", majlisId: j.majlisId };
      if (!j.research || !j.brief || !j.plan) fail("كمّل الخطوات اللي قبل أول");
      const r = j.research as Research, plan = j.plan as Plan;
      const sheikhName = (String(r.name || "").trim() || j.sheikh).slice(0, 120);
      const m = await prisma.majlis.create({
        data: {
          userId: me.id, sheikh: /^(الشيخ|د\.|الدكتور)/.test(sheikhName) ? sheikhName : "الشيخ " + sheikhName,
          topic: j.topic, opening: buildOpening(plan), briefing: buildBriefing(r, j.brief as Brief),
          questions: { create: buildQuestions(plan).map((q) => ({ text: q.text, why: q.why, grp: q.group, pos: q.order })) },
        },
      });
      await prisma.aiJob.update({ where: { id: j.id }, data: { majlisId: m.id, status: "saved" } });
      return { id: j.id, status: "saved", majlisId: m.id };
    }
    fail("طلب غير معروف");
  });
}

async function research(id: string, userId: string) {
  const j = await prisma.aiJob.findFirst({ where: { id, userId } });
  if (!j) fail("ما لقيت عملية التوليد", 404);
  if (j!.research) return { id, status: "research", preview: preview(j!.research as Research) };
  try {
    const out = await askClaude({ system: RESEARCH_SYSTEM, prompt: researchPrompt(j!.sheikh, j!.hint, j!.topic), maxTokens: 8000, webSearch: 8, deadlineMs: 270000 });
    const r = parse<Research>(out.text, "البحث");
    if (r.found === false && !(r.bio || []).length) fail("ما لقيت معلومات كافية عن هذا الشيخ. جرّب تكتب اسمه كامل أو معلومة تميّزه", 422);
    await prisma.aiJob.update({ where: { id, }, data: { research: r as any, status: "research", error: null } });
    return { id, status: "research", preview: preview(r) };
  } catch (e: any) {
    await prisma.aiJob.update({ where: { id }, data: { error: String(e?.message || e).slice(0, 300) } }).catch(() => {});
    throw e;
  }
}

function preview(r: Research) {
  return { name: r.name || "", identity: r.identity || "", namesakes: r.namesakes || "", sources: (r.sources || []).length };
}

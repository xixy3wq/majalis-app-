import { prisma } from "@/lib/db";
import { fail, handle, requireUser, text } from "@/lib/auth";
import { aiReady, askClaude } from "@/lib/claude";
import { extractJson } from "@/lib/gen";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// أدوات الذكاء الاصطناعي على جلسات المستخدم نفسه فقط:
// tidy (ترتيب جواب) · guidance (استخراج التوجيهات) · next (أسئلة للمجلس الجاي) · thanks (رسالة شكر) · ask (اسأل دفترك)
const TOOL_LIMIT = 40; // لكل مستخدم في اليوم (المدير بدون حد)
const ORDER: Record<string, number> = { core: 0, ask: 1, spare: 2 };
const STYLE = "اكتب بالعربية الفصحى المبسطة القريبة من كلام أهل السعودية، بجمل قصيرة وواضحة، بدون مبالغة ولا زخرفة ولا رموز تعبيرية.";

async function gate(me: any) {
  if (!aiReady()) fail("الذكاء الاصطناعي غير مفعّل: صاحب الموقع لازم يضيف مفتاح Claude API", 503);
  if (me.role !== "admin" && !me.aiAllowed) fail("حسابك بانتظار موافقة المدير لاستخدام الذكاء الاصطناعي", 403);
  if (me.role !== "admin") {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const n = await prisma.aiJob.count({ where: { userId: me.id, status: "tool", createdAt: { gte: since } } });
    if (n >= TOOL_LIMIT) fail("وصلت حدك اليومي من أدوات الذكاء الاصطناعي، جرّب بكرة", 429);
  }
}
async function logUse(me: any, op: string) {
  await prisma.aiJob.create({ data: { userId: me.id, sheikh: "أداة: " + op, status: "tool" } }).catch(() => {});
}
async function ownMajlis(userId: string, id: string) {
  const m = await prisma.majlis.findFirst({ where: { id: String(id || ""), userId }, include: { questions: true } });
  if (!m) fail("ما لقيت هذا المجلس", 404);
  m!.questions.sort((a, b) => (ORDER[a.grp] ?? 0) - (ORDER[b.grp] ?? 0) || a.pos - b.pos);
  return m!;
}
function majlisText(m: any, withIds = false) {
  const lines = [`المجلس${withIds ? ` [${m.id}]` : ""}: مع ${m.sheikh}` + (m.date ? ` بتاريخ ${m.date}` : "") + (m.topic ? `، الموضوع: ${m.topic}` : "")];
  m.questions.forEach((q: any, i: number) => {
    lines.push(`${withIds ? `(سؤال ${q.id}) ` : `${i + 1}. `}${q.text}`);
    if (q.answer.trim()) lines.push("الجواب: " + q.answer.trim());
  });
  if (m.general.trim()) lines.push("الفوائد المكتوبة: " + m.general.trim());
  if (m.books.trim()) lines.push("الكتب والآثار: " + m.books.trim());
  return lines.join("\n");
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await gate(me);
    const b = await req.json().catch(() => ({}));

    if (b.op === "tidy") {
      const q = await prisma.question.findFirst({ where: { id: String(b.qid || ""), majlis: { userId: me.id } }, include: { majlis: true } });
      if (!q) fail("ما لقيت السؤال", 404);
      const ans = text(b.answer ?? q!.answer, 20000).trim();
      if (!ans) fail("ما فيه جواب مكتوب أرتّبه");
      await logUse(me, "tidy");
      const out = await askClaude({
        system: "أنت تساعد مشرفًا تربويًا يرتّب ما كتبه بسرعة أثناء مجلس مع شيخ. رتّب الجواب في نقاط قصيرة تبدأ كل نقطة بـ «- »، وصحّح الإملاء والترقيم. لا تضف أي معلومة ليست في النص، ولا تحذف معلومة، ولا تغيّر المعنى. أبقِ ما بين علامات التنصيص «» كما هو حرفيًا. " + STYLE + " أعد النص المرتّب فقط بدون أي مقدمة.",
        prompt: `السؤال: ${q!.text}\n\nالجواب كما كُتب:\n${ans}`,
        maxTokens: 3000, deadlineMs: 100000,
      });
      return { answer: out.text.trim() };
    }

    if (b.op === "guidance" || b.op === "next" || b.op === "thanks") {
      const m = await ownMajlis(me.id, b.id);
      if (!m.questions.some((q) => q.answer.trim()) && !m.general.trim()) fail("اكتب أجوبة الشيخ أول، بعدين استخدم هذي الأداة");
      await logUse(me, b.op);
      const body = majlisText(m);
      if (b.op === "guidance") {
        const out = await askClaude({
          system: "استخرج التوجيهات العملية اللي قالها الشيخ في هذا المجلس، من أجوبته فقط. كل توجيه سطر واحد يبدأ بـ «- »، يبدأ بفعل أو بنصيحة واضحة قابلة للتطبيق مع الطلاب. لا تكرر ما هو موجود في «الفوائد المكتوبة»، ولا تضف شيئًا لم يقله الشيخ. " + STYLE + " أعد الأسطر فقط.",
          prompt: body, maxTokens: 2500, deadlineMs: 100000,
        });
        return { lines: out.text.trim() };
      }
      if (b.op === "thanks") {
        const out = await askClaude({
          system: "اكتب رسالة شكر قصيرة على واتساب من طالب علم إلى الشيخ بعد مجلس معه. تبدأ بـ «السلام عليكم ورحمة الله وبركاته» وتخاطبه بـ «فضيلة الشيخ» واسمه. 4 إلى 6 أسطر: شكر على وقته، ثم فائدتين أو ثلاث محددة استفادها من المجلس بكلمات قريبة من كلام الشيخ، ثم دعاء قصير. بدون مبالغة في المدح. " + STYLE + " أعد نص الرسالة فقط.",
          prompt: body, maxTokens: 1200, deadlineMs: 80000,
        });
        return { text: out.text.trim() };
      }
      const out = await askClaude({
        system: "اقترح أسئلة لمجلس قادم مع نفس الشيخ، مبنية على أجوبته في هذا المجلس: أسئلة متابعة تعمّق ما قاله، أو توضّح ما بقي مجملًا، أو تسأل عن التطبيق العملي مع طلاب المرحلة المتوسطة. 6 إلى 8 أسئلة، كل سؤال جملة أو جملتين، ولا تجمع سؤالين في سؤال. " + STYLE +
          ' أعد JSON فقط بهذا الشكل: {"questions":[{"text":"السؤال","why":"سبب قصير مرتبط بما قاله في المجلس"}]}',
        prompt: body, maxTokens: 2500, deadlineMs: 100000,
      });
      let qs: any[] = [];
      try { qs = (extractJson<any>(out.text).questions || []).filter((x: any) => x && typeof x.text === "string" && x.text.trim()).slice(0, 10); } catch {}
      if (!qs.length) fail("ما طلعت أسئلة، جرّب مرة ثانية", 502);
      return { questions: qs.map((x) => ({ text: String(x.text).trim(), why: String(x.why || "").trim() })), sheikh: m.sheikh, topic: m.topic };
    }

    if (b.op === "ask") {
      const question = text(b.question, 600).trim();
      if (question.length < 3) fail("اكتب سؤالك");
      const rows = await prisma.majlis.findMany({ where: { userId: me.id }, include: { questions: true }, orderBy: { date: "desc" } });
      if (!rows.length) fail("ما فيه جلسات في دفترك بعد");
      let total = 0;
      const parts: string[] = [];
      for (const m of rows) {
        m.questions.sort((a, c) => (ORDER[a.grp] ?? 0) - (ORDER[c.grp] ?? 0) || a.pos - c.pos);
        const t = majlisText(m, true);
        if (total + t.length > 160000) break;
        parts.push(t); total += t.length;
      }
      await logUse(me, "ask");
      const out = await askClaude({
        system: "أنت مساعد يجاوب من دفتر مجالس المستخدم مع المشايخ فقط. لا تجاوب من معلوماتك العامة. " +
          "إذا سأل وين قيلت فائدة أو كلمة، حدد المجلس والشيخ والسؤال اللي جاءت تحته. " +
          "بعد كل معلومة تأخذها من الدفتر ضع مرجعها بهذا الشكل بالضبط: [[q:رقم_المجلس~رقم_السؤال]] إذا كانت من جواب سؤال، أو [[s:رقم_المجلس]] إذا كانت من الفوائد أو الكتب. الأرقام هي اللي بين الأقواس المربعة والقوسين في الدفتر. " +
          "انقل كلام الشيخ كما هو بين «» إذا طلب النص. إذا ما لقيت الجواب في الدفتر قل ذلك بوضوح ولا تخمّن. " + STYLE + " اجعل الجواب قصيرًا ومرتبًا، ونقاطًا تبدأ بـ «- » إذا كانت أكثر من معلومة.",
        prompt: "الدفتر:\n\n" + parts.join("\n\n---\n\n") + "\n\n===\nسؤال المستخدم: " + question,
        maxTokens: 2500, deadlineMs: 110000,
      });
      const refs: Record<string, string> = {};
      rows.forEach((m) => { refs[m.id] = m.sheikh + (m.date ? " · " + m.date : ""); });
      return { answer: out.text.trim(), refs };
    }
    fail("طلب غير معروف");
  });
}

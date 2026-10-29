import { prisma } from "@/lib/db";
import { fail, handle, requireUser, text } from "@/lib/auth";
import { aiReady, askClaude, streamClaude } from "@/lib/claude";
import { extractJson } from "@/lib/gen";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// أدوات الذكاء الاصطناعي على جلسات المستخدم نفسه فقط:
// tidy (ترتيب جواب) · guidance (استخراج التوجيهات) · next (أسئلة للمجلس الجاي) · thanks (رسالة شكر) · ask (اسأل دفترك) · chat (سولف مع دفترك، رد متدفق)
const TOOL_LIMIT = 60; // لكل مستخدم في اليوم، وكل رسالة في المحادثة تنحسب (المدير بدون حد)
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

// ---------- سولف مع دفترك ----------
const riyadhToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const normAr = (s: string) => s.replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const sheikhKey = (name: string) => normAr(String(name || "").replace(/^\s*(فضيلة\s+)?(الشيخ|الدكتور|أ\.\s*د\.|د\.)\s*/, "")).replace(/\s+/g, " ").trim() || "بدون اسم";
const hasContent = (m: any) => m.general.trim() || m.books.trim() || m.questions.some((q: any) => q.answer.trim());
const nAr = (n: number, one: string, two: string, few: string, many: string) => (n === 0 ? "لا " + one : n === 1 ? one + " واحد" : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);

function notebookFor(me: any, rows: any[]) {
  const today = riyadhToday();
  const attended = (m: any) => (m.date ? m.date <= today : !!hasContent(m));
  const att = rows.filter(attended);
  const up = rows.filter((m) => m.date && m.date > today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const noDate = rows.filter((m) => !m.date);
  const attDates = att.map((m) => m.date).filter(Boolean).sort();
  // المشايخ
  const g: Record<string, { name: string; all: any[]; att: any[] }> = {};
  rows.forEach((m) => { const k = sheikhKey(m.sheikh); (g[k] = g[k] || { name: m.sheikh || "بدون اسم", all: [], att: [] }).all.push(m); if (attended(m)) g[k].att.push(m); });
  const sheikhs = Object.values(g).sort((a, b) => b.att.length - a.att.length || b.all.length - a.all.length);
  // الأسئلة
  let qAll = 0, qAns = 0, qAsked = 0;
  rows.forEach((m) => m.questions.forEach((q: any) => { qAll++; if (q.answer.trim()) qAns++; if (q.asked) qAsked++; }));
  const months: Record<string, number> = {};
  att.forEach((m) => { if (m.date) months[m.date.slice(0, 7)] = (months[m.date.slice(0, 7)] || 0) + 1; });

  const st: string[] = [];
  st.push(`اليوم: ${today} (بتوقيت الرياض)`);
  st.push(`صاحب الدفتر: ${me.name}` + (me.about?.trim() ? `، ويعرّف بنفسه: ${me.about.trim().slice(0, 600)}` : ""));
  st.push(`عدد الجلسات في الدفتر كله: ${rows.length}`);
  st.push(`المجالس اللي حضرها: ${att.length}` + (attDates.length ? ` (أولها ${attDates[0]}، وآخرها ${attDates[attDates.length - 1]})` : "") +
    " — المقصود: جلسة تاريخها مضى أو اليوم، أو بلا تاريخ ومكتوب فيها أجوبة أو فوائد");
  st.push(`المجالس القادمة: ${up.length}` + (up.length ? ` (أقربها مع ${up[0].sheikh} يوم ${up[0].date}${up[0].time ? " الساعة " + up[0].time : ""})` : ""));
  if (noDate.length) st.push(`جلسات بلا تاريخ: ${noDate.length}`);
  st.push(`عدد المشايخ: ${sheikhs.length}`);
  sheikhs.forEach((x) => st.push(`- ${x.name}: حضر معه ${x.att.length} من ${x.all.length}` + (x.all.some((m) => m.date) ? ` (التواريخ: ${x.all.map((m) => m.date || "بلا تاريخ").sort().join("، ")})` : "")));
  st.push(`الأسئلة: المجموع ${qAll}، المكتوب لها جواب ${qAns}، المعلّم عليها «انسأل» ${qAsked}`);
  const mk = Object.keys(months).sort();
  if (mk.length) st.push("المجالس اللي حضرها حسب الشهر: " + mk.map((k) => `${k}: ${months[k]}`).join("، "));

  let total = 0, cut = 0;
  const parts: string[] = [];
  for (const m of rows) {
    m.questions.sort((a: any, c: any) => (ORDER[a.grp] ?? 0) - (ORDER[c.grp] ?? 0) || a.pos - c.pos);
    const head = `المجلس [${m.id}]: مع ${m.sheikh}` + (m.date ? ` بتاريخ ${m.date}` : " بلا تاريخ") + (m.time ? ` الساعة ${m.time}` : "") +
      (m.place ? ` في ${m.place}` : "") + (m.topic ? `، الموضوع: ${m.topic}` : "") + (attended(m) ? " (حضره)" : m.date ? " (قادم)" : " (لم يُكتب فيه شيء بعد)");
    const lines = [head];
    if (m.briefing.trim()) lines.push("نبذة عن الشيخ: " + m.briefing.trim().replace(/\s+/g, " ").slice(0, 700));
    m.questions.forEach((q: any) => {
      lines.push(`(سؤال ${q.id})${q.asked ? " [انسأل]" : ""} ${q.text}`);
      if (q.answer.trim()) lines.push("الجواب: " + q.answer.trim());
    });
    if (m.general.trim()) lines.push("الفوائد والتوجيهات المكتوبة: " + m.general.trim());
    if (m.books.trim()) lines.push("الكتب والآثار: " + m.books.trim());
    let t = lines.join("\n");
    if (total + t.length > 150000) { t = head + " — (تفاصيله ما دخلت لطول الدفتر)"; cut++; }
    parts.push(t); total += t.length;
  }
  return "الإحصاءات (محسوبة بدقة من الدفتر، استخدمها كما هي):\n" + st.join("\n") +
    (cut ? `\n\nتنبيه: ${cut} من الجلسات القديمة دخلت بعناوينها فقط لأن الدفتر طويل.` : "") +
    "\n\n===\nالدفتر (الأحدث أولًا):\n\n" + parts.join("\n\n---\n\n");
}

const CHAT_RULES = "أنت مساعد داخل موقع «دفتر مجالس المشايخ». تسولف مع صاحب الدفتر عن مجالسه مع المشايخ: تجاوبه، وتعطيه رأيك إذا طلبه، وتكمل معه السالفة. " +
  "قواعدك:\n" +
  "1. مصدرك الأول الدفتر المرفق. الأرقام (كم مجلس حضر، كم سؤال، مع مين أكثر، كم شيخ) خذها من «الإحصاءات» كما هي ولا تعدّ بنفسك. إذا سأل كم حضر وفيه جلسات بلا تاريخ أو قادمة، وضّح الأساس في جملة.\n" +
  "2. بعد كل معلومة تأخذها من الدفتر ضع مرجعها بهذا الشكل بالضبط: [[q:رقم_المجلس~رقم_السؤال]] إذا كانت من جواب سؤال، أو [[s:رقم_المجلس]] إذا كانت من الفوائد أو الكتب أو بيانات المجلس. الأرقام هي اللي بين الأقواس المربعة والقوسين في الدفتر. مرجع واحد لكل معلومة يكفي، ولا تكتب الأرقام بأي شكل ثاني.\n" +
  "3. لا تنسب لشيخ كلامًا غير مكتوب في الدفتر. إذا نقلت كلامه فبين «» كما هو.\n" +
  "4. إذا طلب رأيك (وش رايك، وش أفضل فائدة، وش أنفع مجلس، وش أركز عليه) فاختر فعلًا وأعطه رأيًا واضحًا ومحددًا مع السبب في جملة أو جملتين، ولا تقل «كلها مفيدة». وإذا أضفت شيئًا من معلوماتك العامة أو رأيك فقدّمه بعبارة «من عندي:» عشان يفرّق بينه وبين كلام المشايخ.\n" +
  "5. لا تفتِ في المسائل الشرعية من عندك. اذكر ما قاله المشايخ في الدفتر، وإن لم يوجد فقل ذلك وانصحه يسأل أهل العلم.\n" +
  "6. إذا ما لقيت الجواب في الدفتر قل ذلك بصراحة ولا تخمّن.\n" +
  "7. السلام والشكر والسوالف القصيرة رد عليها باختصار وبشكل طبيعي.\n" +
  "8. الأسلوب: كلام سعودي مبسط وقريب، بجمل قصيرة، بدون مقدمات ولا تكرار للسؤال ولا خاتمة طويلة. إذا كانت أكثر من معلومة فنقاط تبدأ بـ «- ». بدون جداول ولا عناوين ولا رموز تعبيرية، و**الغامق** فقط لكلمة مهمة نادرًا. خاطبه بصيغة المفرد.";

function cleanHistory(raw: any): { role: "user" | "assistant"; content: string }[] {
  const arr = Array.isArray(raw) ? raw.slice(-24) : [];
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const x of arr) {
    const role = x && x.role === "assistant" ? "assistant" : x && x.role === "user" ? "user" : null;
    const content = text(x && x.content, 6000).replace(/\u0000[\s\S]*$/, "").trim();
    if (!role || !content) continue;
    if (!out.length && role === "assistant") continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += "\n\n" + content;
    else out.push({ role, content });
  }
  // حد للطول: نحتفظ بآخر المحادثة
  let sum = 0, start = out.length;
  while (start > 0 && sum + out[start - 1].content.length <= 30000) { sum += out[start - 1].content.length; start--; }
  const kept = out.slice(start);
  while (kept.length && kept[0].role !== "user") kept.shift();
  return kept;
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
    if (b.op === "chat") {
      const messages = cleanHistory(b.messages);
      if (!messages.length || messages[messages.length - 1].role !== "user") fail("اكتب رسالتك");
      const rows = await prisma.majlis.findMany({ where: { userId: me.id }, include: { questions: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
      await logUse(me, "chat");
      const notebook = rows.length ? notebookFor(me, rows) : `صاحب الدفتر: ${me.name}\nالدفتر فاضي: ما فيه ولا جلسة مسجلة بعد.`;
      const stream = await streamClaude({
        system: [{ type: "text", text: CHAT_RULES }, { type: "text", text: notebook, cache_control: { type: "ephemeral" } }],
        messages, maxTokens: 2500, deadlineMs: 110000,
      });
      return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
    }
    fail("طلب غير معروف");
  });
}

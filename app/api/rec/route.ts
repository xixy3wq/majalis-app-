import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, handle, requireUser, text } from "@/lib/auth";
import { aiReady, askClaude } from "@/lib/claude";
import { extractJson } from "@/lib/gen";
import { blobAccess, blobReady, delFiles, readUrl, rememberAccess, SAFE_LIMIT, storageUsed, uploadMode } from "@/lib/blob";
import { asrReady, deleteAsr, pollAsr, startAsr } from "@/lib/asr";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// التسجيلات الصوتية للمجالس: تجهيز الرفع، تسجيلها بعد الرفع، التفريغ، التلخيص، وإضافة الناتج للجلسة.
const MAX_FILE = 500 * 1024 * 1024;
const USER_CAP = 150 * 1024 * 1024; // لغير المدير
const ASR_PER_DAY = 3; // لغير المدير
const ORDER: Record<string, number> = { core: 0, ask: 1, spare: 2 };
const STYLE = "اكتب بالعربية الفصحى المبسطة القريبة من كلام أهل السعودية، بجمل قصيرة وواضحة، بدون مبالغة ولا زخرفة ولا رموز تعبيرية.";

const canRec = (me: any) => me.role === "admin" || me.aiAllowed;
async function ownMajlis(userId: string, id: string) {
  const m = await prisma.majlis.findFirst({ where: { id: String(id || ""), userId }, include: { questions: true } });
  if (!m) fail("ما لقيت هذا المجلس", 404);
  return m!;
}
async function ownRec(userId: string, id: string) {
  const r = await prisma.recording.findFirst({ where: { id: String(id || ""), userId } });
  if (!r) fail("ما لقيت التسجيل", 404);
  return r!;
}
async function room(me: any) {
  const used = await storageUsed();
  let left = SAFE_LIMIT - used.total;
  if (me.role !== "admin") {
    const mine = await prisma.recording.aggregate({ where: { userId: me.id }, _sum: { size: true } });
    left = Math.min(left, USER_CAP - Number(mine._sum.size || 0));
  }
  return { left: Math.max(0, left), used };
}
const stale = (r: any) => Date.now() - new Date(r.updatedAt).getTime() > 6 * 60 * 1000;

async function view(r: any, withPlay = true) {
  let play = "";
  if (withPlay && r.url) { try { play = await readUrl(r.url, r.pathname); } catch (e) { console.error("readUrl", e); play = `/api/rec/audio?id=${r.id}`; } }
  return {
    id: r.id, name: r.name, size: r.size, seconds: r.seconds, mime: r.mime, status: r.status === "summarizing" && stale(r) ? "transcribed" : r.status,
    error: r.status === "summarizing" && stale(r) ? "تعطل التلخيص، جرّب مرة ثانية" : r.error,
    createdAt: new Date(r.createdAt).getTime(), hasText: !!r.transcript, summary: r.status === "ready" ? r.summary : null, play, gone: !r.url,
  };
}

function sumPrompt(m: any) {
  m.questions.sort((a: any, b: any) => (ORDER[a.grp] ?? 0) - (ORDER[b.grp] ?? 0) || a.pos - b.pos);
  const qs = m.questions.map((q: any) => `(سؤال ${q.id}) ${q.text}` + (q.answer.trim() ? `\n  (مكتوب عنده سابقًا: ${q.answer.trim().slice(0, 600)})` : "")).join("\n");
  return `المجلس مع: ${m.sheikh}` + (m.topic ? `\nالموضوع: ${m.topic}` : "") + (m.date ? `\nالتاريخ: ${m.date}` : "") +
    `\n\nالأسئلة المحضّرة:\n${qs || "(ما فيه أسئلة محضّرة)"}`;
}
const SUM_RULES =
  "أنت تساعد مشرفًا تربويًا سجّل مجلسه مع شيخ. أمامك تفريغ آلي للتسجيل، مقسم على متكلمين (A وB…) مع وقت كل كلام، وفيه أخطاء تفريغ. مهمتك توزيع كلام الشيخ على أسئلة الجلسة.\n" +
  "القواعد:\n" +
  "1. حدّد أي متكلم هو الشيخ: غالبًا صاحب الأجوبة الطويلة. لا تنسب للشيخ كلام غيره أبدًا، ولا تخلط كلام الحاضرين بكلامه. إذا كان تقسيم المتكلمين غير دقيق فاعتمد على المعنى.\n" +
  "2. صحّح أخطاء التفريغ الواضحة من السياق (الآيات والأحاديث وأسماء الكتب والأعلام)، ولا تضف معلومة لم تُقل.\n" +
  "3. answers: لكل سؤال محضّر انسأل فعلًا في التسجيل وجاوب عليه الشيخ، اكتب جوابه نقاطًا تبدأ كل نقطة بـ «- »، بألفاظ الشيخ قدر الإمكان، والعبارات المهمة حرفيًا بين «». qid هو رقم السؤال كما في القائمة. at وقت بداية الجواب كما في التفريغ. لا تكتب سؤالًا لم يُجب عنه.\n" +
  "4. extra: الأسئلة اللي انسألت وليست في القائمة (من المستخدم أو الحاضرين)، مع جواب الشيخ بنفس الطريقة.\n" +
  "5. guidance: التوجيهات العملية اللي قالها الشيخ، كل توجيه جملة واحدة تبدأ بفعل.\n" +
  "6. books: الكتب والمراجع اللي ذكرها الشيخ (اسم الكتاب ومؤلفه إن ذُكر)، كل واحد في عنصر.\n" +
  "7. summary: خلاصة المجلس في 3 إلى 6 أسطر، كل سطر يبدأ بـ «- ».\n" +
  "8. لا تكرر نفس المعلومة في أكثر من مكان، واختصر بدون ما تضيّع المعنى.\n" +
  STYLE + "\n" +
  'أعد JSON فقط بهذا الشكل: {"sheikh":"B","summary":"- …","answers":[{"qid":"…","answer":"- …","at":"12:30"}],"extra":[{"q":"…","answer":"- …","at":"…"}],"guidance":["…"],"books":["…"]}';

function cleanSummary(raw: any, qids: Set<string>) {
  const s = (v: unknown, max = 20000) => String(v ?? "").trim().slice(0, max);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const seen = new Set<string>();
  const answers = arr(raw.answers).map((a: any) => ({ qid: s(a?.qid, 60), answer: s(a?.answer), at: s(a?.at, 12) }))
    .filter((a) => qids.has(a.qid) && a.answer && !seen.has(a.qid) && seen.add(a.qid));
  const extra = arr(raw.extra).map((a: any) => ({ q: s(a?.q, 2000), answer: s(a?.answer), at: s(a?.at, 12) })).filter((a) => a.q && a.answer).slice(0, 40);
  const lines = (v: unknown) => arr(v).map((x: any) => s(x, 1000).replace(/^[-•]\s*/, "")).filter(Boolean).slice(0, 60);
  return { sheikh: s(raw.sheikh, 10), summary: s(raw.summary, 4000), answers, extra, guidance: lines(raw.guidance), books: lines(raw.books) };
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const b = await req.json().catch(() => ({}));
    const op = String(b.op || "");

    if (op === "list") {
      const m = await prisma.majlis.findFirst({ where: { id: String(b.majlisId || ""), userId: me.id }, select: { id: true } });
      if (!m) fail("ما لقيت هذا المجلس", 404);
      const recs = await prisma.recording.findMany({ where: { majlisId: m!.id, userId: me.id }, orderBy: { createdAt: "asc" } });
      const out = [];
      for (const r of recs) out.push(await view(r));
      return { recs: out, store: blobReady(), asr: asrReady(), ai: aiReady() && canRec(me), can: canRec(me) };
    }

    if (op === "prepare") {
      if (!blobReady()) fail("التسجيل يحتاج تفعيل مخزن الملفات من صاحب الموقع (Vercel ← Storage ← Blob)", 503);
      if (!canRec(me)) fail("التسجيل يحتاج موافقة المدير على استخدام الذكاء الاصطناعي في حسابك", 403);
      const size = Math.max(0, Number(b.size) || 0);
      if (size > MAX_FILE) fail("الملف أكبر من ٥٠٠ ميجا");
      const r = await room(me);
      if (size > r.left) fail(me.role === "admin" ? "مساحة التخزين قربت تخلص. احذف تسجيلات قديمة بعد ما تفرّغها" : "وصلت حدك من مساحة التسجيلات. احذف تسجيلات قديمة بعد ما تفرّغها", 413);
      if (b.kind === "backup") {
        if (me.role !== "admin") fail("للمدير فقط", 403);
        return { prefix: "backups/upload/", access: await blobAccess(), mode: uploadMode() };
      }
      const m = await ownMajlis(me.id, b.majlisId);
      return { prefix: `rec/${me.id}/${m.id}/`, access: await blobAccess(), mode: uploadMode() };
    }

    if (op === "add") {
      if (!canRec(me)) fail("ما عندك صلاحية التسجيل", 403);
      const m = await ownMajlis(me.id, b.majlisId);
      const url = text(b.url, 2000), pathname = text(b.pathname, 1000);
      let u: URL | null = null;
      try { u = new URL(url); } catch {}
      if (!u || u.protocol !== "https:" || !/\.blob\.vercel-storage\.com$/i.test(u.hostname)) fail("رابط الملف غير صحيح");
      if (!pathname.startsWith(`rec/${me.id}/${m.id}/`) || decodeURIComponent(u!.pathname.slice(1)) !== pathname) fail("مسار الملف غير صحيح");
      const dup = await prisma.recording.findFirst({ where: { url } });
      if (dup) return { rec: await view(dup) };
      await rememberAccess(url);
      const r = await prisma.recording.create({
        data: {
          majlisId: m.id, userId: me.id, url, pathname, size: Math.max(0, Math.floor(Number(b.size) || 0)),
          seconds: Math.max(0, Math.floor(Number(b.seconds) || 0)), mime: text(b.mime, 100), name: text(b.name, 200) || "تسجيل",
        },
      });
      return { rec: await view(r) };
    }

    if (op === "del") {
      const r = await ownRec(me.id, b.id);
      if (r.url) await delFiles([r.url]);
      if (r.asrId && r.status === "transcribing") await deleteAsr(r.asrId);
      await prisma.recording.delete({ where: { id: r.id } });
      return { ok: true };
    }

    if (op === "transcript") {
      const r = await ownRec(me.id, b.id);
      return { text: r.transcript };
    }

    if (op === "transcribe") {
      if (!asrReady()) fail("التفريغ يحتاج مفتاح AssemblyAI من صاحب الموقع (ASSEMBLYAI_API_KEY في Vercel)", 503);
      if (!canRec(me)) fail("ما عندك صلاحية التفريغ", 403);
      const r = await ownRec(me.id, b.id);
      if (!r.url) fail("الملف الصوتي محذوف");
      if (r.status === "transcribing" && r.asrId) return { rec: await view(r, false) };
      if (me.role !== "admin") {
        const since = new Date(Date.now() - 24 * 3600 * 1000);
        const n = await prisma.recording.count({ where: { userId: me.id, asrId: { not: null }, updatedAt: { gte: since } } });
        if (n >= ASR_PER_DAY) fail("وصلت حدك اليومي من التفريغ، جرّب بكرة", 429);
      }
      const asrId = await startAsr(r.url, r.pathname);
      const r2 = await prisma.recording.update({ where: { id: r.id }, data: { asrId, status: "transcribing", error: "", transcript: "", summary: Prisma.DbNull } });
      return { rec: await view(r2, false) };
    }

    if (op === "poll") {
      const r = await ownRec(me.id, b.id);
      if (r.status !== "transcribing" || !r.asrId) return { rec: await view(r, false) };
      const p = await pollAsr(r.asrId);
      if (p.status === "error") {
        const r2 = await prisma.recording.update({ where: { id: r.id }, data: { status: "error", error: "ما نجح التفريغ: " + String(p.error).slice(0, 300) } });
        return { rec: await view(r2, false) };
      }
      if (p.status !== "completed") return { rec: await view(r, false), asr: p.status };
      const r2 = await prisma.recording.update({
        where: { id: r.id },
        data: { status: p.text ? "transcribed" : "error", transcript: p.text || "", error: p.text ? "" : "ما طلع كلام من التسجيل", ...(p.seconds ? { seconds: p.seconds } : {}) },
      });
      await deleteAsr(r.asrId);
      return { rec: await view(r2, false) };
    }

    if (op === "summarize") {
      if (!aiReady()) fail("الذكاء الاصطناعي غير مفعّل: صاحب الموقع لازم يضيف مفتاح Claude API", 503);
      if (!canRec(me)) fail("حسابك بانتظار موافقة المدير لاستخدام الذكاء الاصطناعي", 403);
      const r = await ownRec(me.id, b.id);
      if (!r.transcript.trim()) fail("فرّغ التسجيل أول");
      if (r.status === "summarizing" && !stale(r)) return { rec: await view(r, false), busy: true };
      const m = await ownMajlis(me.id, r.majlisId);
      await prisma.recording.update({ where: { id: r.id }, data: { status: "summarizing", error: "" } });
      try {
        const tr = r.transcript.length > 350000 ? r.transcript.slice(0, 350000) + "\n(…بقية التفريغ محذوفة لطولها)" : r.transcript;
        const out = await askClaude({ system: SUM_RULES, prompt: sumPrompt(m) + "\n\n===\nالتفريغ:\n" + tr, maxTokens: 16000, deadlineMs: 285000 });
        let raw: any;
        try { raw = extractJson(out.text); } catch { fail(out.truncated ? "التلخيص طلع طويل وانقطع، جرّب مرة ثانية" : "ما قدرت أقرأ ناتج التلخيص، جرّب مرة ثانية", 502); }
        const summary = cleanSummary(raw, new Set(m.questions.map((q) => q.id)));
        const r2 = await prisma.recording.update({ where: { id: r.id }, data: { status: "ready", summary: summary as any, error: "" } });
        return { rec: await view(r2, false) };
      } catch (e: any) {
        await prisma.recording.update({ where: { id: r.id }, data: { status: "transcribed", error: String(e?.message || "تعذّر التلخيص").slice(0, 300) } }).catch(() => {});
        throw e;
      }
    }

    if (op === "apply") {
      const r = await ownRec(me.id, b.id);
      const s: any = r.summary;
      if (r.status !== "ready" || !s) fail("ما فيه ملخص جاهز");
      const m = await ownMajlis(me.id, r.majlisId);
      const pick = b.pick || {};
      const ans = new Set<string>((Array.isArray(pick.answers) ? pick.answers : []).map(String));
      const ext = new Set<number>((Array.isArray(pick.extra) ? pick.extra : []).map(Number));
      const ops: any[] = [];
      let nA = 0, nE = 0;
      for (const a of s.answers || []) {
        if (!ans.has(a.qid)) continue;
        const q = m.questions.find((x) => x.id === a.qid);
        if (!q) continue;
        const cur = q.answer.trim();
        if (cur && cur.includes(a.answer.trim())) continue;
        ops.push(prisma.question.update({ where: { id: q.id }, data: { asked: true, answer: cur ? cur + "\n\nمن التسجيل:\n" + a.answer : a.answer } }));
        nA++;
      }
      let pos = m.questions.filter((q) => q.grp === "core").reduce((x, q) => Math.max(x, q.pos), -1);
      (s.extra || []).forEach((x: any, i: number) => {
        if (!ext.has(i)) return;
        ops.push(prisma.question.create({ data: { majlisId: m.id, text: x.q, answer: x.answer, asked: true, grp: "core", pos: ++pos, why: "انسأل في المجلس (من التسجيل)" } }));
        nE++;
      });
      const add: string[] = [];
      if (pick.summary && s.summary) add.push("ملخص المجلس (من التسجيل):\n" + s.summary);
      if (pick.guidance && (s.guidance || []).length) add.push("توجيهات الشيخ (من التسجيل):\n" + s.guidance.map((g: string) => "- " + g).join("\n"));
      const data: any = {};
      if (add.length) data.general = (m.general.trim() ? m.general.trim() + "\n\n" : "") + add.join("\n\n");
      if (pick.books && (s.books || []).length) {
        const have = m.books;
        const nb = s.books.filter((x: string) => !have.includes(x));
        if (nb.length) data.books = (have.trim() ? have.trim() + "\n" : "") + nb.map((x: string) => "- " + x).join("\n");
      }
      if (Object.keys(data).length) ops.push(prisma.majlis.update({ where: { id: m.id }, data }));
      ops.push(prisma.recording.update({ where: { id: r.id }, data: { status: "applied" } }));
      await prisma.$transaction(ops);
      return { ok: true, answers: nA, extra: nE, notes: !!data.general, books: !!data.books };
    }

    if (op === "storage") {
      const r = await room(me);
      return { ...r.used, left: r.left };
    }
    fail("طلب غير معروف");
  });
}

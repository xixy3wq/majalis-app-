// تفريغ الصوت عبر AssemblyAI (المفتاح ASSEMBLYAI_API_KEY في Vercel).
// الملف الخاص ينقرأ من المخزن وينرسل لـ AssemblyAI من الخادم مباشرة، فما يطلع رابطه لأحد.
import { get } from "@vercel/blob";
import { fail } from "./auth";
import { accessOfUrl } from "./blob";

const BASE = "https://api.assemblyai.com/v2";
export const asrReady = () => !!process.env.ASSEMBLYAI_API_KEY;
const key = () => process.env.ASSEMBLYAI_API_KEY || "";

async function call(path: string, init: RequestInit & { duplex?: string } = {}, ms = 30000) {
  const r = await fetch(BASE + path, { ...init, headers: { authorization: key(), ...(init.headers || {}) }, signal: AbortSignal.timeout(ms) } as any)
    .catch((e) => fail(e?.name === "TimeoutError" ? "خدمة التفريغ تأخرت في الرد، جرّب بعد شوي" : "ما قدرت أتصل بخدمة التفريغ", 502));
  const res = r as Response;
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(d?.error || res.status);
    if (res.status === 401) fail("مفتاح AssemblyAI غير صحيح. صاحب الموقع يراجعه في Vercel", 503);
    if (/balance|credit|payment|billing/i.test(msg)) fail("رصيد خدمة التفريغ خلص. صاحب الموقع يشحن من AssemblyAI", 503);
    const e: any = new Error(msg); e.asrStatus = res.status; throw e;
  }
  return d;
}

/** رابط يقدر AssemblyAI يحمّل منه: العام كما هو، والخاص نرفعه لهم من الخادم */
async function audioUrlFor(url: string, pathname: string) {
  if (accessOfUrl(url) === "public") return url;
  const g = await get(pathname || url, { access: "private" });
  if (!g || g.statusCode !== 200) fail("ما لقيت الملف الصوتي في المخزن", 404);
  const up = await call("/upload", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: (g as any).stream, duplex: "half" }, 240000);
  if (!up.upload_url) fail("ما انرفع الصوت لخدمة التفريغ", 502);
  return String(up.upload_url);
}

/** يبدأ التفريغ ويرجع رقم المهمة. يجرب أفضل إعداد، وإذا رُفض يتدرج لإعداد أبسط. */
export async function startAsr(url: string, pathname: string) {
  const audio_url = await audioUrlFor(url, pathname);
  const models = ["universal-3-5-pro", "universal-2"];
  const tries: any[] = [
    { audio_url, speech_models: models, language_code: "ar", speaker_labels: true },
    { audio_url, speech_models: models, language_detection: true, speaker_labels: true },
    { audio_url, language_code: "ar", speaker_labels: true },
    { audio_url, language_code: "ar" },
  ];
  let last: any = null;
  for (const body of tries) {
    try {
      const d = await call("/transcript", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (d.id) return String(d.id);
    } catch (e: any) {
      if (e?.asrStatus !== 400) throw e;
      last = e;
    }
  }
  fail("خدمة التفريغ رفضت الطلب: " + String(last?.message || "").slice(0, 200), 502);
  return "";
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0");
};

/** حالة التفريغ. إذا اكتمل يرجع النص مقسمًا على المتكلمين مع الوقت */
export async function pollAsr(id: string): Promise<{ status: "queued" | "processing" | "completed" | "error"; text?: string; seconds?: number; error?: string }> {
  const d = await call("/transcript/" + encodeURIComponent(id));
  if (d.status === "error") return { status: "error", error: String(d.error || "تعذّر التفريغ") };
  if (d.status !== "completed") return { status: d.status === "queued" ? "queued" : "processing" };
  let text = "";
  const utt: any[] = Array.isArray(d.utterances) ? d.utterances : [];
  if (utt.length) text = utt.map((u) => `[${clock(u.start)}] المتكلم ${u.speaker}: ${String(u.text || "").trim()}`).join("\n");
  else text = String(d.text || "").trim();
  return { status: "completed", text, seconds: Math.round(Number(d.audio_duration) || 0) };
}

/** خصوصية: بعد ما نحفظ التفريغ عندنا نحذفه من AssemblyAI */
export async function deleteAsr(id: string) {
  await call("/transcript/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});
}

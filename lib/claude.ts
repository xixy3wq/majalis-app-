// الاتصال بـ Claude API بمفتاح صاحب الموقع (ANTHROPIC_API_KEY في Vercel)
import { fail } from "./auth";

export const MODEL = () => process.env.MAJALIS_MODEL || "claude-sonnet-5-5";
export const aiReady = () => !!process.env.ANTHROPIC_API_KEY;

type Msg = { role: "user" | "assistant"; content: any };

/** يرسل الطلب، ويكمل تلقائيًا إذا وقف البحث في النص (pause_turn)، ويرجع النص النهائي. */
export async function askClaude(opts: { system: string; prompt: string; maxTokens?: number; webSearch?: number; deadlineMs?: number }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) fail("الذكاء الاصطناعي غير مفعّل: صاحب الموقع لازم يضيف مفتاح Claude API", 503);
  const deadline = Date.now() + (opts.deadlineMs || 280000);
  const tools = opts.webSearch ? [{ type: "web_search_20250305", name: "web_search", max_uses: opts.webSearch }] : undefined;
  const base: Msg[] = [{ role: "user", content: opts.prompt }];
  let assistant: any[] = [];
  let searches = 0;
  for (let round = 0; round < 4; round++) {
    const left = deadline - Date.now();
    if (left < 5000) fail("أخذ البحث وقت أطول من المتوقع، جرّب مرة ثانية", 504);
    const messages = assistant.length ? [...base, { role: "assistant", content: assistant }] : base;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL(), max_tokens: opts.maxTokens || 4096, system: opts.system, messages, ...(tools ? { tools } : {}) }),
      signal: AbortSignal.timeout(left),
    }).catch((e) => fail(e?.name === "TimeoutError" ? "أخذ الرد وقت أطول من المتوقع، جرّب مرة ثانية" : "ما قدرت أتصل بـ Claude، جرّب بعد شوي", 502));
    const d: any = await (r as Response).json().catch(() => ({}));
    if (!(r as Response).ok) {
      const st = (r as Response).status;
      const msg = String(d?.error?.message || "");
      if (st === 401) fail("مفتاح Claude API غير صحيح. صاحب الموقع يراجعه في Vercel", 503);
      if (st === 400 && /credit|balance|billing/i.test(msg)) fail("رصيد Claude API خلص. صاحب الموقع يشحن من Claude Console", 503);
      if (st === 429 || st === 529 || st === 503) fail("خدمة الذكاء الاصطناعي مزحومة الحين، جرّب بعد دقيقة", 503);
      fail("خطأ من Claude: " + (msg || st).toString().slice(0, 200), 502);
    }
    assistant = assistant.concat(d.content || []);
    searches += Number(d?.usage?.server_tool_use?.web_search_requests || 0);
    if (d.stop_reason === "pause_turn") continue;
    // النص النهائي: الكتل النصية بعد آخر نتيجة بحث
    let lastTool = -1;
    assistant.forEach((c, i) => { if (c.type === "web_search_tool_result" || c.type === "server_tool_use") lastTool = i; });
    const text = assistant.slice(lastTool + 1).filter((c) => c.type === "text").map((c) => c.text).join("");
    return { text, searches, truncated: d.stop_reason === "max_tokens" };
  }
  fail("أخذ البحث وقت أطول من المتوقع، جرّب مرة ثانية", 504);
  return { text: "", searches, truncated: false };
}

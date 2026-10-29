// الاتصال بـ Claude API بمفتاح صاحب الموقع (ANTHROPIC_API_KEY في Vercel)
import { fail } from "./auth";

export const MODEL = () => process.env.MAJALIS_MODEL || "claude-sonnet-5-5";
export const aiReady = () => !!process.env.ANTHROPIC_API_KEY;

type Msg = { role: "user" | "assistant"; content: any };

function apiError(st: number, msg: string): never {
  if (st === 401) fail("مفتاح Claude API غير صحيح. صاحب الموقع يراجعه في Vercel", 503);
  if (st === 400 && /credit|balance|billing/i.test(msg)) fail("رصيد Claude API خلص. صاحب الموقع يشحن من Claude Console", 503);
  if (st === 429 || st === 529 || st === 503) fail("خدمة الذكاء الاصطناعي مزحومة الحين، جرّب بعد دقيقة", 503);
  fail("خطأ من Claude: " + (msg || st).toString().slice(0, 200), 502);
  throw new Error("unreachable");
}

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
    if (!(r as Response).ok) apiError((r as Response).status, String(d?.error?.message || ""));
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

/**
 * محادثة متدفقة: يرجع ReadableStream نص عادي (UTF-8) يوصل للمتصفح أول بأول.
 * أخطاء ما قبل البث ترجع كخطأ عادي (JSON)، وأخطاء أثناء البث تنكتب في آخر النص بعد العلامة \u0000.
 * system ممكن يكون مصفوفة كتل عشان نستخدم prompt caching للدفتر.
 */
export async function streamClaude(opts: { system: any; messages: Msg[]; maxTokens?: number; deadlineMs?: number }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) fail("الذكاء الاصطناعي غير مفعّل: صاحب الموقع لازم يضيف مفتاح Claude API", 503);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.deadlineMs || 110000);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL(), max_tokens: opts.maxTokens || 2500, system: opts.system, messages: opts.messages, stream: true }),
    signal: ctl.signal,
  }).catch((e) => { clearTimeout(timer); fail(e?.name === "AbortError" ? "أخذ الرد وقت أطول من المتوقع، جرّب مرة ثانية" : "ما قدرت أتصل بـ Claude، جرّب بعد شوي", 502); });
  const res = r as Response;
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const d: any = await res.json().catch(() => ({}));
    apiError(res.status, String(d?.error?.message || ""));
  }
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = res.body!.getReader();
  let buf = "";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // لازم كل pull يضيف شي أو يقفل، وإلا يوقف البث: نقرأ لين يطلع نص
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { clearTimeout(timer); controller.close(); return; }
          buf += dec.decode(value, { stream: true });
          let i: number;
          let out = "";
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            let ev: any;
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") out += ev.delta.text;
            else if (ev.type === "message_delta" && ev.delta?.stop_reason === "max_tokens") out += "\u0000الرد طويل وانقطع، اطلب منه يكمل.";
            else if (ev.type === "error") {
              const t = String(ev.error?.type || "");
              out += "\u0000" + (t === "overloaded_error" ? "خدمة الذكاء الاصطناعي مزحومة الحين، جرّب بعد دقيقة" : "انقطع الرد، جرّب مرة ثانية");
            }
          }
          if (out) { controller.enqueue(enc.encode(out)); return; }
        }
      } catch (e: any) {
        clearTimeout(timer);
        controller.enqueue(enc.encode("\u0000" + (e?.name === "AbortError" ? "أخذ الرد وقت أطول من المتوقع، جرّب مرة ثانية" : "انقطع الرد، جرّب مرة ثانية")));
        controller.close();
      }
    },
    cancel() { clearTimeout(timer); ctl.abort(); },
  });
}

/**
 * رد منظم مضمون: نجبر Claude يرجّع النتيجة عبر «أداة» لها مخطط JSON، فيرجع كائن صالح دائمًا
 * (بدل نص JSON ممكن ينكسر بعلامة تنصيص أو ينقطع).
 */
export async function askClaudeJson<T = any>(opts: { system: string; prompt: string; name: string; schema: any; maxTokens?: number; deadlineMs?: number }): Promise<T> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) fail("الذكاء الاصطناعي غير مفعّل: صاحب الموقع لازم يضيف مفتاح Claude API", 503);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL(), max_tokens: opts.maxTokens || 12000, system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      tools: [{ name: opts.name, description: "احفظ النتيجة النهائية بهذا الشكل.", input_schema: opts.schema }],
      tool_choice: { type: "tool", name: opts.name },
    }),
    signal: AbortSignal.timeout(opts.deadlineMs || 280000),
  }).catch((e) => fail(e?.name === "TimeoutError" ? "أخذ الرد وقت أطول من المتوقع، جرّب مرة ثانية" : "ما قدرت أتصل بـ Claude، جرّب بعد شوي", 502));
  const d: any = await (r as Response).json().catch(() => ({}));
  if (!(r as Response).ok) apiError((r as Response).status, String(d?.error?.message || ""));
  if (d.stop_reason === "max_tokens") fail("الرد طلع أطول من المسموح وانقطع، جرّب مرة ثانية", 502);
  const block = (d.content || []).find((c: any) => c.type === "tool_use" && c.name === opts.name);
  if (!block || typeof block.input !== "object") fail("ما رجع الذكاء الاصطناعي نتيجة مرتبة، جرّب مرة ثانية", 502);
  return block.input as T;
}

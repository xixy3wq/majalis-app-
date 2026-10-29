// إشعارات واتساب للمدير عبر «الواتس الذكي» (smart-whats.com)، نفس مزوّد موقع التسميع.
// الإعداد في جدول Setting بالمفتاح "wa" (نص JSON). كلمة مرور حساب الواتس الذكي ما تنحفظ أبدًا.
import { prisma } from "./db";

export type WaCfg = { jwt: string; device: string; notifyPhone: string; onRegister: boolean; onReminder: boolean };
const DEF: WaCfg = { jwt: "", device: "", notifyPhone: "", onRegister: true, onReminder: true };
const SMART = "https://server.smart-whats.com";

export async function waCfg(): Promise<WaCfg> {
  const r = await prisma.setting.findUnique({ where: { key: "wa" } });
  let v: any = {};
  try { v = JSON.parse(r?.value || "{}"); } catch {}
  return { ...DEF, ...v };
}
export async function saveWa(c: WaCfg) {
  const value = JSON.stringify(c);
  await prisma.setting.upsert({ where: { key: "wa" }, create: { key: "wa", value }, update: { value } });
}
/** رقم دولي بدون + (السعودية افتراضيًا) */
export function intlPhone(p: string) {
  let d = String(p || "").replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("05") && d.length === 10) d = "966" + d.slice(1);
  else if (d.startsWith("5") && d.length === 9) d = "966" + d;
  return d.length >= 10 ? d : "";
}
async function post(path: string, data: Record<string, string>) {
  try {
    const r = await fetch(SMART + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(data).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const hdr = [r.headers.get("authorization"), r.headers.get("set-cookie"), r.headers.get("x-auth-token")].filter(Boolean).join(" ");
    return { status: r.status, ok: r.ok, t: await r.text(), hdr };
  } catch (e: any) {
    return { status: 0, ok: false, t: "تعذّر الاتصال بالواتس الذكي: " + String(e?.message || e), hdr: "" };
  }
}
/** يرسل رسالة واحدة */
export async function waSend(c: WaCfg, phone: string, text: string): Promise<{ ok: boolean; resp: string }> {
  const p = intlPhone(phone);
  if (!p) return { ok: false, resp: "رقم الجوال غير صحيح" };
  if (!c.jwt || !c.device) return { ok: false, resp: "الواتساب مو مربوط" };
  const r = await post("/user/messages/send", { jwt: c.jwt, devices: c.device, message: text, numbers: p });
  const body = r.t.slice(0, 300);
  const ok = r.ok && !/"(success|status|ok)"\s*:\s*(false|"(error|fail|failed)")/i.test(body);
  return { ok, resp: `${r.status} ${body}` };
}
/** إشعار للمدير، ما يرمي خطأ أبدًا (ما نبي تسجيل مستخدم أو مهمة تفشل بسبب الواتساب) */
export async function notifyAdmin(kind: "register" | "reminder", text: string) {
  try {
    const c = await waCfg();
    if (!c.jwt || !c.device || !intlPhone(c.notifyPhone)) return;
    if (kind === "register" && !c.onRegister) return;
    if (kind === "reminder" && !c.onReminder) return;
    const r = await waSend(c, c.notifyPhone, text);
    if (!r.ok) console.error("wa notify failed", r.resp);
  } catch (e) {
    console.error("wa notify", e);
  }
}
/** ربط سريع: يدخل بحساب الواتس الذكي ويرجع رمز الربط والأرقام المربوطة */
export async function smartLogin(phoneIn: string, password: string) {
  const phone = intlPhone(phoneIn);
  if (!phone || !password) return { error: "اكتب رقم الجوال وكلمة المرور حق حسابك في الواتس الذكي" };
  const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
  let l = await post("/user/auth/login", { phone, password });
  let jwt = ((l.t + " " + l.hdr).match(JWT) || [])[0];
  if (!jwt && phone.startsWith("966")) {
    l = await post("/user/auth/login", { phone: "0" + phone.slice(3), password });
    jwt = ((l.t + " " + l.hdr).match(JWT) || [])[0];
  }
  if (!jwt) return { error: "ما قدرت أدخل حسابك في الواتس الذكي. تأكد من الرقم وكلمة المرور." };
  const d = await post("/user/devices/api/list", { jwt });
  let devices: { id: string; name: string }[] = [];
  try {
    const walk = (x: any) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        if (typeof x._id === "string" && /^[a-f0-9]{24}$/i.test(x._id) && (x.name || x.phone || x.number || x.status !== undefined || x.connected !== undefined))
          devices.push({ id: x._id, name: String(x.name || x.title || x.phone || x.number || "") });
        else Object.values(x).forEach(walk);
      }
    };
    walk(JSON.parse(d.t));
  } catch {}
  if (!devices.length) devices = Array.from(new Set(d.t.match(/\b[a-f0-9]{24}\b/gi) || [])).map((id) => ({ id, name: "" }));
  return { jwt, devices };
}

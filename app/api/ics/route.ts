import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
export const dynamic = "force-dynamic";

// موعد المجلس كملف تقويم: تنبيه قبله بيوم لمراجعة التحضير، وقبله بساعة
function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 60) { out.push(rest.slice(0, 60)); rest = " " + rest.slice(60); }
  out.push(rest);
  return out.join("\r\n");
}
const pad = (n: number) => String(n).padStart(2, "0");
const utc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me || (me.role !== "admin" && !me.approved)) return NextResponse.json({ error: "سجّل دخولك" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const m = await prisma.majlis.findFirst({ where: { id, userId: me.id } });
  if (!m) return NextResponse.json({ error: "ما لقيت هذا المجلس" }, { status: 404 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return NextResponse.json({ error: "حدّد تاريخ المجلس أول" }, { status: 400 });
  const [y, mo, d] = m.date.split("-").map(Number);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const link = host ? `https://${host}/#s-${m.id}` : "";
  const title = `مجلس ${m.sheikh}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//majalis//AR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${m.id}@majalis`, `DTSTAMP:${utc(new Date())}`];
  if (/^\d{2}:\d{2}$/.test(m.time)) {
    const [h, mi] = m.time.split(":").map(Number);
    const start = new Date(Date.UTC(y, mo - 1, d, h - 3, mi)); // توقيت السعودية UTC+3
    lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(new Date(start.getTime() + 90 * 60000))}`);
  } else {
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    lines.push(`DTSTART;VALUE=DATE:${m.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`);
  }
  lines.push(`SUMMARY:${esc(title)}`);
  const desc = [m.topic ? `الموضوع: ${m.topic}` : "", link ? `التحضير: ${link}` : ""].filter(Boolean).join("\n");
  if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
  if (m.place) lines.push(`LOCATION:${esc(m.place)}`);
  if (link) lines.push(`URL:${link}`);
  lines.push("BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:${esc(`بكرة ${title}. راجع التحضير والأسئلة`)}`, "END:VALARM");
  lines.push("BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${esc(`بعد ساعة ${title}`)}`, "END:VALARM");
  lines.push("END:VEVENT", "END:VCALENDAR");
  return new NextResponse(lines.map(fold).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="majlis.ics"', "Cache-Control": "no-store" },
  });
}

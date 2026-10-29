// النسخ الاحتياطي: لقطة كاملة لكل جداول الموقع (ملف JSON مضغوط) في مخزن الملفات، مستقل عن قاعدة البيانات.
// تلقائية كل ليلة + يدوية من صفحة المدير + نسخة قبل أي استرجاع. السجل في Setting بالمفتاح backupLog.
import { gunzipSync, gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { get, head } from "@vercel/blob";
import { prisma } from "./db";
import { fail } from "./auth";
import { accessOfUrl, delFiles, putFile } from "./blob";

export type Kind = "auto" | "manual" | "pre-restore" | "upload";
export type BackupEntry = { id: string; url: string; pathname: string; size: number; at: string; kind: Kind; counts: Record<string, number> };
const KEEP: Record<Kind, number> = { auto: 30, manual: 15, "pre-restore": 5, upload: 5 };
const SKIP_SETTING = (k: string) => k === "backupLog" || k === "blobAccess" || k.startsWith("rem:");

export async function readLog(): Promise<BackupEntry[]> {
  const s = await prisma.setting.findUnique({ where: { key: "backupLog" } });
  try { const v = JSON.parse(s?.value || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
async function saveLog(log: BackupEntry[]) {
  const value = JSON.stringify(log);
  await prisma.setting.upsert({ where: { key: "backupLog" }, create: { key: "backupLog", value }, update: { value } });
}
const stamp = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", "_").replace(":", "");

export async function snapshot() {
  const [users, majalis, questions, settings, recordings, aiJobs] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.majlis.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.question.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.setting.findMany(),
    prisma.recording.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.aiJob.findMany({ where: { status: { not: "tool" } }, orderBy: { createdAt: "asc" } }),
  ]);
  const st = settings.filter((s) => !SKIP_SETTING(s.key));
  return {
    app: "majalis", version: 1, at: new Date().toISOString(),
    counts: { users: users.length, majalis: majalis.length, questions: questions.length, recordings: recordings.length },
    users, majalis, questions, settings: st, recordings, aiJobs,
  };
}

/** ياخذ نسخة ويحفظها، ويحذف الزايد عن الحد لكل نوع */
export async function makeBackup(kind: Kind) {
  const data = await snapshot();
  const gz = gzipSync(Buffer.from(JSON.stringify(data)));
  const f = await putFile(`backups/${kind}/majalis-${stamp()}.json.gz`, gz, "application/gzip");
  const entry: BackupEntry = { id: randomBytes(6).toString("hex"), url: f.url, pathname: f.pathname, size: gz.length, at: data.at, kind, counts: data.counts };
  await addToLog(entry);
  return entry;
}
export async function addToLog(entry: BackupEntry) {
  const log = [entry, ...(await readLog()).filter((e) => e.url !== entry.url)];
  const n: Record<string, number> = {};
  const keep: BackupEntry[] = [], drop: BackupEntry[] = [];
  for (const e of log) { n[e.kind] = (n[e.kind] || 0) + 1; (n[e.kind] <= (KEEP[e.kind] ?? 10) ? keep : drop).push(e); }
  await saveLog(keep);
  if (drop.length) await delFiles(drop.map((e) => e.url));
}

export async function loadBackup(url: string, pathname: string) {
  const g = await get(pathname || url, { access: accessOfUrl(url) });
  if (!g || g.statusCode !== 200) fail("ما لقيت ملف النسخة في المخزن", 404);
  const buf = Buffer.from(await new Response((g as any).stream).arrayBuffer());
  let data: any;
  try { data = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8")); } catch { fail("الملف تالف أو مو ملف نسخة احتياطية"); }
  if (!data || data.app !== "majalis" || !Array.isArray(data.users) || !Array.isArray(data.majalis)) fail("هذا الملف مو نسخة احتياطية من دفتر المجالس");
  return data;
}

const d = (v: any) => (v ? new Date(v) : new Date());
const same = (a: any, b: any, keys: string[]) => keys.every((k) => JSON.stringify(a?.[k] ?? null) === JSON.stringify(b?.[k] ?? null));
async function inBatches(ops: any[]) {
  for (let i = 0; i < ops.length; i += 50) await prisma.$transaction(ops.slice(i, i + 50));
}
const U_KEYS = ["name", "username", "passwordHash", "role", "aiAllowed", "approved", "about"];
const M_KEYS = ["userId", "sheikh", "topic", "date", "time", "place", "opening", "briefing", "books", "general"];
const Q_KEYS = ["majlisId", "text", "why", "grp", "pos", "asked", "answer"];
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));

/**
 * استرجاع بالدمج، ما يحذف شي جديد أبدًا:
 * - missing: يرجّع المحذوف فقط (الأسلم)
 * - all: يرجّع المحذوف + يرجّع المعدّل لحالته وقت النسخة
 * userId: يقتصر على مستخدم واحد وجلساته
 */
export async function restore(data: any, mode: "missing" | "all", userId?: string | null) {
  let users: any[] = data.users || [], majalis: any[] = data.majalis || [], questions: any[] = data.questions || [];
  let recordings: any[] = data.recordings || [], settings: any[] = data.settings || [], aiJobs: any[] = data.aiJobs || [];
  if (userId) {
    users = users.filter((u) => u.id === userId);
    if (!users.length) fail("هذا المستخدم ما كان موجود وقت النسخة");
    majalis = majalis.filter((m) => m.userId === userId);
    const mids = new Set(majalis.map((m) => m.id));
    questions = questions.filter((q) => mids.has(q.majlisId));
    recordings = recordings.filter((r) => mids.has(r.majlisId));
    aiJobs = aiJobs.filter((j) => j.userId === userId);
    settings = [];
  }
  const res = { users: 0, majalis: 0, questions: 0, recordings: 0, settings: 0, updated: 0, skipped: 0 };

  // المستخدمون
  const curU = await prisma.user.findMany();
  const uById = new Map(curU.map((u) => [u.id, u]));
  const uByName = new Map(curU.map((u) => [u.username, u.id]));
  const liveUsers = new Set(curU.map((u) => u.id));
  const ops: any[] = [];
  for (const u of users) {
    const now = uById.get(u.id);
    if (now) {
      if (mode === "all" && !same(now, u, U_KEYS)) {
        const owner = uByName.get(u.username);
        const fields: any = pick(u, U_KEYS);
        if (owner && owner !== u.id) delete fields.username;
        ops.push(prisma.user.update({ where: { id: u.id }, data: fields }));
        res.updated++;
      }
    } else if (uByName.has(u.username)) {
      res.skipped++;
    } else {
      ops.push(prisma.user.create({ data: { id: u.id, ...pick(u, U_KEYS), createdAt: d(u.createdAt) } as any }));
      uByName.set(u.username, u.id); liveUsers.add(u.id); res.users++;
    }
  }
  await inBatches(ops.splice(0));

  // الجلسات
  const curM = await prisma.majlis.findMany({ where: { id: { in: majalis.map((m) => m.id) } } });
  const mById = new Map(curM.map((m) => [m.id, m]));
  const liveM = new Set(curM.map((m) => m.id));
  const newM: any[] = [];
  for (const m of majalis) {
    const now = mById.get(m.id);
    if (now) {
      if (mode === "all" && !same(now, m, M_KEYS) && liveUsers.has(m.userId)) { ops.push(prisma.majlis.update({ where: { id: m.id }, data: pick(m, M_KEYS) })); res.updated++; }
    } else if (liveUsers.has(m.userId)) {
      newM.push({ id: m.id, ...pick(m, M_KEYS), createdAt: d(m.createdAt) }); liveM.add(m.id);
    } else res.skipped++;
  }
  for (let i = 0; i < newM.length; i += 200) res.majalis += (await prisma.majlis.createMany({ data: newM.slice(i, i + 200), skipDuplicates: true })).count;
  await inBatches(ops.splice(0));

  // الأسئلة
  const curQ = await prisma.question.findMany({ where: { id: { in: questions.map((q) => q.id) } } });
  const qById = new Map(curQ.map((q) => [q.id, q]));
  const newQ: any[] = [];
  for (const q of questions) {
    const now = qById.get(q.id);
    if (now) {
      if (mode === "all" && !same(now, q, Q_KEYS) && liveM.has(q.majlisId)) { ops.push(prisma.question.update({ where: { id: q.id }, data: pick(q, Q_KEYS) })); res.updated++; }
    } else if (liveM.has(q.majlisId)) newQ.push({ id: q.id, ...pick(q, Q_KEYS), createdAt: d(q.createdAt) });
    else res.skipped++;
  }
  for (let i = 0; i < newQ.length; i += 300) res.questions += (await prisma.question.createMany({ data: newQ.slice(i, i + 300), skipDuplicates: true })).count;
  await inBatches(ops.splice(0));

  // التسجيلات (بياناتها والتفريغ؛ الملف الصوتي يرجع إذا كان باقي في المخزن)
  const curR = new Set((await prisma.recording.findMany({ where: { id: { in: recordings.map((r) => r.id) } }, select: { id: true } })).map((r) => r.id));
  for (const r of recordings) {
    if (curR.has(r.id) || !liveM.has(r.majlisId)) continue;
    let url = String(r.url || "");
    if (url) { try { await head(url); } catch { url = ""; } }
    const st = r.status === "transcribing" || r.status === "summarizing" ? (r.transcript ? "transcribed" : "uploaded") : r.status;
    await prisma.recording.create({
      data: {
        id: r.id, majlisId: r.majlisId, userId: r.userId, url, pathname: r.pathname || "", size: url ? r.size || 0 : 0, seconds: r.seconds || 0,
        mime: r.mime || "", name: r.name || "تسجيل", status: !url && st === "uploaded" ? "error" : st, transcript: r.transcript || "",
        error: url ? r.error || "" : "الملف الصوتي ما عاد موجود، بس التفريغ رجع", createdAt: d(r.createdAt),
        ...(r.summary ? { summary: r.summary } : {}),
      },
    }).then(() => res.recordings++, () => res.skipped++);
  }

  // الإعدادات (فقط في الاسترجاع الكامل لكل الموقع)
  if (!userId) {
    for (const s of settings) {
      if (!s || typeof s.key !== "string" || SKIP_SETTING(s.key)) continue;
      const now = await prisma.setting.findUnique({ where: { key: s.key } });
      if (!now) { await prisma.setting.create({ data: { key: s.key, value: String(s.value) } }); res.settings++; }
      else if (mode === "all" && now.value !== s.value) { await prisma.setting.update({ where: { key: s.key }, data: { value: String(s.value) } }); res.settings++; }
    }
  }

  // سجل توليد الجلسات (للحدود اليومية والمراجعة): المحذوف فقط
  const jobs = aiJobs.filter((j) => liveUsers.has(j.userId)).map((j) => ({
    id: j.id, userId: j.userId, sheikh: j.sheikh || "", hint: j.hint || "", topic: j.topic || "", status: j.status || "saved",
    majlisId: j.majlisId || null, error: j.error || null, createdAt: d(j.createdAt),
    ...(j.research ? { research: j.research } : {}), ...(j.brief ? { brief: j.brief } : {}), ...(j.plan ? { plan: j.plan } : {}),
  }));
  const haveJ = new Set((await prisma.aiJob.findMany({ where: { id: { in: jobs.map((j) => j.id) } }, select: { id: true } })).map((j) => j.id));
  for (const j of jobs) if (!haveJ.has(j.id)) await prisma.aiJob.create({ data: j as any }).catch(() => {});
  return res;
}

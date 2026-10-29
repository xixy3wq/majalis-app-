// توليد جلسة مع شيخ بالذكاء الاصطناعي: التعليمات، وقراءة الردود، وبناء نص الجلسة بنفس تنسيق المجالس الجاهزة.
// الملف بدون اعتماد على قاعدة البيانات عشان ينختبر لحاله.

export type Research = {
  name?: string; found?: boolean; identity?: string; namesakes?: string;
  bio?: string[]; quotes?: { text: string; context?: string; source?: number }[];
  observations?: { point: string; source?: number }[];
  works?: { title: string; note?: string }[];
  sources?: { n: number; title: string; url: string }[];
};
export type Brief = { who?: string[]; traits?: { title: string; evidence: string; meaning: string }[]; caution?: string };
export type Plan = {
  hook?: string; angle?: string; opening?: string[]; bridge?: string; closing?: string;
  before?: string[]; during?: string[]; avoid?: string[];
  questions?: { text: string; why?: string; group?: string }[];
};

/** يطلع أول كائن JSON كامل من نص الرد (حتى لو قبله أو بعده كلام أو علامات ```). */
export function extractJson<T = any>(text: string): T {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no json");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error("unterminated json");
}

const clean = (v: unknown, max = 2000) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const safeUrl = (u: unknown) => { const s = String(u || "").trim(); return /^https?:\/\/[^\s()<>]+$/i.test(s) ? s : ""; };

/** نص «التحضير والافتتاح»: زاوية الجلسة، وجملة الافتتاح، والخطوات، ثم قبل/أثناء/تجنّب/الختام */
export function buildOpening(plan: Plan): string {
  const out: string[] = [];
  if (clean(plan.angle)) out.push(`**زاوية الجلسة:** ${clean(plan.angle, 600)}`, "");
  if (clean(plan.hook)) out.push("## الافتتاح", `> ${clean(plan.hook, 800)}`, "");
  else if (arr(plan.opening).length) out.push("## الافتتاح");
  arr<string>(plan.opening).map((x) => clean(x, 600)).filter(Boolean).forEach((x, i) => out.push(`${i + 1}. ${x}`));
  if (clean(plan.bridge)) out.push("", `**الانتقال لأول سؤال:** ${clean(plan.bridge, 600)}`);
  const sec = (title: string, items: unknown) => {
    const list = arr<string>(items).map((x) => clean(x, 600)).filter(Boolean);
    if (list.length) { out.push("", `## ${title}`); list.forEach((x) => out.push(`- ${x}`)); }
  };
  sec("قبل اللقاء", plan.before);
  sec("أثناء الكلام", plan.during);
  sec("تجنّب", plan.avoid);
  if (clean(plan.closing)) out.push("", "## الختام", clean(plan.closing, 800));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** نص «عن الشيخ» بنفس تنسيق المجالس الجاهزة، مع المصادر */
export function buildBriefing(r: Research, b: Brief): string {
  const out: string[] = ["## من هو"];
  arr<string>(b.who).map((x) => clean(x, 500)).filter(Boolean).forEach((x) => out.push(`- ${x}`));
  out.push("");
  if (clean(b.caution)) out.push(`انتبه: ${clean(b.caution, 800)}`, "");
  out.push("هذا التحليل جهّزه الذكاء الاصطناعي من البحث في الإنترنت عن الشيخ، فراجع المصادر قبل ما تعتمد على أي معلومة. وهو عن شخصيته العلمية وطريقته في الكلام، مو عن طباعه الشخصية.");
  const traits = arr<any>(b.traits).filter((t) => clean(t?.title));
  if (traits.length) {
    out.push("", "## ملامح شخصيته");
    traits.forEach((t) => {
      out.push(`### ${clean(t.title, 120)}`);
      if (clean(t.evidence)) out.push(`**الدليل:** ${clean(t.evidence, 1500)}`);
      if (clean(t.meaning)) out.push(`**وش يعني لك:** ${clean(t.meaning, 1000)}`);
      out.push("");
    });
  }
  const seen = new Set<string>();
  const srcs = arr<any>(r.sources).map((s) => ({ title: clean(s?.title, 200) || "مصدر", url: safeUrl(s?.url) })).filter((s) => s.url && !seen.has(s.url) && seen.add(s.url));
  if (srcs.length) {
    out.push("## المصادر");
    srcs.forEach((s) => out.push(`- [${s.title.replace(/[\[\]]/g, "")}](${s.url})`));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** الأسئلة بعد التنظيف والترتيب داخل كل قسم */
export function buildQuestions(plan: Plan) {
  const pos: Record<string, number> = { core: 0, ask: 0, spare: 0 };
  return arr<any>(plan.questions)
    .map((q) => ({ text: clean(q?.text, 1200), why: clean(q?.why, 400), group: ["core", "ask", "spare"].includes(q?.group) ? q.group : "core" }))
    .filter((q) => q.text)
    .slice(0, 16)
    .map((q) => ({ ...q, order: pos[q.group]++ }));
}

/* ---------------- التعليمات ---------------- */

const DIALECT = "اكتب بلهجة سعودية بيضاء مفهومة (مثل: وش، ليش، عشان، تقدر، يبي)، بجمل قصيرة وواضحة، بدون مبالغة ولا مدح.";

export const RESEARCH_SYSTEM = `أنت باحث دقيق. مهمتك تجمع معلومات موثقة من الإنترنت عن شيخ أو عالم مسلم، عشان شخص يتحضر لجلسة معه.
ابحث بالعربي أولًا، ونوّع البحث: سيرته، ومؤلفاته، وقنواته وحساباته، وتفريغ دروسه، ولقاءاته، وكلام طلابه أو اللي حضروا مجالسه.
ركّز على:
- سيرته: منصبه الحالي، تعليمه ورسائله، مؤلفاته، برامجه، عضوياته.
- كلامه هو منقولًا حرفيًا من دروسه أو حساباته أو كتبه، خصوصًا عن الموضوع المطلوب.
- كيف يوصفه الناس في مجالسه وأسلوبه في الكلام والتدريس.
- اهتماماته الخاصة اللي تميزه عن غيره.
- تفاصيل حيّة تصلح مدخلًا للحديث معه: قصة ذكرها في درس، مناسبة قريبة، سؤال تكرر عليه، رأي اشتهر به، عبارة يرددها.
قواعد صارمة:
- لا تخترع أي معلومة أو اقتباس. الاقتباس الحرفي فقط إذا شفته بنفسك في نتيجة بحث، ومعه رقم المصدر.
- إذا فيه أكثر من شخص بنفس الاسم، وضّح ذلك في namesakes، واعتمد الأقرب للمعلومة المميِّزة إن وُجدت.
- إذا ما لقيت معلومات كافية، قل ذلك بصراحة واجعل found = false.
في النهاية اكتب JSON فقط، بدون أي كلام قبله أو بعده، بهذا الشكل:
{"name": "اسمه الكامل كما في المصادر", "found": true, "identity": "جملة تحدد من هو بالضبط", "namesakes": "أشخاص بنفس الاسم إن وجدوا، وإلا نص فاضي",
 "bio": ["حقيقة قصيرة"], "quotes": [{"text": "اقتباس حرفي", "context": "وين قاله", "source": 1}],
 "observations": [{"point": "ملاحظة عن أسلوبه أو اهتمامه أو كلام الناس عنه", "source": 2}],
 "works": [{"title": "اسم الكتاب أو البرنامج أو الدرس", "note": "وصف قصير"}],
 "sources": [{"n": 1, "title": "عنوان الصفحة", "url": "الرابط"}]}`;

export function researchPrompt(sheikh: string, hint: string, topic: string) {
  return `الشيخ: ${sheikh}
${hint ? `معلومة تميّزه: ${hint}\n` : ""}موضوع الجلسة: ${topic || "عام"}
ابحث عنه واجمع المعلومات، ثم اكتب JSON فقط.`;
}

const STYLE_TRAIT = `مثال على ملمح واحد بالأسلوب المطلوب (من جلسة سابقة):
{"title": "دقيق جدًا في المصطلحات", "evidence": "عنده كتاب كامل اسمه «مفهوم التفسير والتأويل والاستنباط والتدبر والمفسر». وفي درسه يقول: «التدبر عملية عقلية»، ويقول عن التأثر إنه وجداني، وإنه «قد يتأثر الكافر، لكن لا يؤمن».", "meaning": "حدّد قصدك من البداية: التأثر اللي يثمر إيمانًا وعملًا، مو بس مشاعر وقت القراءة. وإلا بيبدأ يصحح المفهوم قبل ما يجاوب."}`;

export const BRIEF_SYSTEM = `أنت تساعد شخصًا يتحضر لجلسة مع شيخ. عندك نتائج بحث موثقة عنه. اكتب تحليلًا لشخصيته العلمية وأسلوبه في الكلام، يفيده في طريقة الحوار معه.
${DIALECT}
قواعد:
- لا تفترض أي شيء عن صاحب الجلسة: لا إنه معلم ولا مربٍّ ولا عنده طلاب أو حلقة ولا شغله. إذا كتب تعريفًا بنفسه في «عن صاحب الجلسة» استخدمه، وإلا خلّ الكلام مرتبطًا بموضوع الجلسة والشيخ فقط.
- كل «دليل» لازم يكون من نتائج البحث فقط، والاقتباسات حرفية بين «».
- «وش يعني لك» نصيحة عملية للجلسة: كيف يسأله، وش يتجنب، وش المدخل الأنسب.
- التحليل عن شخصيته العلمية وأسلوبه، مو تحليل نفسي ولا حكم على طباعه.
- من ٥ إلى ٨ ملامح، كل واحد مختلف عن الثاني.
- «من هو»: من ٣ إلى ٦ نقاط قصيرة من السيرة.
- إذا فيه تشابه أسماء أو المعلومات قليلة، اكتب ذلك في caution.
${STYLE_TRAIT}
احفظ النتيجة بأداة الحفظ بهذا الشكل:
{"who": ["نقطة"], "traits": [{"title": "عنوان قصير", "evidence": "الدليل", "meaning": "وش يعني لك"}], "caution": ""}`;

export function briefPrompt(r: Research, topic: string, about: string) {
  return `موضوع الجلسة: ${topic || "عام"}
${about ? `عن صاحب الجلسة: ${about}\n` : ""}نتائج البحث:
${JSON.stringify(r)}`;
}

const STYLE_Q = `أمثلة على الأسلوب المطلوب (الشكل فقط، لا تنسخ مضمونها):
سؤال جيد: {"text": "يا شيخ، في كتابك «مفهوم التفسير والتأويل والاستنباط والتدبر» فرّقت بين التدبر والتفسير. لو واحد يقرأ وِرده كل يوم، كيف يعرف إنه تدبّر فعلًا وما اكتفى بالقراءة؟", "why": "مبني على تفريقه الدقيق بين المصطلحات في كتابه.", "group": "core"}
سؤال ضعيف (عام يصلح لأي شيخ، لا تكتب مثله): {"text": "يا شيخ، وش نصيحتك في طلب العلم؟"}
افتتاح جيد (hook): "يا شيخ، سمعتك تقول في درسك عن سورة الطور: «...»، ومن يومها وأنا أفكر فيها، وجيت اليوم أسألك عن ..."
افتتاح ضعيف (لا تكتب مثله): "سلّم عليه وعرّف بنفسك وبهدف الزيارة."`;

export const PLAN_SYSTEM = `أنت تساعد شخصًا يتحضر لجلسة مع شيخ. عندك نتائج بحث عنه وتحليل لشخصيته. جهّز له تحضيرًا مبتكرًا وخاصًا بهذا الشيخ وهذا الموضوع، والأسئلة.
${DIALECT}
- لا تفترض أي شيء عن صاحب الجلسة: لا إنه معلم ولا مربٍّ ولا عنده طلاب أو حلقة ولا شغله. إذا كتب تعريفًا بنفسه في «عن صاحب الجلسة» استخدمه، وإلا خلّ الكلام مرتبطًا بموضوع الجلسة والشيخ فقط.
قواعد الأسئلة:
- كل سؤال يخاطب الشيخ مباشرة، ومرتبط بموضوع الجلسة، ومبني على شيء من شغل الشيخ نفسه (كتاب، درس، اقتباس، اهتمام) إذا أمكن.
- سؤال واحد في كل سطر، بدون ما تجمع سؤالين مختلفين.
- الأقسام: core (٦ أسئلة أساسية مرتبة من الأهم)، ask (طلب واحد في آخر اللقاء يناسب هذا الشيخ وموضوع الجلسة، مثل: كتاب يوصي فيه، أو نصيحة خاصة، أو طريقة تواصل)، spare (٣ أو ٤ أسئلة احتياط).
- why: سطر قصير يوضح ليش هذا السؤال مناسب مع هذا الشيخ.
- لا تنسب للشيخ شيء مو موجود في نتائج البحث. وإذا ذكرت أثرًا أو حديثًا، فاذكر الصحيح المشهور فقط.
قواعد التحضير (أهم شي فيه الإبداع والخصوصية):
- كل سطر لازم يكون خاصًا بهذا الشيخ وهذا الموضوع، ويذكر شيئًا محددًا من البحث (كتاب، درس، اقتباس، برنامج، اهتمام، قصة). إذا كان السطر يصلح لأي شيخ ثاني فاحذفه أو أعد كتابته.
- ممنوع العبارات المكررة اللي تنقال لكل شيخ: «سلّم وعرّف بنفسك»، «استأذن قبل التسجيل»، «اشكره على وقته»، «كن مختصرًا»، «احترم وقته»؛ إلا إذا ربطتها بشيء خاص فيه.
- angle: جملة وحدة تبيّن ليش هذا الشيخ بالذات مناسب لهذا الموضوع، والزاوية اللي تميّز الجلسة معه.
- hook: جملة الافتتاح اللي يقولها بعد السلام حرفيًا، بصيغة المتكلم، تشد انتباه الشيخ لأنها تلامس شيئًا يخصه هو (كتابه، كلمة قالها، قصة رواها، مشروع يهتم فيه)، وتوصل للموضوع بسلاسة.
- opening: من ٢ إلى ٤ خطوات مبتكرة للدقائق الأولى، كل خطوة فيها فكرة محددة (مثل: تذكر له موقفًا من درسه، أو تهديه ملاحظة من كتابه، أو تبدأ بسؤال خفيف عن اهتمام يحبه). نوّع بداياتها.
- bridge: جملة تنقلك من الافتتاح لأول سؤال أساسي بشكل طبيعي.
- before: وش يقرأ أو يسمع قبل اللقاء بالتحديد، مع روابط من المصادر بصيغة [العنوان](الرابط) إن وجدت.
- during وavoid: نصائح عملية مبنية على تحليل شخصيته، مو نصائح عامة.
- closing: كيف يختم المجلس بطريقة تناسب هذا الشيخ (جملة ختام أو طلب أخير)، بدون تكرار سؤال ask.
${STYLE_Q}
احفظ النتيجة بأداة الحفظ بهذا الشكل:
{"angle": "...", "hook": "...", "opening": ["خطوة"], "bridge": "...", "before": ["..."], "during": ["..."], "avoid": ["..."], "closing": "...", "questions": [{"text": "...", "why": "...", "group": "core"}]}`;

export function planPrompt(r: Research, b: Brief, topic: string, about: string) {
  return `موضوع الجلسة: ${topic || "عام"}
${about ? `عن صاحب الجلسة: ${about}\n` : ""}نتائج البحث:
${JSON.stringify(r)}
تحليل الشخصية:
${JSON.stringify(b)}`;
}

/* ---------------- مخططات النتائج (للرد المنظم المضمون) ---------------- */
const S = { type: "string" };
const LIST = { type: "array", items: S };
export const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    who: LIST,
    traits: { type: "array", items: { type: "object", properties: { title: S, evidence: S, meaning: S }, required: ["title", "evidence", "meaning"] } },
    caution: S,
  },
  required: ["who", "traits"],
};
export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    angle: S, hook: S, opening: LIST, bridge: S, before: LIST, during: LIST, avoid: LIST, closing: S,
    questions: { type: "array", items: { type: "object", properties: { text: S, why: S, group: { type: "string", enum: ["core", "ask", "spare"] } }, required: ["text", "group"] } },
  },
  required: ["angle", "hook", "opening", "questions"],
};
export const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    name: S, found: { type: "boolean" }, identity: S, namesakes: S, bio: LIST,
    quotes: { type: "array", items: { type: "object", properties: { text: S, context: S, source: { type: "number" } }, required: ["text"] } },
    observations: { type: "array", items: { type: "object", properties: { point: S, source: { type: "number" } }, required: ["point"] } },
    works: { type: "array", items: { type: "object", properties: { title: S, note: S }, required: ["title"] } },
    sources: { type: "array", items: { type: "object", properties: { n: { type: "number" }, title: S, url: S }, required: ["n", "url"] } },
  },
  required: ["name", "found", "bio", "sources"],
};

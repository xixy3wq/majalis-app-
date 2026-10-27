# مجالس المشايخ

دفتر لجلساتك مع المشايخ: التحضير، والأسئلة، وأجوبة الشيخ، والفوائد. مبني بـ **Next.js 14 + Prisma + PostgreSQL (Neon)** ويُرفع على **Vercel** بنفس طريقة «حلقات ارتق».

## الرفع على الإنترنت (مرة واحدة)

1. **Vercel**: Add New → Project ← اختر المستودع `majalis-app` ← Deploy (أول رفع ممكن يفشل لأن القاعدة ما انربطت، عادي).
2. **قاعدة البيانات**: من صفحة المشروع ← Storage ← Create Database ← **Neon** ← اربطها بالمشروع. يضيف Vercel تلقائيًا `DATABASE_URL` و`DATABASE_URL_UNPOOLED`.
3. **المتغيرات** (Settings → Environment Variables):
   - `AUTH_SECRET` = نص عشوائي طويل (32 حرفًا أو أكثر)
   - `SEED_ADMIN_USERNAME` = اسم المستخدم (حروف إنجليزية صغيرة)
   - `SEED_ADMIN_PASSWORD` = كلمة المرور (8 أحرف أو أكثر)
   - `SEED_ADMIN_NAME` = اسمك (اختياري)
4. **Redeploy**. الجداول وحسابك ومجلس الشيخ مساعد الطيار تنشأ تلقائيًا في أول رفع ناجح.

> نسيت كلمة المرور؟ أضف `SEED_ADMIN_FORCE_PASSWORD=1` واعمل Redeploy، ثم احذف المتغير.

## هيكل المشروع

```
prisma/schema.prisma      ← الجداول: User, Majlis, Question, Setting
prisma/ensure-admin.mjs   ← إنشاء حسابك مع كل رفع
prisma/seed-first.mjs     ← إضافة مجلس الشيخ مساعد الطيار مرة وحدة
prisma/seed-masaed.json   ← بيانات ذاك المجلس
app/api/login|logout|data|majlis|act
public/app.js             ← الواجهة كاملة
app/globals.css           ← التصميم (فاتح وداكن)
```

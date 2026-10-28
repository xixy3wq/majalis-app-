# مجالس المشايخ

دفتر لجلساتك مع المشايخ: التحضير، والأسئلة، وأجوبة الشيخ، والفوائد. مبني بـ **Next.js 14 + Prisma + PostgreSQL (Neon)** ويُرفع على **Vercel** بنفس طريقة «حلقات ارتق».

## الرفع على الإنترنت (مرة واحدة)

1. **Vercel**: Add New → Project ← اختر المستودع `majalis-app` ← Deploy.
2. **قاعدة البيانات**: من صفحة المشروع ← Storage ← Create Database ← **Neon** ← اربطها بالمشروع.
3. **Redeploy** (Deployments ← آخر رفع ← ⋯ ← Redeploy).
4. افتح الموقع: أول مرة يطلب منك تسوي اسم المستخدم وكلمة المرور، ومجلس الشيخ مساعد الطيار يكون جاهز.

**الذكاء الاصطناعي:** أضف `ANTHROPIC_API_KEY` (مفتاح Claude API من console.anthropic.com) ثم Redeploy. واختياريًا `MAJALIS_MODEL` لتغيير النموذج (الافتراضي `claude-sonnet-5-5`).

متغيرات اختيارية: `AUTH_SECRET` (نص عشوائي ٣٢ حرفًا أو أكثر)، أو `SEED_ADMIN_USERNAME` و`SEED_ADMIN_PASSWORD` لإنشاء الحساب مع الرفع بدل شاشة أول مرة.

> نسيت كلمة المرور؟ أضف `SEED_ADMIN_USERNAME` و`SEED_ADMIN_PASSWORD` الجديدة و`SEED_ADMIN_FORCE_PASSWORD=1` واعمل Redeploy، ثم احذف المتغير الأخير.

## هيكل المشروع

```
prisma/schema.prisma      ← الجداول: User, Majlis, Question, Setting
prisma/db-sync.mjs        ← تجهيز الجداول مع كل رفع (يتخطى إذا القاعدة مو مربوطة)
prisma/ensure-admin.mjs   ← إنشاء حسابك من المتغيرات (اختياري)
prisma/seed-first.mjs     ← إضافة مجلس الشيخ مساعد الطيار مرة وحدة
prisma/seed-masaed.json   ← بيانات ذاك المجلس
app/api/setup|login|logout|data|majlis|act
public/app.js             ← الواجهة كاملة
app/globals.css           ← التصميم (فاتح وداكن)
```

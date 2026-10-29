// رقم النسخة المنشورة: يتغير تلقائيًا مع كل رفع على Vercel، والواجهة تقارنه عشان تحدّث نفسها
export const BUILD = (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7);

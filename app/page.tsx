import Script from "next/script";
// الواجهة كاملة في public/app.js، والبيانات من مسارات /api
export const dynamic = "force-dynamic";
const V = "3";
export default function Home() {
  return (
    <>
      <div id="app" dir="rtl" lang="ar"><p className="boot">جاري التحميل</p></div>
      <Script src={`/app.js?v=${V}`} strategy="afterInteractive" />
    </>
  );
}

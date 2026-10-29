import Script from "next/script";
import UploadBridge from "./upload-bridge";
// الواجهة كاملة في public/app.js، والبيانات من مسارات /api
export const dynamic = "force-dynamic";
const V = "11";
export default function Home() {
  return (
    <>
      <div id="app" dir="rtl" lang="ar"><p className="boot">جاري التحميل</p></div>
      <UploadBridge />
      <Script src={`/app.js?v=${V}`} strategy="afterInteractive" />
    </>
  );
}

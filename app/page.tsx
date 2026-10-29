import Script from "next/script";
import UploadBridge from "./upload-bridge";
import { BUILD } from "@/lib/version";
// الواجهة كاملة في public/app.js، والبيانات من مسارات /api
export const dynamic = "force-dynamic";
export default function Home() {
  return (
    <>
      <div id="app" dir="rtl" lang="ar"><p className="boot">جاري التحميل</p></div>
      <UploadBridge />
      <Script src={`/app.js?v=${BUILD}`} strategy="afterInteractive" />
    </>
  );
}

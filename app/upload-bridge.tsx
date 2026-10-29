"use client";
import { useEffect } from "react";

// يجهّز أداة رفع الملفات من Vercel Blob للواجهة (public/app.js) بدون ما تنحمّل إلا وقت الحاجة
export default function UploadBridge() {
  useEffect(() => {
    (window as any).majalisBlob = () => import("@vercel/blob/client");
  }, []);
  return null;
}

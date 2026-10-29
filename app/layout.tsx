import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "مجالس المشايخ",
  description: "دفتر مجالسك مع المشايخ: التحضير، والأسئلة، وأجوبة الشيخ، والفوائد",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-180.png" },
  appleWebApp: { capable: true, title: "المجالس", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#1D6A56", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('majalis-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Noto_Sans_TC } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const notoSansTc = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-sans-tc",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "台股基金資產追蹤",
    template: "%s · 台股基金資產追蹤",
  },
  description:
    "台股與境內基金持倉管理、自動更新價格、損益與趨勢圖表，資料儲存於本機",
  applicationName: "tw-portfolio-tracker",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className={`${notoSansTc.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

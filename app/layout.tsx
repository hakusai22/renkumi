import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LaunchCut",
  description: "Next.js + Remotion workflow for product launch videos.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16", type: "image/png" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

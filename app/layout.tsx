import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Renkumi",
  description: "Renkumi turns product copy, screenshots, and AI storyboards into reusable showcase videos.",
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
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

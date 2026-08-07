import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LCE",
  description: "LCE - Code Context Engine for AI Coding Agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark overflow-x-clip" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} overflow-x-clip antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
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
  metadataBase: new URL("https://lcebot.com"),
  title: {
    default: "LCE",
    template: "%s | LCE",
  },
  description: "LCE - Code Context Engine for AI Coding Agents",
  applicationName: "LCE",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/lce-icon.svg", type: "image/svg+xml" },
      { url: "/lce-icon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/lce-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    url: "https://lcebot.com",
    siteName: "LCE",
    title: "LCE",
    description: "Code Context Engine for AI Coding Agents",
    images: [{ url: "/lce-icon-512.png", width: 512, height: 512, alt: "LCE robot" }],
  },
  twitter: {
    card: "summary",
    title: "LCE",
    description: "Code Context Engine for AI Coding Agents",
    images: ["/lce-icon-512.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale} className="dark overflow-x-clip" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} overflow-x-clip antialiased`}
      >
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

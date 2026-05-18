import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import "./globals.css";
import Navbar from "./components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://oddsphere-ruby.vercel.app";
const SITE_TITLE = "Oddsphere AI — AI-Powered Sports Predictions";
const SITE_DESCRIPTION =
  "AI-powered sports predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL. Where data meets winning. For entertainment and informational purposes only.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Oddsphere AI",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    images: [
      {
        url: "/logo-transparent.png",
        width: 3125,
        height: 1875,
        alt: "Oddsphere AI",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@OddSphereAI",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/logo-transparent.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`}>
      <body className="text-white min-h-screen flex flex-col antialiased">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 violet-overlay"
        />
        <Navbar />
        <div className="flex-1">{children}</div>
        <footer className="bg-gray-950/80 border-t border-gray-800 mt-20 py-10 relative">
          <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-400">
            <div className="flex justify-center mb-4 opacity-70">
              <Image
                src="/logo-transparent.png"
                alt="Oddsphere AI"
                width={500}
                height={300}
                sizes="200px"
                className="h-8 sm:h-10 w-auto invert drop-shadow-[0_0_6px_rgba(167,139,250,0.3)]"
              />
            </div>
            <p className="mb-1">
              ⚠️ For entertainment and informational purposes only. Not betting advice.
            </p>
            <p>© 2026 Oddsphere. All stats and odds are publicly available data.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

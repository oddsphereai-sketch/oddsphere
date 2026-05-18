import type { Metadata, Viewport } from "next";
import Image from "next/image";
import "./globals.css";
import Navbar from "./components/Navbar";

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
        url: "/logo.png",
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
    images: ["/logo.png"],
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
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-white min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1">{children}</div>
        <footer className="bg-gray-950 border-t border-gray-800 mt-16 py-6">
          <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-400">
            <div className="flex justify-center mb-3 opacity-70">
              <Image
                src="/logo.png"
                alt="Oddsphere AI"
                width={250}
                height={150}
                sizes="120px"
                className="h-6 sm:h-7 w-auto invert mix-blend-lighten"
              />
            </div>
            <p className="mb-1">
              ⚠️ For entertainment and informational purposes only. Not betting
              advice.
            </p>
            <p>© 2026 Oddsphere. All stats and odds are publicly available data.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

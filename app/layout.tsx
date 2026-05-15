import type { Metadata } from "next";
import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: "Oddsphere AI — AI-Powered Sports Predictions",
  description:
    "AI-powered sports predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL. Where data meets winning. For entertainment and informational purposes only.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1">{children}</div>
        <footer className="bg-gray-950 border-t border-gray-800 mt-16 py-6">
          <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
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

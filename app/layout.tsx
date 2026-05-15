import type { Metadata } from "next";
import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: "Oddsphere - MLB Stats, Streaks & Trends",
  description:
    "MLB player and team stats, streaks, and trend analysis. For entertainment and informational purposes only.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white min-h-screen">
        <Navbar />
        {children}
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
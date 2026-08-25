import type { Metadata } from "next";

import { HowItWorksGuide } from "@/app/components/how-it-works/HowItWorksGuide";

export const metadata: Metadata = {
  title: "How OddSphere Works | Predictions, Market Movement & Play Grades",
  description:
    "Learn how OddSphere turns model projections, current prices, market movement and supporting evidence into a live Daily Edge and clear Play Grades.",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    type: "website",
    url: "/how-it-works",
    title: "How OddSphere Works",
    description:
      "Understand live projections, market movement, Play Grades, game locks and tracked results before starting your free trial.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "OddSphere AI Daily Edge dashboard preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "How OddSphere Works",
    description:
      "Understand live projections, market movement, Play Grades, game locks and tracked results.",
    images: ["/og-image.png"],
  },
};

export default function HowItWorksPage() {
  return <HowItWorksGuide publicCta />;
}

import type { Metadata } from "next";

import { HowItWorksGuide } from "@/app/components/how-it-works/HowItWorksGuide";

import HowToReviewNav from "./HowToReviewNav";
import ReviewChrome from "./ReviewChrome";

export const metadata: Metadata = {
  title: "How It Works Review | OddSphere AI",
  robots: { index: false, follow: false },
};

export default function OddsphereHowToReviewPage() {
  return (
    <ReviewChrome>
      <HowToReviewNav />
      <HowItWorksGuide />
    </ReviewChrome>
  );
}

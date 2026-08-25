/**
 * Keep the established /lab/my-bets path so existing member bookmarks remain
 * valid while the fourth Lab tab becomes the in-app How It Works guide.
 */

import { HowItWorksGuide } from "@/app/components/how-it-works/HowItWorksGuide";

export default function MyBetsPage() {
  return <HowItWorksGuide />;
}

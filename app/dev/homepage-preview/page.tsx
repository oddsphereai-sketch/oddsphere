import { notFound } from "next/navigation";

import { HomePageContent } from "@/app/page";
import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";

export const metadata = {
  title: "OddSphere Homepage Preview",
  robots: { index: false, follow: false },
};

export default function HomepagePreviewPage() {
  if (!isProductExperiencePreviewAvailable()) notFound();
  return <HomePageContent presentation="candidate" />;
}

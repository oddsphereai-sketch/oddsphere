import { notFound } from "next/navigation";

import LabTrackingPage from "@/app/lab/tracking/TrackingClient";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";

export const metadata = {
  title: "OddSphere Tracking Preview",
  robots: { index: false, follow: false },
};

export default function TrackingPreviewPage() {
  if (!isProductExperiencePreviewAvailable()) notFound();
  return (
    <ProductAppFrame>
      <LabTrackingPage presentation="candidate" />
    </ProductAppFrame>
  );
}

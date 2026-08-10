import { isTrackingExperienceCandidateEnabled } from "@/lib/config/productExperience";

import LabTrackingPage from "./TrackingClient";

export default function TrackingPage() {
  return (
    <LabTrackingPage
      presentation={isTrackingExperienceCandidateEnabled() ? "candidate" : "current"}
    />
  );
}

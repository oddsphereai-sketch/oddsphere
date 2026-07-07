import PublicSeoLandingPage, { seoLandingMetadata } from "../components/seo/PublicSeoLandingPage";
import { SEO_LANDING_PAGES } from "../components/seo/seoLandingPages";

const config = SEO_LANDING_PAGES.worldCupPredictions;

export const metadata = seoLandingMetadata(config);

export default function WorldCupPredictionsPage() {
  return <PublicSeoLandingPage config={config} />;
}


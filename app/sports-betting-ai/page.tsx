import PublicSeoLandingPage, { seoLandingMetadata } from "../components/seo/PublicSeoLandingPage";
import { SEO_LANDING_PAGES } from "../components/seo/seoLandingPages";

const config = SEO_LANDING_PAGES.sportsBettingAi;

export const metadata = seoLandingMetadata(config);

export default function SportsBettingAiPage() {
  return <PublicSeoLandingPage config={config} />;
}


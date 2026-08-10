import { notFound } from "next/navigation";

import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";

export const metadata = {
  title: "OddSphere Device Review",
  robots: { index: false, follow: false },
};

type DeviceReviewParams = Promise<{ target?: string | string[] }>;

export default async function DeviceReviewPage({ searchParams }: { searchParams: DeviceReviewParams }) {
  if (!isProductExperiencePreviewAvailable()) notFound();
  const query = await searchParams;
  const requested = typeof query.target === "string" ? query.target : "";
  const target = allowedTarget(requested) ? requested : "/dev/relaunch-review";

  return (
    <main className="min-h-screen bg-[#05070c] px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">Private device QA</p>
          <h1 className="mt-2 text-2xl font-black">390 × 844 phone viewport</h1>
          <p className="mt-2 text-xs text-gray-500">The frame below is the real candidate route with the normal authenticated session.</p>
        </div>
        <div className="mx-auto h-[844px] w-[390px] max-w-full overflow-hidden rounded-[28px] border border-violet-300/25 bg-black shadow-[0_28px_90px_rgba(0,0,0,0.65)]">
          <iframe title="OddSphere phone review" src={target} className="h-full w-full border-0" />
        </div>
      </div>
    </main>
  );
}

function allowedTarget(target: string): boolean {
  return [
    "/dev/experience-preview",
    "/dev/mlb-props-preview",
    "/dev/tracking-preview",
    "/dev/homepage-preview",
  ].some((prefix) => target === prefix || target.startsWith(`${prefix}?`));
}

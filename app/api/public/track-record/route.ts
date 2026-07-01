import { getPublicTrackRecordSummary } from "@/lib/services/tracking/publicTrackRecordSummary";

export async function GET() {
  const summary = await getPublicTrackRecordSummary();

  return Response.json(summary, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

const MLB_HEADSHOT_BASE = "https://img.mlbstatic.com/mlb-photos/image/upload";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mlb_id: string }> },
) {
  if (isProductionDeployment()) {
    return new Response(null, { status: 404 });
  }

  const { mlb_id: mlbId } = await params;
  if (!/^\d{1,9}$/.test(mlbId)) {
    return new Response(null, { status: 404 });
  }

  const headshotUrl = `${MLB_HEADSHOT_BASE}/w_426,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/${mlbId}/headshot/67/current`;
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      Location: headshotUrl,
    },
  });
}

function isProductionDeployment(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return process.env.VERCEL_ENV === undefined && process.env.NODE_ENV === "production";
}

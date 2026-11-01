import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Importing the stored reader needs DB configuration; auth rejection must not
// reach a database or any provider. These defaults never leave this process.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "fixture-only";
async function main() {
  const { GET } = await import("../app/api/lab/cbb-game-detail/route");
  for (const cookie of [undefined, "oddsphere_beta_session=invalid"]) {
    const request = new NextRequest("https://www.oddsphereai.com/api/lab/cbb-game-detail?game=cbb-1", {
      headers: cookie ? { cookie } : {},
    });
    const response = await GET(request);
    assert.equal(response.status, 401, "async beta-session rejection cannot authorize a detail read");
    assert.deepEqual(await response.json(), { error: "auth_required" });
  }
  console.log("CBB member detail: absent and invalid sessions reject before any stored evidence read.");
}
void main();

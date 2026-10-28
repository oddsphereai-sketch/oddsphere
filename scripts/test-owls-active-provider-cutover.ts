import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const activeProviderFiles = [
  "app/api/admin/nba-preview/route.ts",
  "lib/mlb/props/providerFactory.ts",
  "lib/providers/factory.ts",
  "lib/services/automationOrchestrator.ts",
  "lib/services/linesService.ts",
  "lib/services/marketCoverageAudit.ts",
  "lib/services/wnba/buildWnbaDailyEdgePreview.ts",
] as const;

const forbiddenRuntimePatterns = [
  /process\.env\.SHARPAPI_KEY/,
  /api\.sharpapi\.io/,
  /new\s+SharpApiClient\s*\(/,
  /new\s+SharpAPIOddsProvider\s*\(/,
  /new\s+SharpAPISharpSignalProvider\s*\(/,
] as const;

async function main(): Promise<void> {
  for (const relativePath of activeProviderFiles) {
    const source = await readFile(path.resolve(process.cwd(), relativePath), "utf8");
    for (const pattern of forbiddenRuntimePatterns) {
      assert.equal(
        pattern.test(source),
        false,
        `${relativePath} must not retain active SharpAPI runtime access (${pattern})`,
      );
    }
  }

  const factory = await readFile(path.resolve(process.cwd(), "lib/providers/factory.ts"), "utf8");
  assert.match(factory, /oddsInstance\s*=\s*new OwlsOddsProvider\(/, "real-api odds factory must use Owls");
  assert.match(factory, /sharpSignalInstance\s*=\s*new OwlsSignalProvider\(/, "real-api signal factory must use Owls");

  console.log(`PASS: ${activeProviderFiles.length} active provider surfaces are Owls-cutover safe`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

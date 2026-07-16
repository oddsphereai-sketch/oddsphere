import { MockMLBProvider } from "./providerClients";
import { runFixtureMlbPropBacktest } from "./backtest";
import type { MlbPropMarketKey } from "./config";

export async function scoreMockMlbPropSlate(args: {
  date: string;
  asOfTimestamp?: string;
  marketKeys?: MlbPropMarketKey[];
}) {
  const provider = new MockMLBProvider();
  const asOfTimestamp = args.asOfTimestamp ?? `${args.date}T15:00:00.000Z`;
  return runFixtureMlbPropBacktest({
    provider,
    date: args.date,
    asOfTimestamp,
    marketKeys: args.marketKeys,
  });
}

export async function scoreMlbPropSlate(args: {
  date: string;
  provider: MockMLBProvider;
  asOfTimestamp?: string;
  marketKeys?: MlbPropMarketKey[];
}) {
  return runFixtureMlbPropBacktest({
    provider: args.provider,
    date: args.date,
    asOfTimestamp: args.asOfTimestamp ?? `${args.date}T15:00:00.000Z`,
    marketKeys: args.marketKeys,
  });
}

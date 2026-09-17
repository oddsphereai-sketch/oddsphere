"use client";

import { useEffect, useState } from "react";
import {
  decodeNflPlayerPropsMemberTransport,
  type NflPlayerPropsMemberTransport,
} from "@/lib/services/football/nflPlayerPropsMemberTransport";
import type { NflPlayerPropsMemberSnapshot } from "@/lib/services/football/nflPlayerPropsProductionContract";
import { NflPlayerPropsProductDashboard } from "./NflPlayerPropsProductDashboard";

type DecodeState =
  | { key: string | null; status: "loading"; snapshot: null }
  | { key: string; status: "ready"; snapshot: NflPlayerPropsMemberSnapshot }
  | { key: null; status: "unavailable"; snapshot: null };

export function NflPlayerPropsProductDashboardTransport({
  transport,
  initialSelectedKey = null,
  dataUnavailable = false,
}: {
  transport: NflPlayerPropsMemberTransport | null;
  initialSelectedKey?: string | null;
  dataUnavailable?: boolean;
}) {
  const transportKey = transport?.checksum ?? null;
  const [decoded, setDecoded] = useState<DecodeState>(() => transport
    ? { key: transport.checksum, status: "loading", snapshot: null }
    : { key: null, status: "unavailable", snapshot: null });

  useEffect(() => {
    let active = true;
    if (!transport) return () => { active = false; };
    void decodeNflPlayerPropsMemberTransport(transport)
      .then((snapshot) => {
        if (active) setDecoded({ key: transport.checksum, status: "ready", snapshot });
      })
      .catch((error: unknown) => {
        console.error("NFL player props member transport decode failed", error);
        if (active) setDecoded({ key: null, status: "unavailable", snapshot: null });
      });
    return () => { active = false; };
  }, [transport]);

  const current: DecodeState = decoded.key === transportKey
    ? decoded
    : transport
      ? { key: transportKey, status: "loading", snapshot: null }
      : { key: null, status: "unavailable", snapshot: null };
  if (current.status === "loading") return <NflPlayerPropsBoardSkeleton />;
  return <NflPlayerPropsProductDashboard
    snapshot={current.snapshot}
    initialSelectedKey={initialSelectedKey}
    dataUnavailable={dataUnavailable || current.status === "unavailable"}
  />;
}

function NflPlayerPropsBoardSkeleton() {
  return <div aria-busy="true" aria-label="Loading NFL player props" className="w-full animate-pulse pb-8">
    <div className="h-52 rounded-xl border border-violet-400/10 bg-white/[0.025]" />
    <div className="mt-5 h-36 rounded-xl border border-gray-800 bg-white/[0.02]" />
    <div className="mt-5 grid gap-3 lg:grid-cols-3">
      <div className="h-48 rounded-lg border border-gray-800 bg-white/[0.02]" />
      <div className="h-48 rounded-lg border border-gray-800 bg-white/[0.02]" />
      <div className="h-48 rounded-lg border border-gray-800 bg-white/[0.02]" />
    </div>
  </div>;
}

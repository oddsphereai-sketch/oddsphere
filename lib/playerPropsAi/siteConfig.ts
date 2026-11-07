/** Server-only switches. Both default off; no NEXT_PUBLIC key can enable inference. */
export const PROPS_AI_SITE_RELEASE="player_props_ai_site_2026_11_07_r2_isolated_server_key" as const;
export const PROPS_AI_CONTROL_RELEASE="player_props_ai_control_2026_11_07_r1_explicit_off" as const;
export function propsAiSiteConfig(env:Record<string,string|undefined>=process.env){
  const integrated=env.PLAYER_PROPS_AI_SITE_ENABLED==="true";
  return {integrated,paid:integrated&&env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED==="true",key:(env.PLAYER_PROPS_AI_OPENAI_API_KEY??env.OPENAI_API_KEY)?.trim()??""};
}
export function requireRealPropsAiPermission(){
  if(!propsAiSiteConfig().paid)throw new Error("player_props_ai_paid_runs_disabled");
}

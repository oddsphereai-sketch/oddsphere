# NFL Daily Edge navigation latency r2

Status: behavior-neutral navigation candidate. No prediction, probability, score, grade, price, provider, writer, T-60, tracking, or settlement change.

## Diagnosis

- Current production already uses `router.push`; native replacement is only a 10-second failure watchdog.
- The release-keyed compact NFL fixture is healthy and reduced the server read from about 39.15 MB / 3.2 seconds to 332 KB / 0.34–0.72 seconds before the 15-second private cache.
- On an enabled local Next 16.2.6 production server, the first NFL document completed in 441.5 ms and warm documents completed in 22.9–28.5 ms.
- The existing `router.prefetch()` call on this dynamic search-param route fetched only a roughly 300-byte route marker. The actual NFL RSC response was roughly 341 KB. The installed Next.js 16.2.6 contract requires `prefetch={true}` to fully prefetch a dynamic route.
- Signed-in production browser measurements after the compact-fixture release remained 3.179–3.422 seconds total. The server path does not explain that duration; the remaining wait includes RSC navigation, browser parsing/rendering, and browser-tool action/navigation wait.

## Candidate

When a member points at or keyboard-focuses the NFL tab from another Daily Edge sport, the canonical NFL link upgrades from no prefetch to `prefetch={true}`. Activation remains the existing guarded `router.push`, URL cleanup, focus restoration, and 10-second native fallback. Other sports retain their existing navigation and prefetch behavior. The NFL tab does not full-prefetch while NFL is already active.

This is intentionally user-intent scoped. It does not preload every live sport, does not call a provider, and does not create a second data path. The prefetched result is the same release-keyed compact member snapshot read by the normal route.

## Existing-tab freshness assessment

An already-open MLB tab was separately reported with older movement while a new production navigation showed the latest movement. Current source does not intentionally freeze that snapshot:

- the member page calls `await connection()` and is request-rendered;
- `DailyEdgeLiveRefresh` calls `router.refresh()` every 60 seconds and on focus/resume;
- the MLB member read directly queries the exact `lab_response_snapshots` row on every server render and is not wrapped in `unstable_cache`;
- `ActualDailyEdgePreview` recomputes its normalized games whenever the `snapshot` prop changes.

The same sport/date React key preserves reader state but does not block prop updates. The inner API response's private cache header is not a browser fetch in this direct server call. No lightweight identity poll or `no-store` override is added here because no stale server refresh was reproduced, and either would create a second member read path without a proven cause. A reproduced incident should capture the open tab's displayed `as_of`, visibility/focus state, and the RSC refresh response identity before changing this contract.

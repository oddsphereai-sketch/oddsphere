# Local memory attribution probe

Starting base: `f69e281bb1949e3cadf6865112204934d0eaf264`.

The owner requested continued memory diagnosis and explicitly declined external
support contact. Host-level per-process accounting is unavailable to the project
role. The existing contexts view only describes the connection executing it;
dashboard SQL therefore cannot inspect the five API pool connections.

This no-argument service-only RPC samples the current API backend's allocation
totals and groups its largest contexts by generic name. It also returns counts
and total text bytes for prepared statements, without returning SQL text or
values. The fixed catalog search path and explicit privilege reset prevent
public-schema shadowing or accidental anonymous/member execution.

The narrowly scoped SECURITY DEFINER boundary lets the service role obtain this
metadata without granting it the underlying statistics role or function access.
It accepts no SQL, identifier, PID, path or other caller-controlled input.
The routine reads only pg_catalog views; it changes no rows, model inputs,
snapshot readers, forecasts, leases, schedules, retention or product behavior.

Apply v56 only after protected PR publication; call through the existing service
API and correlate returned PIDs with pg_stat_activity and host metrics. Allocation
contexts do not include every allocator reservation and are not RSS/PSS. Do not
interpret a small result as proof that the process has small private kernel
memory, or a query's temporary peak as an idle leak.

Validation uses disposable PostgreSQL: denied public/member execution, permitted
service execution, hostile public function shadowing, fixed return-field list,
allocation consistency, idempotency and unchanged locked guard payload.
No prediction or model code is touched, so no model release changes apply.

Remove the diagnostic function after the incident via a reviewed migration:
`DROP FUNCTION public.operator_backend_memory_probe(); NOTIFY pgrst,'reload schema';`.
No snapshot or member data needs rollback.

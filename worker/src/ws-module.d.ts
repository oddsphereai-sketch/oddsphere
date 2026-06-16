/**
 * Ambient shim for the `ws` package so the repo typechecks WITHOUT `ws`
 * installed in the local dev environment. The worker lazily imports `ws` only
 * inside the default socket factory (production); all tests inject a mock
 * socket factory and never touch this. `ws` IS a real dependency in
 * worker/package.json — it is installed in the Docker image at deploy time.
 */
declare module "ws";

# workers-sentinel

## 0.2.0

### Minor Changes

- [#15](https://github.com/G4brym/workers-sentinel/pull/15) [`60e122d`](https://github.com/G4brym/workers-sentinel/commit/60e122d28e69a0ced3f33e112d19721759c66b34) Thanks [@G4brym](https://github.com/G4brym)! - Add project member management API and dashboard UI

  - New API endpoints for managing project members (add, remove, update roles, list)
  - Admin-only endpoint to list all registered users
  - Team Members section in project settings with role management UI
  - Role-based access control: only owner/admin can manage members

- [#12](https://github.com/G4brym/workers-sentinel/pull/12) [`f85522b`](https://github.com/G4brym/workers-sentinel/commit/f85522bb3c7e6f77497352d445507d9fa3226617) Thanks [@G4brym](https://github.com/G4brym)! - Add project overview dashboard with error trend visualization, metric cards, and top issues table

- [#19](https://github.com/G4brym/workers-sentinel/pull/19) [`57530fc`](https://github.com/G4brym/workers-sentinel/commit/57530fc862be7594f5632b2b9292252f513781b0) Thanks [@G4brym](https://github.com/G4brym)! - Add personal API token support for programmatic access. Users can create long-lived, revocable tokens from the dashboard's API Tokens page and use them with `Authorization: Bearer wst_...` headers. Tokens are stored as SHA-256 hashes with only the prefix retained for display. Supports optional expiration dates and a 10-token-per-user limit.

- [#13](https://github.com/G4brym/workers-sentinel/pull/13) [`15dec8d`](https://github.com/G4brym/workers-sentinel/commit/15dec8dfd735f125e70404a8115543e41f36a1f8) Thanks [@G4brym](https://github.com/G4brym)! - Add bulk issue operations with multi-select UI for resolving, ignoring, reopening, and deleting multiple issues at once

- [#10](https://github.com/G4brym/workers-sentinel/pull/10) [`a4586bc`](https://github.com/G4brym/workers-sentinel/commit/a4586bc4a939ebaf9c03782de3a8717552e52013) Thanks [@G4brym](https://github.com/G4brym)! - Add environment-based issue filtering with project environment selector

- [#6](https://github.com/G4brym/workers-sentinel/pull/6) [`c242be3`](https://github.com/G4brym/workers-sentinel/commit/c242be3dcd3f8fa9edd56b9560d4735118c28992) Thanks [@G4brym](https://github.com/G4brym)! - Add configurable per-project event retention policies with automatic cleanup via Durable Object alarms. Projects can set a retention period (7, 30, 90, 180, or 365 days, or keep forever) in project settings. A daily alarm-based cleanup process removes expired events, stats, and orphaned issues to keep storage under control.

- [#20](https://github.com/G4brym/workers-sentinel/pull/20) [`3c6b108`](https://github.com/G4brym/workers-sentinel/commit/3c6b1082e36c2a0f618b18396df4434dc555f7d4) Thanks [@G4brym](https://github.com/G4brym)! - Add inbound data filters to drop noisy events during ingestion

- [#16](https://github.com/G4brym/workers-sentinel/pull/16) [`f41f96a`](https://github.com/G4brym/workers-sentinel/commit/f41f96aca7118ee6a94a75816b26c4874652710f) Thanks [@G4brym](https://github.com/G4brym)! - Add issue comments and activity timeline with API endpoints for CRUD operations and a unified activity feed in the dashboard

- [#18](https://github.com/G4brym/workers-sentinel/pull/18) [`0e99853`](https://github.com/G4brym/workers-sentinel/commit/0e9985371883aef170483f20d8e9848b9dabf135) Thanks [@G4brym](https://github.com/G4brym)! - Add issue snooze with Durable Object alarm-based auto-unsnooze

- [#11](https://github.com/G4brym/workers-sentinel/pull/11) [`f772940`](https://github.com/G4brym/workers-sentinel/commit/f772940321a12364f2ec9f03640f3e6a703bf87f) Thanks [@G4brym](https://github.com/G4brym)! - Add per-project event rate limiting with configurable hourly quotas. Projects can set a maximum events per hour threshold, after which new events are rejected with a 429 status code and Retry-After header. Rate limit settings are configurable through the dashboard's project settings page.

- [#7](https://github.com/G4brym/workers-sentinel/pull/7) [`186ddbe`](https://github.com/G4brym/workers-sentinel/commit/186ddbef736d863989d7738d0f506ce47785f10c) Thanks [@G4brym](https://github.com/G4brym)! - Add release tracking and regression detection. Track which software releases introduce errors, view per-release issue breakdowns, and automatically detect regressions when resolved issues reappear in new releases. Exposes new API endpoints for listing releases and release details, with a corresponding Releases dashboard view.

- [#17](https://github.com/G4brym/workers-sentinel/pull/17) [`5ba72e3`](https://github.com/G4brym/workers-sentinel/commit/5ba72e3904dcf6e346faad27b877820bf3bcc578) Thanks [@G4brym](https://github.com/G4brym)! - Add source map upload and client-side stack trace resolution with API endpoints for CRUD operations, a management UI in project settings, and automatic frame resolution in the issue detail view

- [#14](https://github.com/G4brym/workers-sentinel/pull/14) [`ef9d8e7`](https://github.com/G4brym/workers-sentinel/commit/ef9d8e72faa29fa183433ead289e59e1e7628540) Thanks [@G4brym](https://github.com/G4brym)! - Add tag-based search and faceted filtering for issues. Tags collected during event ingestion are now stored in a normalized `event_tags` table, enabling efficient lookups. New API endpoints expose tag facets and values, the issues list supports filtering by tag key-value pairs, and the dashboard includes tag filter controls.

### Patch Changes

- [#21](https://github.com/G4brym/workers-sentinel/pull/21) [`4aebbf1`](https://github.com/G4brym/workers-sentinel/commit/4aebbf1f6b5bdcc0b326ce679b3bbee4105d32e4) Thanks [@G4brym](https://github.com/G4brym)! - Fix PATCH /api/projects/:slug returning 200 instead of 400 when no update fields are provided. Fix totalUsers always returning 0 in project summary due to SqlStorage `.one()` throwing when no existing user record is found during ingestion.

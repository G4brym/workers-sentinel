---
"workers-sentinel": minor
---

Add configurable per-project event retention policies with automatic cleanup via Durable Object alarms. Projects can set a retention period (7, 30, 90, 180, or 365 days, or keep forever) in project settings. A daily alarm-based cleanup process removes expired events, stats, and orphaned issues to keep storage under control.

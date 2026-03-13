---
"workers-sentinel": patch
---

Fix PATCH /api/projects/:slug returning 200 instead of 400 when no update fields are provided. Fix totalUsers always returning 0 in project summary due to SqlStorage `.one()` throwing when no existing user record is found during ingestion.

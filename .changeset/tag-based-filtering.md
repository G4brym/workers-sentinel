---
"workers-sentinel": minor
---

Add tag-based search and faceted filtering for issues. Tags collected during event ingestion are now stored in a normalized `event_tags` table, enabling efficient lookups. New API endpoints expose tag facets and values, the issues list supports filtering by tag key-value pairs, and the dashboard includes tag filter controls.

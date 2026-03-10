---
"workers-sentinel": minor
---

Add per-project event rate limiting with configurable hourly quotas. Projects can set a maximum events per hour threshold, after which new events are rejected with a 429 status code and Retry-After header. Rate limit settings are configurable through the dashboard's project settings page.

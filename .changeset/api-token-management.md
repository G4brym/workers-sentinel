---
"workers-sentinel": minor
---

Add personal API token support for programmatic access. Users can create long-lived, revocable tokens from the dashboard's API Tokens page and use them with `Authorization: Bearer wst_...` headers. Tokens are stored as SHA-256 hashes with only the prefix retained for display. Supports optional expiration dates and a 10-token-per-user limit.

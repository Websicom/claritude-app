# Claritude project safeguards

For every Claritude-related request, assess the proposed implementation before making changes.

- Flag the user before implementation if the request could materially increase database size, analytics/event ingestion, write volume, retained data, provider usage, or operating cost.
- Flag any approach that would weaken the architecture, duplicate an existing data source, introduce unnecessary polling or snapshots, or reduce future scalability.
- Explain the likely impact and recommend a more efficient architecture where one is available.
- Prefer existing aggregates, caches, snapshots, and scheduled processing over duplicating data or adding request-time computation.
- Do not raise warnings for negligible, bounded overhead; focus on material or scaling-sensitive effects.


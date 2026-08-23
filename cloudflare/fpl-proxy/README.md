# Penguin Cup FPL API Worker

Cloudflare Worker data proxy for league `511690`. It caches the league roster,
captain picks and live player points in Workers KV.

## Captain Pick Rate

The rate is league-only:

```text
teams in this league selecting the player as captain
---------------------------------------------------- × 100%
teams in this league with readable picks for the GW
```

## Low-request sync strategy

The league has more than 50 entries, while a Workers Free invocation can make
at most 50 external subrequests. Starting 90 minutes after each official GW
deadline, a five-minute gate fetches at most 40 still-missing entry pick
endpoints. A normal league is therefore locked in three batches over roughly
ten minutes. Completed captain choices are stored once in KV and never fetched
again for that GW.

Completion is checked against the current roster by entry ID rather than raw
array length. If players join or leave after a batch completes, the next cron
captures only newly missing entries and excludes departed entries from the
captain-rate denominator. Once the current GW is complete, the same cron also
backfills any older due GW left incomplete by a prolonged FPL outage.

At Beijing time 07:30, the Worker reads the single FPL live endpoint, records
each captain's base points before any captain multiplier, and publishes one
complete snapshot. Player page views only read KV-backed API responses and do
not call the official FPL API.

## Endpoints

- `GET /api/health`
- `GET /api/status`
- `GET /api/league`
- `GET /api/history`
- `GET /api/gw/:gw`
- `POST /api/refresh` with `Authorization: Bearer <ADMIN_TOKEN>`

## Deploy

See the project handoff instructions. Copy `wrangler.example.jsonc` to
`wrangler.jsonc`, create a KV namespace, paste its ID into the config, set the
admin secret and run Wrangler deploy.

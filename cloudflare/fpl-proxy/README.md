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

## Free-plan sync strategy

The league has more than 50 entries, while a Workers Free invocation can make
at most 50 external subrequests. The cron therefore fetches at most 40 entry
pick endpoints per run. Internal preparation batches run at Beijing time 07:28
and 07:29, then the single public snapshot is published at 07:30. Once picks
for a GW are cached, they are not fetched again; subsequent daily refreshes
mainly require the single FPL live endpoint.

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

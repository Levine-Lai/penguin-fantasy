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
The next daily publish also creates any missing historical snapshots whose picks
were recovered, so an outage spanning a later DDL cannot leave a permanent gap.

At Beijing time 07:30, the Worker reads the FPL live-points and fixture endpoints, records
each captain's base points before any captain multiplier, and publishes one
complete snapshot. Scores, matching duel results and derived challenge refunds commit
in one D1 transaction in `published_rounds`. A per-round revision rejects overlapping
stale writes; separate rows retain concurrent updates to different rounds. KV keeps
legacy history and a best-effort per-round mirror. Player page views only read published API responses and do
not call the official FPL API.

The locked pick stores both the original captain and vice captain. Captain
popularity always remains attached to the original captain. For scoring, an
unstarted captain is shown as not started; only after that player's fixture is
complete with zero minutes does an available vice captain become the scoring
captain. Existing KV picks and snapshots are versioned and migrated in bounded
batches.

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

Before deploying the publication changes, apply the D1 migrations (including
`0003_published_rounds.sql` and `0004_duel_queue.sql`) to `penguin-fantasy-operations` with
`wrangler d1 migrations apply penguin-fantasy-operations --remote --config cloudflare/fpl-proxy/wrangler.jsonc`. Deploy the Worker
only after the migration succeeds.

## Second-stage duel registration

GW9–GW20 registration opens automatically 12 hours before each official DDL and
closes at DDL. Submissions have no round-wide cap; participant exclusivity and the
five season challenge rights remain atomic checks. Locked original captain picks
select up to five eligible groups in submission order. Same-captain, unreadable-pick
and overflow submissions do not consume rights or affect HP. Selection waits for
all submitted participants to be checked, then freezes statuses and a per-round
marker in one D1 transaction. Existing settled rounds retain their selections.

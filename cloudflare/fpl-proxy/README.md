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

临时真人测试报名使用 D1 `settings` 中的 `arena_test_window`：`{gw, opensAt, closesAt}`，时间使用 ISO UTC。仅允许下一轮、尚未到 DDL 且最长 24 小时的窗口；结束后自动回到 DDL 前 12 小时的常规安排。窗口同时受报名原子 SQL 校验，不能绕过参与人互斥、挑战次数或官方 DDL。运营开启时保留审计记录；测试报名仍为正式记录，不自动删除。

持续真人测试可设置 `arena_test_open` 为 `{ "gw": 9, "open": true }`，不设一小时或 24 小时到期。该开关优先于临时窗口，关闭时删除 `arena_test_open` 与 `arena_test_window`；正式 DDL、参与互斥和挑战次数仍由同一条原子 SQL 校验。API 代理对 JSON 使用 identity 上游和 no-transform 下游，避免部分浏览器/网络的压缩响应超时；只读请求最多重试一次，写入请求不因网络错误重发。

报名区优先展示排行榜已加载的联赛名单，公共 `/community` 不作为玩家搜索或已确认提交的阻塞依赖。鉴权 `/duels/mine` 同时返回本人的报名限制及 `arena` 窗口；前端收到签名会话状态后才允许提交，后台原子校验保持不变。

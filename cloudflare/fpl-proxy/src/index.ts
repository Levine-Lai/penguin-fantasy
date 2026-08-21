interface KVNamespace {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

interface Env {
  FPL_CACHE: KVNamespace;
  LEAGUE_ID: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

type FplEvent = {
  id: number;
  name: string;
  deadline_time: string;
  is_current: boolean;
  is_next: boolean;
  finished: boolean;
};

type Bootstrap = {
  events: FplEvent[];
  elements: Array<{ id: number; web_name: string }>;
};

type LeagueMember = {
  entryId: number;
  teamName: string;
};

type PickRecord = {
  captainId: number;
  multiplier: number;
};

type PicksDocument = {
  gw: number;
  checkedEntryIds: number[];
  picksByEntry: Record<string, PickRecord | null>;
  updatedAt: string;
  completedAt?: string;
};

type CachedValue<T> = {
  value: T;
  cachedAt: string;
};

const FPL_ORIGIN = "https://fantasy.premierleague.com/api";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const PICKS_BATCH_SIZE = 40;

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "penguin-cup-fpl-api" }, request, env, 30);
      }

      if (url.pathname === "/api/league") {
        const roster = await env.FPL_CACHE.get<LeagueMember[]>("league:roster", "json");
        if (!roster) {
          return json({ ready: false, message: "联赛名单正在首次同步" }, request, env, 5, 202);
        }
        return json({ ready: true, leagueId: Number(env.LEAGUE_ID), teams: roster }, request, env, 300);
      }

      if (url.pathname === "/api/history") {
        const [history, deadlines] = await Promise.all([getSnapshotHistory(env), getSeasonDeadlines(env)]);
        return json({ ready: history.length > 0, snapshots: history, deadlines }, request, env, 60);
      }

      const gwMatch = url.pathname.match(/^\/api\/gw\/(\d{1,2})$/);
      if (gwMatch) {
        const gw = Number(gwMatch[1]);
        const snapshot = await env.FPL_CACHE.get(`snapshot:gw:${gw}`, "json");
        if (!snapshot) {
          return json({ ready: false, gw, message: "该周数据尚未发布" }, request, env, 5, 202);
        }
        return json(snapshot, request, env, 60);
      }

      if (url.pathname === "/api/status") {
        const status = await env.FPL_CACHE.get("sync:status", "json");
        return json(status ?? { ready: false }, request, env, 5);
      }

      if (url.pathname === "/api/refresh" && request.method === "POST") {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
          return json({ error: "Unauthorized" }, request, env, 0, 401);
        }
        ctx.waitUntil(publishDailySnapshot(env));
        return json({ accepted: true }, request, env, 0, 202);
      }

      return json({ error: "Not found" }, request, env, 0, 404);
    } catch (error) {
      return json(
        { error: "Worker request failed", detail: error instanceof Error ? error.message : String(error) },
        request,
        env,
        0,
        500,
      );
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContextLike): Promise<void> {
    if (controller.cron === "30 23 * * *") {
      ctx.waitUntil(publishDailySnapshot(env));
      return;
    }
    ctx.waitUntil(captureDueCaptainPicks(env, controller.scheduledTime));
  },
};

export default worker;

async function captureDueCaptainPicks(env: Env, scheduledTime = Date.now()): Promise<void> {
  const cachedBootstrap = await env.FPL_CACHE.get<CachedValue<Bootstrap>>("fpl:bootstrap", "json");
  const bootstrap = cachedBootstrap?.value
    ?? await cachedFetch<Bootstrap>(env, "fpl:bootstrap", "/bootstrap-static/", 6 * 60 * 60);
  const event = selectLatestCaptureEvent(bootstrap.events, scheduledTime);
  if (!event) return;

  let picksDocument = await getPicksDocument(env, event.id);
  if (picksDocument.completedAt) return;

  const roster = await getRoster(env);
  picksDocument = await syncPicksBatch(env, event.id, roster, picksDocument);
  const completed = picksDocument.checkedEntryIds.length >= roster.length;
  await env.FPL_CACHE.put(
    "sync:status",
    JSON.stringify({
      state: completed ? "picks_ready" : "capturing_picks",
      gw: event.id,
      picksChecked: picksDocument.checkedEntryIds.length,
      teams: roster.length,
      completed,
      picksCapturedAt: picksDocument.completedAt ?? null,
      updatedAt: new Date().toISOString(),
    }),
  );
}

async function publishDailySnapshot(env: Env, requestedGw?: number): Promise<void> {
  const startedAt = new Date().toISOString();
  const previousStatus = await env.FPL_CACHE.get<Record<string, unknown>>("sync:status", "json");
  await env.FPL_CACHE.put("sync:status", JSON.stringify({ ...previousStatus, state: "running", startedAt }));

  try {
    const bootstrap = await cachedFetch<Bootstrap>(env, "fpl:bootstrap", "/bootstrap-static/", 6 * 60 * 60);
    const roster = await getRoster(env);
    const event = requestedGw
      ? bootstrap.events.find((item) => item.id === requestedGw)
      : selectLatestPassedEvent(bootstrap.events, Date.now());

    if (!event) {
      throw new Error("No relevant FPL event found");
    }

    const deadlineHasPassed = Date.now() >= Date.parse(event.deadline_time);
    const picksDocument = await getPicksDocument(env, event.id);
    if (!picksDocument.completedAt || picksDocument.checkedEntryIds.length < roster.length) {
      await env.FPL_CACHE.put(
        "sync:status",
        JSON.stringify({
          state: "waiting_for_picks",
          gw: event.id,
          picksChecked: picksDocument.checkedEntryIds.length,
          teams: roster.length,
          completed: false,
          updatedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    const live = deadlineHasPassed
      ? await fetchFpl<{ elements: Array<{ id: number; stats: { total_points: number } }> }>(`/event/${event.id}/live/`)
      : { elements: [] };

    const playerNames = Object.fromEntries(bootstrap.elements.map((player) => [player.id, player.web_name]));
    const livePoints = Object.fromEntries(live.elements.map((player) => [player.id, player.stats.total_points]));
    const validPicks = Object.values(picksDocument.picksByEntry).filter((pick): pick is PickRecord => Boolean(pick));
    const captainCounts = validPicks.reduce<Record<string, number>>((counts, pick) => {
      counts[pick.captainId] = (counts[pick.captainId] ?? 0) + 1;
      return counts;
    }, {});
    const denominator = validPicks.length;

    const teams = roster.map((member) => {
      const pick = picksDocument.picksByEntry[member.entryId] ?? null;
      const rawPoints = pick ? Number(livePoints[pick.captainId] ?? 0) : 0;
      const captainPickRate = pick && denominator > 0
        ? Number((((captainCounts[pick.captainId] ?? 0) / denominator) * 100).toFixed(1))
        : null;

      return {
        ...member,
        captainId: pick?.captainId ?? null,
        captainName: pick ? playerNames[pick.captainId] ?? `Player ${pick.captainId}` : null,
        captainPoints: rawPoints,
        captainPickRate,
      };
    });

    const completed = picksDocument.checkedEntryIds.length >= roster.length;
    const snapshot = {
      ready: deadlineHasPassed && denominator > 0,
      leagueId: Number(env.LEAGUE_ID),
      gw: event.id,
      eventName: event.name,
      deadlineTime: event.deadline_time,
      deadlineHasPassed,
      picksSync: {
        checked: picksDocument.checkedEntryIds.length,
        total: roster.length,
        valid: denominator,
        completed,
        capturedAt: picksDocument.completedAt,
      },
      pointsDefinition: "队长球员在 FPL 的基础得分，不计算队长双倍或三倍倍率",
      captainPickRateDefinition: "本联赛中选择该球员为当周队长的有效队伍数 / 本联赛当周可读取队长选择的队伍数",
      teams,
      updatedAt: new Date().toISOString(),
    };

    await env.FPL_CACHE.put(`snapshot:gw:${event.id}`, JSON.stringify(snapshot));
    const history = await getSnapshotHistory(env);
    const nextHistory = [...history.filter((item) => item.gw !== event.id), snapshot]
      .sort((left, right) => left.gw - right.gw);
    await env.FPL_CACHE.put("snapshot:history", JSON.stringify(nextHistory));
    await env.FPL_CACHE.put(
      "sync:status",
      JSON.stringify({
        state: "ready",
        gw: event.id,
        picksChecked: picksDocument.checkedEntryIds.length,
        teams: roster.length,
        completed,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    await env.FPL_CACHE.put(
      "sync:status",
      JSON.stringify({
        state: "error",
        startedAt,
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

async function getSnapshotHistory(env: Env): Promise<Array<{ gw: number } & Record<string, unknown>>> {
  const history = await env.FPL_CACHE.get<Array<{ gw: number } & Record<string, unknown>>>("snapshot:history", "json");
  if (history) return history;

  const status = await env.FPL_CACHE.get<{ gw?: number }>("sync:status", "json");
  if (!status?.gw) return [];
  const current = await env.FPL_CACHE.get<{ gw: number } & Record<string, unknown>>(`snapshot:gw:${status.gw}`, "json");
  return current ? [current] : [];
}

async function getSeasonDeadlines(env: Env): Promise<Array<{ gw: number; deadlineTime: string }>> {
  const cached = await env.FPL_CACHE.get<CachedValue<Bootstrap>>("fpl:bootstrap", "json");
  const bootstrap = cached?.value ?? await cachedFetch<Bootstrap>(env, "fpl:bootstrap", "/bootstrap-static/", 6 * 60 * 60);
  return bootstrap.events.map((event) => ({ gw: event.id, deadlineTime: event.deadline_time }));
}

async function getRoster(env: Env): Promise<LeagueMember[]> {
  const key = "league:roster:cached";
  const cached = await env.FPL_CACHE.get<CachedValue<LeagueMember[]>>(key, "json");
  if (cached && Date.now() - Date.parse(cached.cachedAt) < 6 * 60 * 60 * 1000) {
    return cached.value;
  }

  const members = new Map<number, LeagueMember>();
  for (let page = 1; page <= 20; page += 1) {
    const payload = await fetchFpl<{
      standings?: { results?: Array<Record<string, unknown>>; has_next?: boolean };
      new_entries?: { results?: Array<Record<string, unknown>>; has_next?: boolean };
    }>(`/leagues-classic/${env.LEAGUE_ID}/standings/?page_new_entries=${page}&page_standings=${page}&phase=1`);

    const groups = [payload.standings, payload.new_entries];
    for (const group of groups) {
      for (const row of group?.results ?? []) {
        const entryId = Number(row.entry ?? row.id);
        const teamName = String(row.entry_name ?? row.name ?? `Team ${entryId}`);
        if (Number.isFinite(entryId)) members.set(entryId, { entryId, teamName });
      }
    }

    if (!groups.some((group) => group?.has_next)) break;
  }

  const roster = [...members.values()];
  await env.FPL_CACHE.put(key, JSON.stringify({ value: roster, cachedAt: new Date().toISOString() }));
  await env.FPL_CACHE.put("league:roster", JSON.stringify(roster));
  return roster;
}

async function getPicksDocument(env: Env, gw: number): Promise<PicksDocument> {
  return (
    (await env.FPL_CACHE.get<PicksDocument>(`picks:gw:${gw}`, "json")) ?? {
      gw,
      checkedEntryIds: [],
      picksByEntry: {},
      updatedAt: new Date(0).toISOString(),
    }
  );
}

async function syncPicksBatch(
  env: Env,
  gw: number,
  roster: LeagueMember[],
  document: PicksDocument,
): Promise<PicksDocument> {
  const checked = new Set(document.checkedEntryIds);
  const pending = roster.filter((member) => !checked.has(member.entryId)).slice(0, PICKS_BATCH_SIZE);
  if (pending.length === 0) {
    if (checked.size >= roster.length && !document.completedAt) {
      document.updatedAt = new Date().toISOString();
      document.completedAt = document.updatedAt;
      await env.FPL_CACHE.put(`picks:gw:${gw}`, JSON.stringify(document));
    }
    return document;
  }

  const results = await mapWithConcurrency(pending, 6, async (member) => {
    try {
      const payload = await fetchFpl<{
        picks: Array<{ element: number; multiplier: number; is_captain: boolean }>;
      }>(`/entry/${member.entryId}/event/${gw}/picks/`);
      const captain = payload.picks.find((pick) => pick.is_captain);
      return {
        entryId: member.entryId,
        pick: captain ? { captainId: captain.element, multiplier: captain.multiplier } : null,
      };
    } catch (error) {
      if (error instanceof FplHttpError && error.status === 404) {
        return { entryId: member.entryId, pick: null };
      }
      throw error;
    }
  });

  for (const result of results) {
    checked.add(result.entryId);
    document.picksByEntry[result.entryId] = result.pick;
  }
  document.checkedEntryIds = [...checked];
  document.updatedAt = new Date().toISOString();
  if (document.checkedEntryIds.length >= roster.length) document.completedAt = document.updatedAt;
  await env.FPL_CACHE.put(`picks:gw:${gw}`, JSON.stringify(document));
  return document;
}

async function cachedFetch<T>(env: Env, key: string, path: string, ttlSeconds: number): Promise<T> {
  const cached = await env.FPL_CACHE.get<CachedValue<T>>(key, "json");
  if (cached && Date.now() - Date.parse(cached.cachedAt) < ttlSeconds * 1000) return cached.value;
  const value = await fetchFpl<T>(path);
  await env.FPL_CACHE.put(key, JSON.stringify({ value, cachedAt: new Date().toISOString() }));
  return value;
}

async function fetchFpl<T>(path: string): Promise<T> {
  const response = await fetch(`${FPL_ORIGIN}${path}`, {
    headers: {
      accept: "application/json",
      "user-agent": "PenguinCup/1.0 (+https://example.com)",
    },
  });
  if (!response.ok) throw new FplHttpError(response.status, `${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

class FplHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function selectLatestPassedEvent(events: FplEvent[], now: number): FplEvent | undefined {
  return events
    .filter((event) => Date.parse(event.deadline_time) <= now)
    .sort((left, right) => left.id - right.id)
    .at(-1);
}

function selectLatestCaptureEvent(events: FplEvent[], now: number): FplEvent | undefined {
  const captureDelayMs = 90 * 60 * 1000;
  return events
    .filter((event) => Date.parse(event.deadline_time) + captureDelayMs <= now)
    .sort((left, right) => left.id - right.id)
    .at(-1);
}

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, mapper: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function json(
  data: unknown,
  request: Request,
  env: Env,
  maxAge: number,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request, env),
      "cache-control": `public, max-age=${maxAge}, s-maxage=${Math.max(maxAge, 60)}`,
    },
  });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowOrigin = allowed.includes("*") || allowed.includes(origin) ? origin || "*" : allowed[0] ?? "null";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type",
    vary: "Origin",
  };
}

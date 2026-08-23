import assert from "node:assert/strict";
import test from "node:test";

import { captureDueCaptainPicks, publishDailySnapshot } from "../cloudflare/fpl-proxy/src/index.ts";

class MemoryKv {
  values = new Map();

  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

function createEvents(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Gameweek ${index + 1}`,
    deadline_time: new Date(Date.UTC(2026, 7, 1 + index * 7, 12)).toISOString(),
    is_current: index === 0,
    is_next: index === 1,
    finished: false,
  }));
}

function createRoster(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => ({
    entryId: first + index,
    teamName: `Team ${first + index}`,
  }));
}

async function seedEnv(events, roster) {
  const kv = new MemoryKv();
  const bootstrap = {
    events,
    elements: Array.from({ length: 4 }, (_, index) => ({ id: 101 + index, web_name: `Captain ${101 + index}` })),
  };
  const cachedAt = new Date().toISOString();
  await kv.put("fpl:bootstrap", JSON.stringify({ value: bootstrap, cachedAt }));
  await kv.put("league:roster:cached", JSON.stringify({ value: roster, cachedAt }));
  await kv.put("league:roster", JSON.stringify(roster));
  return { FPL_CACHE: kv, LEAGUE_ID: "511690" };
}

function installFplMock({ failOnceForEntry } = {}) {
  const calls = [];
  let pendingFailure = failOnceForEntry;
  let livePointsBonus = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);

    const picksMatch = url.pathname.match(/\/entry\/(\d+)\/event\/(\d+)\/picks\/$/);
    if (picksMatch) {
      const entryId = Number(picksMatch[1]);
      if (pendingFailure === entryId) {
        pendingFailure = undefined;
        return new Response("temporary outage", { status: 503 });
      }
      const captainId = 101 + (entryId % 4);
      return Response.json({ picks: [{ element: captainId, multiplier: 2, is_captain: true }] });
    }

    const liveMatch = url.pathname.match(/\/event\/(\d+)\/live\/$/);
    if (liveMatch) {
      const gw = Number(liveMatch[1]);
      return Response.json({
        elements: Array.from({ length: 4 }, (_, index) => ({
          id: 101 + index,
          stats: { total_points: gw + index + livePointsBonus },
        })),
      });
    }

    throw new Error(`Unexpected FPL request: ${url.pathname}`);
  };

  return {
    calls,
    setLivePointsBonus(value) {
      livePointsBonus = value;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("honors the DDL plus 90-minute gate and never publishes a partial roster", async () => {
  const [event] = createEvents(1);
  const env = await seedEnv([event], createRoster(1, 111));
  const mock = installFplMock();
  const deadline = Date.parse(event.deadline_time);

  try {
    await captureDueCaptainPicks(env, deadline + 90 * 60 * 1000 - 1);
    assert.equal(mock.calls.filter((path) => path.includes("/picks/")).length, 0);

    await captureDueCaptainPicks(env, deadline + 90 * 60 * 1000);
    await captureDueCaptainPicks(env, deadline + 95 * 60 * 1000);
    await publishDailySnapshot(env, 1, deadline + 24 * 60 * 60 * 1000);
    assert.equal(await env.FPL_CACHE.get("snapshot:gw:1", "json"), null);
    assert.equal((await env.FPL_CACHE.get("sync:status", "json")).state, "waiting_for_picks");

    await captureDueCaptainPicks(env, deadline + 100 * 60 * 1000);
    await publishDailySnapshot(env, 1, deadline + 24 * 60 * 60 * 1000);
    assert.equal((await env.FPL_CACHE.get("snapshot:gw:1", "json")).teams.length, 111);
  } finally {
    mock.restore();
  }
});

test("refreshes the same GW snapshot each morning without duplicating its history entry", async () => {
  const [event] = createEvents(1);
  const env = await seedEnv([event], createRoster(1, 111));
  const mock = installFplMock();
  const firstPublish = Date.parse(event.deadline_time) + 24 * 60 * 60 * 1000;

  try {
    await captureWholeRoster(env, event);
    await publishDailySnapshot(env, 1, firstPublish);
    const firstSnapshot = await env.FPL_CACHE.get("snapshot:gw:1", "json");

    mock.setLivePointsBonus(10);
    await publishDailySnapshot(env, 1, firstPublish + 24 * 60 * 60 * 1000);
    const refreshedSnapshot = await env.FPL_CACHE.get("snapshot:gw:1", "json");
    const history = await env.FPL_CACHE.get("snapshot:history", "json");

    assert.equal(refreshedSnapshot.teams[0].captainPoints, firstSnapshot.teams[0].captainPoints + 10);
    assert.equal(history.length, 1);
    assert.equal(history[0].gw, 1);
    assert.equal(mock.calls.filter((path) => path.includes("/picks/")).length, 111);
  } finally {
    mock.restore();
  }
});

async function captureWholeRoster(env, event, attempts = 3) {
  const firstCapture = Date.parse(event.deadline_time) + 90 * 60 * 1000;
  for (let index = 0; index < attempts; index += 1) {
    await captureDueCaptainPicks(env, firstCapture + index * 5 * 60 * 1000);
  }
}

test("simulates GW1–GW8 without duplicate picks, missing history, or mixed snapshots", async () => {
  const events = createEvents(8);
  const roster = createRoster(1, 111);
  const env = await seedEnv(events, roster);
  const mock = installFplMock();

  try {
    for (const event of events) {
      const callsBefore = mock.calls.filter((path) => path.includes("/picks/")).length;
      await captureWholeRoster(env, event);
      await captureDueCaptainPicks(env, Date.parse(event.deadline_time) + 110 * 60 * 1000);
      const callsAfter = mock.calls.filter((path) => path.includes("/picks/")).length;
      assert.equal(callsAfter - callsBefore, 111, `GW${event.id} should read each entry exactly once`);

      await publishDailySnapshot(env, undefined, Date.parse(event.deadline_time) + 36 * 60 * 60 * 1000);
      const snapshot = await env.FPL_CACHE.get(`snapshot:gw:${event.id}`, "json");
      assert.equal(snapshot.ready, true);
      assert.equal(snapshot.teams.length, 111);
      assert.equal(snapshot.picksSync.checked, 111);
      assert.equal(snapshot.picksSync.total, 111);
      assert.equal(snapshot.picksSync.valid, 111);
      assert.equal(snapshot.picksSync.completed, true);
    }

    const history = await env.FPL_CACHE.get("snapshot:history", "json");
    assert.deepEqual(history.map((snapshot) => snapshot.gw), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(history.every((snapshot) => snapshot.teams.length === 111));
  } finally {
    mock.restore();
  }
});

test("reconciles a same-size roster replacement without polluting captain rates", async () => {
  const [event] = createEvents(1);
  const originalRoster = createRoster(1, 111);
  const env = await seedEnv([event], originalRoster);
  const mock = installFplMock();

  try {
    await captureWholeRoster(env, event);
    const replacementRoster = [...createRoster(2, 111), { entryId: 112, teamName: "Team 112" }];
    await env.FPL_CACHE.put("league:roster:cached", JSON.stringify({ value: replacementRoster, cachedAt: new Date().toISOString() }));
    await captureDueCaptainPicks(env, Date.parse(event.deadline_time) + 110 * 60 * 1000);
    await publishDailySnapshot(env, 1, Date.parse(event.deadline_time) + 36 * 60 * 60 * 1000);

    const snapshot = await env.FPL_CACHE.get("snapshot:gw:1", "json");
    assert.equal(snapshot.picksSync.checked, 111);
    assert.equal(snapshot.picksSync.total, 111);
    assert.equal(snapshot.picksSync.valid, 111);
    assert.equal(snapshot.teams.some((team) => team.entryId === 1), false);
    assert.equal(snapshot.teams.some((team) => team.entryId === 112), true);

    const captain101Count = replacementRoster.filter((team) => 101 + (team.entryId % 4) === 101).length;
    const team112 = snapshot.teams.find((team) => team.entryId === 112);
    assert.equal(team112.captainPickRate, Number((captain101Count / 111 * 100).toFixed(1)));
    assert.equal(mock.calls.filter((path) => path === "/api/entry/112/event/1/picks/").length, 1);
  } finally {
    mock.restore();
  }
});

test("captures the current GW first, then backfills an older incomplete GW", async () => {
  const events = createEvents(2);
  const roster = createRoster(1, 111);
  const env = await seedEnv(events, roster);
  const mock = installFplMock();

  try {
    const gw2CaptureTime = Date.parse(events[1].deadline_time) + 90 * 60 * 1000;
    for (let index = 0; index < 6; index += 1) {
      await captureDueCaptainPicks(env, gw2CaptureTime + index * 5 * 60 * 1000);
    }

    const pickCalls = mock.calls.filter((path) => path.includes("/picks/"));
    assert.ok(pickCalls.slice(0, 111).every((path) => path.includes("/event/2/")));
    assert.ok(pickCalls.slice(111).every((path) => path.includes("/event/1/")));
    assert.ok((await env.FPL_CACHE.get("picks:gw:1", "json")).completedAt);
    assert.ok((await env.FPL_CACHE.get("picks:gw:2", "json")).completedAt);
  } finally {
    mock.restore();
  }
});

test("retries a temporary FPL failure without committing a partial batch", async () => {
  const [event] = createEvents(1);
  const env = await seedEnv([event], createRoster(1, 111));
  const mock = installFplMock({ failOnceForEntry: 5 });
  const firstCapture = Date.parse(event.deadline_time) + 90 * 60 * 1000;

  try {
    await assert.rejects(captureDueCaptainPicks(env, firstCapture), /503/);
    assert.equal(await env.FPL_CACHE.get("picks:gw:1", "json"), null);

    await captureDueCaptainPicks(env, firstCapture + 5 * 60 * 1000);
    await captureDueCaptainPicks(env, firstCapture + 10 * 60 * 1000);
    await captureDueCaptainPicks(env, firstCapture + 15 * 60 * 1000);
    const document = await env.FPL_CACHE.get("picks:gw:1", "json");
    assert.equal(document.checkedEntryIds.length, 111);
    assert.ok(document.completedAt);
  } finally {
    mock.restore();
  }
});

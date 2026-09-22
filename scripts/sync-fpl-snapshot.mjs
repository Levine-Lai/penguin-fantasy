import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const apiBase = "https://penguin-fantasy.pages.dev/api";
const snapshotUrl = new URL("../app/static-fpl-data.json", import.meta.url);
const snapshotPath = fileURLToPath(snapshotUrl);

async function fetchJson(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function isUsableLeague(value) {
  return value?.ready === true && Array.isArray(value.teams) && value.teams.length > 0;
}

function isUsableHistory(value) {
  return value?.ready === true && Array.isArray(value.snapshots) && value.snapshots.some((snapshot) => snapshot?.teams?.length > 0);
}

try {
  const [league, history] = await Promise.all([fetchJson("/league"), fetchJson("/history")]);
  if (!isUsableLeague(league) || !isUsableHistory(history)) throw new Error("API returned an incomplete snapshot");

  let existing = null;
  try {
    existing = JSON.parse(await readFile(snapshotPath, "utf8"));
  } catch {
    // A missing or invalid local snapshot is replaced below.
  }

  const dataIsUnchanged =
    JSON.stringify(existing?.league) === JSON.stringify(league) &&
    JSON.stringify(existing?.history) === JSON.stringify(history);

  if (dataIsUnchanged) {
    console.log(`[snapshot] unchanged: ${league.teams.length} teams and ${history.snapshots.length} gameweeks`);
  } else {
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), league, history }, null, 2)}\n`, "utf8");
    console.log(`[snapshot] stored ${league.teams.length} teams and ${history.snapshots.length} gameweeks`);
  }
} catch (error) {
  try {
    const existing = JSON.parse(await readFile(snapshotPath, "utf8"));
    if (!isUsableLeague(existing?.league) || !isUsableHistory(existing?.history)) throw new Error("existing snapshot is incomplete");
    console.warn(`[snapshot] live refresh failed; keeping bundled snapshot: ${String(error)}`);
  } catch {
    throw error;
  }
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Penguin Cup leaderboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /PENGUIN CUP/);
  assert.match(html, /冰渊王座/);
  assert.match(html, /冰海角斗场/);
  assert.doesNotMatch(html, /刷新排行榜数据|刷新数据|数据已更新|更新失败/);
  assert.match(html, /data-current-trial[^>]*>GW \d+/);
  assert.match(html, /当周队长得分/);
  assert.match(html, /血量/);
  assert.match(html, /aria-label="1 点血量"/);
  assert.match(html, /class="rank-gem rank-gem-/);
  assert.match(html, /class="pixel-health"/);
  assert.match(html, /class="blood-drop"/);
  const renderedPlayerNames = [...html.matchAll(/class="player-id[^"]*"[^>]*>([^<]+)<\/strong>/g)].map((match) => match[1]);
  assert.deepEqual(renderedPlayerNames.slice(0, 2), ["SSU - Sakai Moka", "企鹅"]);
  assert.match(html, /队长总分/);
  assert.doesNotMatch(html, />GPC<|>TP<|>HP</);
  assert.equal((html.match(/class="rank-row/g) ?? []).length, 20);
  assert.doesNotMatch(html, /搜索玩家/);
});

test("keeps the five-stage interaction and unified ranking contracts", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.equal((page.match(/id:\s*[1-5],\s*roman:/g) ?? []).length, 5);
  assert.match(page, /key=\{`ranking-\$\{activeStage\}`\}/);
  assert.match(page, /className="stage-switcher"/);
  assert.match(page, /rank-gem rank-gem-/);
  assert.match(page, /assets\/leaderboard\/ice-ledger-frame\.png/);
  assert.match(page, /assets\/leaderboard\/ice-frame-complete\.png/);
  assert.match(page, /assets\/leaderboard\/ice-row-frame\.png/);
  assert.match(page, /assets\/leaderboard\/ice-history-frame\.png/);
  assert.match(page, /Official FPL classic league 511690 roster/);
  const rosterBlock = page.match(/const players = \[([\s\S]*?)\n\];/)?.[1] ?? "";
  assert.equal((rosterBlock.match(/^\s*".*",\s*$/gm) ?? []).length, 111);
  assert.match(rosterBlock, /"JZhuoyan"/);
  assert.match(rosterBlock, /"Shuo City"/);
  assert.doesNotMatch(rosterBlock, /"Shuo Home"|"Rainbow Desert"/);
  assert.match(page, /assets\/leaderboard\/ice-side-left\.png/);
  assert.match(page, /assets\/leaderboard\/ice-side-right\.png/);
  assert.match(page, /assets\/leaderboard\/score-slot\.png/);
  assert.match(page, /assets\/leaderboard\/pixel-heart\.svg/);
  assert.match(page, /className="pixel-health"/);
  assert.match(page, /className="blood-drop"/);
  assert.match(page, /Array\.from\(\{ length: hp \}/);
  assert.match(page, /className="ranking-pagination"/);
  assert.match(page, /const pageSize = 20/);
  assert.match(page, /function lifeEarned/);
  assert.match(page, /rate !== null && rate < 10 \? 2 : 1/);
  assert.match(page, /right\.hp - left\.hp[\s\S]*right\.captainTotal - left\.captainTotal[\s\S]*left\.captainRateTotal - right\.captainRateTotal/);
  assert.match(page, /featuredTeamOrder\.get\(left\.name\)[\s\S]*featuredTeamOrder\.get\(right\.name\)/);
  assert.match(page, /captainRateTotal:\s*history\.reduce\(\(total, item\) => total \+ item\.rate, 0\)/);
  assert.match(page, /\["SSU - Sakai Moka", 0\]/);
  assert.match(page, /\["企鹅", 1\]/);
  assert.match(page, /featuredTeamOrder\.has\(name\) \? "featured-player"/);
  assert.match(page, /rank: index \+ 1/);
  assert.match(page, />\{rank\}<\/span>/);
  assert.match(page, /penguin-fantasy\.pages\.dev/);
  assert.match(page, /\/api\/league/);
  assert.match(page, /\/api\/history/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /window\.addEventListener\("pageshow"/);
  assert.match(page, /beijingSnapshotDay/);
  assert.match(page, /nextBeijingSnapshotRefreshDelay/);
  assert.match(page, /scheduleDailyRefresh/);
  assert.doesNotMatch(page, /data-refresh|refresh-status|刷新排行榜数据/);
  assert.match(page, /type CaptainPopularity/);
  assert.match(page, /className="panel ranking-panel captain-rate-panel"/);
  assert.match(page, />队长名字</);
  assert.match(page, />当轮分数</);
  assert.match(page, />选择人数</);
  assert.match(page, />选择率</);
  assert.match(page, /captain\.selections \/ selections\.length \* 100/);
  assert.match(page, /right\.selections - left\.selections/);
  assert.doesNotMatch(page, /\.at\(-1\)/);
  assert.doesNotMatch(page, /Array\.from\(\{ length: relevantGw \}/);
  assert.match(page, /history\.deadlines \?\? \[\]/);
  assert.match(page, /Date\.parse\(event\.deadlineTime\)/);
  assert.match(page, /deadline <= currentTime/);
  assert.match(page, /latestStartedGw > 0 \? `GW \$\{latestStartedGw\}`/);
  assert.match(page, /setInterval\(\(\) => setCurrentTime\(Date\.now\(\)\), 30_000\)/);
  assert.match(page, /const fallbackGwDeadlines:[\s\S]*gw:\s*38/);
  assert.match(page, /data-current-trial suppressHydrationWarning/);
  assert.match(page, /currentTrialBootstrapScript/);
  assert.match(page, /尚无队长选择记录/);
  assert.match(page, /InlineCaptainHistory playerName=\{name\} history=\{history\} currentGwLabel=\{currentTrialLabel\}/);
  assert.doesNotMatch(page, /<header><strong>队长选择记录<\/strong><small>见习者集结<\/small><\/header>/);
  assert.match(page, /useState<StageId>\(1\)/);
  assert.match(page, /item\.id === 1 \? <i>当前<\/i>/);
  assert.match(page, /className="brand-emblem"/);
  assert.match(page, /className="stage-relic"/);
  assert.match(page, /assets\/stages\/stage-\$\{item\.id\}\.png/);
  const stageArtifacts = await Promise.all(
    [1, 2, 3, 4, 5].map((id) => readFile(new URL(`../public/assets/stages/stage-${id}.png`, import.meta.url))),
  );
  assert.ok(stageArtifacts.every((asset) => asset.byteLength > 100_000));
  assert.match(page, /stage-lore stage-lore-/);
  assert.equal((page.match(/description:\s*"/g) ?? []).length, 5);
  assert.doesNotMatch(page, /iceBurst|ice-burst|ice-fragments|ice-dust|ice-cloud/);
  assert.doesNotMatch(page, /className="stage-token"|className="stage-sigil"/);
  assert.doesNotMatch(page, /className="hero-seal"/);
  assert.doesNotMatch(page, /hero-metrics|当前为模拟数据|后续接入 FPL API/);
  assert.match(page, /据说，只有经历五重试炼、在冰山与深海之间活到最后的人/);
  assert.match(page, /<strong>冰渊之王<\/strong>/);
  assert.doesNotMatch(page, /你的生命，由你守护 你的传奇，由你书写/);
  assert.match(page, /A New Chapter Await/);
  assert.doesNotMatch(page, /积分与血量排行榜<\/h2><\/div><span>36<\/span>/);
  assert.match(page, /第 \{rankingPage \+ 1\} 页/);
  assert.match(page, /function InlineCaptainHistory/);
  assert.match(page, /className="rank-history-wrap"/);
  assert.doesNotMatch(page, /className="right-stack"|selectedPlayer|玩家 ID<\/small>/);
  assert.match(page, /useState<number \| null>\(null\)/);
  assert.match(page, /aria-expanded=/);
  assert.match(page, /冰山之上，强者争夺荣耀；深海之下，亡者寻找重生<\/p>/);
  assert.match(page, /className="playoff-match"/);
  assert.match(page, /roman:\s*"I"/);
  assert.match(page, /roman:\s*"V"/);
  assert.doesNotMatch(page, /captain-summary|场均队长分|生命获取|稀有选择/);
  assert.doesNotMatch(page, /placeholder=.*搜索|searchQuery|filteredRanking/);

  assert.match(css, /\.site-header\s*\{[\s\S]*position:\s*sticky/);
  assert.match(css, /@media \(min-width:\s*40rem\)\s*\{[\s\S]*\.stage-switcher\s*\{\s*grid-template-columns:\s*repeat\(6/);
  assert.match(css, /\.stage-slot:nth-child\(4\)\s*\{\s*grid-column:\s*2 \/ span 2/);
  assert.match(css, /background-image:\s*var\(--asset-penguin-logo\)/);
  assert.doesNotMatch(css, /frosted-steel-texture|ice-shatter-burst|@keyframes ice-/);
  assert.doesNotMatch(css, /\.stage-token|\.stage-sigil/);
  assert.doesNotMatch(css, /\.hero-metrics/);
  assert.match(css, /\.player-id\.featured-player\s*\{[\s\S]*color:\s*var\(--color-gold\)/);
  assert.doesNotMatch(css, /\.rank-row:nth-of-type\(-n\+3\) \.rank-gem/);
  assert.match(css, /\.hero-seal\s*\{/);
  assert.match(css, /\.stage-relic\s*\{/);
  assert.match(css, /\.stage-lore\s*\{/);
  assert.match(css, /\.stage-lore\s*\{[\s\S]*background:\s*var\(--color-clear\)/);
  assert.match(css, /\.hero-copy h1 > span\s*\{[^}]*display:\s*block/);
  assert.match(css, /\.hero-copy > p\s*\{[^}]*white-space:\s*normal/);
  assert.match(css, /\.stage-switcher i\s*\{[^}]*inset-inline-start:\s*50%/);
  assert.match(css, /\.stage-switcher i\s*\{[^}]*transform:\s*translateX\(-50%\)/);
  assert.match(css, /\.chapter-await/);
  assert.match(css, /\.site-footer p\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.rank-gem\s*\{/);
  assert.match(css, /\.pixel-health\s*\{/);
  assert.match(css, /\.blood-drop\s*\{/);
  assert.match(css, /\.blood-drop::before\s*\{/);
  assert.doesNotMatch(css, /\.ranking-panel \.panel-title::before/);
  assert.match(css, /\.ranking-pagination/);
  assert.doesNotMatch(css, /\.data-refresh|\.refresh-status/);
  assert.match(css, /\.captain-rate-panel/);
  assert.match(css, /\.captain-rate-head/);
  assert.match(css, /\.captain-rate-row/);
  assert.match(css, /\.captain-rate-head,[\s\S]*\.captain-rate-row\s*\{[\s\S]*justify-items:\s*center;[\s\S]*text-align:\s*center;/);
  assert.doesNotMatch(css, /\.captain-rate-(?:head|row)[\s\S]{0,180}justify-self:\s*end/);
  assert.match(css, /\.ranking-pagination button\s*\{[^}]*clip-path:/);
  assert.match(css, /transparent relic frame \+ compact desktop roster/);
  assert.match(css, /\.ranking-panel\s*\{\s*background-clip:\s*padding-box;\s*box-shadow:\s*none;/);
  assert.match(css, /\.rank-row\.selected\s*\{\s*min-height:\s*4rem;\s*padding-block:\s*0;/);
  assert.match(css, /@media \(max-width:\s*48rem\)[\s\S]*\.stage-switcher\s*\{[\s\S]*grid-template-columns:\s*repeat\(6/);
  assert.match(css, /\.rank-history\s*\{/);
  assert.match(css, /@keyframes history-reveal/);
  assert.doesNotMatch(css, /\.mobile-captain-detail|\.mobile-captain-history|\.pixel-hearts/);
  assert.match(css, /\.playoff-match/);
  assert.match(css, /@media \(max-width:\s*32rem\)/);
  assert.match(css, /main::before\s*\{[\s\S]*position:\s*fixed/);
});

test("locks captain picks after DDL and publishes base points once at 07:30", async () => {
  const [worker, config, exampleConfig, workerReadme] = await Promise.all([
    readFile(new URL("../cloudflare/fpl-proxy/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare/fpl-proxy/wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare/fpl-proxy/wrangler.example.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare/fpl-proxy/README.md", import.meta.url), "utf8"),
  ]);

  for (const source of [config, exampleConfig]) {
    assert.match(source, /"crons": \["\*\/5 \* \* \* \*", "30 23 \* \* \*"\]/);
  }
  assert.match(worker, /controller\.cron === "30 23 \* \* \*"/);
  assert.match(worker, /captureDueCaptainPicks\(env, controller\.scheduledTime\)/);
  assert.match(worker, /90 \* 60 \* 1000/);
  assert.match(worker, /if \(picksDocument\.completedAt\) return/);
  assert.match(worker, /checked\.size >= roster\.length && !document\.completedAt/);
  assert.match(worker, /PICKS_BATCH_SIZE = 40/);
  assert.match(worker, /state: "waiting_for_picks"/);
  assert.match(worker, /pointsDefinition: "队长球员在 FPL 的基础得分，不计算队长双倍或三倍倍率"/);
  assert.doesNotMatch(worker, /captainPointsWithMultiplier/);
  assert.match(worker, /url\.pathname === "\/api\/history"/);
  assert.match(worker, /getSeasonDeadlines\(env\)/);
  assert.match(worker, /deadlineTime: event\.deadline_time/);
  assert.match(worker, /FPL_CACHE\.put\("snapshot:history"/);
  assert.match(workerReadme, /Starting 90 minutes after each official GW/);
  assert.match(workerReadme, /At Beijing time 07:30/);
});

test("proxies public API reads through Cloudflare Pages", async () => {
  const [proxy, routes] = await Promise.all([
    readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8"),
    readFile(new URL("../public/_routes.json", import.meta.url), "utf8"),
  ]);

  assert.match(proxy, /penguin-cup-fpl-api\.nbafantasy\.workers\.dev/);
  assert.match(proxy, /health\|status\|league\|history\|gw/);
  assert.match(proxy, /x-penguin-api-proxy/);
  assert.match(proxy, /access-control-allow-origin/);
  assert.deepEqual(JSON.parse(routes), { version: 1, include: ["/api/*"], exclude: [] });
});

test("server-renders the rules route", async () => {
  const response = await render("/rules/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /五重试炼/);
  assert.match(html, /GW35–GW38/);
  assert.match(html, /aria-label="返回战榜">战榜/);
  assert.doesNotMatch(html, /href="\/rules\/"[^>]*>冰渊法典/);
  assert.doesNotMatch(html, /class="rules-summary"|赛制流程|<span>Gameweeks<\/span>/);
});

test("ships a double-clickable local HTML edition without network or API calls", async () => {
  const html = await readFile(new URL("../penguin-cup-local.html", import.meta.url), "utf8");
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /你的生命，由你守护。你的传奇，由你书写<\/p>/);
  assert.doesNotMatch(html, /你的生命，由你守护。你的传奇，由你书写。/);
  assert.match(html, /A New Chapter Await/);
  assert.match(html, /class="current-badge">当前<\/i>/);
  assert.match(html, /left:\s*50%[\s\S]*transform:\s*translateX\(-50%\)/);
  assert.match(html, /src="public\/penguin-cup-logo\.png"/);
  assert.doesNotMatch(html, /https?:\/\/|fetch\s*\(|XMLHttpRequest|WebSocket/);
});

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
  assert.match(html, /见习者集结/);
  assert.match(html, /当周队长得分/);
  assert.match(html, /血量/);
  assert.match(html, /aria-label="1 点血量"/);
  assert.match(html, /class="rank-gem rank-gem-/);
  assert.match(html, /class="pixel-health"/);
  assert.match(html, /class="blood-drop"/);
  assert.ok(html.indexOf("willis's Team") < html.indexOf("Shuo Home"));
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
  assert.match(page, /className="rank-gem rank-gem-4"/);
  assert.match(page, /assets\/leaderboard\/ice-ledger-frame\.png/);
  assert.match(page, /assets\/leaderboard\/ice-frame-complete\.png/);
  assert.match(page, /assets\/leaderboard\/ice-row-frame\.png/);
  assert.match(page, /assets\/leaderboard\/ice-history-frame\.png/);
  assert.match(page, /Official FPL classic league 511690 Team name roster/);
  assert.match(page, /assets\/leaderboard\/ice-side-left\.png/);
  assert.match(page, /assets\/leaderboard\/ice-side-right\.png/);
  assert.match(page, /assets\/leaderboard\/score-slot\.png/);
  assert.match(page, /assets\/leaderboard\/pixel-heart\.svg/);
  assert.match(page, /className="pixel-health"/);
  assert.match(page, /className="blood-drop"/);
  assert.match(page, /Array\.from\(\{ length: hp \}/);
  assert.match(page, /className="ranking-pagination"/);
  assert.match(page, /const pageSize = 20/);
  assert.match(page, /function getLifeAfterGw8/);
  assert.match(page, /return 1;/);
  assert.doesNotMatch(page, /rate < 10 \? 2 : 1/);
  assert.doesNotMatch(page, /\.sort\(/);
  assert.match(page, /尚无队长选择记录/);
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
  assert.match(page, /useState<string \| null>\(null\)/);
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

test("server-renders the rules route", async () => {
  const response = await render("/rules/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /五重试炼/);
  assert.match(html, /GW35–GW38/);
  assert.match(html, /aria-label="返回战榜">战榜/);
  assert.doesNotMatch(html, /href="\/rules\/"[^>]*>冰渊法典/);
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

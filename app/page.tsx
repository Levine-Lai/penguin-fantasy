"use client";

import { useMemo, useState } from "react";

type Player = {
  id: number;
  name: string;
  score: number;
  trend: "up" | "down" | "same";
  delta: number;
  form: string[];
};

const names = [
  "企鹅1",
  "Old Trafford",
  "Baros15",
  "Eva",
  "别墅里面唱K 你想象不到",
  "Kumanoiii",
  "Conan",
  "Shuo#北极K3🇺🇿",
  "扎卡反黑小组",
  "Gladiator Mississippi",
  "比尔",
  "蒂兰基尔尼",
  "拙言",
  "无机盐",
  "狗蛋kk",
  "✖ Bigsix Team",
  "acidboy",
  "咻狗勾不在家",
  "kusuri",
  "Bad K",
  "TheViolin",
  "MutdBJ-垫底超人",
  "香香软软的big b",
  "AVG",
  "Low Lik Kee",
  "Faiaa",
  "Wooooo",
  "OCEAN🇪🇬",
  "笨笨是大骗子",
  "DDDD",
  "HindMics",
  "小火龙",
  "Eric(殷少)",
  "爱吃鱼的星喵",
  "BB88",
  "镜落镜落-南极🇺🇾",
];

const players: Player[] = names.map((name, index) => ({
  id: index + 1,
  name,
  score: Math.max(102, 268 - index * 4 - (index % 4) * 2),
  trend: index % 5 === 0 ? "same" : index % 3 === 0 ? "down" : "up",
  delta: index % 5 === 0 ? 0 : (index % 3) + 1,
  form: Array.from({ length: 5 }, (_, i) => ((index + i * 2) % 4 === 0 ? "L" : "W")),
}));

const challenges = [
  { id: 1, challenger: "Baros15", target: "Old Trafford", time: "周一 · 21:08", state: "待应战", accent: "orange" },
  { id: 2, challenger: "Eva", target: "企鹅1", time: "周二 · 09:42", state: "已接受", accent: "green" },
  { id: 3, challenger: "Kumanoiii", target: "别墅里面唱K 你想象不到", time: "周三 · 18:15", state: "已结束", accent: "slate", result: "胜" },
  { id: 4, challenger: "Conan", target: "Shuo#北极K3🇺🇿", time: "今天 · 12:30", state: "待应战", accent: "orange" },
  { id: 5, challenger: "扎卡反黑小组", target: "Gladiator Mississippi", time: "今天 · 16:04", state: "已接受", accent: "green" },
];

const initials = (name: string) => name.replace(/[✖#🇺🇿🇪🇬🇺🇾]/gu, "").trim().slice(0, 2).toUpperCase();

function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return (
    <span className={`avatar ${small ? "avatar-small" : ""}`} style={{ "--avatar-hue": hue } as React.CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function Trend({ player }: { player: Player }) {
  const symbol = player.trend === "up" ? "↑" : player.trend === "down" ? "↓" : "—";
  return <span className={`trend trend-${player.trend}`}>{symbol}{player.delta || ""}</span>;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [challengeFilter, setChallengeFilter] = useState("全部");
  const [showAll, setShowAll] = useState(false);

  const filteredPlayers = useMemo(() => {
    const matches = players.filter((player) => player.name.toLowerCase().includes(query.trim().toLowerCase()));
    return showAll || query ? matches : matches.slice(0, 12);
  }, [query, showAll]);

  const filteredChallenges = challengeFilter === "全部"
    ? challenges
    : challenges.filter((item) => item.state === challengeFilter);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="企鹅杯首页">
          <span className="brand-mark" aria-hidden="true"><span className="penguin-face">●</span></span>
          <span><strong>PENGUIN CUP</strong><small>26–27 赛季 · 第三版</small></span>
        </a>
        <nav aria-label="主导航">
          <a className="nav-active" href="#ranking">联赛榜</a>
          <a href="#challenges">本周挑战</a>
          <a href="#rules">赛制</a>
        </nav>
        <div className="week-badge"><span></span> GW 12 进行中</div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span>SEASON 26/27</span><i></i> GAMEWEEK 12</div>
          <h1>冰面之上，<br/><em>排名见真章。</em></h1>
          <p>36 位玩家，一座企鹅杯。每周用挑战改写榜单，直到最后一轮决出真正的冠军。</p>
          <div className="hero-actions">
            <a className="primary-button" href="#ranking">查看实时排名 <span>↘</span></a>
            <a className="text-link" href="#rules">了解赛制 <span>→</span></a>
          </div>
        </div>
        <div className="hero-scorecard" aria-label="本周联赛数据">
          <div className="scorecard-top"><span>LIVE TABLE</span><span className="live-dot">● LIVE</span></div>
          <div className="top-player">
            <span className="giant-rank">01</span>
            <div className="leader-info">
              <Avatar name="企鹅1" />
              <div><small>当前领跑</small><strong>企鹅1</strong></div>
            </div>
            <div className="leader-score"><strong>268</strong><small>PTS</small></div>
          </div>
          <div className="scorecard-stats">
            <div><strong>36</strong><span>参赛玩家</span></div>
            <div><strong>05</strong><span>本周挑战</span></div>
            <div><strong>02</strong><span>等待应战</span></div>
          </div>
          <div className="ice-orbit" aria-hidden="true"><span>♟</span></div>
        </div>
      </section>

      <section className="dashboard" aria-label="企鹅杯联赛数据">
        <div className="ranking-panel" id="ranking">
          <div className="section-heading">
            <div><span className="section-kicker">LEAGUE TABLE</span><h2>实时排名</h2></div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索玩家" aria-label="搜索玩家" />
            </label>
          </div>

          <div className="table-head" aria-hidden="true"><span>排名 / 玩家</span><span>近 5 轮</span><span>升降</span><span>积分</span></div>
          <div className="player-list">
            {filteredPlayers.map((player, index) => (
              <article className={`player-row ${player.id <= 3 ? "podium-row" : ""}`} key={player.id}>
                <span className="rank-number">{String(player.id).padStart(2, "0")}</span>
                <Avatar name={player.name} />
                <div className="player-name"><strong>{player.name}</strong><small>{player.id <= 3 ? ["领跑者", "争冠区", "争冠区"][player.id - 1] : `官方账户 · PG${String(2600 + player.id).padStart(4, "0")}`}</small></div>
                <div className="form-dots" aria-label={`近五轮：${player.form.join(" ")}`}>{player.form.map((result, i) => <i className={result === "W" ? "win" : "loss"} key={i}>{result}</i>)}</div>
                <Trend player={player} />
                <strong className="points">{player.score}</strong>
              </article>
            ))}
          </div>
          {!query && <button className="show-all" onClick={() => setShowAll((value) => !value)}>{showAll ? "收起排名" : "查看全部 36 位玩家"}<span>{showAll ? "↑" : "↓"}</span></button>}
          {filteredPlayers.length === 0 && <div className="empty-state">没有找到这位玩家，再试试其他名字。</div>}
        </div>

        <aside className="challenge-panel" id="challenges">
          <div className="section-heading challenge-heading">
            <div><span className="section-kicker">THIS WEEK</span><h2>谁发起了挑战</h2></div>
            <span className="count-chip">{String(challenges.length).padStart(2, "0")}</span>
          </div>
          <div className="filter-tabs" role="group" aria-label="筛选挑战状态">
            {["全部", "待应战", "已接受", "已结束"].map((filter) => <button className={challengeFilter === filter ? "active" : ""} onClick={() => setChallengeFilter(filter)} key={filter}>{filter}</button>)}
          </div>

          <div className="challenge-list">
            {filteredChallenges.map((challenge) => (
              <article className={`challenge-card challenge-${challenge.accent}`} key={challenge.id}>
                <div className="challenge-meta"><span>{challenge.time}</span><span className="status"><i></i>{challenge.state}</span></div>
                <div className="matchup">
                  <div className="match-player"><Avatar name={challenge.challenger} /><strong>{challenge.challenger}</strong><small>发起挑战</small></div>
                  <div className="versus"><span>VS</span>{challenge.result && <strong>{challenge.result}</strong>}</div>
                  <div className="match-player target"><Avatar name={challenge.target} /><strong>{challenge.target}</strong><small>被挑战</small></div>
                </div>
              </article>
            ))}
          </div>
          <button className="new-challenge">＋ 发起新挑战</button>
          <p className="demo-note">当前为前端演示数据 · 官方账户 API 接入后自动更新</p>
        </aside>
      </section>

      <section className="rules-section" id="rules">
        <div className="rules-intro">
          <span className="section-kicker">HOW IT WORKS</span>
          <h2>三段赛程，<br/>一场到底。</h2>
          <p>没有平局，就没有争议。若战成平手，挑战机会退还——这谁还不服？</p>
        </div>
        <div className="rule-cards">
          <article><span>01</span><small>GW 1–9</small><h3>积蓄血量</h3><p>全员同组，初始 1 血。不扣血、不决斗，靠队长选择积累后期优势。</p></article>
          <article className="featured-rule"><span>02</span><small>GW 10–34 · NOW</small><h3>每周决斗</h3><p>每人 5 次挑战机会。成功 +1 血，失败 −1 血；每周最先申请的五组生效。</p></article>
          <article><span>03</span><small>GW 35–38</small><h3>最终决战</h3><p>淘汰阶段逐轮清场，最后一轮按队长分、身价与历史总分决出总冠军。</p></article>
        </div>
      </section>

      <footer><div className="footer-brand"><span className="brand-mark mini" aria-hidden="true"><span className="penguin-face">●</span></span><strong>PENGUIN CUP</strong></div><p>为热爱而战，为企鹅杯加冕。</p><span>26/27 SEASON · V3</span></footer>
    </main>
  );
}

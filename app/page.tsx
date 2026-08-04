"use client";

import { Fragment, useMemo, useState } from "react";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type StageId = 1 | 2 | 3 | 4 | 5;
type RankedPlayer = { name: string; rank: number; gpc: number; tp: number; hp: number };
type CaptainHistoryEntry = { gw: number; captain: string; rate: number; points: number; life: number };

const players = [
  "企鹅1", "Old Trafford", "Baros15", "Eva", "别墅里面唱K 你想象不到", "Kumanoiii",
  "Conan", "Shuo#北极K3🇺🇿", "扎卡反黑小组", "Gladiator Mississippi", "比尔", "蒂兰基尔尼",
  "拙言", "无机盐", "狗蛋kk", "✖ Bigsix Team", "acidboy", "咻狗勾不在家", "kusuri", "Bad K",
  "TheViolin", "MutdBJ-垫底超人", "香香软软的big b", "AVG", "Low Lik Kee", "Faiaa",
  "Wooooo", "OCEAN🇪🇬", "笨笨是大骗子", "DDDD", "HindMics", "小火龙", "Eric(殷少)",
  "爱吃鱼的星喵", "BB88", "镜落镜落-南极🇺🇾",
];

const stages: Array<{ id: StageId; roman: string; title: string; range: string; tpBase: number }> = [
  { id: 1, roman: "I", title: "生命之火试炼", range: "GW1–GW8", tpBase: 686 },
  { id: 2, roman: "II", title: "冰海角斗场", range: "GW9–GW20", tpBase: 812 },
  { id: 3, roman: "III", title: "冰山与深海分界", range: "GW21–GW30", tpBase: 936 },
  { id: 4, roman: "IV", title: "深海大逃杀", range: "GW31–GW34", tpBase: 1012 },
  { id: 5, roman: "V", title: "冰渊王座对决", range: "GW35–GW38", tpBase: 1094 },
];

const captainNames = [
  "Haaland", "B.Fernandes", "Gabriel", "Semenyo", "Gibbs-White", "Rice", "Thiago", "Anderson",
  "Guéhi", "João Pedro", "Senesi", "Virgil", "Tarkowski", "Rogers", "Wilson", "Watkins",
];

const captainPointPattern = [12, 4, 15, 2, 10, 7, 14, 3];

function getCaptainHistory(playerIndex: number): CaptainHistoryEntry[] {
  return Array.from({ length: 8 }, (_, index) => {
    const rate = Number((((playerIndex + 1) * 4.3 + (index + 1) * 6.7) % 29 + 2.2).toFixed(1));
    const points = captainPointPattern[(index + playerIndex) % captainPointPattern.length];
    const life = points >= 10 ? (rate < 10 ? 2 : 1) : 0;
    const captain = captainNames[(index + playerIndex * 3) % captainNames.length];
    return { gw: index + 1, captain, rate, points, life };
  });
}

function getLifeAfterGw8(playerIndex: number) {
  return 1 + getCaptainHistory(playerIndex).reduce((total, gameweek) => total + gameweek.life, 0);
}

const challenges = [
  { id: 1, challenger: "Baros15", challengerScore: 12, target: "Old Trafford", targetScore: 8, day: "周一", time: "21:08" },
  { id: 2, challenger: "Eva", challengerScore: 15, target: "企鹅1", targetScore: 11, day: "周二", time: "09:42" },
  { id: 3, challenger: "Kumanoiii", challengerScore: 6, target: "别墅里面唱K 你想象不到", targetScore: 9, day: "周三", time: "18:15" },
  { id: 4, challenger: "Conan", challengerScore: 13, target: "Shuo#北极K3🇺🇿", targetScore: 10, day: "今天", time: "12:30" },
  { id: 5, challenger: "扎卡反黑小组", challengerScore: 7, target: "Gladiator Mississippi", targetScore: 14, day: "今天", time: "16:04" },
];

const knockoutMatches = [
  { id: 1, left: "企鹅1", leftScore: 14, right: "BB88", rightScore: 8 },
  { id: 2, left: "Old Trafford", leftScore: 11, right: "爱吃鱼的星喵", rightScore: 13 },
  { id: 3, left: "Baros15", leftScore: 9, right: "Eric(殷少)", rightScore: 6 },
  { id: 4, left: "Eva", leftScore: 7, right: "小火龙", rightScore: 10 },
  { id: 5, left: "别墅里面唱K 你想象不到", leftScore: 15, right: "HindMics", rightScore: 12 },
  { id: 6, left: "Kumanoiii", leftScore: 8, right: "DDDD", rightScore: 8 },
  { id: 7, left: "Conan", leftScore: 6, right: "笨笨是大骗子", rightScore: 4 },
  { id: 8, left: "Shuo#北极K3🇺🇿", leftScore: 10, right: "OCEAN🇪🇬", rightScore: 12 },
];

function Score({ value, opponent }: { value: number; opponent: number }) {
  const state = value === opponent ? "score-draw" : value > opponent ? "score-high" : "score-low";
  const marker = value === opponent ? "平" : value > opponent ? "胜" : "负";
  return <b className={state} aria-label={`${value} 分，${marker}`}>{value}<small aria-hidden="true">{marker}</small></b>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for chapters II–IV
function ChallengePanel({ melee = false, gameweek = "GW12" }: { melee?: boolean; gameweek?: string }) {
  return (
    <aside className="panel challenge-panel">
      <header className="panel-title"><div><small>{melee ? "THE ABYSS · GW31–GW34" : `ICE DRAGON ARENA · ${gameweek}`}</small><h2>{melee ? "万丈冰渊" : "本轮决斗"}</h2></div><span>{melee ? "∞" : "05"}</span></header>
      <div className="challenge-head"><span>对阵双方</span><span>当周队长得分</span></div>
      <div className="challenge-list">
        {challenges.map((item) => (
          <article className="challenge-row" key={item.id}>
            <div className="challenge-time"><span>{item.day}</span><time>{item.time}</time></div>
            <div className="horizontal-match">
              <div className="match-side home"><strong>{item.challenger}</strong><Score value={item.challengerScore} opponent={item.targetScore} /></div>
              <i>VS</i>
              <div className="match-side away"><Score value={item.targetScore} opponent={item.challengerScore} /><strong>{item.target}</strong></div>
            </div>
          </article>
        ))}
      </div>
      <footer className="challenge-footer"><div><small>{melee ? "决斗权限" : "本轮申请"}</small><strong>{melee ? "无限" : "5 / 5"}</strong></div><div className="duel-slots" aria-label={melee ? "决斗次数无限" : "五组决斗名额已满"}>{Array.from({ length: 5 }, (_, index) => <span className="filled" key={index}></span>)}</div></footer>
    </aside>
  );
}

function InlineCaptainHistory({ playerName }: { playerName: string }) {
  const playerIndex = Math.max(players.indexOf(playerName), 0);
  const history = getCaptainHistory(playerIndex);
  return (
    <section className="rank-history" aria-label={`${playerName} 的队长选择记录`}>
      <header><strong>队长选择记录</strong><small>GW1–GW8</small></header>
      <div>
        {history.map((item) => (
          <article className="history-row" key={item.gw}>
            <strong className="history-gw">GW{item.gw}</strong>
            <div className="history-captain"><b>{item.captain}</b><small className={item.rate < 10 ? "rare-pick" : ""}>选择率 {item.rate}%</small></div>
            <div className="history-result"><b>{item.points} 分</b><em className={item.life === 2 ? "life-rare" : ""}>+{item.life} 血</em></div>
          </article>
        ))}
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for chapter V
function KnockoutPanel() {
  return (
    <aside className="panel knockout-panel">
      <header className="panel-title"><div><small>PLAYOFF SEEDING · GW35</small><h2>冰渊王座对决</h2></div><span>16</span></header>
      <div className="knockout-list">
        {knockoutMatches.map((match) => (
          <article className="playoff-match" key={match.id}>
            <header><span>第 {match.id} 场</span><strong>{match.id} vs {17 - match.id}</strong></header>
            <div className={match.leftScore > match.rightScore ? "playoff-team winner" : "playoff-team"}>
              <i>{match.id}</i><span>{match.left}</span><Score value={match.leftScore} opponent={match.rightScore} />
            </div>
            <div className={match.rightScore > match.leftScore ? "playoff-team winner" : "playoff-team"}>
              <i>{17 - match.id}</i><span>{match.right}</span><Score value={match.rightScore} opponent={match.leftScore} />
            </div>
          </article>
        ))}
      </div>
      <div className="knockout-rounds"><span>GW35<br />16强</span><span>GW36<br />8强</span><span>GW37<br />半决赛</span><span>GW38<br />决赛</span></div>
    </aside>
  );
}

export default function Home() {
  const [activeStage, setActiveStage] = useState<StageId>(1);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [rankingPage, setRankingPage] = useState(0);
  const stage = stages.find((item) => item.id === activeStage) ?? stages[1];

  const selectStage = (stageId: StageId) => {
    setActiveStage(stageId);
    setRankingPage(0);
    setExpandedPlayer(null);
  };

  const ranking = useMemo<RankedPlayer[]>(() => players
    .map((name, index) => {
      const captainHistory = getCaptainHistory(index);
      return {
        name,
        gpc: activeStage === 1 ? captainHistory[7].points : 2 + ((index * 5 + stage.id * 3) % 14),
        tp: stage.tpBase - index * 9 - (index % 3) * 2,
        hp: getLifeAfterGw8(index),
      };
    })
    .sort((a, b) => b.hp - a.hp || b.tp - a.tp)
    .map((player, index) => ({ ...player, rank: index + 1 })), [activeStage, stage.id, stage.tpBase]);
  const pageSize = 10;
  const pageCount = Math.ceil(ranking.length / pageSize);
  const visibleRanking = ranking.slice(rankingPage * pageSize, (rankingPage + 1) * pageSize);

  return (
    <main>
      <header className="site-header"><div className="header-inner"><a className="brand" href={`${siteBasePath}/`} aria-label="企鹅杯首页"><span className="brand-emblem" aria-hidden="true"></span><span className="brand-copy"><strong>PENGUIN CUP</strong><small>THE FROZEN ABYSS</small></span></a><nav className="top-nav" aria-label="主导航"><a className="active" href={`${siteBasePath}/`}>战榜</a><a href={`${siteBasePath}/rules/`}>冰渊法典</a></nav><div className="gameweek"><small>当前试炼</small><strong>GW 8</strong></div></div></header>

      <section className="league-hero"><div className="hero-inner"><div className="hero-copy"><span>THE FROZEN ABYSS · 2026–27</span><h1>冰渊王座<br />之战</h1><p>你的生命，由你守护 你的传奇，由你书写</p></div></div></section>

      <section className="stage-switcher" aria-label="选择阶段">
        {stages.map((item) => (
          <div className={`stage-slot ${activeStage === item.id ? "active" : ""}`} key={item.id}>
            <button className={item.id === 1 ? "current-stage" : ""} onClick={() => selectStage(item.id)} aria-pressed={activeStage === item.id}>
              <span className="shield-weathering" aria-hidden="true"></span>
              <strong className="stage-roman">{item.roman}</strong>
              <span className="stage-name">{item.title}</span>
              <small>{item.range}</small>
              {item.id === 1 ? <i>当前</i> : null}
            </button>
          </div>
        ))}
      </section>

      {activeStage === 1 ? <section className="boards">
        <article className="panel ranking-panel" id="ranking" key={`ranking-${activeStage}`}>
          <header className="panel-title"><div><small>{stage.range} · {stage.title}</small><h2>积分与血量排行榜</h2></div></header>
          <div className="ranking-head"><span>阶位</span><span>玩家 ID</span><span>当周队长得分</span><span>血量</span></div>
          <div className="ranking-list">
            {visibleRanking.map(({ name, rank, gpc, hp }) => (
              <Fragment key={name}>
                <article
                  className={`rank-row selectable ${expandedPlayer === name ? "selected" : ""}`}
                  onClick={() => {
                    setExpandedPlayer((current) => current === name ? null : name);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedPlayer((current) => current === name ? null : name);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedPlayer === name}
                >
                  <strong className="rank-gem" aria-label={`第 ${rank} 名`}><span aria-hidden="true">{rank}</span></strong>
                  <div className="player-id-cell">
                    <strong className="player-id">{name}</strong>
                  </div>
                  <strong className="stat-score"><span>{gpc}</span></strong>
                  <div className="hp-cell" aria-label={`${hp} 点血量`}>
                    <span className="pixel-health" aria-hidden="true">
                      {Array.from({ length: hp }, (_, index) => <i className="blood-drop" key={index}></i>)}
                    </span>
                  </div>
                </article>
                {expandedPlayer === name ? <div className="rank-history-wrap"><InlineCaptainHistory playerName={name} /></div> : null}
              </Fragment>
            ))}
          </div>
          <nav className="ranking-pagination" aria-label="排行榜分页">
            <button onClick={() => { setExpandedPlayer(null); setRankingPage((page) => Math.max(0, page - 1)); }} disabled={rankingPage === 0} aria-label="上一页"><span aria-hidden="true">‹</span></button>
            <span><strong>第 {rankingPage + 1} 页</strong></span>
            <button onClick={() => { setExpandedPlayer(null); setRankingPage((page) => Math.min(pageCount - 1, page + 1)); }} disabled={rankingPage === pageCount - 1} aria-label="下一页"><span aria-hidden="true">›</span></button>
          </nav>
        </article>
      </section> : <section className="chapter-await" aria-live="polite"><p>A New Chapter Await</p></section>}

      <footer className="site-footer"><p>冰山之上争夺荣耀，深海之下寻找重生</p><div><strong>PENGUIN CUP 2026–27</strong></div></footer>
    </main>
  );
}

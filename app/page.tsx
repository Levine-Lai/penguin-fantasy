"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const fplApiBase = "https://penguin-cup-fpl-api.nbafantasy.workers.dev";

type StageId = 1 | 2 | 3 | 4 | 5;
type RankedPlayer = { entryId: number; name: string; rank: number | null; gpc: number; captainTotal: number; hp: number; history: CaptainHistoryEntry[] };
type CaptainHistoryEntry = { gw: number; captain: string; rate: number; points: number; life: number };
type LeagueTeam = { entryId: number; teamName: string };
type ApiTeam = LeagueTeam & {
  captainName: string | null;
  captainPoints: number;
  captainPickRate: number | null;
};
type GwSnapshot = {
  ready: boolean;
  gw: number;
  deadlineHasPassed: boolean;
  teams: ApiTeam[];
};
type ApiStatus = { gw?: number };
type LeagueResponse = { ready: boolean; teams: LeagueTeam[] };

// Official FPL classic league 511690 roster, refreshed from the live API.
const players = [
  "JZhuoyan",
  "好堡",
  "NBS TEAM",
  "Fitz",
  "willis's Team",
  "Shuo Home",
  "传来传去不射门，阿尔特塔快走人！",
  "New Trafford",
  "Rainbow Desert",
  "礼物铺今天赢球了吗",
  "这是团赛专用的大号",
  "范特西体育",
  "KNVB",
  "联曼",
  "奏响最绝望的乐章",
  "粒粒2.0",
  "Shanghai Port FC",
  "Wenbo's Team",
  "BEK's Team",
  "kusuri",
  "YaGunnersYa",
  "Nicolas' XI",
  "Chelsea Mata",
  "afewgoodkids",
  "Cuipi",
  "TakahashiAki",
  "dora ura aka aka",
  "咻狗勾不在家",
  "Call loud Yeehc111",
  "绿豆猫手作",
  "热刺传奇教练德泽尔比",
  "笨雕先游",
  "在英格兰捕猎的's Team",
  "逍遥小尧",
  "Will Alves my love",
  "Seawuwu",
  "Baros15",
  "镜落",
  "AVERAGE",
  "HindMics",
  "红衫圣殿",
  "fpl中搁浅的哲学家",
  "SSU - Sakai Moka",
  "AMARTD",
  "Dream Tickets",
  "蒂亚鸽鸽鸽",
  "Hann-San",
  "ABC",
  "Orange's Team",
  "Wei's Team",
  "柯北",
  "Verydisco",
  "红烧天堂",
  "remember",
  "Yemoooon",
  "将死之时掩以水门汀",
  "谁是无机盐",
  "Team Blue",
  "Mind The Gap",
  "乔治啊啊马丁",
  "FRANCISTASY",
  "EriCherry",
  "lecitron",
  "Kw",
  "足球离家出走了",
  "OOPS",
  "Steven's Team",
  "蒂兰基尔尼",
  "SSU - 珍惜当下❤️",
  "acidboy",
  "F.C. Chelion",
  "JackieGu",
  "英超不倒翁",
  "MUJY",
  "yu99",
  "Team电子羊",
  "Trent66",
  "TEAM NAME",
  "Dongma",
  "开半天猪耳朵",
  "Northcote Holdings",
  "Xi9Li",
  "Summerfan",
  "美式加冰",
  "夏初一笑 婉兒摘星",
  "光之围棋俱乐部",
  "elliott's Team",
  "Clark's Team",
  "毒奶喵26",
  "LAD's Team",
  "William's Team",
  "Noodle FC",
  "MutdBJ",
  "ParisAintGerman",
  "Eva",
  "香香软软的big b",
  "應該係除非唔係",
  "AnonTokyo",
  "Champion Leeds",
  "Pluto D",
  "Havertz Scores again",
  "谨慎分析 大胆梭哈",
  "muscleking",
  "Real Madridista",
  "Micky VDV",
  "Loki7_7",
  "她在我耳边吹气",
  "换汤不换药",
  "Bill's Red Riffs",
  "干饭帮手",
  "Yamine Lmao",
  "企鹅",
];

const stages: Array<{ id: StageId; roman: string; title: string; range: string; tpBase: number; description: string }> = [
  {
    id: 1,
    roman: "I",
    title: "生命之火试炼",
    range: "GW1–GW8",
    tpBase: 686,
    description: "踏入终焉冰海的那一刻，所有远征者都会被古老的寒冰魔法剥去昔日荣光，只留下微弱却不肯熄灭的生命之火。他们以“寒冰见习者”之名穿越无声冰原，在没有战争与背叛的最初旅程中，既要学会重新燃起自己的火种，也要留意远古龙魂的凝视。这里尚未响起刀剑，冰海安静地记录每一次选择，并把真正的力量藏进即将到来的风暴。",
  },
  {
    id: 2,
    roman: "II",
    title: "冰海角斗场",
    range: "GW9–GW20",
    tpBase: 812,
    description: "寒冬加剧，封冻千年的冰龙决斗场从裂海之下重新升起。曾并肩远行的勇士第一次以敌手的身份隔着冰刃相望，荣耀、鲜血与命运在古老看台的回声中交织。冰龙不赞颂迟疑，也不怜悯弱小；当挑战的号角响起，有人成为猎人，有人成为猎物，而每一次交锋都在冰渊深处上留下无法抹去的刻痕。",
  },
  {
    id: 3,
    roman: "III",
    title: "冰山与深海分界",
    range: "GW21–GW30",
    tpBase: 936,
    description: "二十周的征战之后，远古冰龙降临冰海，审判所有仍然站立的勇士。命运自冰面中央裂开：一边是沐浴寒光、资源丰饶的浮冰大陆，冰冠贵族在高处继续追逐荣耀；另一边是永无天日的深渊，幸存者在暗流、巨兽与未知恐惧中寻找出路。冰山象征被承认的力量，深海则收藏尚未写完的传奇——因为终焉冰海最古老的传说，总从绝境开始。",
  },
  {
    id: 4,
    roman: "IV",
    title: "深海大逃杀",
    range: "GW31–GW34",
    tpBase: 1012,
    description: "冰海陷入狂潮，所有未被王座选中的幸存者都被卷入万丈冰渊。这里没有坚固的盟约，没有安全的边界，也没有谁能倚仗旧日排名获得庇护。曾经的强者可能在黑潮中陨落，曾经的弱者也可能从最深处归来；当整片深海化作最后的战场，唯有坚韧的意志才是能让人最终活下去的火苗。",
  },
  {
    id: 5,
    roman: "V",
    title: "冰渊王座对决",
    range: "GW35–GW38",
    tpBase: 1094,
    description: "冰山之巅的八位冰冠骑士，与深海归来的八位挑战者，终在冰龙王座竞技场相会。漫长远征就此结束，留下十六道孤独的身影，每一步都通往王冠之巅，但一不留神也可能坠入永恒寒夜。乱战之后，远古冰龙只会向最后站立的人低首；那个人将戴上冰渊王冠，成为新的冰渊之王，并把自己的名字刻入终焉冰海从不融化的冰层深处。",
  },
];

const fallbackTeams: LeagueTeam[] = players.map((teamName, index) => ({ entryId: -(index + 1), teamName }));
const featuredTeamOrder = new Map([
  ["SSU - Sakai Moka", 0],
  ["企鹅", 1],
]);

function lifeEarned(points: number, rate: number | null): number {
  if (points < 10) return 0;
  return rate !== null && rate < 10 ? 2 : 1;
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

function InlineCaptainHistory({ playerName, history }: { playerName: string; history: CaptainHistoryEntry[] }) {
  return (
    <section className="rank-history" aria-label={`${playerName} 的队长选择记录`}>
      <header><strong>队长选择记录</strong><small>见习者集结</small></header>
      <div>
        {history.length === 0 ? <p className="history-empty">尚无队长选择记录</p> : history.map((item) => (
          <article className="history-row" key={item.gw}>
            <strong className="history-gw">GW{item.gw}</strong>
            <div className="history-captain"><b>{item.captain}</b><small className={item.rate < 10 ? "rare-pick" : ""}>选择率 {item.rate}%</small></div>
            <div
              className="history-result"
              aria-label={`${item.points} 分，增加 ${item.life} 滴血`}
            >
              <span className="history-result-box history-points" aria-hidden="true">
                <b>{item.points}</b><em>分</em>
              </span>
              <span className={`history-result-box history-life ${item.life === 2 ? "life-rare" : ""}`} aria-hidden="true">
                <b>+{item.life}</b><em>血</em>
              </span>
            </div>
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
  const [expandedPlayer, setExpandedPlayer] = useState<number | null>(null);
  const [rankingPage, setRankingPage] = useState(0);
  const [leagueTeams, setLeagueTeams] = useState<LeagueTeam[]>(fallbackTeams);
  const [gwSnapshots, setGwSnapshots] = useState<GwSnapshot[]>([]);
  const [currentGw, setCurrentGw] = useState(1);
  const stage = stages.find((item) => item.id === activeStage) ?? stages[1];

  useEffect(() => {
    let cancelled = false;

    const loadFplData = async () => {
      try {
        const [leagueResponse, statusResponse] = await Promise.all([
          fetch(`${fplApiBase}/api/league`, { cache: "no-store" }),
          fetch(`${fplApiBase}/api/status`, { cache: "no-store" }),
        ]);
        if (!leagueResponse.ok || !statusResponse.ok) return;

        const league = await leagueResponse.json() as LeagueResponse;
        const status = await statusResponse.json() as ApiStatus;
        const relevantGw = Math.max(1, Math.min(38, status.gw ?? 1));
        const snapshots = await Promise.all(
          Array.from({ length: relevantGw }, async (_, index) => {
            const response = await fetch(`${fplApiBase}/api/gw/${index + 1}`, { cache: "no-store" });
            return response.ok ? response.json() as Promise<GwSnapshot> : null;
          }),
        );

        if (cancelled) return;
        if (league.ready && league.teams.length > 0) setLeagueTeams(league.teams);
        setCurrentGw(relevantGw);
        setGwSnapshots(snapshots.filter((snapshot): snapshot is GwSnapshot => Boolean(snapshot?.teams)));
      } catch {
        // Keep the server-rendered roster if the remote API is temporarily unavailable.
      }
    };

    void loadFplData();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectStage = (stageId: StageId) => {
    setActiveStage(stageId);
    setRankingPage(0);
    setExpandedPlayer(null);
  };

  const ranking = useMemo<RankedPlayer[]>(() => {
    const hasPublishedPicks = gwSnapshots.some((snapshot) => snapshot.teams.some((team) => team.captainName));
    const rows = leagueTeams.map((team) => {
      const history = gwSnapshots.flatMap<CaptainHistoryEntry>((snapshot) => {
        const result = snapshot.teams.find((entry) => entry.entryId === team.entryId);
        if (!result?.captainName) return [];
        const life = lifeEarned(result.captainPoints, result.captainPickRate);
        return [{
          gw: snapshot.gw,
          captain: result.captainName,
          rate: result.captainPickRate ?? 0,
          points: result.captainPoints,
          life,
        }];
      });
      const latest = history.at(-1);
      return {
        entryId: team.entryId,
        name: team.teamName,
        rank: null,
        gpc: latest?.points ?? 0,
        captainTotal: history.reduce((total, item) => total + item.points, 0),
        hp: 1 + history.reduce((total, item) => total + item.life, 0),
        history,
      };
    });

    const orderedRows = hasPublishedPicks
      ? rows.sort((left, right) => right.hp - left.hp || right.captainTotal - left.captainTotal || left.name.localeCompare(right.name, "zh-CN"))
      : rows.sort((left, right) => (featuredTeamOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) - (featuredTeamOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER));

    return orderedRows
      .map((player, index) => ({ ...player, rank: index + 1 }));
  }, [gwSnapshots, leagueTeams]);
  const pageSize = 20;
  const pageCount = Math.ceil(ranking.length / pageSize);
  const visibleRanking = ranking.slice(rankingPage * pageSize, (rankingPage + 1) * pageSize);
  const latestSnapshot = gwSnapshots.find((snapshot) => snapshot.gw === currentGw);
  const currentTrialLabel = latestSnapshot?.deadlineHasPassed ? `GW ${currentGw}` : "见习者集结";
  const rankingPanelAssets = {
    "--ledger-complete-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-frame-complete.png")`,
    "--ledger-row-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-row-frame.png")`,
    "--ledger-history-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-history-frame.png")`,
    "--ledger-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-ledger-frame.png")`,
    "--ledger-left-rail-image": `url("${siteBasePath}/assets/leaderboard/ice-side-left.png")`,
    "--ledger-right-rail-image": `url("${siteBasePath}/assets/leaderboard/ice-side-right.png")`,
    "--ledger-divider-image": `url("${siteBasePath}/assets/leaderboard/ice-divider.png")`,
    "--score-slot-image": `url("${siteBasePath}/assets/leaderboard/score-slot.png")`,
    "--pixel-heart-image": `url("${siteBasePath}/assets/leaderboard/pixel-heart.svg")`,
  } as CSSProperties;

  return (
    <main>
      <header className="site-header"><div className="header-inner"><a className="brand" href={`${siteBasePath}/`} aria-label="企鹅杯首页"><span className="brand-emblem" aria-hidden="true"></span><span className="brand-copy"><strong>PENGUIN CUP</strong><small>THE FROZEN ABYSS</small></span></a><nav className="top-nav" aria-label="主导航"><a className="active" href={`${siteBasePath}/`}>战榜</a><a href={`${siteBasePath}/rules/`}>冰渊法典</a></nav><div className="gameweek"><small>当前试炼</small><strong>{currentTrialLabel}</strong></div></div></header>

      <section className="league-hero"><div className="hero-inner"><div className="hero-copy"><span>THE FROZEN ABYSS · 2026–27</span><h1>冰渊王座<span>之战</span></h1><p className="hero-myth"><span>在世界尽头，有一片被遗忘的禁地——终焉冰海。这里没有四季，只有永恒的寒冬。传说远古巨龙陨落后，它的心脏化为了贯穿天地的巨大冰山，而它的鲜血流入深海，孕育出了无数深渊生灵。</span><span>冰山之上，是荣耀、力量与王权的象征；<br />深海之下，是黑暗、危险与未知的试炼。</span><span>千年以来，无数冒险者、骑士、法师、海妖与巨兽都曾踏入这片领域，只为寻找传说中的至高宝藏。据说，只有经历五重试炼、在冰山与深海之间活到最后的人，才能获得王座认可，成为新一代——</span><strong>冰渊之王</strong></p></div></div></section>

      <section className="stage-switcher" aria-label="选择阶段">
        {stages.map((item) => (
          <div className={`stage-slot stage-slot-${item.id} ${activeStage === item.id ? "active" : ""}`} data-stage={item.id} key={item.id}>
            <button className={item.id === 1 ? "current-stage" : ""} onClick={() => selectStage(item.id)} aria-pressed={activeStage === item.id}>
              <span className="stage-relic" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${siteBasePath}/assets/stages/stage-${item.id}.png`}
                  alt=""
                  width="1536"
                  height="1536"
                  draggable="false"
                />
              </span>
              <strong className="stage-roman">{item.roman}</strong>
              <span className="stage-name">{item.title}</span>
              <small>{item.range}</small>
              {item.id === 1 ? <i>当前</i> : null}
            </button>
          </div>
        ))}
      </section>

      <section className={`stage-lore stage-lore-${activeStage}`} aria-live="polite" key={`lore-${activeStage}`}>
        <header><small>CHAPTER {stage.roman} · {stage.range}</small><h2>{stage.title}</h2></header>
        <p>{stage.description}</p>
      </section>

      {activeStage === 1 ? <section className="boards">
        <article className="panel ranking-panel" id="ranking" key={`ranking-${activeStage}`} style={rankingPanelAssets}>
          <header className="panel-title"><div><small>{stage.range} · {stage.title}</small><h2>积分与血量排行榜</h2></div></header>
          <div className="ranking-head"><span>阶位</span><span>玩家 ID</span><span>当周队长得分</span><span>队长总分</span><span>血量</span></div>
          <div className="ranking-list">
            {visibleRanking.map(({ entryId, name, rank, gpc, captainTotal, hp, history }) => (
              <Fragment key={entryId}>
                <article
                  className={`rank-row selectable ${expandedPlayer === entryId ? "selected" : ""}`}
                  onClick={() => {
                    setExpandedPlayer((current) => current === entryId ? null : entryId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedPlayer((current) => current === entryId ? null : entryId);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedPlayer === entryId}
                >
                  <strong
                    className={`rank-gem rank-gem-${rank && rank <= 3 ? rank : 4}`}
                    aria-label={`第 ${rank} 名`}
                    style={rank && rank <= 3 ? { "--rank-badge-image": `url("${siteBasePath}/assets/leaderboard/rank-${rank}-ice.png")` } as CSSProperties : undefined}
                  ><span aria-hidden="true">{rank}</span></strong>
                  <div className="player-id-cell">
                    <strong className={`player-id ${featuredTeamOrder.has(name) ? "featured-player" : ""}`}>{name}</strong>
                  </div>
                  <strong className="stat-score"><span>{gpc}</span></strong>
                  <strong className="stat-score stat-captain-total"><span>{captainTotal}</span></strong>
                  <div className="hp-cell" aria-label={`${hp} 点血量`}>
                    <span className="pixel-health" aria-hidden="true">
                      {Array.from({ length: hp }, (_, index) => <i className="blood-drop" key={index}></i>)}
                    </span>
                  </div>
                </article>
                {expandedPlayer === entryId ? <div className="rank-history-wrap"><InlineCaptainHistory playerName={name} history={history} /></div> : null}
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

      <footer className="site-footer"><p>冰山之上，强者争夺荣耀；深海之下，亡者寻找重生</p><div><strong>PENGUIN CUP 2026–27</strong></div></footer>
    </main>
  );
}

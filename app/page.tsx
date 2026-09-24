"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { currentTrialBootstrapScript, fallbackGwDeadlines, type GwDeadline } from "./current-trial";
import staticFplData from "./static-fpl-data.json";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const fplApiBase = "https://penguin-fantasy.pages.dev";

type StageId = 1 | 2 | 3 | 4 | 5;
type RankedPlayer = { entryId: number; name: string; rank: number | null; gpc: number; captainTotal: number; captainRateTotal: number; hp: number; history: CaptainHistoryEntry[] };
type CaptainHistoryEntry = { gw: number; captain: string; rate: number; points: number; life: number };
type CaptainPopularity = { name: string; points: number; selections: number; rate: number; selectors: string[] };
type LeagueTeam = { entryId: number; teamName: string };
type ApiTeam = LeagueTeam & {
  captainName: string | null;
  captainPoints: number;
  captainPickRate: number | null;
};
type GwSnapshot = {
  ready: boolean;
  gw: number;
  deadlineTime: string;
  deadlineHasPassed: boolean;
  teams: ApiTeam[];
};
type LeagueResponse = { ready: boolean; teams: LeagueTeam[] };
type HistoryResponse = { ready: boolean; snapshots: GwSnapshot[]; deadlines: GwDeadline[] };
type CachedFplPayload<T> = { cachedAt: number; value: T };
type StaticFplData = { generatedAt: string; league: LeagueResponse; history: HistoryResponse };
type LoginStep = "closed" | "identify" | "confirm";

const leagueCacheKey = "penguin-fantasy:league:v1";
const historyCacheKey = "penguin-fantasy:history:v1";
const playerIdentityKey = "penguin-fantasy:player-id:v1";
const cachedDataMaxAge = 7 * 24 * 60 * 60 * 1000;
const requestTimeout = 5_000;
const requestRetryDelays = [0, 750];

function isLeagueResponse(value: unknown): value is LeagueResponse {
  const candidate = value as LeagueResponse | null;
  return candidate?.ready === true
    && Array.isArray(candidate.teams)
    && candidate.teams.length > 0
    && candidate.teams.every((team) => Number.isFinite(team?.entryId) && typeof team?.teamName === "string");
}

function isHistoryResponse(value: unknown): value is HistoryResponse {
  const candidate = value as HistoryResponse | null;
  return candidate?.ready === true
    && Array.isArray(candidate.snapshots)
    && candidate.snapshots.some((snapshot) => Array.isArray(snapshot?.teams) && snapshot.teams.length > 0)
    && Array.isArray(candidate.deadlines);
}

const bundledFplData = staticFplData as StaticFplData;
const bundledSnapshotTime = Date.parse(bundledFplData.generatedAt);

function readCachedFplPayload<T>(key: string): CachedFplPayload<T> | null {
  try {
    const cached = JSON.parse(window.localStorage.getItem(key) ?? "null") as CachedFplPayload<T> | null;
    if (!cached || !Number.isFinite(cached.cachedAt) || Date.now() - cached.cachedAt > cachedDataMaxAge) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedFplPayload<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), value } satisfies CachedFplPayload<T>));
  } catch {
    // Storage can be unavailable in private or embedded browsers; live data still works.
  }
}

function parseFplId(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const entryId = Number(normalized);
  return Number.isSafeInteger(entryId) && entryId > 0 ? entryId : null;
}

function readRememberedPlayerId(): number | null {
  try {
    return parseFplId(window.localStorage.getItem(playerIdentityKey) ?? "");
  } catch {
    return null;
  }
}

function leagueTeamsFromHistory(history: HistoryResponse): LeagueTeam[] {
  const latestSnapshot = history.snapshots.reduce<GwSnapshot | null>(
    (latest, snapshot) => latest === null || snapshot.gw > latest.gw ? snapshot : latest,
    null,
  );
  return latestSnapshot?.teams.map(({ entryId, teamName }) => ({ entryId, teamName })) ?? [];
}

async function fetchFplJsonWithRetry<T>(path: string): Promise<T> {
  let lastError: unknown = new Error("FPL request failed");

  for (const delay of requestRetryDelays) {
    if (delay > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), requestTimeout);
    try {
      const response = await fetch(`${fplApiBase}${path}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw lastError;
}

// Official FPL classic league 511690 roster, refreshed from the live API.
const players = [
  "JZhuoyan",
  "好堡",
  "NBS TEAM",
  "Fitz",
  "willis's Team",
  "Shuo City",
  "传来传去不射门，阿尔特塔快走人！",
  "New Trafford",
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

function compareRankedPlayers(left: RankedPlayer, right: RankedPlayer): number {
  return right.hp - left.hp
    || right.captainTotal - left.captainTotal
    || left.captainRateTotal - right.captainRateTotal
    || (featuredTeamOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) - (featuredTeamOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name, "zh-CN");
}

function lifeEarned(points: number, rate: number | null): number {
  if (points < 10) return 0;
  return rate !== null && rate < 10 ? 2 : 1;
}

const refreshRetryDelay = 5 * 60_000;

function beijingSnapshotDay(timestamp: number): number {
  const beijingOffset = 8 * 60 * 60 * 1000;
  const publishTime = (7 * 60 + 30) * 60 * 1000;
  return Math.floor((timestamp + beijingOffset - publishTime) / (24 * 60 * 60 * 1000));
}

function nextBeijingSnapshotRefreshDelay(timestamp: number): number {
  const day = 24 * 60 * 60 * 1000;
  const beijingOffset = 8 * 60 * 60 * 1000;
  const safeRefreshTime = (7 * 60 + 31) * 60 * 1000;
  const beijingTimestamp = timestamp + beijingOffset;
  const beijingDayStart = Math.floor(beijingTimestamp / day) * day;
  let nextRefresh = beijingDayStart + safeRefreshTime - beijingOffset;
  if (nextRefresh <= timestamp) nextRefresh += day;
  return nextRefresh - timestamp;
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

function InlineCaptainHistory({ playerName, history, currentGwLabel }: { playerName: string; history: CaptainHistoryEntry[]; currentGwLabel: string }) {
  return (
    <section className="rank-history" aria-label={`${playerName} 的队长选择记录`}>
      <header><strong>队长选择记录</strong><small>{currentGwLabel}</small></header>
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

function RankedPlayerCells({ player }: { player: RankedPlayer }) {
  const { name, rank, gpc, captainTotal, hp } = player;
  return (
    <>
      <strong
        className={`rank-gem rank-gem-${rank && rank <= 3 ? rank : 4}`}
        aria-label={`第 ${rank} 名`}
        style={rank && rank <= 3 ? { "--rank-badge-image": `url("${siteBasePath}/assets/leaderboard/rank-${rank}-ice.webp")` } as CSSProperties : undefined}
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
    </>
  );
}

function CaptainSelectorList({ captain }: { captain: CaptainPopularity }) {
  const pageSize = 10;
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(captain.selectors.length / pageSize);
  const visibleSelectors = captain.selectors.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <section className="captain-selector-detail" aria-label={`选择 ${captain.name} 的玩家`}>
      <header><strong>选择该队长的玩家</strong><small>{captain.selections} 人</small></header>
      <ol>
        {visibleSelectors.map((teamName, index) => <li key={teamName}><span>{page * pageSize + index + 1}</span><strong>{teamName}</strong></li>)}
      </ol>
      {pageCount > 1 ? <nav className="captain-selector-pagination" aria-label={`${captain.name} 选择者分页`}>
        <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} aria-label="上一页"><span aria-hidden="true">‹</span></button>
        <strong>第 {page + 1} 页</strong>
        <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page === pageCount - 1} aria-label="下一页"><span aria-hidden="true">›</span></button>
      </nav> : null}
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
  const [leagueTeams, setLeagueTeams] = useState<LeagueTeam[]>(() => isLeagueResponse(bundledFplData.league) ? bundledFplData.league.teams : fallbackTeams);
  const [gwSnapshots, setGwSnapshots] = useState<GwSnapshot[]>(() => isHistoryResponse(bundledFplData.history) ? bundledFplData.history.snapshots : []);
  const [gwDeadlines, setGwDeadlines] = useState<GwDeadline[]>(() => isHistoryResponse(bundledFplData.history) ? bundledFplData.history.deadlines : []);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [playerEntryId, setPlayerEntryId] = useState<number | null>(null);
  const [myStandingExpanded, setMyStandingExpanded] = useState(false);
  const [expandedCaptain, setExpandedCaptain] = useState<string | null>(null);
  const [loginStep, setLoginStep] = useState<LoginStep>("closed");
  const [loginValue, setLoginValue] = useState("");
  const [loginError, setLoginError] = useState("");
  const [pendingEntryId, setPendingEntryId] = useState<number | null>(null);
  const mountedRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const leagueResponseReceivedRef = useRef(false);
  const lastRefreshAttemptRef = useRef(0);
  const lastSuccessfulRefreshRef = useRef<number | null>(Number.isFinite(bundledSnapshotTime) ? bundledSnapshotTime : null);
  const stage = stages.find((item) => item.id === activeStage) ?? stages[1];

  const loadFplData = useCallback((force = false) => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const requestedAt = Date.now();
    if (!force && requestedAt - lastRefreshAttemptRef.current < refreshRetryDelay) {
      return Promise.resolve();
    }
    lastRefreshAttemptRef.current = requestedAt;

    const request = Promise.resolve().then(async () => {
      // Apply each response as it arrives: a slow roster request must not hold back scores.
      await Promise.allSettled([
        fetchFplJsonWithRetry<HistoryResponse>("/api/history").then((history) => {
          if (!mountedRef.current || !isHistoryResponse(history)) return;
          setGwSnapshots(history.snapshots.filter((snapshot) => Array.isArray(snapshot?.teams)));
          setGwDeadlines(history.deadlines ?? []);
          writeCachedFplPayload(historyCacheKey, history);
          lastSuccessfulRefreshRef.current = Date.now();
          const snapshotTeams = leagueTeamsFromHistory(history);
          if (!leagueResponseReceivedRef.current && snapshotTeams.length > 0) setLeagueTeams(snapshotTeams);
        }),
        fetchFplJsonWithRetry<LeagueResponse>("/api/league").then((league) => {
          if (!mountedRef.current || !isLeagueResponse(league)) return;
          leagueResponseReceivedRef.current = true;
          setLeagueTeams(league.teams);
          writeCachedFplPayload(leagueCacheKey, league);
        }),
      ]);
    }).finally(() => {
      refreshInFlightRef.current = null;
    });

    refreshInFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    void Promise.resolve().then(() => {
      if (!mountedRef.current) return;

      const cachedLeague = readCachedFplPayload<LeagueResponse>(leagueCacheKey);
      const cachedHistory = readCachedFplPayload<HistoryResponse>(historyCacheKey);
      const rememberedPlayerId = readRememberedPlayerId();
      const validCachedLeague = cachedLeague && cachedLeague.cachedAt > bundledSnapshotTime && isLeagueResponse(cachedLeague.value) ? cachedLeague : null;
      const validCachedHistory = cachedHistory && cachedHistory.cachedAt > bundledSnapshotTime && isHistoryResponse(cachedHistory.value) ? cachedHistory : null;

      if (rememberedPlayerId) setPlayerEntryId(rememberedPlayerId);
      if (validCachedLeague) {
        leagueResponseReceivedRef.current = true;
        setLeagueTeams(validCachedLeague.value.teams);
      }
      if (validCachedHistory) {
        setGwSnapshots(validCachedHistory.value.snapshots.filter((snapshot) => Array.isArray(snapshot?.teams)));
        setGwDeadlines(validCachedHistory.value.deadlines ?? []);
        lastSuccessfulRefreshRef.current = validCachedHistory.cachedAt;

        if (!validCachedLeague) {
          const snapshotTeams = leagueTeamsFromHistory(validCachedHistory.value);
          if (snapshotTeams.length > 0) setLeagueTeams(snapshotTeams);
        }
      }
    });

    const refreshAfterSnapshotBoundary = () => {
      const lastSuccessfulRefresh = lastSuccessfulRefreshRef.current;
      if (lastSuccessfulRefresh === null || beijingSnapshotDay(Date.now()) > beijingSnapshotDay(lastSuccessfulRefresh)
        || Date.now() - lastRefreshAttemptRef.current >= refreshRetryDelay) {
        void loadFplData();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAfterSnapshotBoundary();
    };

    const handlePageShow = () => refreshAfterSnapshotBoundary();

    let dailyRefreshTimer = 0;
    const scheduleDailyRefresh = () => {
      dailyRefreshTimer = window.setTimeout(() => {
        void loadFplData();
        scheduleDailyRefresh();
      }, nextBeijingSnapshotRefreshDelay(Date.now()));
    };

    void loadFplData(true);
    scheduleDailyRefresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(dailyRefreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [loadFplData]);

  useEffect(() => {
    const clock = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => {
      window.clearInterval(clock);
    };
  }, []);

  const selectStage = (stageId: StageId) => {
    setActiveStage(stageId);
    setRankingPage(0);
    setExpandedPlayer(null);
  };

  const ranking = useMemo<RankedPlayer[]>(() => {
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
      const latest = history.length > 0 ? history[history.length - 1] : undefined;
      return {
        entryId: team.entryId,
        name: team.teamName,
        rank: null,
        gpc: latest?.points ?? 0,
        captainTotal: history.reduce((total, item) => total + item.points, 0),
        captainRateTotal: history.reduce((total, item) => total + item.rate, 0),
        hp: 1 + history.reduce((total, item) => total + item.life, 0),
        history,
      };
    });

    const orderedRows = rows.sort(compareRankedPlayers);

    return orderedRows
      .map((player, index) => ({ ...player, rank: index + 1 }));
  }, [gwSnapshots, leagueTeams]);
  const pageSize = 20;
  const pageCount = Math.ceil(ranking.length / pageSize);
  const visibleRanking = ranking.slice(rankingPage * pageSize, (rankingPage + 1) * pageSize);
  const myRanking = playerEntryId === null ? null : ranking.find((player) => player.entryId === playerEntryId) ?? null;
  const latestCaptainSnapshot = useMemo(() => gwSnapshots.reduce<GwSnapshot | null>(
    (latest, snapshot) => latest === null || snapshot.gw > latest.gw ? snapshot : latest,
    null,
  ), [gwSnapshots]);
  const captainPopularity = useMemo<CaptainPopularity[]>(() => {
    if (!latestCaptainSnapshot) return [];

    const selections = latestCaptainSnapshot.teams.filter((team) => team.captainName);
    const grouped = new Map<string, { points: number; selections: number; selectors: string[] }>();
    for (const team of selections) {
      const name = team.captainName;
      if (!name) continue;
      const current = grouped.get(name);
      grouped.set(name, {
        points: team.captainPoints,
        selections: (current?.selections ?? 0) + 1,
        selectors: [...(current?.selectors ?? []), team.teamName],
      });
    }

    return Array.from(grouped, ([name, captain]) => ({
      name,
      points: captain.points,
      selections: captain.selections,
      rate: selections.length > 0 ? captain.selections / selections.length * 100 : 0,
      selectors: captain.selectors.sort((left, right) => left.localeCompare(right, "zh-CN")),
    })).sort((left, right) => right.selections - left.selections || right.points - left.points || left.name.localeCompare(right.name, "zh-CN"));
  }, [latestCaptainSnapshot]);
  const deadlineSchedule = gwDeadlines.length > 0
    ? gwDeadlines
    : gwSnapshots.length > 0
      ? gwSnapshots.map((snapshot) => ({ gw: snapshot.gw, deadlineTime: snapshot.deadlineTime }))
      : fallbackGwDeadlines;
  const latestStartedGw = deadlineSchedule.reduce((latestGw, event) => {
    const deadline = Date.parse(event.deadlineTime);
    const hasStarted = Number.isFinite(deadline) && deadline <= currentTime;
    return hasStarted ? Math.max(latestGw, event.gw) : latestGw;
  }, 0);
  const currentTrialLabel = latestStartedGw > 0 ? `GW ${latestStartedGw}` : "见习者集结";
  const pendingLoginTeam = pendingEntryId === null ? null : leagueTeams.find((team) => team.entryId === pendingEntryId) ?? null;

  const openLogin = () => {
    setLoginStep("identify");
    setLoginValue("");
    setLoginError("");
    setPendingEntryId(null);
  };

  const closeLogin = () => {
    setLoginStep("closed");
    setLoginValue("");
    setLoginError("");
    setPendingEntryId(null);
  };

  const submitPlayerId = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (leagueTeams.length === 0) {
      setLoginError("排行榜数据尚未加载，请稍后再试。");
      return;
    }

    const entryId = parseFplId(loginValue);
    if (entryId === null || !leagueTeams.some((team) => team.entryId === entryId)) {
      setLoginError("没有找到这个 FPL ID，请检查后重新输入。");
      return;
    }

    setPendingEntryId(entryId);
    setLoginStep("confirm");
    setLoginValue("");
    setLoginError("");
  };

  const confirmPlayerId = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const confirmedEntryId = parseFplId(loginValue);
    if (confirmedEntryId === null || confirmedEntryId !== pendingEntryId) {
      setLoginError("两次输入的 FPL ID 不一致，请重新确认。");
      return;
    }

    try {
      window.localStorage.setItem(playerIdentityKey, String(confirmedEntryId));
    } catch {
      setLoginError("当前浏览器无法保存登录状态，请检查隐私设置。");
      return;
    }

    setPlayerEntryId(confirmedEntryId);
    setRankingPage(0);
    closeLogin();
  };

  const logoutPlayer = () => {
    try {
      window.localStorage.removeItem(playerIdentityKey);
    } catch {
      // In-memory logout still works when storage is unavailable.
    }
    setPlayerEntryId(null);
    setMyStandingExpanded(false);
    setExpandedPlayer(null);
  };

  const rankingPanelAssets = {
    "--ledger-complete-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-frame-complete.webp")`,
    "--ledger-row-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-row-frame.webp")`,
    "--ledger-history-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-history-frame.webp")`,
    "--ledger-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-ledger-frame.webp")`,
    "--ledger-left-rail-image": `url("${siteBasePath}/assets/leaderboard/ice-side-left.webp")`,
    "--ledger-right-rail-image": `url("${siteBasePath}/assets/leaderboard/ice-side-right.webp")`,
    "--ledger-divider-image": `url("${siteBasePath}/assets/leaderboard/ice-divider.webp")`,
    "--score-slot-image": `url("${siteBasePath}/assets/leaderboard/score-slot.webp")`,
    "--pixel-heart-image": `url("${siteBasePath}/assets/leaderboard/pixel-heart.svg")`,
  } as CSSProperties;

  return (
    <main>
      <header className="site-header"><div className="header-inner"><a className="brand" href={`${siteBasePath}/`} aria-label="企鹅杯首页"><span className="brand-emblem" aria-hidden="true"></span><span className="brand-copy"><strong>PENGUIN CUP</strong><small>THE FROZEN ABYSS</small></span></a><nav className="top-nav" aria-label="主导航"><a className="active" href={`${siteBasePath}/`}>战榜</a><a href={`${siteBasePath}/rules/`}>冰渊法典</a></nav>{myRanking ? <button className="player-login-button player-login-active" type="button" onClick={logoutPlayer} aria-label="退出登录"><small>已登录</small><strong>我的成绩</strong></button> : <button className="player-login-button" type="button" onClick={openLogin}><small>PLAYER</small><strong>登录</strong></button>}<div className="gameweek"><small>当前试炼</small><strong data-current-trial suppressHydrationWarning>{currentTrialLabel}</strong></div></div></header>
      <script dangerouslySetInnerHTML={{ __html: currentTrialBootstrapScript }} />

      <section className="league-hero"><div className="hero-inner"><div className="hero-copy"><span>THE FROZEN ABYSS · 2026–27</span><h1>冰渊王座<span>之战</span></h1><p className="hero-myth"><span>在世界尽头，有一片被遗忘的禁地——终焉冰海。这里没有四季，只有永恒的寒冬。传说远古巨龙陨落后，它的心脏化为了贯穿天地的巨大冰山，而它的鲜血流入深海，孕育出了无数深渊生灵。</span><span>冰山之上，是荣耀、力量与王权的象征；<br />深海之下，是黑暗、危险与未知的试炼。</span><span>千年以来，无数冒险者、骑士、法师、海妖与巨兽都曾踏入这片领域，只为寻找传说中的至高宝藏。据说，只有经历五重试炼、在冰山与深海之间活到最后的人，才能获得王座认可，成为新一代——</span><strong>冰渊之王</strong></p></div></div></section>

      <section className="stage-switcher" aria-label="选择阶段">
        {stages.map((item) => (
          <div className={`stage-slot stage-slot-${item.id} ${activeStage === item.id ? "active" : ""}`} data-stage={item.id} key={item.id}>
            <button className={item.id === 1 ? "current-stage" : ""} onClick={() => selectStage(item.id)} aria-pressed={activeStage === item.id}>
              <span className="stage-relic" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${siteBasePath}/assets/stages/stage-${item.id}.webp`}
                  alt=""
                  width="1536"
                  height="1536"
                  loading="lazy"
                  fetchPriority="low"
                  decoding="async"
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

      <section className="boards">
        <article className="panel ranking-panel" id="ranking" style={rankingPanelAssets}>
          <header className="panel-title"><div><small>GW1–GW8 · 生命之火试炼</small><h2>积分与血量排行榜</h2></div></header>
          {myRanking ? <section className="my-ranking-strip" id="my-ranking" aria-label="我的成绩">
            <header><div><small>MY STANDING</small><strong>{myRanking.name}</strong></div></header>
            <article className={`rank-row selectable current-player-row ${myStandingExpanded ? "selected" : ""}`} role="button" tabIndex={0} aria-expanded={myStandingExpanded} onClick={() => setMyStandingExpanded((expanded) => !expanded)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setMyStandingExpanded((expanded) => !expanded); } }}><RankedPlayerCells player={myRanking} /></article>
            {myStandingExpanded ? <div className="rank-history-wrap"><InlineCaptainHistory playerName={myRanking.name} history={myRanking.history} currentGwLabel={currentTrialLabel} /></div> : null}
          </section> : null}
          <div className="ranking-head"><span>阶位</span><span>玩家 ID</span><span>当周队长得分</span><span>队长总分</span><span>血量</span></div>
          <div className="ranking-list">
            {visibleRanking.map((player) => {
              const { entryId, name, history } = player;
              return <Fragment key={entryId}>
                <article
                  className={`rank-row selectable ${expandedPlayer === entryId ? "selected" : ""} ${playerEntryId === entryId ? "current-player-row" : ""}`}
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
                  <RankedPlayerCells player={player} />
                </article>
                {expandedPlayer === entryId ? <div className="rank-history-wrap"><InlineCaptainHistory playerName={name} history={history} currentGwLabel={currentTrialLabel} /></div> : null}
              </Fragment>;
            })}
          </div>
          <nav className="ranking-pagination" aria-label="排行榜分页">
            <button onClick={() => { setExpandedPlayer(null); setRankingPage((page) => Math.max(0, page - 1)); }} disabled={rankingPage === 0} aria-label="上一页"><span aria-hidden="true">‹</span></button>
            <span><strong>第 {rankingPage + 1} 页</strong></span>
            <button onClick={() => { setExpandedPlayer(null); setRankingPage((page) => Math.min(pageCount - 1, page + 1)); }} disabled={rankingPage === pageCount - 1} aria-label="下一页"><span aria-hidden="true">›</span></button>
          </nav>
        </article>
        <article className="panel ranking-panel captain-rate-panel" style={rankingPanelAssets}>
          <header className="panel-title"><div><small>{latestCaptainSnapshot ? `GW${latestCaptainSnapshot.gw}` : "CURRENT GW"} · CAPTAIN PICKS</small><h2>队长选择率</h2></div></header>
          <div className="captain-rate-head"><span>队长名字</span><span>当轮分数</span><span>选择人数</span><span>选择率</span></div>
          <div className="captain-rate-list">
            {captainPopularity.map((captain) => {
              const isRare = captain.rate < 10;
              const isExpanded = expandedCaptain === captain.name;
              return <Fragment key={captain.name}>
              <article className={`captain-rate-row selectable ${isExpanded ? "selected" : ""}`} role="button" tabIndex={0} aria-expanded={isExpanded} onClick={() => setExpandedCaptain((current) => current === captain.name ? null : captain.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpandedCaptain((current) => current === captain.name ? null : captain.name); } }}>
                <strong className="captain-rate-name">{captain.name}</strong>
                <strong>{captain.points}</strong>
                <strong>{captain.selections} 人</strong>
                <strong className={isRare ? "rare-captain-rate" : undefined}>{captain.rate.toFixed(1)}%</strong>
              </article>
              {isExpanded ? <CaptainSelectorList captain={captain} /> : null}
              </Fragment>;
            })}
          </div>
        </article>
      </section>

      {loginStep !== "closed" ? <div className="player-login-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeLogin(); }} onKeyDown={(event) => { if (event.key === "Escape") closeLogin(); }}>
        <section className="player-login-dialog" role="dialog" aria-modal="true" aria-labelledby="player-login-title">
          <button className="player-login-close" type="button" onClick={closeLogin} aria-label="关闭登录对话框">×</button>
          <small>{loginStep === "identify" ? "PLAYER IDENTIFICATION" : "CONFIRM IDENTITY"}</small>
          <h2 id="player-login-title">{loginStep === "identify" ? "登录企鹅杯" : "再次确认 FPL ID"}</h2>
          {loginStep === "confirm" && pendingLoginTeam ? <p className="player-login-found">已找到玩家：<strong>{pendingLoginTeam.teamName}</strong></p> : <p>输入你在 Fantasy Premier League 中的数字 ID。</p>}
          <form onSubmit={loginStep === "identify" ? submitPlayerId : confirmPlayerId}>
            <label htmlFor="player-fpl-id">FPL ID</label>
            <input id="player-fpl-id" name="fpl-id" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoFocus value={loginValue} onChange={(event) => { setLoginValue(event.target.value); setLoginError(""); }} aria-describedby={loginError ? "player-login-note player-login-error" : "player-login-note"} />
            {loginError ? <strong className="player-login-error" id="player-login-error" role="alert">{loginError}</strong> : null}
            <small id="player-login-note">此功能只用于个性化显示，ID 仅保存在当前浏览器，不代表账号所有权。</small>
            <div className="player-login-actions"><button type="button" onClick={closeLogin}>取消</button><button type="submit">{loginStep === "identify" ? "下一步" : "确认登录"}</button></div>
          </form>
        </section>
      </div> : null}

      <footer className="site-footer"><p>冰山之上，强者争夺荣耀；深海之下，亡者寻找重生</p><div><strong>PENGUIN CUP 2026–27</strong></div></footer>
    </main>
  );
}

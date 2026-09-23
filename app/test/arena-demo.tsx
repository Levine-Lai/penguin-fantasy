"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import styles from "./arena.module.css";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isAfterDeadline = true;

type DialogStep = "closed" | "select" | "confirm";

type Duel = {
  id: number;
  challenger: string;
  target: string;
  challengerCaptain: string;
  targetCaptain: string;
  challengerScore: number;
  targetScore: number;
};

type Candidate = {
  name: string;
  rank: number;
  hp: number;
  revealedCaptain: string;
  revealedScore: number;
};

type CaptainHistoryEntry = {
  gw: number;
  captain: string;
  rate: number;
  points: number;
  life: number;
};

type DemoPlayer = {
  name: string;
  history: CaptainHistoryEntry[];
};

type RankedDemoPlayer = DemoPlayer & {
  rank: number;
  gpc: number;
  captainTotal: number;
  hp: number;
};

type DuelHistoryRecord = {
  id: number;
  opponent: string;
  result: "胜" | "负" | "平";
  hpChange: number;
};

function makeHistory(captain: string, points: number[], rate: number): CaptainHistoryEntry[] {
  return points.map((score, index) => {
    const gw = index + 5;
    const life = gw === 9
      ? score >= 10 ? 1 : score <= 3 ? -1 : 0
      : score >= 10 ? rate < 10 ? 2 : 1 : 0;
    return { gw, captain, rate, points: score, life };
  });
}

const initialDuels: Duel[] = [
  {
    id: 1,
    challenger: "willis's Team",
    target: "SSU - Sakai Moka",
    challengerCaptain: "Haaland",
    targetCaptain: "Saka",
    challengerScore: 12,
    targetScore: 6,
  },
  {
    id: 2,
    challenger: "HindMics",
    target: "Orange's Team",
    challengerCaptain: "Palmer",
    targetCaptain: "Isak",
    challengerScore: 8,
    targetScore: 8,
  },
  {
    id: 3,
    challenger: "muscleking",
    target: "Team电子羊",
    challengerCaptain: "Haaland",
    targetCaptain: "B.Fernandes",
    challengerScore: 4,
    targetScore: 11,
  },
];

const candidates: Candidate[] = [
  { name: "Nicolas' XI", rank: 7, hp: 4, revealedCaptain: "Haaland", revealedScore: 4 },
  { name: "Dream Tickets", rank: 10, hp: 3, revealedCaptain: "Saka", revealedScore: 6 },
  { name: "F.C. Chelion", rank: 12, hp: 3, revealedCaptain: "Palmer", revealedScore: 8 },
  { name: "Loki7_7", rank: 14, hp: 3, revealedCaptain: "Isak", revealedScore: 8 },
  { name: "谨慎分析 大胆梭哈", rank: 16, hp: 3, revealedCaptain: "Haaland", revealedScore: 4 },
  { name: "足球离家出走了", rank: 19, hp: 3, revealedCaptain: "Saka", revealedScore: 6 },
];

const demoPlayers: DemoPlayer[] = [
  { name: "willis's Team", history: makeHistory("Haaland", [2, 11, 5, 9, 12], 34.2) },
  { name: "SSU - Sakai Moka", history: makeHistory("Saka", [6, 3, 10, 7, 6], 18.9) },
  { name: "HindMics", history: makeHistory("Palmer", [5, 12, 8, 6, 8], 33.3) },
  { name: "Orange's Team", history: makeHistory("Isak", [2, 4, 11, 8, 8], 9.0) },
  { name: "muscleking", history: makeHistory("Haaland", [12, 7, 2, 9, 4], 34.2) },
  { name: "Team电子羊", history: makeHistory("B.Fernandes", [5, 3, 6, 10, 11], 7.2) },
  { name: "Eva（我）", history: makeHistory("Haaland", [6, 10, 5, 8, 10], 34.2) },
  { name: "Nicolas' XI", history: makeHistory("Haaland", [8, 5, 11, 3, 4], 34.2) },
  { name: "Dream Tickets", history: makeHistory("Saka", [4, 10, 5, 7, 6], 18.9) },
  { name: "F.C. Chelion", history: makeHistory("Palmer", [10, 6, 3, 12, 8], 33.3) },
  { name: "Loki7_7", history: makeHistory("Isak", [7, 2, 5, 10, 8], 9.0) },
  { name: "谨慎分析 大胆梭哈", history: makeHistory("Haaland", [3, 6, 12, 4, 4], 34.2) },
  { name: "足球离家出走了", history: makeHistory("Saka", [9, 3, 7, 11, 6], 18.9) },
];

function duelHistoryFor(playerName: string, duels: Duel[]): DuelHistoryRecord[] {
  return duels.flatMap((duel) => {
    const isChallenger = duel.challenger === playerName;
    const isTarget = duel.target === playerName;
    if (!isChallenger && !isTarget) return [];

    const ownScore = isChallenger ? duel.challengerScore : duel.targetScore;
    const opponentScore = isChallenger ? duel.targetScore : duel.challengerScore;
    const result = ownScore === opponentScore ? "平" : ownScore > opponentScore ? "胜" : "负";
    return [{
      id: duel.id,
      opponent: isChallenger ? duel.target : duel.challenger,
      result,
      hpChange: result === "胜" ? 1 : result === "负" ? -1 : 0,
    } satisfies DuelHistoryRecord];
  });
}

function formatLife(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function DuelCard({ duel }: { duel: Duel }) {
  const isDraw = duel.challengerScore === duel.targetScore;
  const challengerWon = duel.challengerScore > duel.targetScore;
  const challengerScoreClass = isDraw ? styles.neutral : challengerWon ? styles.positive : styles.negative;
  const targetScoreClass = isDraw ? styles.neutral : challengerWon ? styles.negative : styles.positive;

  return (
    <article className={`${styles.duelCard} ${isDraw ? styles.draw : styles.settled}`}>
      <header className={styles.duelCardHeader}>
        <span>DUEL {String(duel.id).padStart(2, "0")}</span>
        <strong>{isDraw ? "平局 · 次数返还" : "已结算"}</strong>
      </header>
      <div className={styles.combatants}>
        <div className={styles.combatant}>
          <small>挑战者</small>
          <strong>{duel.challenger}</strong>
          <span className={styles.captainLabel}>队长</span>
          <b className={styles.captainName}>{duel.challengerCaptain}</b>
          <em className={challengerScoreClass}>{duel.challengerScore}</em>
        </div>
        <div className={styles.versus} aria-hidden="true"><i></i><strong>VS</strong><i></i></div>
        <div className={`${styles.combatant} ${styles.target}`}>
          <small>被挑战者</small>
          <strong>{duel.target}</strong>
          <span className={styles.captainLabel}>队长</span>
          <b className={styles.captainName}>{duel.targetCaptain}</b>
          <em className={targetScoreClass}>{duel.targetScore}</em>
        </div>
      </div>
      <div className={styles.outcome}>
        <strong className={challengerScoreClass}>{isDraw ? "平局" : challengerWon ? "胜 +1 血量" : "负 -1 血量"}</strong>
        <strong className={targetScoreClass}>{isDraw ? "平局" : challengerWon ? "负 -1 血量" : "胜 +1 血量"}</strong>
      </div>
    </article>
  );
}

function DemoRankedPlayerCells({ player }: { player: RankedDemoPlayer }) {
  return (
    <>
      <strong
        className={`rank-gem rank-gem-${player.rank <= 3 ? player.rank : 4}`}
        aria-label={`第 ${player.rank} 名`}
        style={player.rank <= 3 ? { "--rank-badge-image": `url("${siteBasePath}/assets/leaderboard/rank-${player.rank}-ice.webp")` } as CSSProperties : undefined}
      ><span aria-hidden="true">{player.rank}</span></strong>
      <div className="player-id-cell"><strong className="player-id">{player.name}</strong></div>
      <strong className="stat-score"><span>{player.gpc}</span></strong>
      <strong className="stat-score stat-captain-total"><span>{player.captainTotal}</span></strong>
      <div className="hp-cell" aria-label={`${player.hp} 点血量`}>
        <span className="pixel-health" aria-hidden="true">
          {Array.from({ length: player.hp }, (_, index) => <i className="blood-drop" key={index}></i>)}
        </span>
      </div>
    </>
  );
}

function DemoRankingHistory({ player, duelRecords }: { player: RankedDemoPlayer; duelRecords: DuelHistoryRecord[] }) {
  return (
    <section className="rank-history" aria-label={`${player.name} 的得分与血量记录`}>
      <header><strong>队长选择记录</strong><small>GW 9</small></header>
      <div>
        {player.history.map((item) => (
          <article className="history-row" key={`captain-${item.gw}`}>
            <strong className="history-gw">GW{item.gw}</strong>
            <div className="history-captain"><b>{item.captain}</b><small className={item.rate < 10 ? "rare-pick" : ""}>选择率 {item.rate}%</small></div>
            <div className="history-result" aria-label={`${item.points} 分，血量变化 ${formatLife(item.life)}`}>
              <span className="history-result-box history-points" aria-hidden="true"><b>{item.points}</b><em>分</em></span>
              <span className={`history-result-box history-life ${item.life >= 2 ? "life-rare" : ""}`} aria-hidden="true"><b>{formatLife(item.life)}</b><em>血</em></span>
            </div>
          </article>
        ))}
        {duelRecords.map((record) => (
          <article className={`history-row ${styles.duelHistoryRow}`} key={`duel-${record.id}`}>
            <strong className="history-gw">GW9</strong>
            <div className="history-captain"><b>决斗记录</b><small>VS {record.opponent}</small></div>
            <div className="history-result" aria-label={`决斗${record.result}，血量变化 ${formatLife(record.hpChange)}`}>
              <span className={`history-result-box ${record.result === "胜" ? styles.duelWin : record.result === "负" ? styles.duelLoss : ""}`} aria-hidden="true"><b>{record.result}</b><em>决斗</em></span>
              <span className={`history-result-box ${record.hpChange > 0 ? styles.duelWin : record.hpChange < 0 ? styles.duelLoss : ""}`} aria-hidden="true"><b>{formatLife(record.hpChange)}</b><em>血</em></span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function ArenaDemo() {
  const [duels, setDuels] = useState<Duel[]>(initialDuels);
  const [dialogStep, setDialogStep] = useState<DialogStep>("closed");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [feedback, setFeedback] = useState("");
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const usedDuelRights = Math.max(0, duels.length - initialDuels.length);
  const remainingDuels = 5 - usedDuelRights;
  const selectedCandidate = useMemo(() => candidates.find((candidate) => candidate.name === selectedTarget) ?? null, [selectedTarget]);
  const ranking = useMemo<RankedDemoPlayer[]>(() => {
    const rows = demoPlayers.map((player) => {
      const duelLife = duelHistoryFor(player.name, duels).reduce((total, record) => total + record.hpChange, 0);
      const latest = player.history[player.history.length - 1];
      return {
        ...player,
        rank: 0,
        gpc: latest?.points ?? 0,
        captainTotal: player.history.reduce((total, item) => total + item.points, 0),
        hp: Math.max(0, 1 + player.history.reduce((total, item) => total + item.life, 0) + duelLife),
      };
    });
    return rows
      .sort((left, right) => right.hp - left.hp || right.captainTotal - left.captainTotal || left.name.localeCompare(right.name, "zh-CN"))
      .map((player, index) => ({ ...player, rank: index + 1 }));
  }, [duels]);
  const frameStyle = {
    "--arena-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-frame-complete.webp")`,
  } as CSSProperties;
  const rankingPanelAssets = {
    "--ledger-complete-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-frame-complete.webp")`,
    "--ledger-row-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-row-frame.webp")`,
    "--ledger-history-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-history-frame.webp")`,
    "--score-slot-image": `url("${siteBasePath}/assets/leaderboard/score-slot.webp")`,
    "--pixel-heart-image": `url("${siteBasePath}/assets/leaderboard/pixel-heart.svg")`,
  } as CSSProperties;

  useEffect(() => {
    if (dialogStep === "closed") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogStep("closed");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialogStep]);

  const openDialog = () => {
    setSelectedTarget("");
    setFeedback("");
    setDialogStep("select");
  };

  const reviewChallenge = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCandidate) {
      setFeedback("请选择一位挑战目标。");
      return;
    }
    if (duels.length >= 5) {
      setFeedback("本轮前 5 组名额已经用完。");
      return;
    }
    setFeedback("");
    setDialogStep("confirm");
  };

  const confirmChallenge = () => {
    if (!selectedCandidate || duels.length >= 5) return;
    const challengerScore = 10;
    const targetScore = selectedCandidate.revealedScore;
    setDuels((current) => [
      ...current,
      {
        id: current.length + 1,
        challenger: "Eva（我）",
        target: selectedCandidate.name,
        challengerCaptain: "Haaland",
        targetCaptain: selectedCandidate.revealedCaptain,
        challengerScore,
        targetScore,
      },
    ]);
    setDialogStep("closed");
  };

  return (
    <main className={styles.page}>
      <header className={styles.siteHeader}>
        <a className={styles.brand} href={`${siteBasePath}/`} aria-label="返回正式战榜">
          <span className={styles.brandEmblem} aria-hidden="true"></span>
          <span><strong>PENGUIN CUP</strong><small>THE FROZEN ABYSS</small></span>
        </a>
        <a className={styles.backLink} href={`${siteBasePath}/`}>返回战榜</a>
      </header>

      <section className={styles.hero}>
        <small>STAGE II · GW9–GW20</small>
        <h1>冰海角斗场</h1>
      </section>

      <section className={styles.arena} style={frameStyle}>
        <header className={styles.arenaHeader}>
          <div>
            <small>GW9 · DDL 已过</small>
            <h2>决斗申请与战况</h2>
          </div>
          <div className={styles.slotMeter} aria-label={`本轮已提交 ${duels.length} 组，最多 5 组`}>
            <span>{Array.from({ length: 5 }, (_, index) => <i className={index < duels.length ? styles.filledSlot : ""} key={index}></i>)}</span>
            <strong>{duels.length} / 5 组</strong>
          </div>
          <button className={styles.challengeButton} type="button" onClick={openDialog} disabled={duels.length >= 5}>
            <small>剩余 {remainingDuels} 次决斗权</small>
            <strong>＋ 发起挑战</strong>
          </button>
        </header>

        {isAfterDeadline ? (
          <div className={styles.duelGrid} aria-live="polite">
            {duels.map((duel) => <DuelCard duel={duel} key={duel.id} />)}
          </div>
        ) : (
          <div className={styles.preDeadlineSummary}><strong>{duels.length} 组</strong><span>挑战已发起</span></div>
        )}
      </section>

      <section className={styles.rankingArea}>
        <article className="panel ranking-panel" id="ranking" style={rankingPanelAssets}>
          <header className="panel-title"><div><small>2026–27 · ALL STAGES</small><h2>积分与血量排行榜</h2></div></header>
          <div className="ranking-head" aria-hidden="true">
            <span>阶位</span><span>玩家 ID</span><span>当周队长得分</span><span>队长总分</span><span>血量</span>
          </div>
          <div className="ranking-list">
            {ranking.map((player) => {
              const isExpanded = expandedPlayer === player.name;
              return <Fragment key={player.name}>
                <article
                  className={`rank-row selectable ${isExpanded ? "selected" : ""} ${player.name === "Eva（我）" ? "current-player-row" : ""}`}
                  onClick={() => setExpandedPlayer((current) => current === player.name ? null : player.name)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedPlayer((current) => current === player.name ? null : player.name);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                >
                  <DemoRankedPlayerCells player={player} />
                </article>
                {isExpanded ? <div className="rank-history-wrap"><DemoRankingHistory player={player} duelRecords={duelHistoryFor(player.name, duels)} /></div> : null}
              </Fragment>;
            })}
          </div>
          <nav className="ranking-pagination" aria-label="排行榜分页">
            <button type="button" disabled aria-label="上一页"><span aria-hidden="true">‹</span></button>
            <span><strong>第 1 页</strong></span>
            <button type="button" disabled aria-label="下一页"><span aria-hidden="true">›</span></button>
          </nav>
        </article>
      </section>

      {dialogStep === "select" ? <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogStep("closed"); }}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="duel-dialog-title">
          <button className={styles.closeButton} type="button" onClick={() => setDialogStep("closed")} aria-label="关闭挑战申请">×</button>
          <header>
            <small>GW9 · DDL 前申请</small>
            <h2 id="duel-dialog-title">发起决斗申请</h2>
            <p>当前身份：<strong>Eva</strong></p>
          </header>
          <form onSubmit={reviewChallenge}>
            <fieldset>
              <legend>选择挑战目标</legend>
              <div className={styles.candidateList}>
                {candidates.map((candidate) => (
                  <label className={selectedTarget === candidate.name ? styles.selectedCandidate : ""} key={candidate.name}>
                    <input type="radio" name="duel-target" value={candidate.name} checked={selectedTarget === candidate.name} onChange={() => { setSelectedTarget(candidate.name); setFeedback(""); }} />
                    <span><small>RANK {candidate.rank}</small><strong>{candidate.name}</strong></span>
                    <span><small>当前血量</small><b>{candidate.hp} ♥</b></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {feedback ? <p className={styles.feedback} role="alert">{feedback}</p> : null}
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setDialogStep("closed")}>取消</button>
              <button type="submit">确认发起挑战</button>
            </div>
          </form>
        </section>
      </div> : null}

      {dialogStep === "confirm" && selectedCandidate ? <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogStep("closed"); }}>
        <section className={`${styles.dialog} ${styles.confirmDialog}`} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
          <button className={styles.closeButton} type="button" onClick={() => setDialogStep("closed")} aria-label="关闭二次确认">×</button>
          <header>
            <small>GW9 · FINAL CONFIRMATION</small>
            <h2 id="confirm-dialog-title">确认挑战对象</h2>
          </header>
          <div className={styles.confirmBody}>
            <div className={styles.confirmVersus}>
              <article>
                <small>挑战者 · RANK 20</small>
                <strong>Eva（我）</strong>
                <span>当前血量 <b>4 ♥</b></span>
              </article>
              <b>VS</b>
              <article>
                <small>挑战对象 · RANK {selectedCandidate.rank}</small>
                <strong>{selectedCandidate.name}</strong>
                <span>当前血量 <b>{selectedCandidate.hp} ♥</b></span>
              </article>
            </div>
            <p className={styles.hiddenCaptainNotice}>双方队长与得分将在 DDL 后统一公开</p>
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setDialogStep("select")}>返回重选</button>
              <button type="button" className={styles.primaryAction} onClick={confirmChallenge}>确认提交</button>
            </div>
          </div>
        </section>
      </div> : null}
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import styles from "./arena.module.css";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isAfterDeadline = true;

type DialogStep = "closed" | "select" | "confirm";
type DuelStatus = "settled" | "draw";

type Duel = {
  id: number;
  challenger: string;
  target: string;
  challengerCaptain: string;
  targetCaptain: string;
  challengerScore: number;
  targetScore: number;
  status: DuelStatus;
};

type Candidate = {
  name: string;
  rank: number;
  hp: number;
  captain: string;
  captainScore: number;
};

const initialDuels: Duel[] = [
  {
    id: 1,
    challenger: "willis's Team",
    target: "SSU - Sakai Moka",
    challengerCaptain: "Haaland",
    targetCaptain: "Saka",
    challengerScore: 12,
    targetScore: 6,
    status: "settled",
  },
  {
    id: 2,
    challenger: "HindMics",
    target: "Orange's Team",
    challengerCaptain: "Palmer",
    targetCaptain: "Isak",
    challengerScore: 8,
    targetScore: 8,
    status: "draw",
  },
  {
    id: 3,
    challenger: "muscleking",
    target: "Team电子羊",
    challengerCaptain: "Haaland",
    targetCaptain: "B.Fernandes",
    challengerScore: 4,
    targetScore: 11,
    status: "settled",
  },
];

const candidates: Candidate[] = [
  { name: "Nicolas' XI", rank: 7, hp: 4, captain: "Haaland", captainScore: 4 },
  { name: "Dream Tickets", rank: 10, hp: 3, captain: "Saka", captainScore: 6 },
  { name: "F.C. Chelion", rank: 12, hp: 3, captain: "Palmer", captainScore: 8 },
  { name: "Loki7_7", rank: 14, hp: 3, captain: "Isak", captainScore: 8 },
  { name: "谨慎分析 大胆梭哈", rank: 16, hp: 3, captain: "Haaland", captainScore: 4 },
  { name: "足球离家出走了", rank: 19, hp: 3, captain: "Saka", captainScore: 6 },
];

const rankingRows = [
  { rank: 1, name: "willis's Team", captain: "Haaland", captainScore: 12, hp: 7 },
  { rank: 2, name: "Team电子羊", captain: "B.Fernandes", captainScore: 11, hp: 5 },
  { rank: 3, name: "HindMics", captain: "Palmer", captainScore: 8, hp: 4 },
  { rank: 4, name: "Orange's Team", captain: "Isak", captainScore: 8, hp: 4 },
  { rank: 5, name: "SSU - Sakai Moka", captain: "Saka", captainScore: 6, hp: 3 },
  { rank: 6, name: "muscleking", captain: "Haaland", captainScore: 4, hp: 3 },
  { rank: 20, name: "Eva（我）", captain: "Haaland", captainScore: 10, hp: 4 },
];

function captainScoreClass(score: number) {
  if (score >= 10) return styles.positive;
  if (score <= 3) return styles.negative;
  return styles.neutral;
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

export default function ArenaDemo() {
  const [duels, setDuels] = useState<Duel[]>(initialDuels);
  const [dialogStep, setDialogStep] = useState<DialogStep>("closed");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [feedback, setFeedback] = useState("");
  const usedDuelRights = Math.max(0, duels.length - initialDuels.length);
  const remainingDuels = 5 - usedDuelRights;
  const selectedCandidate = useMemo(() => candidates.find((candidate) => candidate.name === selectedTarget) ?? null, [selectedTarget]);
  const frameStyle = {
    "--arena-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-frame-complete.webp")`,
    "--arena-row-frame-image": `url("${siteBasePath}/assets/leaderboard/ice-row-frame.webp")`,
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
    const targetScore = selectedCandidate.captainScore;
    setDuels((current) => [
      ...current,
      {
        id: current.length + 1,
        challenger: "Eva（我）",
        target: selectedCandidate.name,
        challengerCaptain: "Haaland",
        targetCaptain: selectedCandidate.captain,
        challengerScore,
        targetScore,
        status: challengerScore === targetScore ? "draw" : "settled",
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

      <section className={styles.rankingPanel} style={frameStyle}>
        <header>
          <div><small>GW9 · LIFE LEDGER</small><h2>冰海角斗场排行榜</h2></div>
        </header>
        <div className={styles.rankingHead} aria-hidden="true">
          <span>阶位</span><span>玩家 ID</span><span>当前队长</span><span>队长得分</span><span>血量</span>
        </div>
        <div className={styles.rankingList}>
          {rankingRows.map((player) => (
            <article className={player.name.includes("（我）") ? styles.me : ""} key={player.name}>
              <span>{player.rank}</span>
              <strong>{player.name}</strong>
              <span>{player.captain}</span>
              <b className={captainScoreClass(player.captainScore)}>{player.captainScore}</b>
              <strong className={styles.hp}>{player.hp} ♥</strong>
            </article>
          ))}
        </div>
      </section>

      {dialogStep === "select" ? <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogStep("closed"); }}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="duel-dialog-title">
          <button className={styles.closeButton} type="button" onClick={() => setDialogStep("closed")} aria-label="关闭挑战申请">×</button>
          <header>
            <small>GW9 · DUEL APPLICATION</small>
            <h2 id="duel-dialog-title">发起决斗申请</h2>
            <p>当前身份：<strong>Eva</strong>　队长：<strong>Haaland</strong></p>
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
                <span>队长 <b>Haaland</b> · GW9 <em>10</em></span>
              </article>
              <b>VS</b>
              <article>
                <small>挑战对象 · RANK {selectedCandidate.rank}</small>
                <strong>{selectedCandidate.name}</strong>
                <span>当前血量 <b>{selectedCandidate.hp} ♥</b></span>
                <span>队长 <b>{selectedCandidate.captain}</b> · GW9 <em>{selectedCandidate.captainScore}</em></span>
              </article>
            </div>
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

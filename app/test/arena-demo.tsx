"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import styles from "./arena.module.css";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type DuelStatus = "settled" | "draw" | "pending";

type Duel = {
  id: number;
  challenger: string;
  target: string;
  challengerCaptain: string;
  targetCaptain: string;
  challengerScore: number | null;
  targetScore: number | null;
  challengerBase: number;
  targetBase: number;
  status: DuelStatus;
};

type Candidate = {
  name: string;
  rank: number;
  hp: number;
  captain: string;
  captainScore: number | null;
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
    challengerBase: 1,
    targetBase: 0,
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
    challengerBase: 0,
    targetBase: 0,
    status: "draw",
  },
  {
    id: 3,
    challenger: "muscleking",
    target: "Team电子羊",
    challengerCaptain: "Haaland",
    targetCaptain: "B.Fernandes",
    challengerScore: null,
    targetScore: null,
    challengerBase: 0,
    targetBase: -1,
    status: "pending",
  },
];

const candidates: Candidate[] = [
  { name: "Nicolas' XI", rank: 7, hp: 4, captain: "Haaland", captainScore: null },
  { name: "Dream Tickets", rank: 10, hp: 3, captain: "Saka", captainScore: null },
  { name: "F.C. Chelion", rank: 12, hp: 3, captain: "Palmer", captainScore: null },
  { name: "Loki7_7", rank: 14, hp: 3, captain: "Isak", captainScore: null },
  { name: "谨慎分析 大胆梭哈", rank: 16, hp: 3, captain: "Haaland", captainScore: null },
  { name: "足球离家出走了", rank: 19, hp: 3, captain: "Saka", captainScore: null },
];

const rankingRows = [
  { rank: 1, name: "willis's Team", captain: "Haaland · 12", base: 1, duel: 1, hp: 7 },
  { rank: 2, name: "SSU - Sakai Moka", captain: "Saka · 6", base: 0, duel: -1, hp: 3 },
  { rank: 3, name: "HindMics", captain: "Palmer · 8", base: 0, duel: 0, hp: 4 },
  { rank: 4, name: "Orange's Team", captain: "Isak · 8", base: 0, duel: 0, hp: 4 },
  { rank: 5, name: "muscleking", captain: "Haaland · 待定", base: 0, duel: null, hp: 4 },
  { rank: 6, name: "Team电子羊", captain: "B.Fernandes · 待定", base: -1, duel: null, hp: 3 },
  { rank: 20, name: "Eva（我）", captain: "Haaland · 待定", base: 0, duel: null, hp: 3 },
];

function formatChange(value: number | null) {
  if (value === null) return "待结算";
  if (value > 0) return `+${value}`;
  return String(value);
}

function changeClass(value: number | null) {
  if (value === null || value === 0) return styles.neutral;
  return value > 0 ? styles.positive : styles.negative;
}

function DuelCard({ duel }: { duel: Duel }) {
  const challengerDuel = duel.status === "settled" ? 1 : duel.status === "draw" ? 0 : null;
  const targetDuel = duel.status === "settled" ? -1 : duel.status === "draw" ? 0 : null;
  const statusLabel = duel.status === "settled" ? "已结算" : duel.status === "draw" ? "平局 · 次数返还" : "等待 DDL";

  return (
    <article className={`${styles.duelCard} ${styles[duel.status]}`}>
      <header className={styles.duelCardHeader}>
        <span>DUEL {String(duel.id).padStart(2, "0")}</span>
        <strong>{statusLabel}</strong>
      </header>
      <div className={styles.combatants}>
        <div className={styles.combatant}>
          <small>挑战者</small>
          <strong>{duel.challenger}</strong>
          <span>{duel.challengerCaptain}</span>
          <b>{duel.challengerScore ?? "—"}</b>
        </div>
        <div className={styles.versus} aria-hidden="true"><i></i><strong>VS</strong><i></i></div>
        <div className={`${styles.combatant} ${styles.target}`}>
          <small>被挑战者</small>
          <strong>{duel.target}</strong>
          <span>{duel.targetCaptain}</span>
          <b>{duel.targetScore ?? "—"}</b>
        </div>
      </div>
      <div className={styles.settlement}>
        <div>
          <span>基础</span><b className={changeClass(duel.challengerBase)}>{formatChange(duel.challengerBase)}</b>
          <span>决斗</span><b className={changeClass(challengerDuel)}>{formatChange(challengerDuel)}</b>
        </div>
        <div>
          <span>基础</span><b className={changeClass(duel.targetBase)}>{formatChange(duel.targetBase)}</b>
          <span>决斗</span><b className={changeClass(targetDuel)}>{formatChange(targetDuel)}</b>
        </div>
      </div>
    </article>
  );
}

export default function ArenaDemo() {
  const [duels, setDuels] = useState<Duel[]>(initialDuels);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [feedback, setFeedback] = useState("");
  const remainingDuels = 5 - Math.max(0, duels.length - initialDuels.length);
  const selectedCandidate = useMemo(() => candidates.find((candidate) => candidate.name === selectedTarget) ?? null, [selectedTarget]);

  useEffect(() => {
    if (!isDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDialogOpen]);

  const openDialog = () => {
    setSelectedTarget("");
    setFeedback("");
    setDialogOpen(true);
  };

  const submitChallenge = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCandidate) {
      setFeedback("请选择一位挑战目标。 ");
      return;
    }
    if (duels.length >= 5) {
      setFeedback("本轮前 5 组名额已经用完。 ");
      return;
    }

    setDuels((current) => [
      ...current,
      {
        id: current.length + 1,
        challenger: "Eva（我）",
        target: selectedCandidate.name,
        challengerCaptain: "Haaland",
        targetCaptain: selectedCandidate.captain,
        challengerScore: null,
        targetScore: null,
        challengerBase: 0,
        targetBase: 0,
        status: "pending",
      },
    ]);
    setDialogOpen(false);
    setFeedback("");
  };

  return (
    <main className={styles.page}>
      <header className={styles.siteHeader}>
        <a className={styles.brand} href={`${siteBasePath}/`} aria-label="返回正式战榜">
          <span className={styles.brandEmblem} aria-hidden="true"></span>
          <span><strong>PENGUIN CUP</strong><small>ARENA PROTOTYPE</small></span>
        </a>
        <span className={styles.testBadge}>TEST · 不影响正式数据</span>
        <a className={styles.backLink} href={`${siteBasePath}/`}>返回战榜</a>
      </header>

      <section className={styles.hero}>
        <div>
          <small>STAGE II · GW9–GW20</small>
          <h1>冰海角斗场</h1>
          <p>挑战必须在当轮 DDL 前提交。基础队长血量先独立结算，再计算决斗胜负。</p>
        </div>
        <div className={styles.ruleSummary} aria-label="第二阶段规则摘要">
          <span><b>基础结算</b>队长 ≥10：+1　队长 ≤3：-1</span>
          <span><b>决斗结算</b>胜 +1　平 0 并返还次数　负 -1</span>
          <span><b>申请限制</b>每轮前 5 组生效 · 成为目标后不可再发起</span>
        </div>
      </section>

      <section className={styles.arena}>
        <header className={styles.arenaHeader}>
          <div>
            <small>GW9 · 模拟轮次</small>
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

        <div className={styles.duelGrid} aria-live="polite">
          {duels.map((duel) => <DuelCard duel={duel} key={duel.id} />)}
        </div>
      </section>

      <section className={styles.rankingPanel}>
        <header>
          <div><small>GW9 · LIFE LEDGER</small><h2>冰海角斗场排行榜</h2></div>
          <span>模拟数据</span>
        </header>
        <div className={styles.rankingHead} aria-hidden="true">
          <span>阶位</span><span>玩家 ID</span><span>队长</span><span>基础</span><span>决斗</span><span>血量</span>
        </div>
        <div className={styles.rankingList}>
          {rankingRows.map((player) => (
            <article className={player.name.includes("（我）") ? styles.me : ""} key={player.name}>
              <span>{player.rank}</span>
              <strong>{player.name}</strong>
              <span>{player.captain}</span>
              <b className={changeClass(player.base)}>{formatChange(player.base)}</b>
              <b className={changeClass(player.duel)}>{formatChange(player.duel)}</b>
              <strong className={styles.hp}>{player.hp} ♥</strong>
            </article>
          ))}
        </div>
      </section>

      {isDialogOpen ? <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="duel-dialog-title">
          <button className={styles.closeButton} type="button" onClick={() => setDialogOpen(false)} aria-label="关闭挑战申请">×</button>
          <header>
            <small>GW9 · DUEL APPLICATION</small>
            <h2 id="duel-dialog-title">发起决斗申请</h2>
            <p>当前身份：<strong>Eva</strong>　队长：<strong>Haaland</strong></p>
          </header>
          <form onSubmit={submitChallenge}>
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
            <div className={styles.dialogNotice}>
              <p>提交后将占用本轮前 5 组中的 1 个名额。双方队长分会在 DDL 后自动带入。</p>
              <strong>{duels.length} / 5 组已占用</strong>
            </div>
            {feedback ? <p className={styles.feedback} role="alert">{feedback}</p> : null}
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setDialogOpen(false)}>取消</button>
              <button type="submit">确认发起挑战</button>
            </div>
          </form>
        </section>
      </div> : null}
    </main>
  );
}

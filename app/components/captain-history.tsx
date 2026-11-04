import { Fragment } from "react";
import styles from "./captain-history.module.css";

export type CaptainHistoryEntry = { gw: number; captain: string; rate: number; points: number; life: number; duelLife?: number; status?: "not_started" | "playing" | "finished"; usedViceCaptain?: boolean };

type HistoryStage = { gwFrom: number; gwTo: number; roman: string; title: string; range: string };

function signedLife(value: number): string { return value > 0 ? `+${value}` : String(value); }

export default function InlineCaptainHistory({ playerName, history, currentGwLabel, stage }: { playerName: string; history: CaptainHistoryEntry[]; currentGwLabel: string; stage: HistoryStage }) {
  // Chapter panels stay independent: chapter II never shows chapter I records,
  // while total life and captain totals keep ranking players across all chapters.
  const chapterHistory = history.filter((item) => item.gw >= stage.gwFrom && item.gw <= stage.gwTo);
  const chapterLife = chapterHistory.reduce((total, item) => total + item.life + (item.duelLife ?? 0), 0);

  return (
    <section className={`rank-history ${styles.history}`} aria-label={`${playerName} 在${stage.title}的队长选择记录`}>
      <header><strong>队长选择记录</strong><small>{currentGwLabel}</small></header>
      <div>
        {chapterHistory.length === 0 ? <p className="history-empty">本章节尚无队长选择记录</p> : chapterHistory.map((item) => (
          <Fragment key={item.gw}><article className="history-row">
            <strong className="history-gw">GW{item.gw}</strong>
            <div className="history-captain"><b>{item.captain}{item.usedViceCaptain ? "（副）" : ""}</b><small className={item.rate < 10 ? "rare-pick" : ""}>选择率 {item.rate}%</small></div>
            <div
              className="history-result"
              aria-label={item.status === "not_started" ? "未开赛，暂未增加血量" : `${item.points} 分，血量变化 ${signedLife(item.life)}`}
            >
              <span className="history-result-box history-points" aria-hidden="true">
                <b className={item.status === "not_started" ? "score-pending" : undefined}>{item.status === "not_started" ? "未开赛" : item.points}</b>{item.status === "not_started" ? null : <em>分</em>}
              </span>
              <span className={`history-result-box history-life ${item.life > 0 ? "life-gain" : item.life < 0 ? "life-loss" : "life-neutral"} ${item.life === 2 ? "life-rare" : ""}`} aria-hidden="true">
                <b>{signedLife(item.life)}</b><em>血</em>
              </span>
            </div>
          </article>{item.duelLife !== undefined ? <article className="history-row"><strong className="history-gw">GW{item.gw}</strong><div className="history-captain"><b>决斗结算</b><small>{item.duelLife > 0 ? '胜利' : item.duelLife < 0 ? '失败' : '平局'}</small></div><div className="history-result"><span className={`history-result-box history-life ${item.duelLife > 0 ? "life-gain" : item.duelLife < 0 ? "life-loss" : "life-neutral"}`}><b>{signedLife(item.duelLife)}</b><em>血</em></span></div></article> : null}</Fragment>
        ))}
        <article className="history-row history-chapter-summary">
          <strong className="history-gw">CH.{stage.roman}</strong>
          <div className="history-captain"><b>{stage.title}</b><small>{stage.range} · 本章节血量变化</small></div>
          <div className="history-result" aria-label={`本章节血量变化 ${signedLife(chapterLife)}`}>
            <span className={`history-result-box history-life ${chapterLife > 0 ? "life-gain" : chapterLife < 0 ? "life-loss" : "life-neutral"} ${chapterLife >= 2 ? "life-rare" : ""}`} aria-hidden="true">
              <b>{signedLife(chapterLife)}</b><em>血</em>
            </span>
          </div>
        </article>
      </div>
    </section>
  );
}

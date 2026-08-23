const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const phases = [
  { id: "01", title: "第一阶段｜生命之火试炼", range: "GW1–GW8", rules: ["所有寒冰见习者初始拥有 1 点生命值", "冰霜领主得分 ≥10：+1 生命值", "得分 ≥10 且 Captain Pick Rate <10%：额外 +1 生命值（本轮共 +2）", "筑城时代无玩家对战，不会失去生命值"], advance: "全员进入冰海角斗场" },
  { id: "02", title: "第二阶段｜冰海角斗场", range: "GW9–GW20", rules: ["队长 ≥10：+1 生命值；队长 ≤3：-1 生命值", "每位玩家拥有 5 次决斗权，仅比较双方队长得分", "胜利 +1；平局不变并返还次数；失败 -1", "每轮最先提交的前 5 组生效；先成为目标后，自身挑战失效"], advance: "按生命值接受冰山与深海分层" },
  { id: "03", title: "第三阶段｜冰山与深海分界", range: "GW21–GW30", rules: ["生命值前 50% 成为冰冠贵族，后 50% 成为深渊幸存者", "每人仍有 5 次决斗机会，规则与第二阶段一致", "队长 ≥10：+1；队长 ≤3：-1", "每轮仅前 5 组申请生效"], advance: "冰山组前 8 成为冰冠骑士；其余幸存者进入第四阶段" },
  { id: "04", title: "第四阶段｜深海大逃杀", range: "GW31–GW34", rules: ["冰山组未直通玩家与深海幸存者进入万丈冰渊", "决斗次数无限制，仅比较双方队长得分", "胜利 +2；平局不变并返还挑战机会；失败 -2", "队长 ≥10：+1；队长 ≤3：-1"], advance: "GW34 生命值前 8 成为深渊挑战者" },
  { id: "05", title: "第五阶段｜冰渊王座决战", range: "GW35–GW38", rules: ["八大冰冠骑士与八大深渊挑战者会师", "单场淘汰，自动随机抽签，仅比较队长得分", "GW35 16强；GW36 8强；GW37 半决赛；GW38 决赛"], advance: "GW38 获胜者加冕冰渊王冠" },
];

export default function RulesPage() {
  return (
    <main className="rules-page">
      <header className="site-header"><div className="header-inner"><a className="brand" href={`${siteBasePath}/`} aria-label="企鹅杯首页"><span className="brand-emblem" aria-hidden="true"></span><span className="brand-copy"><strong>PENGUIN CUP</strong><small>THE FROZEN ABYSS</small></span></a><nav className="top-nav rules-return-nav" aria-label="返回导航"><a className="active" href={`${siteBasePath}/`} aria-label="返回战榜">战榜</a></nav><div className="gameweek"><small>五重试炼</small><strong>RULES</strong></div></div></header>
      <section className="rules-hero"><div><span>THE CODEX OF THE FROZEN ABYSS</span><h1>冰渊法典</h1><p>五重试炼，十六位传奇，一座王座。</p></div><a href={`${siteBasePath}/`}>← 返回战榜</a></section>
      <section className="rules-grid">{phases.map((phase) => <article className="rule-stage" key={phase.id}><header><strong>{phase.id}</strong><div><small>{phase.range}</small><h2>{phase.title}</h2></div></header><ul>{phase.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul><footer><span>晋级</span><strong>{phase.advance}</strong></footer></article>)}</section>
    </main>
  );
}

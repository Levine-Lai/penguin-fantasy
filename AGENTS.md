# 企鹅杯网站更新与同步规范

本规范适用于本仓库中的所有网页、样式、资源、规则、名单、测试、API Worker 与部署配置修改。

## 发布触发词

当用户说出“同步到网页”“同步网页”“发布网页”“更新线上”“部署网站”“上线”“两个网站一起更新”或语义相近的话时，视为已经明确授权执行一次完整发布：

1. 提交本次相关修改；
2. 推送 GitHub `main`；
3. 等待 GitHub Pages 部署完成；
4. 将同一个提交部署到 Cloudflare Pages；
5. 验证两个公开地址与 API；
6. 报告两个网址及各自结果。

如果用户明确说“只在本地”“先别发布”“只预览”，则不得提交、推送或部署。

## 固定线上地址

- GitHub Pages：`https://levine-lai.github.io/penguin-fantasy/`
- Cloudflare Pages：`https://penguin-fantasy.pages.dev/`
- Cloudflare Worker API：`https://penguin-cup-fpl-api.nbafantasy.workers.dev/`
- Cloudflare Pages 项目名：`penguin-fantasy`
- GitHub 仓库：`Levine-Lai/penguin-fantasy`

两个前端必须使用同一个 Worker API，不得为两个域名维护不同的数据逻辑。

## 每次修改流程

1. 修改前检查 `git status`，保留用户已有且与任务无关的改动。
2. 如果当前在 `main`，先创建 `codex/<简短任务名>` 分支再提交。
3. 只修改本次任务需要的文件，不顺带重构或覆盖无关内容。
4. 涉及名单或排名时，检查：
   - `GET /api/health`
   - `GET /api/status`
   - `GET /api/league`
   - 当前比赛周的 `GET /api/gw/:gw`
5. 以 `/api/league` 返回的当前名单、名称和人数为准；如果本地降级名单过期，同步更新并补充测试中的人数断言。
6. 保留网站现有降级行为：API 暂不可用时仍能显示本地名单。

## 固定排行榜规则

- 所有玩家始终显示数字阶位，不显示破折号占位。
- 只有总榜第 1、2、3 名使用前三名金色徽章；第二页及后续页面不得重复出现“前三名”样式。
- `SSU - Sakai Moka` 和 `企鹅`的玩家名称使用金色。
- 尚未产生任何公开队长数据时，上述两支队伍依次临时排在最前。
- 一旦产生公开队长数据，取消临时置顶，所有玩家统一按正式规则排名：生命值降序、队长总分降序、名称排序。

## 发布前验证

每次发布前至少完成：

```powershell
npm test
npm run lint
$env:NEXT_PUBLIC_BASE_PATH=""
npm run build:pages
```

构建或测试失败时不得发布。需要先修复并重新完成验证。

## GitHub Pages 发布

1. 只暂存本次确认过的文件，禁止使用 `git add .` 或 `git add -A`。
2. 在功能分支创建一个清晰提交。
3. 获取最新 `origin/main`，只允许安全的 fast-forward 合并；若远端出现新提交，先检查再处理。
4. 推送 `main` 到 `origin`。
5. 使用 GitHub Actions 检查 `Deploy GitHub Pages`，持续等待到成功或失败。
6. GitHub Pages 构建会自动使用 `/penguin-fantasy` 作为资源基础路径，不要把这个路径硬编码进页面。

## Cloudflare Pages 发布

GitHub 推送完成后，立即从同一个提交构建并发布 Cloudflare 根路径版本：

```powershell
$env:NEXT_PUBLIC_BASE_PATH=""
npm run build:pages
$commitSha = git rev-parse HEAD
npx wrangler pages deploy out --project-name penguin-fantasy --branch main --commit-hash $commitSha --commit-dirty=false
```

- 不得重复创建 Cloudflare Pages 项目。
- Cloudflare Pages 使用根路径，`NEXT_PUBLIC_BASE_PATH` 必须为空。
- 部署时附带当前提交 SHA，确保 Cloudflare 与 GitHub 对应同一份源代码。
- 如果 Wrangler 登录过期，要求用户完成 `npx wrangler login`，登录后继续原发布流程。

## Worker API 发布

- 普通前端、文案、样式或名单展示修改，不重新部署 Worker。
- 只有 `cloudflare/fpl-proxy/**` 或 Worker 配置确实发生变化时，才运行 `npm run fpl:deploy`。
- Worker 部署后重新检查 health、status、league 和当前 GW 端点，再继续两个前端发布。
- 不在输出、提交、远程地址或日志中暴露令牌与密钥。

## 每日数据刷新规范

- 每天只在北京时间 07:30 对外发布一次新的联赛快照。
- 因联赛人数超过单次 Worker 外部请求上限，允许在 07:28、07:29 做内部队长数据分批预取；这两个批次不得发布半成品排行榜。
- 07:30 完成最后一批并一次性写入正式快照与历史快照。
- 已读取过的当轮队长选择必须使用 KV 缓存，后续每天不得重复请求每支队伍的 picks 接口。
- 前端通过单个 `GET /api/history` 获取全部历史快照，不得在每次打开页面时逐轮请求 `/api/gw/1` 到当前 GW。
- 前端不得用高频 API 轮询更新时间；右上角“当前试炼”使用快照中的 `deadlineTime` 和本地时钟判断。
- 在某轮 DDL 到达前，保持上一个已经过 DDL 的 GW；GW1 DDL 前显示“见习者集结”。
- GW1 DDL 后显示 `GW 1`，GW2 DDL 后显示 `GW 2`，依此类推。页面保持打开时，最多 30 秒内自动切换，不额外调用 API。

## 发布后验收

发布完成后必须确认：

1. 两个公开地址都返回 HTTP 200；
2. 首页与规则页资源路径正确；
3. 两个站点的客户端代码都包含 Worker API 地址；
4. 最新名单能够加载；
5. GitHub Actions 成功；
6. Cloudflare Pages 最新 Production 部署对应同一个提交。

任意一端失败时，继续排查安全且在范围内的问题。最终必须明确说明“全部成功”或“仅哪一端成功、哪一端失败”，不得把部分成功描述为完整同步。

## 最终回复格式

完成同步后，简洁报告：

- 本次上线的主要变化；
- GitHub Pages 链接与状态；
- Cloudflare Pages 链接与状态；
- API 状态及当前名单人数；
- 测试、构建和线上检查结果。

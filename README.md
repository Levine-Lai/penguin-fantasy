# 企鹅杯：冰渊王座之战

2026–27 企鹅杯 Fantasy Premier League 实时榜单。网站已接入企鹅杯 FPL API，展示联赛名单、当前比赛周、队长得分、队长选择率、累计生命值与五阶段赛制；API 暂时不可用时会保留本地名单作为降级展示。

## 数据服务

- API：<https://penguin-cup-fpl-api.nbafantasy.workers.dev>
- 健康检查：`GET /api/health`
- 当前状态：`GET /api/status`
- 联赛名单：`GET /api/league`
- 比赛周快照：`GET /api/gw/:gw`

## 在线访问

[https://levine-lai.github.io/penguin-fantasy/](https://levine-lai.github.io/penguin-fantasy/)

## 本地开发

需要 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

## 验证

```bash
npm test
npm run lint
npm run build:pages
```

- `npm run build`：生成 vinext 构建
- `npm run build:pages`：在 `out/` 生成 GitHub Pages 静态站
- 推送至 `main` 后，GitHub Actions 会自动更新 Pages

## 本地单文件版

直接打开 `penguin-cup-local.html` 可以查看不依赖 API 的本地版本。

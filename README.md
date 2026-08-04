# 企鹅杯：冰渊王座之战

2026–27 企鹅杯 Fantasy Premier League 前端榜单。当前以 GW8 模拟数据展示生命值排名、队长选择记录与五阶段赛制，后续可接入官方 FPL API。

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

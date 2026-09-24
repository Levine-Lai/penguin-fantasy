import type { Metadata } from "next";
import { preload } from "react-dom";
import "./globals.css";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/[^a-zA-Z0-9/_-]/g, "");

export const metadata: Metadata = {
  title: "企鹅杯：冰渊王座之战｜2026–27",
  description: "穿越终焉冰海的五重试炼，争夺企鹅杯冰渊王座。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  preload(`${basePath}/frozen-abyss-hero.webp`, { as: "image", type: "image/webp", fetchPriority: "high" });
  preload(`${basePath}/assets/leaderboard/ice-frame-complete.webp`, { as: "image", type: "image/webp", fetchPriority: "high" });
  preload(`${basePath}/assets/leaderboard/score-slot.webp`, { as: "image", type: "image/webp" });

  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://penguin-fantasy.pages.dev" crossOrigin="anonymous" />
        <link rel="icon" href={`${basePath}/penguin-cup-logo.png`} />
        <style>{`:root{--asset-frozen-abyss:url("${basePath}/frozen-abyss-hero.webp");--asset-penguin-logo:url("${basePath}/penguin-cup-logo.webp")}`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}

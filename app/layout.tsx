import type { Metadata } from "next";
import "./globals.css";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/[^a-zA-Z0-9/_-]/g, "");

export const metadata: Metadata = {
  title: "企鹅杯：冰渊王座之战｜2026–27",
  description: "穿越终焉冰海的五重试炼，争夺企鹅杯冰渊王座。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href={`${basePath}/penguin-cup-logo.png`} />
        <style>{`:root{--asset-frozen-abyss:url("${basePath}/frozen-abyss-hero.png");--asset-penguin-logo:url("${basePath}/penguin-cup-logo.png")}`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import ArenaDemo from "./arena-demo";

export const metadata: Metadata = {
  title: "冰海角斗场 · 测试演示｜企鹅杯",
  description: "企鹅杯第二阶段冰海角斗场的交互测试页面。",
};

export default function ArenaTestPage() {
  return <ArenaDemo />;
}

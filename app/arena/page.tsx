import type { Metadata } from 'next';
import LiveArena from './live-arena';
export const metadata: Metadata = { title: '正式决斗｜企鹅杯' };
export default function ArenaPage() { return <main className="arena-page"><header className="arena-page-head"><a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`}>← 返回战榜</a><h1>冰海角斗场</h1></header><LiveArena /></main>; }

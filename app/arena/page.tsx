import type { Metadata } from 'next';
import { HomeView } from '../page';
export const metadata: Metadata = { title: '正式决斗｜企鹅杯' };
export default function ArenaPage() { return <HomeView initialStage={2} />; }

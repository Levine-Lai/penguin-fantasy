import type { Metadata } from 'next';
import AdminConsole from './admin-console';

export const metadata: Metadata = { title: '企鹅杯管理后台', robots: { index: false, follow: false } };
export default function AdminPage() { return <AdminConsole />; }

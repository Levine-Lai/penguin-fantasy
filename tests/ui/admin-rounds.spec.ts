import { test, expect } from '@playwright/test';

for (const width of [320, 375, 390, 768, 1440]) {
  test(`${width}px admin: recover a failed overview, switch GW and reset pagination`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const queries: URLSearchParams[] = [];
    await page.route('https://penguin-fantasy.pages.dev/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/admin/session')) return route.fulfill({ json: { authenticated: true } });
      queries.push(url.searchParams);
      if (queries.length <= 2) return route.fulfill({ status: 503, json: { error: '暂时无法读取' } });
      const gw = Number(url.searchParams.get('gw') ?? 10);
      const duelPage = Number(url.searchParams.get('duelPage') ?? 0);
      const start = gw === 9 ? '2026-10-23T17:30:00Z' : '2026-10-31T11:00:00Z';
      const end = gw === 9 ? '2026-10-31T11:00:00Z' : '2026-11-07T13:30:00Z';
      return route.fulfill({ json: {
        round: { gw, start, end }, rounds: [{ gw: 9 }, { gw: 10 }], page: 0,
        arena: { gw, open: false, deadline: end, count: gw === 10 ? 51 : 1 },
        members: [{ entryId: 1, teamName: '测试玩家' }],
        duelPagination: { page: duelPage, pageSize: 50, total: gw === 10 ? 51 : 1 },
        duels: [{ id: `${gw}-${duelPage}`, gw, challenger_id: 1, target_id: 2, challengerName: `GW${gw}测试玩家`, targetName: '对手', created_at: '2026-11-06T06:49:09Z', deleted_at: null, settled_at: null, selection_status: 'pending' }],
        announcements: [], activity: [], players: [], logs: [],
      } });
    });
    await page.goto('http://localhost:4319/admin/');
    await expect(page.getByRole('alert').filter({ hasText: '管理数据读取失败' })).toBeVisible();
    await page.getByRole('button', { name: '刷新数据' }).click();
    await expect(page.getByRole('combobox', { name: '统计轮次' })).toHaveValue('10');
    await expect(page.getByRole('cell', { name: /GW10测试玩家/ })).toBeVisible();
    const paging = page.getByLabel('决斗记录分页');
    await paging.getByRole('button', { name: '下一页' }).click();
    await expect(paging).toContainText('第 2 / 2 页');
    await page.getByRole('combobox', { name: '统计轮次' }).selectOption('9');
    await expect(page.getByRole('cell', { name: /GW9测试玩家/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /GW10测试玩家/ })).toHaveCount(0);
    await expect(page.getByText(/2026\/10\/24 01:30:00/)).toBeVisible();
    expect(queries.at(-1)?.get('duelPage')).toBe('0');
    expect(queries.at(-1)?.get('page')).toBe('0');
    await expect(paging).toContainText('第 1 / 1 页');
    await page.getByRole('button', { name: '登录玩家', exact: true }).click();
    await expect(page.getByRole('heading', { name: /本轮登录玩家/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/admin-round-${width}.png`, fullPage: true });
  });
}

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../../app/static-fpl-data.json', import.meta.url), 'utf8')) as {
  league: { teams: Array<{ entryId: number; teamName: string }> };
  history: unknown;
};

// All APIs are intercepted: acceptance checks never submit to production.
for (const width of [320, 375, 390, 768, 1440]) {
  test(`${width}px: row borders, six-row scroll, and history containment`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-11-04T04:00:00Z'));
    const arena = { gw: 10, open: true, deadline: '2026-11-07T02:30:00Z', selectionReady: false };
    const identity = snapshot.league.teams[0].entryId;
    await page.addInitScript(id => localStorage.setItem('penguin-fantasy:player-id:v1', String(id)), identity);
    await page.route('https://penguin-fantasy.pages.dev/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const data = path === '/api/league' ? snapshot.league
        : path === '/api/history' ? snapshot.history
        : path === '/api/community' ? { arena, members: snapshot.league.teams, results: [], announcements: [], duels: [] }
        : path === '/api/player/session' ? { token: 'acceptance-only' }
        : path === '/api/duels/mine' ? { gw: 10, arena, submitted: false, remaining: 5, eliminated: false }
        : {};
      await route.fulfill({ json: data });
    });
    await page.goto('/');
    const chooser = page.getByRole('region', { name: '正式决斗', exact: true });
    const rows = chooser.locator('label.rank-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(6);
    const rowChecks = await rows.evaluateAll(elements => elements.map(row => {
      const css = getComputedStyle(row);
      return ['Top', 'Right', 'Bottom', 'Left'].every(side => Number.parseFloat(css.getPropertyValue(`border-${side.toLowerCase()}-width`)) >= 1);
    }));
    expect(rowChecks.every(Boolean)).toBe(true);
    await expect(chooser.getByRole('group', { name: '我的决斗信息' })).toHaveCSS('border-left-width', '1px');
    const scroll = await rows.first().evaluate(row => {
      const container = row.parentElement!;
      return { height: container.clientHeight, row: row.getBoundingClientRect().height, scroll: container.scrollHeight };
    });
    expect(scroll.height).toBeLessThanOrEqual(scroll.row * 6 + 2);
    expect(scroll.scroll).toBeGreaterThan(scroll.height);
    await page.locator('#ranking .rank-row.selectable').first().click();
    const history = page.locator('.rank-history').first();
    await expect(history).toBeVisible();
    const defects = await history.locator('.history-row').evaluateAll(elements => elements.flatMap(row => {
      const outer = row.getBoundingClientRect();
      const cells = [...row.children].map(cell => cell.getBoundingClientRect());
      const outside = cells.some(cell => cell.left < outer.left - 1 || cell.right > outer.right + 1 || cell.bottom > outer.bottom + 1);
      const overlap = cells.some((a, i) => cells.slice(i + 1).some(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1));
      const clipped = [...row.querySelectorAll('b, small, .history-gw')].some(element => element.scrollWidth > element.clientWidth + 1);
      return outside || overlap || clipped ? [row.textContent] : [];
    }));
    expect(defects).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await history.screenshot({ path: `test-results/history-${width}.png` });
    await chooser.screenshot({ path: `test-results/chooser-${width}.png` });
  });
}

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../../app/static-fpl-data.json', import.meta.url), 'utf8'));
for (const [width, height] of [[320, 568], [375, 667], [390, 844], [768, 1024], [1440, 900], [568, 320]]) {
  test(`${width}x${height}: rejected challenge shows a readable compact dialog with a full-width dismissal`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const arena = { gw: 10, open: true, deadline: '2099-01-01T00:00:00Z' };
    await page.addInitScript(id => localStorage.setItem('penguin-fantasy:player-id:v1', String(id)), snapshot.league.teams[0].entryId);
    await page.route('https://penguin-fantasy.pages.dev/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/duels') return route.fulfill({ status: 409, json: { error: '你已在本轮对阵中，不能再次发起挑战' } });
      const data = path === '/api/league' ? snapshot.league : path === '/api/history' ? snapshot.history
        : path === '/api/community' ? { arena, members: snapshot.league.teams, results: [], announcements: [], duels: [] }
        : path === '/api/player/session' ? { token: 'acceptance-only' }
        : path === '/api/duels/mine' ? { gw: 10, arena, submitted: false, remaining: 5, eliminated: false } : {};
      await route.fulfill({ json: data });
    });
    await page.goto('/');
    await page.locator('label.rank-row').first().click();
    await page.getByRole('button', { name: '确认发起决斗', exact: true }).click();
    await page.getByRole('button', { name: '确认提交', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '操作失败', exact: true });
    await expect(dialog).toBeVisible();
    const detail = dialog.locator('p');
    await expect(detail).toHaveText('你已在本轮对阵中，不能再次发起挑战');
    const geometry = await dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const heading = element.querySelector('h2')!.getBoundingClientRect();
      const detail = element.querySelector('p')!.getBoundingClientRect();
      const button = element.querySelector('button')!.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        headingBottom: heading.bottom, detailTop: detail.top, detailBottom: detail.bottom, buttonTop: button.top,
        buttonWidth: button.width, textWidth: detail.width, clipped: element.scrollWidth > element.clientWidth + 1 };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(8);
    expect(geometry.right).toBeLessThanOrEqual(width - 8);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(height);
    expect(geometry.headingBottom).toBeLessThan(geometry.detailTop);
    expect(geometry.detailBottom).toBeLessThan(geometry.buttonTop);
    expect(Math.abs(geometry.buttonWidth - geometry.textWidth)).toBeLessThan(2);
    expect(geometry.clipped).toBe(false);
    await page.screenshot({ path: `test-results/error-dialog-${width}-${height}.png` });
    await dialog.getByRole('button', { name: '知道了' }).click();
    await expect(dialog).not.toBeVisible();
  });
}

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../../app/static-fpl-data.json', import.meta.url), 'utf8'));
for (const width of [320, 375, 390, 768, 1440]) {
  test(`${width}px resurrection signup locks ordinary duels and recovers an interrupted response`, async ({ page }) => {
    const eliminated = width !== 1440;
    const identity = eliminated ? 37278 : 48961;
    const side = eliminated ? 'abyss' : 'ice';
    const buttonLabel = eliminated ? '报名深渊组' : '报名冰海组';
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-11-26T04:00:00Z'));
    await page.addInitScript(id => localStorage.setItem('penguin-fantasy:player-id:v1', String(id)), identity);
    let registered = false, posts = 0;
    const arena = { gw: 12, open: true, deadline: '2026-11-28T13:30:00Z' };
    const state = () => ({
      gw: 12, open: true, opensAt: '2026-11-26T04:00:00Z', closesAt: '2026-11-27T04:00:00Z',
      counts: { abyss: registered && eliminated ? 1 : 0, ice: registered && !eliminated ? 1 : 0 }, selection: null, result: null, registrations: [],
      mine: registered ? { entry_id: identity, side, created_at: '2026-11-26T04:00:00Z', selection_status: 'pending' } : null,
    });
    await page.route('https://penguin-fantasy.pages.dev/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/resurrection' && route.request().method() === 'POST') {
        expect(route.request().postDataJSON()).toEqual({ side });
        posts++; registered = true;
        // A lost response must recover by reading status, not replaying the write.
        await route.fulfill({ status: 503, json: { error: 'temporary outage' } });
        return;
      }
      const data = path === '/api/league' ? snapshot.league : path === '/api/history' ? snapshot.history
        : path === '/api/player/session' ? { token: 'test-only' }
        : path === '/api/resurrection/mine' ? { ...state(), entryId: identity, eliminated, ordinaryDuel: false }
        : path === '/api/duels/mine' ? { entryId: identity, gw: 12, arena, eliminated: false,
          remaining: 5, submitted: false, resurrectionLocked: registered }
        : path === '/api/community' ? { arena, members: snapshot.league.teams, results: [], duels: [], announcements: [], resurrection: state() }
        : {};
      await route.fulfill({ json: data });
    });
    await page.goto('/');
    const panel = page.getByRole('region', { name: '深渊复生', exact: true });
    const signup = panel.getByRole('button', { name: buttonLabel, exact: true });
    await expect(signup).toBeEnabled();
    await signup.click();
    await expect(panel.getByRole('status')).toContainText('已报名，等待入选');
    expect(posts).toBe(1);
    await expect(page.getByText('已报名深渊复生，本轮普通决斗已锁定。', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: buttonLabel, exact: true })).toHaveCount(0);
    await panel.getByText('挑战规则', { exact: true }).click();
    const overflow = await panel.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return [...el.querySelectorAll('p, button, h3, summary, li')].some(child => {
        const rect = child.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || child.scrollWidth > child.clientWidth + 1;
      });
    });
    expect(overflow).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: `test-results/resurrection-${width}.png` });
  });
}

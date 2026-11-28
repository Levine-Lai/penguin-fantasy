import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../../app/static-fpl-data.json', import.meta.url), 'utf8'));
test('selected teams show both captain choices and the actual scoring captain points', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.clock.setFixedTime(new Date('2026-11-30T00:00:00Z'));
  const members = snapshot.league.teams.slice(0, 17) as Array<{ entryId: number; teamName: string }>;
  const [abyss, ice] = [members.slice(0, 8), members.slice(8, 16)].map(team => team.map(player => player.entryId));
  const result = { gw: 12, status: 'success', abyss, ice, abyssScore: 51, iceScore: 42 };
  const arena = { gw: 12, open: false, deadline: '2026-11-28T13:30:00Z', selectionReady: true };
  const resurrection = { gw: 12, open: false, result,
    selection: { ...result, status: 'selected', abyssScore: null, iceScore: null }, counts: { abyss: 9, ice: 8 },
    registrations: members.map(({ entryId }) => ({ entry_id: entryId, side: ice.includes(entryId) ? 'ice' : 'abyss', created_at: '2026-11-26T04:00:00Z' })),
  };
  const history = { ...snapshot.history, snapshots: [...snapshot.history.snapshots, {
    gw: 12, ready: true, finished: true, officialFinalized: true, deadlineHasPassed: true, deadlineTime: arena.deadline,
    teams: members.map((player, index) => ({ ...player, captainName: '原选队长', viceCaptainName: '副队长',
      usedViceCaptain: index === 0, scoringCaptainName: index === 0 ? '副队长' : '原选队长',
      originalCaptainPoints: 0, captainPoints: index === 0 ? 8 : 0, captainStatus: 'finished', captainPickRate: 10 })),
  }] };
  await page.route('https://penguin-fantasy.pages.dev/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/api/league' ? snapshot.league : path === '/api/history' ? history :
      path === '/api/resurrection' ? resurrection :
      { arena, members, results: [], announcements: [], duels: [], resurrection } });
  });
  await page.goto('/');
  const panel = page.getByRole('region', { name: '深渊复生', exact: true });
  await expect(panel.getByRole('region', { name: '深渊组' }).getByRole('listitem')).toHaveCount(8);
  await expect(panel.getByRole('region', { name: '冰海组' }).getByRole('listitem')).toHaveCount(8);
  await expect(panel.getByText('C 原选队长', { exact: true })).toHaveCount(16);
  await expect(panel.getByText('V 副队长', { exact: true })).toHaveCount(16);
  const rows = panel.getByRole('region', { name: '深渊组' }).getByRole('listitem');
  await expect(rows.first().locator('[aria-label="计入挑战的基础分"]')).toHaveText('8');
  await expect(rows.nth(1).locator('[aria-label="计入挑战的基础分"]')).toHaveText('0');
  expect(await rows.first().evaluate(row => {
    const [name, choices, score] = [...row.children].map(child => child.getBoundingClientRect());
    return Math.abs(name.top + name.height / 2 - choices.top - choices.height / 2) < 1 &&
      name.right <= choices.left && choices.right <= score.left && score.right <= row.getBoundingClientRect().right;
  })).toBe(true);
  await expect(panel.getByText(members[16].teamName, { exact: true })).toHaveCount(0);
  await expect(panel.getByText('报名时间（北京时间）', { exact: false })).toHaveCount(0);
  await expect(panel.locator('time')).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('深渊复生成功');
});

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
        : path === '/api/resurrection' ? { ...state(), mine: null, registrations: registered ? [state().mine] : [] }
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
    const dialog = panel.getByRole('dialog', { name: '确认报名' });
    await expect(dialog).toBeVisible();
    expect(posts).toBe(0);
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toBeHidden();
    expect(posts).toBe(0);
    await signup.click();
    await dialog.getByRole('button', { name: '确认报名' }).click();
    await expect(panel.getByRole('status')).toContainText('已报名，等待入选');
    await expect(panel.locator('time')).toHaveText('2026/11/26 12:00:00');
    expect(posts).toBe(1);
    await expect(page.getByText('已报名深渊复生，本轮普通决斗已锁定。', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: buttonLabel, exact: true })).toHaveCount(0);
    await panel.getByText('挑战规则', { exact: true }).click();
    const overflow = await panel.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return [...el.querySelectorAll('p, button, h3, summary, li')].some(child => {
        const rect = child.getBoundingClientRect();
        return child.getClientRects().length > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || child.scrollWidth > child.clientWidth + 1);
      });
    });
    expect(overflow).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: `test-results/resurrection-${width}.png` });
  });
}

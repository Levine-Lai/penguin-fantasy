import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../../app/static-fpl-data.json', import.meta.url), 'utf8'));
for (const width of [320, 375, 390, 768, 1440]) {
  test(`${width}px: effective/all duels, excluded reasons, shared headings and pending scores`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.clock.setFixedTime(new Date('2026-11-07T04:00:00Z'));
    const history = structuredClone(snapshot.history);
    for (const team of history.snapshots.at(-1).teams) { team.captainStatus = 'not_started'; team.originalCaptainStatus = 'not_started'; }
    const gw = history.snapshots.at(-1).gw;
    const arena = { gw, open: false, deadline: '2026-11-06T18:30:00Z', selectionReady: true };
    const duel = (id: string, status: string, minute: number) => ({ id, gw, selection_status: status,
      challenger_id: snapshot.league.teams[0].entryId, target_id: snapshot.league.teams[1].entryId,
      challengerName: `${id}-left`, targetName: `${id}-right`, created_at: `2026-11-06T06:${String(minute).padStart(2, '0')}:00Z`,
      deleted_at: null, settled_at: null, challenger_score: null, target_score: null, challenger_delta: null, target_delta: null,
      challengerCaptain: { captainName: 'Haaland', viceCaptainName: 'Palmer' }, targetCaptain: { captainName: 'Isak', viceCaptainName: 'Rogers' },
    });
    const selected = Array.from({ length: 5 }, (_, i) => duel(`selected-${i}`, 'selected', i + 1));
    const all = [duel('same', 'same_captain', 0), ...selected, duel('late', 'overflow', 6)].reverse();
    await page.addInitScript(id => localStorage.setItem('penguin-fantasy:player-id:v1', String(id)), snapshot.league.teams[0].entryId);
    await page.route('https://penguin-fantasy.pages.dev/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const data = path === '/api/league' ? snapshot.league : path === '/api/history' ? history
        : path === '/api/community' ? { arena, members: snapshot.league.teams, duels: selected.slice().reverse(), allDuels: all, results: [], announcements: [] }
        : path === '/api/player/session' ? { token: 'acceptance-only' }
        : path === '/api/duels/mine' ? { gw, arena, remaining: 5, submitted: false } : {};
      await route.fulfill({ json: data });
    });
    await page.goto('/');
    const panel = page.getByRole('region', { name: `GW${gw}决斗`, exact: true });
    const cards = panel.locator('article[data-duel-id]');
    await expect(cards).toHaveCount(5);
    await expect(panel.getByRole('button', { name: '已生效', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-duel-id')))).toEqual(selected.map(row => row.id));
    await panel.getByRole('button', { name: '全部', exact: true }).click();
    await expect(cards).toHaveCount(7);
    expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-duel-id')))).toEqual(['same', ...selected.map(row => row.id), 'late']);
    for (const [id, reason] of [['same', '队长一致'], ['late', '报名时间在后']]) {
      const card = panel.locator(`[data-duel-id="${id}"]`);
      await expect(card.getByText(reason, { exact: true })).toBeVisible();
      expect(await card.getByText(reason, { exact: true }).evaluate(node => node.getBoundingClientRect().width / node.parentElement!.getBoundingClientRect().width)).toBeGreaterThan(.9);
      await expect(card.getByText('未结算', { exact: true })).toHaveCount(0);
      const stamp = card.getByText('未生效', { exact: true });
      await expect(stamp).toBeVisible();
      const overlaps = await card.evaluate(card => {
        const badge = [...card.querySelectorAll('span')].find(node => node.textContent === '未生效')!.getBoundingClientRect();
        return [...card.querySelectorAll('header span, strong, b, em')].filter(node => node.textContent !== '未生效').some(node => {
          const core = node.getBoundingClientRect();
          return badge.left < core.right && badge.right > core.left && badge.top < core.bottom && badge.bottom > core.top;
        });
      });
      expect(overlaps).toBe(false);
    }
    const headings = await Promise.all(['积分与血量排行榜', '决斗情况', '决斗选择', '队长选择率'].map(name =>
      page.getByRole('heading', { name, exact: true }).evaluate(node => {
        const css = getComputedStyle(node); return [css.fontSize, css.fontFamily, css.fontWeight, css.lineHeight];
      })));
    expect(headings.every(style => JSON.stringify(style) === JSON.stringify(headings[0]))).toBe(true);
    const pending = page.locator('.stat-score').filter({ hasText: '未开赛' });
    expect(await pending.count()).toBeGreaterThan(2);
    const clipped = await pending.evaluateAll(nodes => nodes.some(node => {
      const frame = node.getBoundingClientRect(), text = node.querySelector('span')!.getBoundingClientRect();
      return text.left < frame.left || text.right > frame.right || text.top < frame.top || text.bottom > frame.bottom;
    }));
    expect(clipped).toBe(false);
    await expect(page.locator('.captain-rate-toggle')).toHaveCount(0);
    const captain = page.locator('.captain-rate-row').first();
    await captain.click(); await expect(captain).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: `test-results/duels-all-${width}.png`, style: '.site-header { visibility: hidden; }' });
    await page.locator('#ranking').screenshot({ path: `test-results/pending-ranking-${width}.png`, style: '.site-header { visibility: hidden; }' });
    await page.reload();
    await expect(panel.locator('article[data-duel-id]')).toHaveCount(5);
  });
}

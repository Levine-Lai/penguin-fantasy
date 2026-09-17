export type GwDeadline = { gw: number; deadlineTime: string };

// Official 2026–27 deadlines keep static pages on the correct current trial.
export const fallbackGwDeadlines: GwDeadline[] = [
  { gw: 1, deadlineTime: "2026-08-21T17:30:00Z" },
  { gw: 2, deadlineTime: "2026-08-28T17:30:00Z" },
  { gw: 3, deadlineTime: "2026-09-04T17:30:00Z" },
  { gw: 4, deadlineTime: "2026-09-12T12:30:00Z" },
  { gw: 5, deadlineTime: "2026-09-18T17:30:00Z" },
  { gw: 6, deadlineTime: "2026-10-10T10:00:00Z" },
  { gw: 7, deadlineTime: "2026-10-17T10:00:00Z" },
  { gw: 8, deadlineTime: "2026-10-23T17:30:00Z" },
  { gw: 9, deadlineTime: "2026-10-31T11:00:00Z" },
  { gw: 10, deadlineTime: "2026-11-07T13:30:00Z" },
  { gw: 11, deadlineTime: "2026-11-21T13:30:00Z" },
  { gw: 12, deadlineTime: "2026-11-28T13:30:00Z" },
  { gw: 13, deadlineTime: "2026-12-02T18:30:00Z" },
  { gw: 14, deadlineTime: "2026-12-05T13:30:00Z" },
  { gw: 15, deadlineTime: "2026-12-12T13:30:00Z" },
  { gw: 16, deadlineTime: "2026-12-19T13:30:00Z" },
  { gw: 17, deadlineTime: "2026-12-26T13:30:00Z" },
  { gw: 18, deadlineTime: "2026-12-30T18:30:00Z" },
  { gw: 19, deadlineTime: "2027-01-02T13:30:00Z" },
  { gw: 20, deadlineTime: "2027-01-06T18:30:00Z" },
  { gw: 21, deadlineTime: "2027-01-16T13:30:00Z" },
  { gw: 22, deadlineTime: "2027-01-23T13:30:00Z" },
  { gw: 23, deadlineTime: "2027-01-30T13:30:00Z" },
  { gw: 24, deadlineTime: "2027-02-06T13:30:00Z" },
  { gw: 25, deadlineTime: "2027-02-10T18:30:00Z" },
  { gw: 26, deadlineTime: "2027-02-20T13:30:00Z" },
  { gw: 27, deadlineTime: "2027-02-27T13:30:00Z" },
  { gw: 28, deadlineTime: "2027-03-03T18:30:00Z" },
  { gw: 29, deadlineTime: "2027-03-13T13:30:00Z" },
  { gw: 30, deadlineTime: "2027-03-20T13:30:00Z" },
  { gw: 31, deadlineTime: "2027-04-10T12:30:00Z" },
  { gw: 32, deadlineTime: "2027-04-17T12:30:00Z" },
  { gw: 33, deadlineTime: "2027-04-24T12:30:00Z" },
  { gw: 34, deadlineTime: "2027-05-01T12:30:00Z" },
  { gw: 35, deadlineTime: "2027-05-08T12:30:00Z" },
  { gw: 36, deadlineTime: "2027-05-15T12:30:00Z" },
  { gw: 37, deadlineTime: "2027-05-23T12:30:00Z" },
  { gw: 38, deadlineTime: "2027-05-30T13:30:00Z" },
];

export const currentTrialBootstrapScript = `(() => {
  const deadlines = ${JSON.stringify(fallbackGwDeadlines)};
  const now = Date.now();
  const currentGw = deadlines.reduce((latest, event) => Date.parse(event.deadlineTime) <= now ? Math.max(latest, event.gw) : latest, 0);
  document.querySelectorAll("[data-current-trial]").forEach((label) => {
    label.textContent = currentGw > 0 ? \`GW \${currentGw}\` : "见习者集结";
  });
})();`;

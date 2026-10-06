import { expect, test } from 'vitest';
import { compareRunnerTrust, computeMobileTrust, rankBuyerQuotes, type TrustEvidence } from '../convex/lib/trustScore';
const now = Date.UTC(2026, 8, 22); const day = 86_400_000;
const job = (i: number, rating = 5): TrustEvidence => ({ buyerId: `buyer-${i}`, confirmedAt: now, rating, ratedAt: now, buyerMessageAt: now - 600_000, runnerReplyAt: now - 540_000 });

test('equal trust uses buyer diversity and stable IDs; unavailable scores do not displace selectable quotes', () => {
  const neutral = computeMobileTrust([], now);
  const quotes = [
    { _id: 'z', canApprove: false, trust: { ...neutral, score: 99 }, fee: 100 },
    { _id: 'b', canApprove: true, trust: neutral, fee: 100 },
    { _id: 'a', canApprove: true, trust: neutral, fee: 9000 },
    { _id: 'c', canApprove: true, trust: { ...neutral, distinctBuyers: 3 }, fee: 8000 },
  ];
  expect(rankBuyerQuotes(quotes).map(q => q._id)).toEqual(['c', 'a', 'b', 'z']);
  expect(quotes.map(q => q._id)).toEqual(['z', 'b', 'a', 'c']);
  expect(compareRunnerTrust(null, neutral)).toBeGreaterThan(0);
});

test('cold start is neutral, and sparse history never masquerades as established', () => {
  expect(computeMobileTrust([], now)).toMatchObject({ score: 50, history: 'new', averageRating: null, responseCount: 0 });
  const one = computeMobileTrust([job(1)], now);
  expect(one.history).toBe('limited'); expect(one.score).toBeGreaterThan(50); expect(one.score).toBeLessThan(80);
  expect(computeMobileTrust(Array.from({ length: 8 }, (_, i) => job(i)), now).history).toBe('established');
});
test('recent good feedback and fast replies outrank poor feedback and slow replies', () => {
  const good = Array.from({ length: 8 }, (_, i) => job(i));
  const bad = good.map(e => ({ ...e, rating: 1, buyerMessageAt: now - 3_600_000, runnerReplyAt: now }));
  expect(computeMobileTrust(good, now).score).toBeGreaterThan(80);
  expect(computeMobileTrust(bad, now).score).toBeLessThan(50);
  expect(computeMobileTrust(good, now + 180 * day).score).toBeLessThan(computeMobileTrust(good, now).score);
  const recentGood = [job(1, 5), { ...job(2, 1), ratedAt: now - 180 * day }];
  const recentBad = [job(1, 1), { ...job(2, 5), ratedAt: now - 180 * day }];
  expect(computeMobileTrust(recentGood, now).score).toBeGreaterThan(computeMobileTrust(recentBad, now).score);
});
test('repeated buyers cannot manufacture established history or unlimited influence', () => {
  const same = Array.from({ length: 30 }, () => job(1));
  const three = Array.from({ length: 3 }, () => job(1));
  const result = computeMobileTrust(same, now);
  expect(result.history).toBe('limited'); expect(result.distinctBuyers).toBe(1);
  expect(result.score).toBe(computeMobileTrust(three, now).score);
  expect(result.score).toBeLessThan(computeMobileTrust(Array.from({ length: 30 }, (_, i) => job(i)), now).score);
});
test('unanswered messages affect only known response observations; missing legacy data stays neutral', () => {
  const missing = computeMobileTrust([{ buyerId: 'b', confirmedAt: now }], now);
  const unanswered = computeMobileTrust([{ buyerId: 'b', confirmedAt: now, buyerMessageAt: now - 1000 }], now);
  expect(missing.responseScore).toBe(50); expect(missing.responseCount).toBe(0);
  expect(unanswered.responseScore).toBeLessThan(50); expect(unanswered.repliedCount).toBe(0);
  expect(computeMobileTrust([{ ...job(1), rating: 99 }], now).ratingCount).toBe(0);
});

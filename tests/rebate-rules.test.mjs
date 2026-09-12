import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibilityReasons, blocksRetry, verifiedTyroStatus, PRE_LAUNCH_REASON, serviceDate, cents, dateOnly } from '../convex/lib/rebateRules.ts';
const good = {
  now: Date.parse('2026-10-06T04:00:00Z'), goLiveAt: Date.parse('2026-10-01T00:00:00Z'),
  startsAt: '2026-10-06T00:00:00Z', endsAt: '2026-10-06T01:00:00Z', attended: true,
  cancelled: false, didNotArrive: false, paid: true, amountCents: 24000, patientMatches: true,
  referral: true, reviewed: true, archived: false, issueDate: '2026-09-01', expiryDate: null,
  maxSessions: 6, sessionNumber: 6, duplicate: false,
};
test('final allocated session remains claimable with no spare booking slots', () => assert.deepEqual(eligibilityReasons(good), []));
test('go-live is inclusive and no pre-launch appointment can become eligible later', () => {
  assert(eligibilityReasons({ ...good, startsAt: '2026-09-30T23:59:59.999Z' }).includes(PRE_LAUNCH_REASON));
  assert.deepEqual(eligibilityReasons({ ...good, startsAt: '2026-10-01T00:00:00Z' }), []);
  assert(eligibilityReasons({ ...good, goLiveAt: null }).length);
});
test('elapsed time does not establish attendance; prepayments do not establish completion', () => {
  for (const change of [{ attended: false }, { cancelled: true }, { didNotArrive: true }, { endsAt: '2026-10-06T05:00:00Z' }, { endsAt: 'invalid' }]) assert(eligibilityReasons({ ...good, ...change }).length);
});
test('unpaid, partially paid, closed and zero-fee invoices fail', () => {
  assert(eligibilityReasons({ ...good, paid: false }).length);
  for (const amountCents of [null, 0, -1]) assert(eligibilityReasons({ ...good, amountCents }).length);
});
test('referral must match patient, dates, verification and session allowance', () => {
  for (const change of [{ reviewed: false }, { referral: false }, { patientMatches: false }, { archived: true }, { issueDate: '2026-10-07' }, { expiryDate: '2026-10-05' }, { maxSessions: null }, { sessionNumber: null }, { sessionNumber: 7 }]) assert(eligibilityReasons({ ...good, ...change }).length);
  assert.deepEqual(eligibilityReasons({ ...good, expiryDate: '2026-10-06' }), []);
});
test('Melbourne service dates respect daylight saving and year boundaries', () => {
  assert.equal(serviceDate('2026-10-05T13:30:00Z'), '2026-10-06');
  assert.equal(serviceDate('2026-12-31T13:30:00Z'), '2027-01-01');
  assert.equal(serviceDate('2026-06-01T13:30:00Z'), '2026-06-01');
});
test('money and calendar validation fail closed', () => {
  assert.equal(cents('240.00'), 24000);
  for (const amount of ['', null, undefined, 'NaN', '-10', '20.123']) assert.equal(cents(amount), null);
  assert.equal(dateOnly('2026-02-30'), false);
  assert.equal(dateOnly('2028-02-29'), true);
});
test('pending, approved, unknown and browser failures block duplicate attempts', () => {
  for (const status of ['launching', 'approved', 'pending', 'under_review', 'unknown', 'error']) assert.equal(blocksRetry(status), true);
  for (const status of ['not_launched', 'rejected', 'cancelled']) assert.equal(blocksRetry(status), false);
  assert(eligibilityReasons({ ...good, duplicate: true }).length);
});
test('a completed payment alone never establishes Medicare approval', () => {
  assert.equal(verifiedTyroStatus({ businessStatus: 'completed' }), 'pending');
  assert.equal(verifiedTyroStatus({ claims: [{ status: 'approved' }] }), 'approved');
  assert.equal(verifiedTyroStatus({ claims: [{ status: 'under-review' }] }), 'under_review');
  assert.equal(verifiedTyroStatus({ claims: [{ status: 'rejected' }, { status: 'approved' }] }), 'pending');
});

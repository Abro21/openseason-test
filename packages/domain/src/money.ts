/**
 * Club/family fees (DIY, free) and OpenSeason staff subscriptions (paid) are
 * separate ledgers. This module covers display and installment maths only;
 * money moves through provider adapters on the server.
 */
export interface Money { amountCents: number; currency: string }

export function formatMoney(m: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amountCents / 100);
}

/** Split a total into n installments; the remainder cents go on the first one. */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('total must be non-negative integer cents');
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error('installments must be 1..24');
  const base = Math.floor(totalCents / count);
  const rem = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? rem : 0));
}

/**
 * Transaction-fee treatment. The PRD specifies this, but the PRD was not
 * readable in this run, so it is configuration with no default. The UI shows
 * "not configured" rather than inventing a percentage.
 */
export type FeeTreatment =
  | { mode: 'unconfigured' }
  | { mode: 'payer_pays'; percentBps: number; fixedCents: number }
  | { mode: 'club_absorbs'; percentBps: number; fixedCents: number };

export function processingFee(amountCents: number, t: FeeTreatment): number {
  if (t.mode === 'unconfigured') return 0;
  return Math.round((amountCents * t.percentBps) / 10000) + t.fixedCents;
}

export interface CheckoutBreakdown { subtotalCents: number; feeCents: number; totalCents: number; feeNote: string }

export function checkoutBreakdown(amountCents: number, t: FeeTreatment): CheckoutBreakdown {
  const fee = processingFee(amountCents, t);
  if (t.mode === 'payer_pays') return { subtotalCents: amountCents, feeCents: fee, totalCents: amountCents + fee, feeNote: 'Processing fee paid by you' };
  if (t.mode === 'club_absorbs') return { subtotalCents: amountCents, feeCents: 0, totalCents: amountCents, feeNote: 'Processing fee covered by the club' };
  return { subtotalCents: amountCents, feeCents: 0, totalCents: amountCents, feeNote: 'Processing fee treatment not configured' };
}

/* ---- Staff subscription entitlements (OpenSeason billing, not club fees) ---- */

export type PlanId = 'diy' | 'staff';
export type EntitlementStatus = 'active' | 'past_due' | 'canceled' | 'none';

export interface Entitlement { plan: PlanId; status: EntitlementStatus; currentPeriodEnd: string | null }

/** DIY tools never depend on entitlement. Only staff preparation does. */
export function canUseStaff(e: Entitlement | null, nowIso: string): boolean {
  if (!e || e.plan !== 'staff') return false;
  if (e.status === 'active') return true;
  /* past_due keeps access until the period ends; never beyond. */
  return e.status === 'past_due' && e.currentPeriodEnd !== null && e.currentPeriodEnd > nowIso;
}

/** Prices are unapproved; this module carries none. Display reads config. */
export interface PlanConfig { id: PlanId; name: string; priceLabel: string | null }
export const PLANS: PlanConfig[] = [
  { id: 'diy', name: 'DIY tools', priceLabel: 'Free' },
  { id: 'staff', name: 'Staff', priceLabel: null },
];

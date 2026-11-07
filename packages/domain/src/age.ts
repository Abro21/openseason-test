/**
 * Age bands and the protections that follow from them.
 *
 * Bands from the brief: under 13, 13 to 17, adult. The PRD's exact consent
 * mechanics were not readable here, so anything beyond the brief's explicit
 * rules is deny-by-default and listed in docs/POLICY_QUESTIONS.md.
 */
export type AgeBand = 'under_13' | 'teen' | 'adult';

export function ageOn(dobIso: string, onIso: string): number {
  const [y, m, d] = dobIso.split('-').map(Number) as [number, number, number];
  const [oy, om, od] = onIso.slice(0, 10).split('-').map(Number) as [number, number, number];
  let age = oy - y;
  if (om < m || (om === m && od < d)) age -= 1;
  return age;
}

export function ageBand(dobIso: string | null, onIso: string): AgeBand {
  /* Unknown DOB is treated as the most protected band. */
  if (!dobIso) return 'under_13';
  const a = ageOn(dobIso, onIso);
  if (a < 13) return 'under_13';
  if (a < 18) return 'teen';
  return 'adult';
}

export type ConsentStatus = 'none' | 'pending' | 'verified' | 'revoked';
export type ConsentMethod = 'checkbox' | 'provider_verified' | 'in_person_verified';

/** A checkbox is never proof of verifiable guardian consent for under-13s. */
export function consentSatisfies(band: AgeBand, status: ConsentStatus, method: ConsentMethod | null, hasActiveGuardian: boolean): boolean {
  if (band === 'adult') return true;
  if (!hasActiveGuardian) return false;
  if (band === 'teen') return status !== 'revoked';
  return status === 'verified' && method !== null && method !== 'checkbox';
}

export interface ParticipationRules {
  canPostInGroupConversations: boolean;
  canSubmitAnonymously: boolean;
  canReceivePrivateAdultDm: boolean;
  selfManages: boolean;
}

export function participationRules(band: AgeBand): ParticipationRules {
  switch (band) {
    case 'under_13':
      return { canPostInGroupConversations: false, canSubmitAnonymously: false, canReceivePrivateAdultDm: false, selfManages: false };
    case 'teen':
      /* Teen anonymity is restricted by the brief; exact PRD scope unknown -> denied. */
      return { canPostInGroupConversations: true, canSubmitAnonymously: false, canReceivePrivateAdultDm: false, selfManages: false };
    default:
      return { canPostInGroupConversations: true, canSubmitAnonymously: true, canReceivePrivateAdultDm: true, selfManages: true };
  }
}

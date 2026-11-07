/**
 * Permissions come from a person's relationships and grants, never from a
 * global account type. These names match the database check constraints.
 * The database (RLS + security-definer RPC checks) is the enforcement point;
 * clients use these only to decide what to show.
 */
export const ORG_PERMISSIONS = [
  'owner',
  'manage_teams',
  'manage_finance',
  'manage_tryouts',
  'manage_compliance',
  'communicate',
  'review_safeguarding',
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

export const TEAM_STAFF_ROLES = ['head_coach', 'assistant_coach', 'scorekeeper'] as const;
export type TeamStaffRole = (typeof TEAM_STAFF_ROLES)[number];

/**
 * Assistant coach scope is an open PRD question. Until decided, assistants get
 * the operational subset below and no finance, roster-private or safeguarding access.
 */
export const TEAM_ROLE_CAPABILITIES: Record<TeamStaffRole, readonly TeamCapability[]> = {
  head_coach: ['view_roster', 'manage_roster', 'manage_schedule', 'take_attendance', 'plan_practice', 'score', 'message_team', 'invite_family', 'invite_staff', 'view_feedback_summary', 'delegate_scoring'],
  assistant_coach: ['view_roster', 'take_attendance', 'plan_practice', 'score'],
  scorekeeper: ['score'],
};
export type TeamCapability =
  | 'view_roster' | 'manage_roster' | 'manage_schedule' | 'take_attendance' | 'plan_practice'
  | 'score' | 'message_team' | 'invite_family' | 'invite_staff' | 'view_feedback_summary' | 'delegate_scoring';

export type AppContext =
  | { kind: 'club'; orgId: string; label: string; permissions: OrgPermission[] }
  | { kind: 'team'; teamId: string; orgId: string | null; label: string; role: TeamStaffRole }
  | { kind: 'family'; athleteId: string; label: string; teamIds: string[] }
  | { kind: 'athlete'; athleteId: string; label: string; teamIds: string[] }
  | { kind: 'fan'; athleteId: string; label: string; teamIds: string[] };

export function contextKey(c: AppContext): string {
  switch (c.kind) {
    case 'club': return `club:${c.orgId}`;
    case 'team': return `team:${c.teamId}`;
    default: return `${c.kind}:${c.athleteId}`;
  }
}

export function teamCan(role: TeamStaffRole, cap: TeamCapability): boolean {
  return TEAM_ROLE_CAPABILITIES[role].includes(cap);
}

export function orgCan(perms: readonly OrgPermission[], need: OrgPermission): boolean {
  /* Owner implies every ordinary org permission, but NOT review_safeguarding:
   * safeguarding access must be granted explicitly (deny by default). */
  if (need === 'review_safeguarding') return perms.includes('review_safeguarding');
  return perms.includes('owner') || perms.includes(need);
}

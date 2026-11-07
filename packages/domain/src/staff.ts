/**
 * Canonical default staff roles. One shared definition used by web, mobile,
 * the database seed and the staff runtime. Role IDs are stable; display titles
 * can be renamed per person (stored in staff_role_titles).
 *
 * The four roles come from the brief (which cites the PRD's four canonical
 * defaults). The marketing site's six director-facing personas are stories,
 * mapped onto these roles in MARKETING_PERSONA_MAP; they are not extra agents.
 */
export const STAFF_ROLE_IDS = ['player_development', 'practice_prep', 'dobo', 'admin'] as const;
export type StaffRoleId = (typeof STAFF_ROLE_IDS)[number];

export type PreparedWorkKind =
  | 'practice_plan'
  | 'rotation'
  | 'announcement'
  | 'attendance_reminder'
  | 'fee_reminder'
  | 'certification_nudge'
  | 'player_feedback';

export interface StaffRoleDefinition {
  id: StaffRoleId;
  defaultTitle: string;
  shortDescription: string;
  /** Work this role may prepare. Preparing never grants execution. */
  prepares: readonly PreparedWorkKind[];
}

export const STAFF_ROLES: Record<StaffRoleId, StaffRoleDefinition> = {
  player_development: {
    id: 'player_development',
    defaultTitle: 'Player Development Coach',
    shortDescription: 'Drafts player feedback and recognition for you to review before anyone sees it.',
    prepares: ['player_feedback'],
  },
  practice_prep: {
    id: 'practice_prep',
    defaultTitle: 'Practice Prep Coach',
    shortDescription: 'Builds practice plans with timed blocks, drills and rotations.',
    prepares: ['practice_plan', 'rotation'],
  },
  dobo: {
    id: 'dobo',
    defaultTitle: 'DOBO, Director of Basketball Operations',
    shortDescription: 'Watches certifications, compliance gaps and team operations.',
    prepares: ['certification_nudge', 'announcement'],
  },
  admin: {
    id: 'admin',
    defaultTitle: 'Admin',
    shortDescription: 'Keeps logistics moving: attendance and fee reminders, announcements.',
    prepares: ['attendance_reminder', 'fee_reminder', 'announcement'],
  },
};

export function roleForWork(kind: PreparedWorkKind): StaffRoleId {
  for (const id of STAFF_ROLE_IDS) if (STAFF_ROLES[id].prepares.includes(kind)) return id;
  throw new Error(`no staff role prepares ${kind}`);
}

export function displayTitle(role: StaffRoleId, overrides: Partial<Record<StaffRoleId, string>> = {}): string {
  const t = overrides[role]?.trim();
  return t && t.length > 0 ? t.slice(0, 60) : STAFF_ROLES[role].defaultTitle;
}

/** Marketing personas are story devices. This maps each story onto a canonical role. */
export const MARKETING_PERSONA_MAP: Record<string, StaffRoleId> = {
  CFO: 'admin',
  Compliance: 'dobo',
  CMO: 'admin',
  Strategy: 'dobo',
  'Parent Experience': 'admin',
  DOBO: 'dobo',
};

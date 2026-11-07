// Fixed IDs from supabase/seed/seed.sql. All synthetic.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export const PEOPLE = {
  dana: id(101), casey: id(102), alex: id(103), pat: id(104), leo: id(105), gail: id(106),
  jordan: id(107), riley: id(108), olivia: id(109), sam: id(110), quinn: id(111),
} as const;
export type Persona = keyof typeof PEOPLE;

export const AUTH: Record<Persona, string> = Object.fromEntries(
  Object.entries(PEOPLE).map(([k, v]) => [k, v.replace(/1(\d\d)$/, '2$1')]),
) as Record<Persona, string>;

export const ATHLETES = { mia: id(301), leo: id(302), ava: id(303), noah: id(304), zoe: id(305) } as const;
export const ORGS = { frontRange: id(401), mesaValley: id(402) } as const;
export const TEAMS = { u12Blue: id(501), u15Red: id(502), u12Gold: id(503) } as const;
export const EVENTS = { blueGame: id(710), redGame: id(711), goldPractice: id(712), bluePractice1: id(701) } as const;
export const ASSIGNMENTS = { oranges: id(720) } as const;
export const INVOICES = { mia: id(811), ava: id(812) } as const;
export const DOCUMENTS = { waiver: id(821), conduct: id(822) } as const;
export const TRYOUTS = { spring: id(831) } as const;

export const PERSONA_LABELS: Record<Persona, string> = {
  dana: 'Dana Director: club owner, Front Range FC',
  casey: 'Casey Coach: head coach, U12 Blue (staff plan)',
  alex: 'Alex Assistant: assistant coach, U12 Blue',
  pat: 'Pat Parent: guardian of Mia (U12 Blue) and Leo (U15 Red)',
  leo: 'Leo Lopez: teen athlete, U15 Red',
  gail: 'Gail Fan: follows Mia',
  jordan: 'Jordan Multi: head coach U15 Red and guardian of Ava (U12 Blue)',
  riley: 'Riley Parent: guardian of Noah (consent pending)',
  olivia: 'Olivia Other: owner and coach at Mesa Valley SC',
  sam: 'Sam Safeguard: safeguarding reviewer, Front Range FC',
  quinn: 'Quinn Newcomer: signed in, no roles yet',
};

import { z } from 'zod';
import { RPC_ARGS } from './rpc.js';

export { RPC_ARGS };
export type RpcName = keyof typeof RPC_ARGS;

/** RPCs that must never be reached from a client, even though they live in `public`. */
export const SERVER_ONLY_RPCS: readonly RpcName[] = ['staff_message_reply'];

/** Arguments sent as JSON (jsonb) rather than as scalars or arrays. */
export const JSON_ARGS = new Set([
  'p_target', 'p_payload', 'p_artifact', 'p_plan', 'p_items', 'p_scores', 'p_rubric', 'p_answers', 'p_questions', 'p_options', 'p_context',
]);

export function isRpcName(name: string): name is RpcName {
  return Object.prototype.hasOwnProperty.call(RPC_ARGS, name);
}

/** Rejects unknown argument names so a client cannot smuggle extra parameters. */
export function checkArgs(fn: RpcName, args: Record<string, unknown>): string | null {
  const allowed = new Set<string>(RPC_ARGS[fn]);
  for (const k of Object.keys(args)) if (!allowed.has(k)) return `unknown argument ${k} for ${fn}`;
  return null;
}

const uuid = z.string().uuid();
const iso = z.string();

export const Contexts = z.object({
  person: z.object({ id: uuid, display_name: z.string() }).nullable(),
  clubs: z.array(z.object({ org_id: uuid, label: z.string(), permissions: z.array(z.string()) })),
  teams: z.array(z.object({ team_id: uuid, org_id: uuid.nullable(), label: z.string(), role: z.string() })),
  family: z.array(z.object({ athlete_id: uuid, label: z.string(), team_ids: z.array(uuid) })),
  athlete: z.array(z.object({ athlete_id: uuid, label: z.string(), team_ids: z.array(uuid) })),
  fan: z.array(z.object({ athlete_id: uuid, label: z.string(), team_ids: z.array(uuid) })),
});
export type Contexts = z.infer<typeof Contexts>;

/** Every club a person belongs to, with their roles and their scopes inside each. */
export const Tenants = z.object({
  person: z.object({ id: uuid, display_name: z.string() }).nullable(),
  tenants: z.array(z.object({
    id: uuid, kind: z.enum(['club', 'team']), name: z.string(), roles: z.array(z.string()),
    contexts: Contexts.omit({ person: true }),
  })),
});
export type Tenants = z.infer<typeof Tenants>;

export const ScheduleEvent = z.object({
  id: uuid, team_id: uuid, kind: z.string(), title: z.string(), opponent: z.string().nullable(),
  starts_at: iso, ends_at: iso, status: z.string(), version: z.number(), location: z.string().nullable(),
  score: z.object({ home: z.number(), away: z.number(), period: z.number(), clock: z.number().nullable(), status: z.string(), version: z.number() }).nullable(),
  my_rsvps: z.array(z.object({ athlete_id: uuid, athlete: z.string(), status: z.string().nullable() })),
  rsvp_summary: z.object({ yes: z.number(), no: z.number(), maybe: z.number(), no_response: z.number() }).nullable(),
});
export type ScheduleEvent = z.infer<typeof ScheduleEvent>;

export const Fee = z.object({
  invoice_id: uuid, athlete: z.string(), club: z.string(), description: z.string(), amount_cents: z.number(), currency: z.string(),
  status: z.string(), paid_cents: z.number(),
  installments: z.array(z.object({ id: uuid, seq: z.number(), amount_cents: z.number(), due_on: z.string(), status: z.string(), pending: z.boolean() })),
  receipts: z.array(z.object({ payment_id: uuid, amount_cents: z.number(), status: z.string(), method: z.string(), at: iso })),
});
export type Fee = z.infer<typeof Fee>;

export const ActionSummary = z.object({
  effect: z.string(),
  title: z.string().nullish(),
  body: z.string().nullish(),
  recipients: z.array(z.string()).optional(),
}).passthrough();

export const PendingAction = z.object({
  id: uuid, kind: z.string(), status: z.string(), status_reason: z.string().nullable(), revision: z.number(), payload_hash: z.string(),
  summary: ActionSummary, requested_via: z.enum(['agent', 'person']), approved_by: z.string().nullable(), rejected_reason: z.string().nullable(),
  outcome: z.unknown(), prepared_work_id: uuid.nullable(), updated_at: iso,
  attempts: z.array(z.object({ attempt: z.number(), outcome: z.string(), detail: z.string().nullable(), at: iso })),
});
export type PendingAction = z.infer<typeof PendingAction>;

export const PreparedWork = z.object({
  id: uuid, kind: z.string(), role_id: z.string(), title: z.string(), summary: z.string().nullable(), artifact: z.record(z.unknown()),
  status: z.string(), revision: z.number(), team_id: uuid.nullable(), org_id: uuid.nullable(), thread_id: uuid.nullable(),
  created_via: z.enum(['agent', 'person']), updated_at: iso,
  sources: z.array(z.object({ type: z.string(), label: z.string(), changed: z.boolean() }).passthrough()).nullable(),
  action: PendingAction.nullable(),
});
export type PreparedWork = z.infer<typeof PreparedWork>;

export const StaffRoom = z.object({
  entitlement: z.object({ plan: z.string(), status: z.string(), current_period_end: iso.nullable(), staff_enabled: z.boolean() }),
  titles: z.record(z.string()),
  work: z.array(z.object({
    id: uuid, kind: z.string(), role_id: z.string(), title: z.string(), summary: z.string().nullable(), status: z.string(), stale: z.boolean(),
    team_id: uuid.nullable(), org_id: uuid.nullable(), event_id: uuid.nullable(), thread_id: uuid.nullable(), updated_at: iso,
    action: z.object({ id: uuid, status: z.string(), revision: z.number() }).nullable(),
  })),
  actions: z.array(z.object({ id: uuid, kind: z.string(), status: z.string(), summary: ActionSummary, revision: z.number(), prepared_work_id: uuid.nullable(), updated_at: iso })),
});
export type StaffRoom = z.infer<typeof StaffRoom>;

export const ConversationRow = z.object({
  id: uuid, kind: z.enum(['team', 'dm', 'group']), team_id: uuid.nullable(), title: z.string().nullable(),
  last_message_at: iso.nullable(), unread: z.boolean(), archived: z.boolean(),
});
export const Message = z.object({
  id: uuid, kind: z.string(), title: z.string().nullable(), body: z.string(), parent_id: uuid.nullable(), created_at: iso,
  sender: z.string(), mine: z.boolean(), prepared_by_role: z.string().nullable(), requires_ack: z.boolean(), acked: z.boolean(),
  held: z.boolean(), reactions: z.record(z.number()),
});
export type Message = z.infer<typeof Message>;

export const StaffThreadPage = z.object({
  messages: z.array(z.object({ id: uuid, author: z.enum(['person', 'staff', 'system']), body: z.string(), status: z.string(), input_mode: z.string(), prepared_work_id: uuid.nullable(), created_at: iso })),
  has_more: z.boolean(),
});
export type StaffThreadPage = z.infer<typeof StaffThreadPage>;

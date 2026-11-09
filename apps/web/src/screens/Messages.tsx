import { ConversationRow, Message } from '@openseason/contracts';
import { teamCan } from '@openseason/domain';
import { useState } from 'react';
import { z } from 'zod';
import { useSession } from '../session';
import { Icon } from '../icons';
import { StaffDrafts } from '../staff';
import { ActionButton, Badge, Empty, initials, PageHeader, Show, useLoad, when } from '../ui';

type Conv = z.infer<typeof ConversationRow>;

export function Messages() {
  const { client, tenant } = useSession();
  const tid = tenant!.id;
  const [search, setSearch] = useState('');
  const [convs] = useLoad(async () => z.array(ConversationRow).parse(await client.rpc('my_conversations', { p_tenant: tid, p_search: search || null, p_archived: false })), [client, search, tid]);
  const [open, setOpen] = useState<Conv | null>(null);
  return (
    <>
      <PageHeader title="Messages" />
      <div className="desk" data-open={open ? 'true' : undefined}>
        <section className="desk-list" aria-label="Conversations">
          <div className="field search">
            <label htmlFor="conv-search" className="sr-only">Search conversations</label>
            <input id="conv-search" type="search" placeholder="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Show value={convs} empty={(d) => d.length === 0} emptyView={<Empty icon="chat" title={search ? 'No matches' : 'No conversations yet'} />}>
            {(list) => (
              <ul className="work-list">
                {list.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="work-item" aria-current={open?.id === c.id} onClick={() => setOpen(c)}>
                      <span className="avatar" aria-hidden="true">{initials(c.title ?? 'C')}</span>
                      <span className="work-text">
                        <span className="work-title"><strong>{c.title ?? 'Conversation'}</strong>{c.unread && <Badge tone="info">New</Badge>}</span>
                        <span className="small muted">{c.kind === 'team' ? 'Team' : c.kind === 'dm' ? 'Direct' : 'Group'}{c.last_message_at ? ` · ${when(c.last_message_at)}` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Show>
        </section>
        <section className="desk-detail" aria-label="Conversation">
          {open ? (
            <>
              <button type="button" className="back-btn" onClick={() => setOpen(null)}><Icon name="back" size={18} /> All conversations</button>
              <Thread conv={open} />
            </>
          ) : <div className="card"><Empty icon="chat" title="Choose a conversation" /></div>}
        </section>
      </div>
    </>
  );
}

function Thread({ conv }: { conv: Conv }) {
  const { client, active } = useSession();
  const coaching = active?.kind === 'team' && active.teamId === conv.team_id && teamCan(active.role, 'message_team');
  const [msgs, reload] = useLoad(async () => z.array(Message).parse(await client.rpc('conversation_messages', { p_conversation: conv.id, p_before: null, p_limit: 50 })), [client, conv.id]);
  const [draft, setDraft] = useState('');
  return (
    <div className="card chat">
      <div className="card-head"><h2>{conv.title ?? 'Conversation'}</h2></div>
      {conv.kind === 'team' && conv.team_id && (
        <StaffDrafts compact match={(w) => w.kind === 'announcement' && w.team_id === conv.team_id}
          prepare={coaching ? { kind: 'announcement', label: 'a week-ahead announcement', target: { team_id: conv.team_id } } : undefined} />
      )}
      <div className="thread" aria-live="polite">
        <Show value={msgs} empty={(d) => d.length === 0} emptyView={<Empty icon="chat" title="No messages yet" />}>
          {(list) => list.map((m) => (
            <div key={m.id} className={`msg ${m.mine ? 'person' : ''}`}>
              <div className="msg-meta">{m.sender}{m.prepared_by_role ? ' (prepared with staff help)' : ''} · {when(m.created_at)}</div>
              {m.title && <strong>{m.title}<br /></strong>}
              {m.body}
              {m.held && <div><Badge tone="warning">Held for review</Badge></div>}
              {m.requires_ack && (m.acked ? <div><Badge tone="success">Acknowledged</Badge></div> : (
                <div><ActionButton onRun={async () => { await client.rpc('message_ack', { p_message: m.id }); reload(); }}>Acknowledge</ActionButton></div>
              ))}
            </div>
          ))}
        </Show>
      </div>
      <div className="composer">
        <label htmlFor="reply" className="sr-only">Reply</label>
        <textarea id="reply" rows={2} placeholder="Write a reply" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <ActionButton variant="primary" disabled={!draft.trim()} onRun={async () => { await client.rpc('message_post', { p_conversation: conv.id, p_body: draft.trim(), p_parent: null }); setDraft(''); reload(); }}>Send</ActionButton>
      </div>
    </div>
  );
}

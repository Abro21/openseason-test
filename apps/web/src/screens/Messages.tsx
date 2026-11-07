import { ConversationRow, Message } from '@openseason/contracts';
import { useState } from 'react';
import { z } from 'zod';
import { useSession } from '../session';
import { ActionButton, Badge, Show, useLoad, when } from '../ui';

type Conv = z.infer<typeof ConversationRow>;

export function Messages() {
  const { client } = useSession();
  const [search, setSearch] = useState('');
  const [convs] = useLoad(async () => z.array(ConversationRow).parse(await client.rpc('my_conversations', { p_search: search || null, p_archived: false })), [client, search]);
  const [open, setOpen] = useState<Conv | null>(null);
  return (
    <div className="desk">
      <section aria-labelledby="conv-h">
        <h1 id="conv-h">Messages</h1>
        <div className="field"><label htmlFor="conv-search">Search conversations</label><input id="conv-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Show value={convs} empty={(d) => d.length === 0}>
          {(list) => (
            <ul className="list">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" className="work-item" aria-current={open?.id === c.id} onClick={() => setOpen(c)}>
                    <div className="row spread"><strong>{c.title ?? 'Conversation'}</strong>{c.unread && <Badge tone="info">New</Badge>}</div>
                    <span className="small muted">{c.kind === 'team' ? 'Team' : c.kind === 'dm' ? 'Direct' : 'Group'}{c.last_message_at ? ` · ${when(c.last_message_at)}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Show>
      </section>
      <section aria-label="Conversation">{open ? <Thread conv={open} /> : <p className="muted">Choose a conversation.</p>}</section>
    </div>
  );
}

function Thread({ conv }: { conv: Conv }) {
  const { client } = useSession();
  const [msgs, reload] = useLoad(async () => z.array(Message).parse(await client.rpc('conversation_messages', { p_conversation: conv.id, p_before: null, p_limit: 50 })), [client, conv.id]);
  const [draft, setDraft] = useState('');
  return (
    <div className="card">
      <h2>{conv.title ?? 'Conversation'}</h2>
      <div className="thread" aria-live="polite">
        <Show value={msgs} empty={(d) => d.length === 0}>
          {(list) => list.map((m) => (
            <div key={m.id} className={`msg ${m.mine ? 'person' : ''}`}>
              <div className="small muted">{m.sender}{m.prepared_by_role ? ' (prepared with staff help)' : ''} · {when(m.created_at)}</div>
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
      <div className="field"><label htmlFor="reply">Reply</label><textarea id="reply" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
      <ActionButton variant="primary" disabled={!draft.trim()} onRun={async () => { await client.rpc('message_post', { p_conversation: conv.id, p_body: draft.trim(), p_parent: null }); setDraft(''); reload(); }}>Send</ActionButton>
    </div>
  );
}

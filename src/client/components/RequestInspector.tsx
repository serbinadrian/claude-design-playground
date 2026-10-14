import type { ReactNode } from 'react';

import type { Conversation } from '@client/chat-domain';
import type { RequestState } from '@client/use-chat-controller';

export interface RequestInspectorProps {
  conversation: Conversation;
  model: string;
  requestState: RequestState;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="inspector-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

export const RequestInspector = ({
  conversation,
  model,
  requestState,
}: RequestInspectorProps) => {
  const assistant = [...conversation.messages]
    .reverse()
    .find(({ role }) => role === 'assistant');
  const metadata = assistant?.metadata;
  const usage = metadata?.usage?.totalTokens;
  const lastMessage = conversation.messages.at(-1);
  const submittedMessages = lastMessage?.role === 'assistant'
    ? conversation.messages.slice(0, -1)
    : conversation.messages;
  const payload = submittedMessages.map(({ role, content }) => ({
    role,
    content: content.length > 70 ? `${content.slice(0, 67)}…` : content,
  }));

  return (
    <aside className="inspector" aria-label="Request inspector">
      <header><span>Request inspector</span><span aria-hidden="true">•••</span></header>
      <section>
        <h2>Transport</h2>
        <dl>
          <Row label="Endpoint"><code>/api/chat</code></Row>
          <Row label="Method"><span className="method">POST</span></Row>
          <Row label="Stream">
            <span className={`state state--${requestState}`}>
              {requestState === 'streaming' ? 'ACTIVE' : 'IDLE'}
            </span>
          </Row>
          <Row label="Outcome">
            {metadata?.httpStatus ? `HTTP ${metadata.httpStatus}` : '—'}
          </Row>
        </dl>
      </section>
      <section>
        <h2>Context</h2>
        <dl>
          <Row label="Model">{metadata?.model ?? model}</Row>
          <Row label="Messages">
            {submittedMessages.length} {submittedMessages.length === 1 ? 'message' : 'messages'}
          </Row>
          <Row label="Elapsed">
            {metadata?.elapsedMs === undefined ? '—' : `${metadata.elapsedMs} ms`}
          </Row>
          <Row label="Usage">{usage === undefined ? 'not reported' : `${usage} tokens`}</Row>
          <Row label="Finish">{metadata?.finishReason ?? '—'}</Row>
        </dl>
      </section>
      <section className="payload-section">
        <h2>Payload preview</h2>
        <pre data-testid="payload-preview">
          {JSON.stringify({ model, messages: payload, stream: true }, null, 2)}
        </pre>
      </section>
      <footer>
        <span>SC_TOKEN</span>
        <strong>SERVER ONLY</strong>
      </footer>
    </aside>
  );
};

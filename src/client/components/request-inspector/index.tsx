import type { Conversation } from '@client/chat-domain';
import { Icon } from '@components/icon';
import { InspectorRow } from '@components/request-inspector/inspector-row';
import type { RequestState } from '@hooks/use-chat-controller';

export interface RequestInspectorProps {
  conversation: Conversation;
  model: string;
  requestState: RequestState;
}

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
      <header><span>Request inspector</span><Icon name="ellipsis" /></header>
      <section>
        <h2>Transport</h2>
        <dl>
          <InspectorRow label="Endpoint"><code>/api/chat</code></InspectorRow>
          <InspectorRow label="Method"><span className="method">POST</span></InspectorRow>
          <InspectorRow label="Stream">
            <span className={`state state--${requestState}`}>
              {requestState === 'streaming' ? 'ACTIVE' : 'IDLE'}
            </span>
          </InspectorRow>
          <InspectorRow label="Outcome">
            {metadata?.httpStatus ? `HTTP ${metadata.httpStatus}` : '—'}
          </InspectorRow>
        </dl>
      </section>
      <section>
        <h2>Context</h2>
        <dl>
          <InspectorRow label="Model">{metadata?.model ?? model}</InspectorRow>
          <InspectorRow label="Messages">
            {submittedMessages.length} {submittedMessages.length === 1 ? 'message' : 'messages'}
          </InspectorRow>
          <InspectorRow label="Elapsed">
            {metadata?.elapsedMs === undefined ? '—' : `${metadata.elapsedMs} ms`}
          </InspectorRow>
          <InspectorRow label="Usage">{usage === undefined ? 'not reported' : `${usage} tokens`}</InspectorRow>
          <InspectorRow label="Finish">{metadata?.finishReason ?? '—'}</InspectorRow>
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

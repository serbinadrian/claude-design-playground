import type { Conversation } from '@client/chat-domain';

export const ThreadHeader = ({ conversation }: { conversation: Conversation }) => (
  <div className="chat-workspace__heading">
    <div>
      <span className="eyebrow">ACTIVE THREAD</span>
      <h1>{conversation.title}</h1>
    </div>
    <span className="thread-count">{conversation.messages.length} MSG</span>
  </div>
);

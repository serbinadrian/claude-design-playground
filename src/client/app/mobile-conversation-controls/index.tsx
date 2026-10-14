import type { Conversation } from '@client/chat-domain';

interface MobileConversationControlsProps {
  activeId: string;
  conversations: Conversation[];
  onNew(): void;
  onSelect(id: string): void;
}

export const MobileConversationControls = ({
  activeId,
  conversations,
  onNew,
  onSelect,
}: MobileConversationControlsProps) => (
  <nav className="mobile-actions" aria-label="Mobile conversation controls">
    <button aria-label="New mobile request" onClick={onNew} type="button">
      ＋ New
    </button>
    <label>
      <span className="sr-only">Mobile conversation history</span>
      <select
        aria-label="Mobile conversation history"
        onChange={(event) => onSelect(event.target.value)}
        value={activeId}
      >
        {conversations.map((conversation) => (
          <option key={conversation.id} value={conversation.id}>
            {conversation.title}
          </option>
        ))}
      </select>
    </label>
  </nav>
);

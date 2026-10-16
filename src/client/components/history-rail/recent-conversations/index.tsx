import type { Conversation } from '@client/chat-domain';
import { Icon } from '@components/icon';

interface RecentConversationsProps {
  activeId: string;
  conversations: Conversation[];
  onDelete(id: string): void;
  onSelect(id: string): void;
}

export const RecentConversations = ({
  activeId,
  conversations,
  onDelete,
  onSelect,
}: RecentConversationsProps) => {
  const populatedConversations = conversations.filter(
    ({ messages }) => messages.length > 0,
  );

  if (populatedConversations.length === 0) {
    return <p className="rail-empty">Your completed threads will live here.</p>;
  }

  return populatedConversations.map((conversation) => {
    const activeClass = conversation.id === activeId ? ' history-item--active' : '';
    return (
      <div className={`history-item${activeClass}`} key={conversation.id}>
        <button
          aria-label={`Open ${conversation.title}`}
          onClick={() => onSelect(conversation.id)}
          type="button"
        >
          <span>{conversation.title}</span>
          <small>{conversation.messages.length} msg</small>
        </button>
        <button
          aria-label={`Delete ${conversation.title}`}
          className="history-item__delete"
          onClick={() => onDelete(conversation.id)}
          type="button"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    );
  });
};

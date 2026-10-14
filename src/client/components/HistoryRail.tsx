import { COMMAND_PRESETS } from '@client/command-presets';
import type { Conversation } from '@client/chat-domain';

export interface HistoryRailProps {
  conversations: Conversation[];
  activeId: string;
  onNew(): void;
  onSelect(id: string): void;
  onDelete(id: string): void;
  onPreset(command: string): void;
}

export const HistoryRail = ({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onPreset,
}: HistoryRailProps) => (
  <aside className="history-rail" aria-label="Conversation history">
    <button aria-label="New request" className="new-request" onClick={onNew} type="button">
      <span aria-hidden="true">＋</span>
      New request
      <kbd>⌘ K</kbd>
    </button>

    <section className="rail-section">
      <h2>Recent</h2>
      <div className="history-list">
        {conversations.filter(({ messages }) => messages.length > 0).length ? (
          conversations
            .filter(({ messages }) => messages.length > 0)
            .map((conversation) => (
              <div
                className={`history-item${conversation.id === activeId ? ' history-item--active' : ''}`}
                key={conversation.id}
              >
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
                  ×
                </button>
              </div>
            ))
        ) : (
          <p className="rail-empty">Your completed threads will live here.</p>
        )}
      </div>
    </section>

    <section className="rail-section rail-section--presets">
      <h2>Command presets</h2>
      {COMMAND_PRESETS.map((preset) => (
        <button
          className="preset-link"
          key={preset.command}
          onClick={() => onPreset(preset.command)}
          type="button"
        >
          <code>{preset.command}</code>
          <span>{preset.description}</span>
        </button>
      ))}
    </section>
    <div className="rail-footer"><span /> Local history only</div>
  </aside>
);

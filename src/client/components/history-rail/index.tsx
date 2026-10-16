import type { Conversation } from '@client/chat-domain';
import { Icon } from '@components/icon';
import { PresetList } from '@components/history-rail/preset-list';
import { RecentConversations } from '@components/history-rail/recent-conversations';

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
      <Icon name="plus" />
      <span>New request</span>
      <kbd>⌘ K</kbd>
    </button>

    <section className="rail-section">
      <h2>Recent</h2>
      <div className="history-list">
        <RecentConversations
          activeId={activeId}
          conversations={conversations}
          onDelete={onDelete}
          onSelect={onSelect}
        />
      </div>
    </section>

    <section className="rail-section rail-section--presets">
      <h2>Command presets</h2>
      <PresetList onPreset={onPreset} />
    </section>
    <div className="rail-footer"><span /> Local history only</div>
  </aside>
);

import { expandCommandPreset } from '@client/command-presets';
import { Composer } from '@components/composer';
import { HistoryRail } from '@components/history-rail';
import { MessageList } from '@components/message-list';
import { RequestInspector } from '@components/request-inspector';
import { TopBar } from '@components/top-bar';
import { fetchHealth } from '@client/health-client';
import {
  useChatController,
  type ChatController,
} from '@hooks/use-chat-controller';
import { useApiHealth } from '@hooks/use-api-health';
import type { HealthResponse } from '@shared/chat-contracts';

import { MobileConversationControls } from '@app/mobile-conversation-controls';
import { RequestError } from '@app/request-error';
import { ThreadHeader } from '@app/thread-header';

export interface AppProps {
  controller?: ChatController;
  healthLoader?: () => Promise<HealthResponse>;
}

export const App = ({
  controller,
  healthLoader = fetchHealth,
}: AppProps) => {
  const ownedController = useChatController();
  const chat = controller ?? ownedController;
  const { health, status: apiStatus } = useApiHealth(healthLoader);
  const unavailableReasons = {
    unconfigured: 'Add SC_TOKEN to the server environment to enable requests.',
    unavailable: 'The local API is unavailable. Check the server process.',
    loading: 'Checking the local API…',
  } as const;
  const unavailableReason = apiStatus === 'ready'
    ? undefined
    : unavailableReasons[apiStatus];
  const latestStatus = chat.activeConversation.messages.at(-1)?.status;
  const followUpBlocked = latestStatus === 'error' || latestStatus === 'aborted';
  let disabledReason: string | undefined = unavailableReason;
  if (!disabledReason && followUpBlocked) {
    disabledReason = 'Retry the failed response or start a new request before adding another turn.';
  }

  const applyPreset = (command: string) => {
    const expansion = expandCommandPreset(command);
    if (expansion) {
      chat.setDraft(expansion.value);
    }
  };

  return (
    <div className="app-shell">
      <TopBar status={apiStatus} />
      <div className="workspace">
        <HistoryRail
          activeId={chat.activeConversation.id}
          conversations={chat.conversations}
          onDelete={chat.deleteConversation}
          onNew={chat.newConversation}
          onPreset={applyPreset}
          onSelect={chat.selectConversation}
        />
        <main className="chat-workspace">
          <ThreadHeader conversation={chat.activeConversation} />
          <MobileConversationControls
            activeId={chat.activeConversation.id}
            conversations={chat.conversations}
            onNew={chat.newConversation}
            onSelect={chat.selectConversation}
          />
          <div className="chat-scroll">
            <MessageList
              conversation={chat.activeConversation}
              onRetry={() => void chat.retry()}
            />
          </div>
          <RequestError
            error={chat.error}
            isDisplayed={!followUpBlocked}
            onRetry={() => void chat.retry()}
          />
          <Composer
            disabled={apiStatus !== 'ready' || followUpBlocked}
            disabledReason={disabledReason}
            draft={chat.draft}
            onDraftChange={chat.setDraft}
            onStop={chat.stop}
            onSubmit={() => void chat.submit()}
            requestState={chat.requestState}
          />
          <div className="composer-footnote">
            <span>ENTER TO SEND · SHIFT+ENTER FOR NEW LINE</span>
            <span>LOCAL SESSION · NO CLOUD HISTORY</span>
          </div>
        </main>
        <RequestInspector
          conversation={chat.activeConversation}
          model={health?.model ?? 'asi1-mini'}
          requestState={chat.requestState}
        />
      </div>
    </div>
  );
};

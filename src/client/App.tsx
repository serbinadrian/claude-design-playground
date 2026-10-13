import { useEffect, useState } from 'react';

import { expandCommandPreset } from '@client/command-presets';
import { Composer } from '@client/components/Composer';
import { HistoryRail } from '@client/components/HistoryRail';
import { MessageList } from '@client/components/MessageList';
import { RequestInspector } from '@client/components/RequestInspector';
import { TopBar, type ApiStatus } from '@client/components/TopBar';
import { fetchHealth } from '@client/health-client';
import {
  useChatController,
  type ChatController,
} from '@client/use-chat-controller';
import type { HealthResponse } from '@shared/chat-contracts';

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
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('loading');

  useEffect(() => {
    let current = true;
    void healthLoader().then(
      (result) => {
        if (current) {
          setHealth(result);
          setApiStatus(result.status);
        }
      },
      () => {
        if (current) {
          setApiStatus('unavailable');
        }
      },
    );
    return () => {
      current = false;
    };
  }, [healthLoader]);

  const unavailableReason = apiStatus === 'unconfigured'
    ? 'Add SC_TOKEN to the server environment to enable requests.'
    : apiStatus === 'unavailable'
      ? 'The local API is unavailable. Check the server process.'
      : apiStatus === 'loading'
        ? 'Checking the local API…'
        : undefined;

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
          <div className="chat-workspace__heading">
            <div>
              <span className="eyebrow">ACTIVE THREAD</span>
              <h1>{chat.activeConversation.title}</h1>
            </div>
            <span className="thread-count">
              {chat.activeConversation.messages.length} MSG
            </span>
          </div>
          <div className="chat-scroll">
            <MessageList
              conversation={chat.activeConversation}
              onRetry={() => void chat.retry()}
            />
          </div>
          {chat.error &&
          chat.activeConversation.messages.at(-1)?.status !== 'error' &&
          chat.activeConversation.messages.at(-1)?.status !== 'aborted' ? (
            <div className="request-error" role="alert">
              <span>{chat.error.message}</span>
              {chat.error.retryable ? (
                <button onClick={() => void chat.retry()} type="button" aria-label="Retry response">
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          <Composer
            disabled={apiStatus !== 'ready'}
            disabledReason={unavailableReason}
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

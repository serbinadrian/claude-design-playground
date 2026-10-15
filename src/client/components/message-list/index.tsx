import type { Conversation, ConversationMessage } from '@client/chat-domain';
import { BrandMark } from '@components/brand';
import { Icon } from '@components/icon';

export interface MessageListProps {
  conversation: Conversation;
  onRetry(): void;
}

const messageMeta = (message: ConversationMessage) => {
  if (message.role !== 'assistant') {
    return null;
  }
  if (message.status === 'streaming') {
    return 'STREAMING';
  }
  if (message.status === 'aborted') {
    return 'STOPPED';
  }
  if (message.status === 'error') {
    return 'FAILED';
  }
  const elapsed = message.metadata?.elapsedMs;
  return elapsed === undefined ? 'COMPLETE' : `${elapsed} ms · COMPLETE`;
};

const MessageError = ({ message, onRetry }: {
  message: ConversationMessage;
  onRetry(): void;
}) => {
  if (message.metadata?.error) {
    return (
      <div className="message__error">
        <span>{message.metadata.error.message}</span>
        {message.metadata.error.retryable && (
          <button onClick={onRetry} type="button" aria-label="Retry response">
            <Icon name="rotate-ccw" />
            Retry
          </button>
        )}
      </div>
    );
  }

  if (message.status !== 'aborted') {
    return null;
  }

  return (
    <div className="message__error">
      <span>This response was stopped before completion.</span>
      <button onClick={onRetry} type="button" aria-label="Retry response">
        <Icon name="rotate-ccw" />
        Retry
      </button>
    </div>
  );
};

const MessageItem = ({ message, index, onRetry }: {
  message: ConversationMessage;
  index: number;
  onRetry(): void;
}) => {
  const isStreaming = message.status === 'streaming';
  const isAssistant = message.role === 'assistant';

  return (
    <li
      className={`message message--${message.role} message--${message.status}`}
      data-testid="chat-message"
    >
      <div className="message__index">{String(index + 1).padStart(2, '0')}</div>
      <article>
        <header>
          {isAssistant ? (
            <span className="message__author">
              <BrandMark className="message__mark" />
              ASI1-MINI
            </span>
          ) : (
            <span>YOU</span>
          )}
          <small>{messageMeta(message)}</small>
        </header>
        <div className="message__body">
          {message.content || (isStreaming && 'Thinking')}
          {isStreaming && <span className="cursor" aria-hidden="true" />}
        </div>
        <MessageError message={message} onRetry={onRetry} />
      </article>
    </li>
  );
};

const EmptyConversation = () => (
  <div className="empty-state">
    <div className="empty-state__glyph" aria-hidden="true">
      <BrandMark />
    </div>
    <p className="eyebrow">READY FOR INPUT</p>
    <h1>Start with a question</h1>
    <p>Type a prompt or use a slash command to shape the request.</p>
    <div className="empty-state__hints">
      <span><kbd>/</kbd> presets</span>
      <span><kbd>↵</kbd> send</span>
      <span><kbd>⇧ ↵</kbd> newline</span>
    </div>
  </div>
);

export const MessageList = ({ conversation, onRetry }: MessageListProps) => {
  if (conversation.messages.length === 0) {
    return <EmptyConversation />;
  }

  return (
    <ol className="message-list" aria-live="polite">
      {conversation.messages.map((message, index) => (
        <MessageItem
          index={index}
          key={message.id}
          message={message}
          onRetry={onRetry}
        />
      ))}
    </ol>
  );
};

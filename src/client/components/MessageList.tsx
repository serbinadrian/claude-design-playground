import type { Conversation } from '@client/chat-domain';

export interface MessageListProps {
  conversation: Conversation;
  onRetry(): void;
}

const messageMeta = (message: Conversation['messages'][number]) => {
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

export const MessageList = ({ conversation, onRetry }: MessageListProps) => {
  if (conversation.messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__glyph" aria-hidden="true">›_</div>
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
  }

  return (
    <ol className="message-list" aria-live="polite">
      {conversation.messages.map((message, index) => (
        <li
          className={`message message--${message.role} message--${message.status}`}
          data-testid="chat-message"
          key={message.id}
        >
          <div className="message__index">{String(index + 1).padStart(2, '0')}</div>
          <article>
            <header>
              <span>{message.role === 'user' ? 'YOU' : 'ASI1-MINI'}</span>
              <small>{messageMeta(message)}</small>
            </header>
            <div className="message__body">
              {message.content || (message.status === 'streaming' ? 'Thinking' : '')}
              {message.status === 'streaming' ? <span className="cursor" aria-hidden="true" /> : null}
            </div>
            {message.metadata?.error ? (
              <div className="message__error">
                <span>{message.metadata.error.message}</span>
                {message.metadata.error.retryable ? (
                  <button onClick={onRetry} type="button" aria-label="Retry response">
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
};

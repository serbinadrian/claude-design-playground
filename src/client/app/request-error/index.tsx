import type { ConversationError } from '@client/chat-domain';
import { Icon } from '@components/icon';

interface RequestErrorProps {
  error: ConversationError | null;
  isDisplayed: boolean;
  onRetry(): void;
}

export const RequestError = ({ error, isDisplayed, onRetry }: RequestErrorProps) => {
  if (!error || !isDisplayed) {
    return null;
  }

  return (
    <div className="request-error" role="alert">
      <span>{error.message}</span>
      {error.retryable && (
        <button onClick={onRetry} type="button" aria-label="Retry response">
          <Icon name="rotate-ccw" />
          Retry
        </button>
      )}
    </div>
  );
};

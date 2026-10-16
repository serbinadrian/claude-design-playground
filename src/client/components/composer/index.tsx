import {
  useEffect,
  useRef,
} from 'react';

import type { RequestState } from '@hooks/use-chat-controller';
import { Icon } from '@components/icon';
import {
  CommandWhisperer,
  commandOptionId,
} from '@components/command-whisperer';

import { useCommandMenu } from '@components/composer/use-command-menu';

export interface ComposerProps {
  draft: string;
  onDraftChange(value: string): void;
  onSubmit(): void;
  onStop(): void;
  requestState: RequestState;
  disabled?: boolean;
  disabledReason?: string;
}

export const Composer = ({
  draft,
  onDraftChange,
  onSubmit,
  onStop,
  requestState,
  disabled = false,
  disabledReason,
}: ComposerProps) => {
  const hasFocusedRef = useRef(false);
  const {
    activePreset,
    handleChange,
    handleKeyDown,
    isOpen,
    listboxId,
    presets,
    selectPreset,
    selectedIndex,
    textareaRef,
  } = useCommandMenu({ disabled, draft, onDraftChange, onSubmit, requestState });

  useEffect(() => {
    if (!disabled && !hasFocusedRef.current) {
      hasFocusedRef.current = true;
      textareaRef.current?.focus();
    }
  }, [disabled, textareaRef]);

  return (
    <div className="composer">
      <div className="composer__input-wrap">
        {isOpen ? (
          <CommandWhisperer
            activeIndex={selectedIndex}
            id={listboxId}
            onSelect={selectPreset}
            presets={presets}
          />
        ) : null}
        <label className="sr-only" htmlFor={`${listboxId}-input`}>
          Message
        </label>
        <textarea
          aria-activedescendant={
            isOpen && activePreset
              ? commandOptionId(listboxId, activePreset.command)
              : undefined
          }
          aria-controls={isOpen ? listboxId : undefined}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          disabled={disabled}
          id={`${listboxId}-input`}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything, or type / for commands"
          ref={textareaRef}
          rows={3}
          value={draft}
        />
      </div>
      <button
        className={`composer__action${requestState === 'streaming' ? ' composer__action--stop' : ''}`}
        disabled={requestState === 'idle' && (disabled || !draft.trim())}
        onClick={requestState === 'streaming' ? onStop : onSubmit}
        type="button"
        aria-label={requestState === 'streaming' ? 'Stop response' : 'Send message'}
      >
        {requestState === 'streaming' ? <Icon name="square" size={14} /> : null}
        {requestState === 'streaming' ? 'Stop' : 'Send'}
      </button>
      {disabledReason ? (
        <p className="composer__hint" role="status">{disabledReason}</p>
      ) : null}
    </div>
  );
};

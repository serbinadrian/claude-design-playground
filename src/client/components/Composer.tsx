import {
  useId,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

import {
  expandCommandPreset,
  filterCommandPresets,
  type CommandPreset,
} from '@client/command-presets';
import type { RequestState } from '@client/use-chat-controller';
import {
  CommandWhisperer,
  commandOptionId,
} from '@client/components/CommandWhisperer';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasFocusedRef = useRef(false);
  const listboxId = useId();
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null);
  const commandMode = draft.startsWith('/') && !draft.includes('\n');
  const presets = commandMode ? filterCommandPresets(draft) : [];
  const isOpen = presets.length > 0 && dismissedDraft !== draft && !disabled;
  const selectedIndex = Math.max(
    0,
    presets.findIndex(({ command }) => command === activeCommand),
  );

  const focusAt = (start: number, end: number) => {
    queueMicrotask(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
    });
  };

  const selectPreset = (preset: CommandPreset) => {
    const expansion = expandCommandPreset(preset.command);
    if (!expansion) {
      return;
    }
    setDismissedDraft(draft);
    onDraftChange(expansion.value);
    focusAt(expansion.cursorStart, expansion.cursorEnd);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDismissedDraft(null);
    setActiveCommand(null);
    onDraftChange(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (selectedIndex + direction + presets.length) % presets.length;
        setActiveCommand(presets[nextIndex].command);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        selectPreset(presets[selectedIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedDraft(draft);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (requestState === 'idle' && draft.trim() && !disabled) {
        onSubmit();
      }
    }
  };

  const activePreset = presets[selectedIndex];

  useEffect(() => {
    if (!disabled && !hasFocusedRef.current) {
      hasFocusedRef.current = true;
      textareaRef.current?.focus();
    }
  }, [disabled]);

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
        className="composer__action"
        disabled={requestState === 'idle' && (disabled || !draft.trim())}
        onClick={requestState === 'streaming' ? onStop : onSubmit}
        type="button"
        aria-label={requestState === 'streaming' ? 'Stop response' : 'Send message'}
      >
        {requestState === 'streaming' ? 'Stop' : 'Send'}
      </button>
      {disabledReason ? (
        <p className="composer__hint" role="status">{disabledReason}</p>
      ) : null}
    </div>
  );
};

import {
  useId,
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
import type { RequestState } from '@hooks/use-chat-controller';

interface CommandMenuOptions {
  disabled: boolean;
  draft: string;
  onDraftChange(value: string): void;
  onSubmit(): void;
  requestState: RequestState;
}

export const useCommandMenu = ({
  disabled,
  draft,
  onDraftChange,
  onSubmit,
  requestState,
}: CommandMenuOptions) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    if (isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (selectedIndex + direction + presets.length) % presets.length;
      setActiveCommand(presets[nextIndex].command);
      return;
    }

    if (isOpen && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      selectPreset(presets[selectedIndex]);
      return;
    }

    if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      setDismissedDraft(draft);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (requestState === 'idle' && draft.trim() && !disabled) {
        onSubmit();
      }
    }
  };

  return {
    activePreset: presets[selectedIndex],
    handleChange,
    handleKeyDown,
    isOpen,
    listboxId,
    presets,
    selectPreset,
    selectedIndex,
    textareaRef,
  };
};

import type { CommandPreset } from '@client/command-presets';

export interface CommandWhispererProps {
  id: string;
  presets: readonly CommandPreset[];
  activeIndex: number;
  onSelect(preset: CommandPreset): void;
}

export const commandOptionId = (listboxId: string, command: string) =>
  `${listboxId}-${command.slice(1)}`;

export const CommandWhisperer = ({
  id,
  presets,
  activeIndex,
  onSelect,
}: CommandWhispererProps) => (
  <div className="command-whisperer" aria-label="Command presets" role="listbox" id={id}>
    <div className="command-whisperer__label" aria-hidden="true">
      Command presets
    </div>
    {presets.map((preset, index) => (
      <div
        aria-selected={index === activeIndex}
        className="command-whisperer__option"
        id={commandOptionId(id, preset.command)}
        key={preset.command}
        onClick={() => onSelect(preset)}
        onMouseDown={(event) => event.preventDefault()}
        role="option"
      >
        <code>{preset.command}</code>
        <span>{preset.description}</span>
      </div>
    ))}
  </div>
);

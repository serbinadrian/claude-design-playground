import { COMMAND_PRESETS } from '@client/command-presets';

export const PresetList = ({ onPreset }: { onPreset(command: string): void }) => (
  <>
    {COMMAND_PRESETS.map((preset) => (
      <button
        className="preset-link"
        key={preset.command}
        onClick={() => onPreset(preset.command)}
        type="button"
      >
        <code>{preset.command}</code>
        <span>{preset.description}</span>
      </button>
    ))}
  </>
);

export type CommandName = '/explain' | '/critique' | '/transform';

export interface CommandPreset {
  command: CommandName;
  description: string;
  scaffold: string;
}

export interface CommandExpansion {
  value: string;
  cursorStart: number;
  cursorEnd: number;
}

export const COMMAND_PRESETS: readonly CommandPreset[] = [
  {
    command: '/explain',
    description: 'Break down a topic clearly and concisely',
    scaffold: 'Explain this clearly and concisely:\n\n',
  },
  {
    command: '/critique',
    description: 'Review an idea and surface practical improvements',
    scaffold: 'Critique the following and suggest practical improvements:\n\n',
  },
  {
    command: '/transform',
    description: 'Rewrite input into a requested format or tone',
    scaffold: 'Transform the following into the requested format or tone:\n\n',
  },
] as const;

export const filterCommandPresets = (query: string): CommandPreset[] => {
  const normalized = query.trim().toLowerCase();
  return COMMAND_PRESETS.filter(({ command }) =>
    command.toLowerCase().startsWith(normalized),
  );
};

export const expandCommandPreset = (
  command: string,
): CommandExpansion | undefined => {
  const preset = COMMAND_PRESETS.find(
    (candidate) => candidate.command === command.toLowerCase(),
  );
  if (!preset) {
    return undefined;
  }

  return {
    value: preset.scaffold,
    cursorStart: preset.scaffold.length,
    cursorEnd: preset.scaffold.length,
  };
};

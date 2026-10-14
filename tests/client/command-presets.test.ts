import { describe, expect, it } from 'vitest';

import {
  COMMAND_PRESETS,
  expandCommandPreset,
  filterCommandPresets,
} from '@client/command-presets';

describe('command presets', () => {
  it('defines the three fixed commands in display order', () => {
    expect(COMMAND_PRESETS.map(({ command }) => command)).toEqual([
      '/explain',
      '/critique',
      '/transform',
    ]);
  });

  it('filters commands by a case-insensitive slash query', () => {
    expect(filterCommandPresets('/CR').map(({ command }) => command)).toEqual([
      '/critique',
    ]);
    expect(filterCommandPresets('/')).toHaveLength(3);
    expect(filterCommandPresets('/missing')).toEqual([]);
  });

  it.each([
    ['/explain', 'Explain this clearly and concisely:\n\n'],
    [
      '/critique',
      'Critique the following and suggest practical improvements:\n\n',
    ],
    [
      '/transform',
      'Transform the following into the requested format or tone:\n\n',
    ],
  ])('expands %s and places the caret at the scaffold end', (command, value) => {
    expect(expandCommandPreset(command)).toEqual({
      value,
      cursorStart: value.length,
      cursorEnd: value.length,
    });
  });

  it('returns undefined for an unknown command', () => {
    expect(expandCommandPreset('/unknown')).toBeUndefined();
  });
});

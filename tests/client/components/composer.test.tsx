import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Composer, type ComposerProps } from '@components/composer';

const renderComposer = (overrides: Partial<ComposerProps> = {}) => {
  const props: ComposerProps = {
    draft: '',
    onDraftChange: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    requestState: 'idle',
    ...overrides,
  };
  const view = render(<Composer {...props} />);
  return { ...view, props };
};

describe('Composer', () => {
  it('prevents empty submission and submits a non-empty draft with Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender, props } = renderComposer({ onSubmit });
    const textbox = screen.getByRole('textbox', { name: 'Message' });

    await user.click(textbox);
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<Composer {...props} draft="A question" />);
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('uses Shift+Enter for a newline', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    renderComposer({ draft: 'Line one', onSubmit, onDraftChange });

    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onDraftChange).toHaveBeenCalled();
  });

  it('shows setup guidance and disables input when unavailable', () => {
    renderComposer({
      disabled: true,
      disabledReason: 'Add SC_TOKEN to enable requests.',
    });

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByText('Add SC_TOKEN to enable requests.')).toBeVisible();
  });

  it('changes the send action to stop while streaming', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    renderComposer({ draft: 'Question', requestState: 'streaming', onStop });

    await user.click(screen.getByRole('button', { name: 'Stop response' }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('opens on slash, filters, and exposes listbox relationships', () => {
    renderComposer({ draft: '/cr' });
    const textbox = screen.getByRole('textbox', { name: 'Message' });
    const listbox = screen.getByRole('listbox', { name: 'Command presets' });

    expect(screen.getByRole('option', { name: /critique/i })).toBeVisible();
    expect(screen.queryByRole('option', { name: /explain/i })).not.toBeInTheDocument();
    expect(textbox).toHaveAttribute('aria-controls', listbox.id);
    expect(textbox).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option').id,
    );
  });

  it('wraps keyboard selection and expands the selected command', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    renderComposer({ draft: '/', onDraftChange });
    const textbox = screen.getByRole('textbox', { name: 'Message' });

    await user.click(textbox);
    await user.keyboard('{ArrowUp}{Enter}');

    expect(onDraftChange).toHaveBeenLastCalledWith(
      'Transform the following into the requested format or tone:\n\n',
    );
    expect(textbox).toHaveFocus();
  });

  it('closes the whisperer with Escape without changing the draft', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    renderComposer({ draft: '/', onDraftChange });

    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it('selects a command by pointer and retains textarea focus', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    renderComposer({ draft: '/', onDraftChange });
    const textbox = screen.getByRole('textbox', { name: 'Message' });

    await user.click(textbox);
    await user.click(screen.getByRole('option', { name: /explain/i }));

    expect(onDraftChange).toHaveBeenLastCalledWith(
      'Explain this clearly and concisely:\n\n',
    );
    expect(textbox).toHaveFocus();
  });
});

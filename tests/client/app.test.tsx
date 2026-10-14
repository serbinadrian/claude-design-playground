import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '@app/index';
import type { Conversation } from '@client/chat-domain';
import { fetchHealth } from '@client/health-client';
import type { ChatController } from '@hooks/use-chat-controller';

const conversation: Conversation = {
  id: 'active',
  title: 'What is fish?',
  createdAt: 100,
  updatedAt: 220,
  messages: [
    {
      id: 'user-1',
      role: 'user',
      content: 'What is fish?',
      status: 'complete',
      createdAt: 100,
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'A fish is an aquatic vertebrate.',
      status: 'complete',
      createdAt: 110,
      metadata: {
        requestId: 'req-12345678',
        model: 'asi1-mini',
        httpStatus: 200,
        startedAt: 110,
        completedAt: 220,
        elapsedMs: 110,
        finishReason: 'stop',
        usage: { promptTokens: 7, completionTokens: 9, totalTokens: 16 },
      },
    },
  ],
};

const controller = (
  overrides: Partial<ChatController> = {},
): ChatController => ({
  conversations: [conversation],
  activeConversation: conversation,
  draft: '',
  requestState: 'idle',
  error: null,
  setDraft: vi.fn(),
  submit: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  retry: vi.fn().mockResolvedValue(undefined),
  newConversation: vi.fn(),
  selectConversation: vi.fn(),
  deleteConversation: vi.fn(),
  ...overrides,
});

describe('fetchHealth', () => {
  it('returns a validated ready or unconfigured response', async () => {
    const ready = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: 'ready', model: 'asi1-mini' }),
    );
    const unconfigured = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: 'unconfigured', model: 'asi1-mini' }),
    );

    await expect(fetchHealth(ready)).resolves.toEqual({
      status: 'ready', model: 'asi1-mini',
    });
    await expect(fetchHealth(unconfigured)).resolves.toEqual({
      status: 'unconfigured', model: 'asi1-mini',
    });
    expect(ready).toHaveBeenCalledWith('/api/health', {
      headers: { Accept: 'application/json' },
    });
  });

  it('rejects malformed health responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: 'maybe', token: 'secret' }),
    );
    await expect(fetchHealth(fetchImpl)).rejects.toThrow('invalid health response');
  });
});

describe('App', () => {
  it('disables submission and gives setup guidance when the server is unconfigured', async () => {
    render(
      <App
        controller={controller()}
        healthLoader={async () => ({ status: 'unconfigured', model: 'asi1-mini' })}
      />,
    );

    await waitFor(() => expect(screen.getByText('API unconfigured')).toBeVisible());
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByText(/Add SC_TOKEN/i)).toBeVisible();
  });

  it('renders the useful empty state when ready', async () => {
    const empty: Conversation = {
      id: 'empty', title: 'New request', messages: [], createdAt: 1, updatedAt: 1,
    };
    render(
      <App
        controller={controller({ conversations: [empty], activeConversation: empty })}
        healthLoader={async () => ({ status: 'ready', model: 'asi1-mini' })}
      />,
    );

    expect(await screen.findByText('Start with a question')).toBeVisible();
    expect(screen.getByText(/Type a prompt or use a slash command/i)).toBeVisible();
  });

  it('renders an ordered multi-turn thread and complete request telemetry', async () => {
    render(
      <App
        controller={controller()}
        healthLoader={async () => ({ status: 'ready', model: 'asi1-mini' })}
      />,
    );

    await screen.findByText('API ready');
    const messages = screen.getAllByTestId('chat-message');
    expect(messages[0]).toHaveTextContent('What is fish?');
    expect(messages[1]).toHaveTextContent('A fish is an aquatic vertebrate.');
    expect(screen.getByText('/api/chat')).toBeVisible();
    expect(screen.getByText('POST')).toBeVisible();
    expect(screen.getByText('1 message')).toBeVisible();
    expect(screen.getAllByText('asi1-mini').length).toBeGreaterThan(0);
    expect(screen.getByText('110 ms')).toBeVisible();
    expect(screen.getByText('16 tokens')).toBeVisible();
    expect(screen.getByText('HTTP 200')).toBeVisible();
    expect(screen.getByTestId('payload-preview')).not.toHaveTextContent(
      'A fish is an aquatic vertebrate.',
    );
  });

  it('routes history, new, retry, and stop actions to the controller', async () => {
    const user = userEvent.setup();
    const failed: Conversation = {
      ...conversation,
      messages: [
        conversation.messages[0],
        {
          ...conversation.messages[1],
          status: 'error',
          metadata: {
            ...conversation.messages[1].metadata,
            error: { code: 'timeout', message: 'Timed out.', retryable: true },
          },
        },
      ],
    };
    const chat = controller({
      activeConversation: failed,
      conversations: [failed, { ...conversation, id: 'older', title: 'Older thread' }],
      error: { code: 'timeout', message: 'Timed out.', retryable: true },
    });
    const { rerender } = render(
      <App
        controller={chat}
        healthLoader={async () => ({ status: 'ready', model: 'asi1-mini' })}
      />,
    );
    await screen.findByText('API ready');

    await user.click(screen.getByRole('button', { name: 'New request' }));
    await user.click(screen.getByRole('button', { name: 'Open Older thread' }));
    await user.click(screen.getByRole('button', { name: 'New mobile request' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Mobile conversation history' }),
      'older',
    );
    await user.click(screen.getByRole('button', { name: 'Retry response' }));
    expect(chat.newConversation).toHaveBeenCalledTimes(2);
    expect(chat.selectConversation).toHaveBeenCalledWith('older');
    expect(chat.retry).toHaveBeenCalledOnce();

    const streaming = controller({ requestState: 'streaming' });
    rerender(
      <App
        controller={streaming}
        healthLoader={async () => ({ status: 'ready', model: 'asi1-mini' })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Stop response' }));
    expect(streaming.stop).toHaveBeenCalledOnce();
  });
});

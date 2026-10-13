import { describe, expect, it } from 'vitest';

import type { Conversation } from '@client/chat-domain';
import { createConversationRepository } from '@client/conversation-storage';

describe('createConversationRepository', () => {
  it('persists schema version 1 and lists newest conversations first', () => {
    const storage = memoryStorage();
    const repository = createConversationRepository(storage);

    repository.save(conversation('older', 10));
    repository.save(conversation('newer', 20));

    expect(repository.list().map(({ id }) => id)).toEqual(['newer', 'older']);
    expect(JSON.parse(storage.getItem('quickllm:conversations:v1') ?? '')).toEqual({
      version: 1,
      conversations: [conversation('newer', 20), conversation('older', 10)],
    });
  });

  it('keeps only the 20 newest conversations', () => {
    const repository = createConversationRepository(memoryStorage());

    for (let index = 0; index < 22; index += 1) {
      repository.save(conversation(`conversation-${index}`, index));
    }

    expect(repository.list()).toHaveLength(20);
    expect(repository.list().at(0)?.id).toBe('conversation-21');
    expect(repository.list().at(-1)?.id).toBe('conversation-2');
  });

  it('falls back to an empty in-memory list for corrupt JSON', () => {
    const storage = memoryStorage({ 'quickllm:conversations:v1': '{broken' });

    const repository = createConversationRepository(storage);

    expect(repository.list()).toEqual([]);
    repository.save(conversation('still-works', 1));
    expect(repository.list().map(({ id }) => id)).toEqual(['still-works']);
  });

  it('rejects structurally invalid saved conversations', () => {
    const storage = memoryStorage({
      'quickllm:conversations:v1': JSON.stringify({
        version: 1,
        conversations: [{ id: 'broken', messages: 'not-an-array' }],
      }),
    });

    expect(createConversationRepository(storage).list()).toEqual([]);
  });

  it('recovers persisted in-flight assistant turns as aborted', () => {
    const interrupted: Conversation = {
      ...conversation('interrupted', 2),
      messages: [
        { id: 'user', role: 'user', content: 'Question', status: 'complete', createdAt: 1 },
        { id: 'assistant', role: 'assistant', content: 'Partial', status: 'streaming', createdAt: 2 },
      ],
    };
    const storage = memoryStorage({
      'quickllm:conversations:v1': JSON.stringify({
        version: 1,
        conversations: [interrupted],
      }),
    });

    const [recovered] = createConversationRepository(storage).list();

    expect(recovered.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Partial',
      status: 'aborted',
    });
  });

  it('continues in memory when storage reads throw', () => {
    const storage = throwingStorage('read');

    const repository = createConversationRepository(storage);
    repository.save(conversation('in-memory', 1));

    expect(repository.list().map(({ id }) => id)).toEqual(['in-memory']);
  });

  it('continues in memory when quota writes throw', () => {
    const storage = throwingStorage('write');
    const repository = createConversationRepository(storage);

    repository.save(conversation('in-memory', 1));

    expect(repository.list().map(({ id }) => id)).toEqual(['in-memory']);
  });

  it('removes a conversation from memory and persistence', () => {
    const storage = memoryStorage();
    const repository = createConversationRepository(storage);
    repository.save(conversation('keep', 1));
    repository.save(conversation('remove', 2));

    repository.remove('remove');

    expect(repository.list().map(({ id }) => id)).toEqual(['keep']);
    expect(storage.getItem('quickllm:conversations:v1')).not.toContain('remove');
  });
});

const conversation = (id: string, updatedAt: number): Conversation => ({
  id,
  title: id,
  messages: [],
  createdAt: updatedAt,
  updatedAt,
});

const memoryStorage = (initial: Record<string, string> = {}): Storage => {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

const throwingStorage = (mode: 'read' | 'write'): Storage => ({
  length: 0,
  clear() {},
  getItem() {
    if (mode === 'read') throw new DOMException('Unavailable');
    return null;
  },
  key() {
    return null;
  },
  removeItem() {
    if (mode === 'write') throw new DOMException('Unavailable');
  },
  setItem() {
    if (mode === 'write') throw new DOMException('Quota exceeded');
  },
});

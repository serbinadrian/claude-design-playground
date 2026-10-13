import type {
  Conversation,
  ConversationMessage,
} from '@client/chat-domain';

const STORAGE_KEY = 'quickllm:conversations:v1';
const SCHEMA_VERSION = 1;
const MAX_CONVERSATIONS = 20;

interface StoredConversations {
  version: typeof SCHEMA_VERSION;
  conversations: Conversation[];
}

export interface ConversationRepository {
  list(): Conversation[];
  save(conversation: Conversation): void;
  remove(id: string): void;
}

const isMessage = (value: unknown): value is ConversationMessage => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ConversationMessage>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    (candidate.status === 'complete' ||
      candidate.status === 'streaming' ||
      candidate.status === 'error' ||
      candidate.status === 'aborted') &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt)
  );
};

const isConversation = (value: unknown): value is Conversation => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<Conversation>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isMessage) &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt)
  );
};

const normalize = (conversations: Conversation[]): Conversation[] =>
  [...conversations]
    .map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.role === 'assistant' && message.status === 'streaming'
          ? { ...message, status: 'aborted' as const }
          : message,
      ),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CONVERSATIONS);

const resolveStorage = (storage?: Storage): Storage | undefined => {
  if (storage) {
    return storage;
  }

  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const load = (storage: Storage | undefined): Conversation[] => {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Partial<StoredConversations>;
    if (
      parsed.version !== SCHEMA_VERSION ||
      !Array.isArray(parsed.conversations) ||
      !parsed.conversations.every(isConversation)
    ) {
      return [];
    }

    return normalize(parsed.conversations);
  } catch {
    return [];
  }
};

export const createConversationRepository = (
  requestedStorage?: Storage,
): ConversationRepository => {
  const storage = resolveStorage(requestedStorage);
  let conversations = load(storage);

  const persist = () => {
    if (!storage) {
      return;
    }

    const payload: StoredConversations = {
      version: SCHEMA_VERSION,
      conversations,
    };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // In-memory state remains available when storage is blocked or full.
    }
  };

  return {
    list: () => [...conversations],
    save(conversation) {
      conversations = normalize([
        conversation,
        ...conversations.filter(({ id }) => id !== conversation.id),
      ]);
      persist();
    },
    remove(id) {
      conversations = conversations.filter(
        (conversation) => conversation.id !== id,
      );
      persist();
    },
  };
};

import type { Usage } from '@shared/chat-contracts';

export interface OpenAiChunk {
  choices?: Array<{
    delta?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

export const normalizeUsage = (chunk: OpenAiChunk): Usage | undefined => {
  if (!chunk.usage) {
    return undefined;
  }

  const usage: Usage = {
    promptTokens: asNumber(chunk.usage.prompt_tokens),
    completionTokens: asNumber(chunk.usage.completion_tokens),
    totalTokens: asNumber(chunk.usage.total_tokens),
  };

  if (Object.values(usage).every((value) => value === undefined)) {
    return undefined;
  }
  return usage;
};

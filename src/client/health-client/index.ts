import type { HealthResponse } from '@shared/chat-contracts';

export const fetchHealth = async (
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResponse> => {
  const response = await fetchImpl('/api/health', {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Health request failed with HTTP ${response.status}.`);
  }
  const value = (await response.json()) as Partial<HealthResponse>;
  if (
    (value.status !== 'ready' && value.status !== 'unconfigured') ||
    typeof value.model !== 'string'
  ) {
    throw new Error('The server returned an invalid health response.');
  }
  return { status: value.status, model: value.model };
};

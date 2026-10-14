import { useEffect, useState } from 'react';

import { fetchHealth } from '@client/health-client';
import type { ApiStatus } from '@components/top-bar';
import type { HealthResponse } from '@shared/chat-contracts';

export type HealthLoader = () => Promise<HealthResponse>;

export const useApiHealth = (healthLoader: HealthLoader = fetchHealth) => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<ApiStatus>('loading');

  useEffect(() => {
    let isCurrent = true;

    void healthLoader().then(
      (result) => {
        if (isCurrent) {
          setHealth(result);
          setStatus(result.status);
        }
      },
      () => {
        if (isCurrent) {
          setStatus('unavailable');
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [healthLoader]);

  return { health, status };
};

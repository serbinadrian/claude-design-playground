export type ApiStatus = 'loading' | 'ready' | 'unconfigured' | 'unavailable';

const STATUS_LABELS: Record<ApiStatus, string> = {
  loading: 'Checking API',
  ready: 'API ready',
  unconfigured: 'API unconfigured',
  unavailable: 'API unavailable',
};

export const TopBar = ({ status }: { status: ApiStatus }) => {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Quick LLM Console home">
        <span className="brand__mark" aria-hidden="true">Q_</span>
        <span>Quick LLM</span>
      </a>
      <div className="topbar__context">
        <span>WORKSPACE</span>
        <strong>Claude Design Workflow</strong>
      </div>
      <div className={`api-status api-status--${status}`}>
        <span className="api-status__dot" aria-hidden="true" />
        {STATUS_LABELS[status]}
      </div>
    </header>
  );
};

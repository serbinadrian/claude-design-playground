export type ApiStatus = 'loading' | 'ready' | 'unconfigured' | 'unavailable';

export const TopBar = ({ status }: { status: ApiStatus }) => {
  const label = status === 'ready'
    ? 'API ready'
    : status === 'unconfigured'
      ? 'API unconfigured'
      : status === 'unavailable'
        ? 'API unavailable'
        : 'Checking API';

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
        {label}
      </div>
    </header>
  );
};

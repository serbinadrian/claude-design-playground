import { BRAND_LOGO_SRC, BrandMark } from '@components/brand';

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
        <img alt="Singularity Compute" className="brand__logo" src={BRAND_LOGO_SRC} />
        <BrandMark className="brand__mark" />
        <span className="brand__divider" aria-hidden="true" />
        <span className="brand__product">Quick LLM</span>
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

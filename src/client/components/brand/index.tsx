export const BRAND_LOGO_SRC = '/brand/logo-horizontal.png';
export const BRAND_MARK_SRC = '/brand/mark.png';

/** Decorative Singularity Compute gradient mark. */
export const BrandMark = ({ className }: { className?: string }) => (
  <img alt="" aria-hidden="true" className={className} src={BRAND_MARK_SRC} />
);

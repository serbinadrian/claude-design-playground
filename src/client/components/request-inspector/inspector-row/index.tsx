import type { ReactNode } from 'react';

export const InspectorRow = ({ label, children }: {
  label: string;
  children: ReactNode;
}) => (
  <div className="inspector-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

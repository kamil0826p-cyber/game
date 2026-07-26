import type { HTMLAttributes, PropsWithChildren } from 'react';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Panel({
  children,
  className = '',
  elevated = false,
  ...props
}: PropsWithChildren<PanelProps>): React.JSX.Element {
  return (
    <div
      className={`fantasy-panel ${elevated ? 'fantasy-panel-elevated' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

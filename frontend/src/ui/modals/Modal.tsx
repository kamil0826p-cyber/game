import type {
  MouseEvent as ReactMouseEvent,
  PropsWithChildren,
  ReactNode,
} from 'react';

interface ModalProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  widthClass?: string;
}

export function Modal({
  title,
  subtitle,
  icon,
  onClose,
  widthClass = 'max-w-2xl',
  children,
}: ModalProps): React.JSX.Element {
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-slate-950/65 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fantasy-panel fantasy-panel-elevated max-h-[88vh] w-full ${widthClass} overflow-hidden`}
        onMouseDown={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-slate-950/45 px-5 py-4">
          <div className="flex items-center gap-3">
            {icon ? <span className="text-2xl text-amber-200">{icon}</span> : null}
            <div>
              <h2 className="font-display text-2xl text-amber-100">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="modal-close" aria-label={`Close ${title}`}>
            ×
          </button>
        </header>
        <div className="max-h-[calc(88vh-76px)] overflow-auto p-5">{children}</div>
      </section>
    </div>
  );
}

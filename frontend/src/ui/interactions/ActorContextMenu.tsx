export interface ActorContextAction {
  key: string;
  label: string;
  icon: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

interface ActorContextMenuProps {
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  actions: readonly ActorContextAction[];
}

export function ActorContextMenu({
  title,
  subtitle,
  x,
  y,
  actions,
}: ActorContextMenuProps): React.JSX.Element {
  const left = Math.min(Math.max(12, x + 10), window.innerWidth - 180);
  const top = Math.min(
    Math.max(12, y - 12),
    window.innerHeight - Math.max(120, 66 + actions.length * 40),
  );

  return (
    <div
      data-actor-context-menu
      className="actor-context-menu pointer-events-auto fixed z-40 w-44 overflow-hidden rounded-lg p-1"
      style={{ left, top }}
    >
      <div className="actor-context-menu-header px-3 py-2">
        <strong className="actor-context-menu-title block truncate text-sm">{title}</strong>
        {subtitle ? (
          <span className="actor-context-menu-subtitle text-[11px]">{subtitle}</span>
        ) : null}
      </div>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={action.disabled}
          className="actor-context-menu-action flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm disabled:opacity-50"
          onClick={() => void action.run()}
        >
          <span className="actor-context-menu-icon">{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>
  );
}

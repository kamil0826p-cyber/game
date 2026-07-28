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
      className="pointer-events-auto fixed z-40 w-44 overflow-hidden rounded-lg border border-amber-300/25 bg-slate-950/95 p-1 shadow-2xl"
      style={{ left, top }}
    >
      <div className="border-b border-white/10 px-3 py-2">
        <strong className="block truncate text-sm text-amber-100">{title}</strong>
        {subtitle ? <span className="text-[11px] text-slate-400">{subtitle}</span> : null}
      </div>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={action.disabled}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-amber-400/10 disabled:opacity-50"
          onClick={() => void action.run()}
        >
          <span className="text-amber-200">{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>
  );
}

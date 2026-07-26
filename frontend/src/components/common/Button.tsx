import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  busy?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'border-amber-300/70 bg-amber-500/20 text-amber-100 hover:bg-amber-400/30',
  secondary: 'border-slate-500/70 bg-slate-800/80 text-slate-100 hover:bg-slate-700/90',
  danger: 'border-rose-500/70 bg-rose-950/70 text-rose-100 hover:bg-rose-900/80',
  ghost: 'border-transparent bg-transparent text-slate-300 hover:bg-white/5 hover:text-white',
};

export function Button({
  children,
  className = '',
  variant = 'primary',
  busy = false,
  disabled,
  ...props
}: PropsWithChildren<ButtonProps>): React.JSX.Element {
  return (
    <button
      className={`retro-button ${variants[variant]} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? <span className="loading-rune" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

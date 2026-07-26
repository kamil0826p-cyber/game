import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  busy?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'ui-button-primary',
  secondary: 'ui-button-secondary',
  danger: 'ui-button-danger',
  ghost: 'ui-button-ghost',
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
      className={`ui-button ${variants[variant]} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? <span className="loading-rune" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-sm hover:bg-primary-dark hover:-translate-y-0.5 hover:shadow-wallet-hover active:translate-y-0',
  secondary: 'bg-surface-secondary text-text-primary border-2 border-border hover:border-primary hover:-translate-y-0.5 hover:shadow-wallet',
  danger: 'bg-danger text-white hover:bg-red-600 hover:-translate-y-0.5',
  ghost: 'bg-transparent text-text-secondary hover:bg-surface-tertiary hover:text-text-primary',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-4 py-3 text-sm',
  md: 'px-5 py-4 text-sm',
  lg: 'px-6 py-5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const baseStyles = 'rounded-wallet font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none';
  const widthStyles = fullWidth ? 'w-full' : '';
  
  return (
    <button
      disabled={disabled || loading}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${widthStyles} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

export default Button;

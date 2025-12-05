import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({
  label,
  error,
  hint,
  className = '',
  id,
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  
  const inputStyles = `
    w-full px-4 py-3.5 rounded-wallet-sm border bg-white
    text-base text-text-primary placeholder:text-text-tertiary leading-relaxed
    focus:outline-none focus:ring-1 transition-colors duration-150
    ${error 
      ? 'border-danger focus:border-danger focus:ring-danger/20' 
      : 'border-border focus:border-primary focus:ring-primary/20'
    }
    ${props.disabled ? 'opacity-50 cursor-not-allowed bg-surface-secondary' : ''}
  `.trim().replace(/\s+/g, ' ');

  return (
    <div className="w-full">
      {label && (
        <label 
          htmlFor={inputId}
          className="block mb-2 text-sm font-semibold text-text-primary"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`${inputStyles} ${className}`}
        {...props}
      />
      {error && (
        <p className="mt-2 text-sm text-danger">{error}</p>
      )}
      {hint && !error && (
        <p className="mt-2 text-sm text-text-secondary">{hint}</p>
      )}
    </div>
  );
}

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function TextArea({
  label,
  error,
  hint,
  className = '',
  id,
  ...props
}: TextAreaProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  
  const textareaStyles = `
    w-full px-4 py-3.5 rounded-wallet-sm border bg-white
    text-base text-text-primary placeholder:text-text-tertiary leading-relaxed
    focus:outline-none focus:ring-1 transition-colors duration-150
    resize-vertical min-h-[120px] font-mono
    ${error 
      ? 'border-danger focus:border-danger focus:ring-danger/20' 
      : 'border-border focus:border-primary focus:ring-primary/20'
    }
    ${props.disabled ? 'opacity-50 cursor-not-allowed bg-surface-secondary' : ''}
  `.trim().replace(/\s+/g, ' ');

  return (
    <div className="w-full">
      {label && (
        <label 
          htmlFor={inputId}
          className="block mb-2 text-sm font-semibold text-text-primary"
        >
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        className={`${textareaStyles} ${className}`}
        {...props}
      />
      {error && (
        <p className="mt-2 text-sm text-danger">{error}</p>
      )}
      {hint && !error && (
        <p className="mt-1.5 text-xs text-text-secondary">{hint}</p>
      )}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({
  label,
  error,
  options,
  className = '',
  id,
  ...props
}: SelectProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  
  const selectStyles = `
    w-full px-4 py-3 rounded-wallet-sm border bg-white
    text-sm text-text-primary leading-relaxed
    focus:outline-none focus:ring-1 transition-colors duration-150
    cursor-pointer appearance-none
    ${error 
      ? 'border-danger focus:border-danger focus:ring-danger/20' 
      : 'border-border focus:border-primary focus:ring-primary/20'
    }
    ${props.disabled ? 'opacity-50 cursor-not-allowed bg-surface-secondary' : ''}
  `.trim().replace(/\s+/g, ' ');

  return (
    <div className="w-full">
      {label && (
        <label 
          htmlFor={inputId}
          className="block mb-2 text-sm font-semibold text-text-primary"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={inputId}
          className={`${selectStyles} ${className}`}
          {...props}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">
          ▼
        </div>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      )}
    </div>
  );
}

export default Input;

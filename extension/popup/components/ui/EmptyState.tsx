/**
 * @fileoverview EmptyState — centered icon + title + subtitle + optional CTA.
 *
 * Use for: zero-history activity list, token list with no tokens added, search
 * with no results, unsupported explorer. Prefer calling out *why* the state is
 * empty and (when meaningful) the next action the user can take.
 */
import React from 'react';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={`empty-state${className ? ` ${className}` : ''}`}>
      {icon && (
        <div className="empty-state__icon">
          <Icon name={icon} size={24} decorative />
        </div>
      )}
      <div className="empty-state__title">{title}</div>
      {subtitle && <div className="empty-state__subtitle">{subtitle}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export default EmptyState;

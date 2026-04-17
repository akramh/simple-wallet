/**
 * @fileoverview Thin wrapper around `lucide-react` that enforces a curated
 * whitelist so only intentional icons ship, sets sensible defaults for size
 * and stroke, and makes accessibility metadata explicit.
 *
 * Usage:
 *   <Icon name="lock" size={16} />
 *   <Icon name="copy" aria-label="Copy address" />   // focusable/icon-only button
 *   <Icon name="check" decorative />                 // hidden from screen readers
 *
 * Adding a new icon: import it from lucide-react and register it in the
 * `registry` map below. Keeping the map explicit prevents the bundle from
 * ballooning by accident.
 */
import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Eye,
  EyeOff,
  Info,
  Key,
  Loader2,
  Lock,
  LockKeyhole,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sun,
  SunMoon,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';

const registry = {
  'alert-circle': AlertCircle,
  'alert-triangle': AlertTriangle,
  'arrow-down-left': ArrowDownLeft,
  'arrow-left': ArrowLeft,
  'arrow-up-right': ArrowUpRight,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  clipboard: Clipboard,
  copy: Copy,
  eye: Eye,
  'eye-off': EyeOff,
  info: Info,
  key: Key,
  loader: Loader2,
  lock: Lock,
  'lock-keyhole': LockKeyhole,
  moon: Moon,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  send: Send,
  settings: Settings,
  sun: Sun,
  'sun-moon': SunMoon,
  trash: Trash2,
  wallet: Wallet,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof registry;

type IconProps = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
} & (
  | { decorative: true; 'aria-label'?: never }
  | { decorative?: false; 'aria-label'?: string }
);

/**
 * Render a single Lucide icon from the whitelisted registry.
 *
 * Defaults: 16px, stroke-width 2, inherits `currentColor`. Pass
 * `decorative` for purely visual icons (hidden from AT); pass `aria-label`
 * for meaningful icons that stand on their own (e.g. icon-only buttons).
 */
export function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  className,
  style,
  decorative,
  'aria-label': ariaLabel,
}: IconProps) {
  const LucideSvg = registry[name];
  if (!LucideSvg) return null;

  const a11yProps =
    decorative || !ariaLabel
      ? { 'aria-hidden': true as const, focusable: false as const }
      : { role: 'img' as const, 'aria-label': ariaLabel };

  return (
    <LucideSvg
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      {...a11yProps}
    />
  );
}

export default Icon;

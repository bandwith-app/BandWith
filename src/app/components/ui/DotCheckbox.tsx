import React from 'react';
import { cn } from './utils';
import { Check } from '@/app/components/icons';

interface DotCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  activeColor?: string;
  inactiveColor?: string;
  /** Colour of the tick on a checked box; set it when activeColor is not the wizard accent. */
  checkColor?: string;
  className?: string;
  onClick?: () => void;
  /**
   * Accessible name (the row's label). Without a click handler or a label the
   * box is only a picture: its row is the control (a `role="checkbox"` row or
   * a button) and says what it is.
   */
  label?: string;
}

export const DotCheckbox: React.FC<DotCheckboxProps> = ({
  checked,
  disabled = false,
  activeColor = 'var(--wizard-accent, var(--fg))',
  inactiveColor,
  checkColor,
  className,
  onClick,
  label,
}) => {
  const borderColor = disabled
    ? 'rgba(0,0,0,0.1)'
    : inactiveColor || 'rgba(0,0,0,0.2)';
  const bg = disabled ? 'rgba(0,0,0,0.04)' : checked ? activeColor : 'transparent';
  const fg = disabled
    ? 'rgba(0,0,0,0.2)'
    : checked
      ? checkColor ?? 'var(--wizard-accent-fg, var(--surface-inverse-fg))'
      : 'transparent';

  const boxClasses = cn(
    'w-[32px] h-[32px] rounded-[8px] border-2 flex items-center justify-center shrink-0 transition-all',
    onClick && 'focus:outline-none',
    onClick && (disabled ? 'cursor-not-allowed' : 'cursor-pointer'),
    !onClick && 'pointer-events-none',
    className,
  );

  const box = (
    <div
      className={boxClasses}
      style={{
        backgroundColor: bg,
        borderColor,
      }}
    >
      <Check
        className="w-[18px] h-[18px] transition-all"
        style={{ color: fg, opacity: checked ? 1 : 0 }}
        strokeWidth={3}
      />
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="shrink-0"
      >
        {box}
      </button>
    );
  }

  if (!label) {
    return (
      <div aria-hidden="true" className="shrink-0">
        {box}
      </div>
    );
  }

  return (
    <div role="checkbox" aria-checked={checked} aria-label={label} className="shrink-0">
      {box}
    </div>
  );
};
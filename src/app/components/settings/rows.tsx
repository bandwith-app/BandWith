import React from 'react';
import { cn } from '@/app/components/ui/utils';

/* ── Settings building blocks (Figma: Card / Icon tile) ── */

export const IconTile: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span
    aria-hidden
    className={cn(
      'size-10 rounded-full bg-foreground/[0.08] flex items-center justify-center text-foreground shrink-0 [&>svg]:size-[18px]',
      className,
    )}
  >
    {children}
  </span>
);

export const RowText: React.FC<{ title: React.ReactNode; hint?: React.ReactNode; titleClassName?: string }> = ({ title, hint, titleClassName }) => (
  <span className="flex flex-col gap-1 min-w-0 flex-1">
    <span className={cn('bw-label-md text-foreground', titleClassName)}>{title}</span>
    {hint && <span className="bw-body-sm text-muted-foreground">{hint}</span>}
  </span>
);

export const CARD = 'bg-card text-card-foreground rounded-[24px]';
export const ROW = 'p-4 flex items-center gap-3 w-full text-left';

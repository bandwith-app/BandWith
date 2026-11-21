import React from 'react';

/**
 * A lazy screen that waits for its own code, not the whole layer list: when
 * one page opens for the first time while another closes, a shared Suspense
 * hid the list mid-change and the closing page's exit never finished, so it
 * stayed on screen (the Duo hub showed two pages, Back lost).
 */
export function lazyLayer<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>): React.FC<React.ComponentProps<T>> {
  const Lazy = React.lazy(load);
  const Layer: React.FC<React.ComponentProps<T>> = (props) => (
    <React.Suspense fallback={null}>
      <Lazy {...props} />
    </React.Suspense>
  );
  return Layer;
}

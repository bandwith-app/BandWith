/**
 * iPhone Duo closed and turned over in landscape: the camera sits at the
 * bottom of the rail column, and the rail's two pills must end above it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { installDuoLayout } from '../deviceRegions';

function layout(vw: number, vh: number, status: { x: number; y: number; w: number; h: number; edge: 'right' }) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: vw });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: vh });
  window.__bwRegions = {
    status,
    division: null,
    viewport: { w: vw, h: vh },
    hinge: { status: 'closed' },
  };
  installDuoLayout();
  return getComputedStyle(document.documentElement);
}

afterEach(() => {
  delete window.__bwRegions;
  document.documentElement.removeAttribute('style');
});

describe('Duo rail clears the camera', () => {
  it('closed in landscape with the camera at the bottom, the rail tightens so the profile pill stays above the camera', () => {
    const cs = layout(678, 466, { x: 594, y: 384, w: 84, h: 82, edge: 'right' });
    expect(cs.getPropertyValue('--bw-rail-clear-bottom').trim()).toBe('90px');
    expect(cs.getPropertyValue('--bw-rail-pad-top').trim()).toBe('8px');
    expect(cs.getPropertyValue('--bw-rail-gap').trim()).toBe('6px');
  });

  it('closed in portrait the rail keeps its usual spacing', () => {
    const cs = layout(466, 678, { x: 382, y: 0, w: 84, h: 174, edge: 'right' });
    expect(cs.getPropertyValue('--bw-rail-pad-top').trim()).toBe('');
    expect(cs.getPropertyValue('--bw-rail-gap').trim()).toBe('');
  });
});

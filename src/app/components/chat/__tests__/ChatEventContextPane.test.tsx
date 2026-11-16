import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatEventContextPane } from '../ChatEventContextPane';
import type { ChatEventContext } from '@/lib/chatEventContext';

const context = {
  id: 'e1',
  title: 'Rooftop Session',
  eventType: 'gig',
  day: '2099-11-15',
  when: 'later',
  time: { kind: 'loadIn', value: '17:00' },
  place: 'Terrazza Aurora',
  cancelled: false,
  details: { status: 'confirmed', venue: 'Terrazza Aurora' },
} as unknown as ChatEventContext;

describe('Chat event pane', () => {
  it('on the iPad the event pane starts below the status bar', () => {
    render(<ChatEventContextPane context={context} lineup={null} onlineCount={null} variant="tablet" />);
    const hero = screen.getByRole('region', { name: /Rooftop Session/ });
    expect(hero.style.paddingTop).toContain('--safe-top');
  });
});

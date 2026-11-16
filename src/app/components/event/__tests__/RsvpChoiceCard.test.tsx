import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { RsvpChoiceCard } from '../RsvpChoiceCard';

afterEach(cleanup);

describe('RsvpChoiceCard', () => {
  it('offers only GOING and CAN’T, never MAYBE', () => {
    render(<RsvpChoiceCard title="Are you coming?" current="pending" onChoose={vi.fn(async () => {})} />);
    expect(screen.getByText('GOING')).toBeTruthy();
    expect(screen.getByText("CAN'T")).toBeTruthy();
    expect(screen.queryByText('MAYBE')).toBeNull();
  });

  it('changing an accepted answer offers no MAYBE either', () => {
    render(<RsvpChoiceCard title="Are you coming?" current="accepted" onChoose={vi.fn(async () => {})} />);
    expect(screen.getByText('Going')).toBeTruthy();
    fireEvent.click(screen.getByText('Change'));
    expect(screen.getByText("CAN'T")).toBeTruthy();
    expect(screen.queryByText('MAYBE')).toBeNull();
  });

  it('an older "maybe" answer asks for a firm one, nothing preselected', async () => {
    const onChoose = vi.fn(async () => {});
    render(<RsvpChoiceCard title="Are you coming?" current="maybe" onChoose={onChoose} />);
    expect(screen.getByText("Your answer was Maybe. Choose GOING or CAN'T.")).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    fireEvent.click(screen.getByText('GOING'));
    expect(onChoose).toHaveBeenCalledWith('confirmed');
  });
});

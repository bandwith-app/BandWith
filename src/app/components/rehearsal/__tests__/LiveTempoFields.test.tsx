import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { LIVE_TEMPO_DEFAULTS, LiveTempoFields, type LiveTempoValues } from '../LiveTempoFields';

const setup = (value: Partial<LiveTempoValues> = {}, chartTime?: string) => {
  const onChange = vi.fn();
  render(<LiveTempoFields value={{ ...LIVE_TEMPO_DEFAULTS, ...value }} onChange={onChange} chartTime={chartTime} />);
  return onChange;
};

describe('LiveTempoFields (song form, 171)', () => {
  it("shows the chart's time signature as the pick, and picking another one sets it", () => {
    const onChange = setup({}, '3/4');
    expect(screen.getByRole('button', { name: 'Time signature 3/4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('From the chord chart.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Time signature 6/8' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeSignature: '6/8' }));
  });

  it('tapping the picked one again goes back to following the chart', () => {
    const onChange = setup({ timeSignature: '6/8' }, '3/4');
    fireEvent.click(screen.getByRole('button', { name: 'Time signature 6/8' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeSignature: '' }));
  });

  it("picking the chart's own 6/8 sets it: the BPM then counts the dotted beats, and the form says so", () => {
    const onChange = setup({}, '6/8');
    expect(screen.getByText('The BPM counts every eighth note.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Time signature 6/8' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeSignature: '6/8' }));
  });

  it('says what the BPM counts in the meters where it can differ', () => {
    setup({ timeSignature: '12/8' });
    expect(screen.getByText('The BPM counts the dotted beats.')).toBeInTheDocument();
  });

  it('… and in odd meters the quarter note; nothing to say in x/4', () => {
    setup({ timeSignature: '7/8' });
    expect(screen.getByText('The BPM counts quarter notes.')).toBeInTheDocument();
  });

  it('2 bars of count-in, a pickup of up to a bar less one beat, and the backing track switch', () => {
    const onChange = setup({ timeSignature: '3/4', pickupBeats: 2 });
    fireEvent.click(screen.getByRole('button', { name: '2 bars' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ countInBars: 2 }));
    expect(screen.getByText('Starts 2 beats early')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'One beat more' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'One beat less' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ pickupBeats: 1 }));
    fireEvent.click(screen.getByRole('switch', { name: 'Played with a backing track' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ backingTrack: true }));
  });
});

describe('LiveTempoFields: pickup', () => {
  it('says "1 beat" for one', () => {
    setup({ timeSignature: '4/4', pickupBeats: 1 });
    expect(screen.getByText('Starts 1 beat early')).toBeInTheDocument();
  });

  it('a shorter bar picked: the pickup is cut to fit it', () => {
    const onChange = setup({ timeSignature: '4/4', pickupBeats: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Time signature 2/4' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeSignature: '2/4', pickupBeats: 1 }));
  });
});

describe('LiveTempoFields: no chart', () => {
  it('shows 4/4 as the pick when nothing is set; picking 4/4 keeps it unset', () => {
    const onChange = setup();
    expect(screen.getByRole('button', { name: 'Time signature 4/4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('From the chord chart.')).toBeNull();
    expect(screen.queryByText(/The BPM counts/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Time signature 4/4' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeSignature: '' }));
  });
});

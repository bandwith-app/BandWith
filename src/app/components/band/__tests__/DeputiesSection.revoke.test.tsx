import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// 182 review round 3: bw_deputy_unlink rotates the reply and calendar links
// also for a deputy without an account, but the sheet only offered "Unlink
// account" to linked deputies, so an admin could never end a link that was
// forwarded or sent to the wrong number.

const list = vi.fn();
const unlink = vi.fn();
const getOne = vi.fn();
vi.mock('@/lib/services/deputies', () => ({
  listDeputies: (...a: unknown[]) => list(...a),
  getDeputy: (...a: unknown[]) => getOne(...a),
  unlinkDeputy: (...a: unknown[]) => unlink(...a),
  saveDeputy: vi.fn(),
  deleteDeputy: vi.fn(),
  deputiesUnavailable: () => false,
}));

import { DeputiesSection } from '../DeputiesSection';

const base = { band_id: 'b1', instrument: 'bass', phone: '+1 212 555 0100', email: null, notes: null, default_fee: null };

describe('DeputiesSection: revoke sent links', () => {
  beforeEach(() => {
    list.mockReset();
    unlink.mockReset();
    getOne.mockReset();
    // By default the deputy is as the list showed them.
    getOne.mockImplementation(async (id: string) => {
      const { data } = await list();
      return { data: data.find((d: { id: string }) => d.id === id) ?? null, error: null };
    });
  });

  it('offers to revoke the links of a deputy without an account', async () => {
    list.mockResolvedValue({ data: [{ ...base, id: 'd1', name: 'Sam Rivera', user_id: null }], error: null });
    unlink.mockResolvedValue({ data: 'revoked', error: null });
    render(<DeputiesSection bandId="b1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Sam Rivera/ }));
    expect(screen.queryByRole('button', { name: 'Unlink account' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke sent links' }));
    expect(screen.getByText('Revoke sent links?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(unlink).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText('Links revoked. The next request you send carries a new one.')).toBeTruthy();
  });

  it('keeps Unlink account for a linked deputy, without the second button', async () => {
    list.mockResolvedValue({ data: [{ ...base, id: 'd2', name: 'Alex Kim', user_id: 'u9' }], error: null });
    render(<DeputiesSection bandId="b1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Alex Kim/ }));
    expect(screen.getByRole('button', { name: 'Unlink account' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke sent links' })).toBeNull();
  });

  // Codex review #285 round 4 (B2): a server before 182 answers 'not_linked'
  // and rotates nothing; without the function at all it errors. Neither is
  // a success.
  it.each([
    ['a server before 182', { data: 'not_linked', error: null }],
    ['no such function', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.bw_deputy_unlink' } }],
    ['an empty answer', { data: null, error: null }],
  ])('%s: an error, never "Links revoked"', async (_name, answer) => {
    list.mockResolvedValue({ data: [{ ...base, id: 'd1', name: 'Sam Rivera', user_id: null }], error: null });
    unlink.mockResolvedValue(answer);
    render(<DeputiesSection bandId="b1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Sam Rivera/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke sent links' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not revoke the links. Try again.')).toBeTruthy();
    expect(screen.queryByText('Links revoked. The next request you send carries a new one.')).toBeNull();
  });

  // Codex review #285 round 5: the deputy joined from the app while the
  // sheet was open. Revoke would unlink their account: the sheet shows the
  // new state and asks again, never unlinks without saying so.
  it('a deputy who joined meanwhile: nothing is unlinked, the sheet shows it and asks again', async () => {
    list.mockResolvedValue({ data: [{ ...base, id: 'd1', name: 'Sam Rivera', user_id: null }], error: null });
    getOne.mockResolvedValue({ data: { ...base, id: 'd1', name: 'Sam Rivera', user_id: 'u9' }, error: null });
    render(<DeputiesSection bandId="b1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Sam Rivera/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke sent links' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Sam Rivera just joined from the app. Their account is below: choose again.')).toBeTruthy();
    expect(unlink).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Unlink account' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke sent links' })).toBeNull();
  });

  it('joined in the last moment (the server unlinked too): the sheet says so', async () => {
    list.mockResolvedValue({ data: [{ ...base, id: 'd1', name: 'Sam Rivera', user_id: null }], error: null });
    unlink.mockResolvedValue({ data: 'unlinked', error: null });
    render(<DeputiesSection bandId="b1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Sam Rivera/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke sent links' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Sam Rivera had just joined from the app: their account is unlinked too, and the links are revoked.')).toBeTruthy();
    expect(screen.queryByText('Links revoked. The next request you send carries a new one.')).toBeNull();
  });

  it('says so when revoking fails', async () => {
    list.mockResolvedValue({ data: [{ ...base, id: 'd1', name: 'Sam Rivera', user_id: null }], error: null });
    unlink.mockResolvedValue({ data: null, error: { message: 'boom' } });
    render(<DeputiesSection bandId="b1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Sam Rivera/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke sent links' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not revoke the links. Try again.')).toBeTruthy();
  });
});

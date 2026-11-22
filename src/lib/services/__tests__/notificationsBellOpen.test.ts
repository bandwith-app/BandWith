/**
 * Audit 07 #10: 21 unread inbox items; the bell loads and counts the newest
 * 20, and opening it marked every unread row read, also the unseen 21st.
 * Now the unread items older than the page come with the list, and opening
 * the bell marks only the items it shows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import appSource from '@/app/AuthenticatedApp.tsx?raw';

type Call = [string, ...unknown[]];
const h = vi.hoisted(() => ({ chains: [] as Call[][], pages: [] as unknown[][] }));

vi.mock('@/lib/supabase', () => {
  const chain = () => {
    const calls: Call[] = [];
    h.chains.push(calls);
    const page = h.pages.shift() ?? [];
    const proxy: any = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'then') {
            const p = Promise.resolve({ data: page, error: null });
            return p.then.bind(p);
          }
          return (...args: unknown[]) => {
            calls.push([prop, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  return { supabase: { from: () => chain() }, getSafeUser: async () => ({ data: { user: { id: 'u1' } } }) };
});

import { getNotifications, markIdsAsRead, unreadInboxIds } from '../notifications';

const at = (i: number) => new Date(Date.UTC(2026, 10, 21, 12, 0) - i * 60_000).toISOString();
const row = (i: number, read = false, type = 'event_update') => ({ id: `n${i}`, type, title: `Item ${i}`, read, created_at: at(i), data: {} });

beforeEach(() => {
  h.chains.length = 0;
  h.pages.length = 0;
});

describe('bell: unread items it would not show', () => {
  it('a full page brings the older unread items too', async () => {
    h.pages.push(Array.from({ length: 20 }, (_, i) => row(i, i % 2 === 0)), [row(20)]);
    const { data } = await getNotifications({ limit: 20, excludeChat: true, withOlderUnread: 100 });
    expect(data?.map((n) => n.id)).toContain('n20');
    const older = h.chains[1];
    expect(older).toContainEqual(['eq', 'read', false]);
    expect(older).toContainEqual(['lte', 'created_at', at(19)]);
    expect(older).toContainEqual(['not', 'type', 'in', '(chat_message,chat_mention)']);
    expect(older).toContainEqual(['limit', 100]);
  });

  // Codex review #291: unread rows with the same time as the 20th row fell
  // between the page and the older request.
  it('unread rows sharing the last row’s time are not lost', async () => {
    const page = Array.from({ length: 20 }, (_, i) => row(i, true));
    const twin = { ...row(19), id: 'n19b' };
    h.pages.push(page, [page[19], twin]);
    const { data } = await getNotifications({ limit: 20, excludeChat: true, withOlderUnread: 100 });
    expect(h.chains[1]).toContainEqual(['lte', 'created_at', at(19)]);
    expect(data?.filter((n) => n.id === 'n19b')).toHaveLength(1);
    expect(data?.filter((n) => n.id === 'n19')).toHaveLength(1);
  });

  it('no second request when the page is not full', async () => {
    h.pages.push([row(0), row(1)]);
    await getNotifications({ limit: 20, excludeChat: true, withOlderUnread: 100 });
    expect(h.chains).toHaveLength(1);
  });

  it('opening the bell marks only the unread inbox items it shows', async () => {
    const shown = [row(0), row(1, true), row(2, false, 'chat_message'), row(3)];
    expect(unreadInboxIds(shown)).toEqual(['n0', 'n3']);
    await markIdsAsRead(['n0', 'n3']);
    expect(h.chains[0]).toContainEqual(['in', 'id', ['n0', 'n3']]);
    expect(h.chains[0]).toContainEqual(['eq', 'user_id', 'u1']);
  });

  it('the app marks the shown ids, not every unread row', () => {
    const open = appSource.slice(appSource.indexOf('const handleOpenNotifications'), appSource.indexOf('// Computed values'));
    expect(open).toMatch(/markIdsAsRead\(shown\)/);
    expect(open).not.toMatch(/markAllNotificationsAsRead\(/);
    expect(appSource).toMatch(/withOlderUnread: 100/);
  });
});

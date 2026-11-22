/**
 * Every layer the app puts on <body> (createPortal), checked against the
 * focus trap (src/lib/focusTrap.ts): a layer that can open above a sheet or
 * the iPad composer must be a dialog (role="dialog" / aria-modal, or a
 * BwSheet), so the trap hands focus over to it. The others are listed with
 * the reason they never need focus there. A new portal must be added here.
 */
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob(['/src/**/*.tsx', '!/src/**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DIALOG = /role="(?:alert)?dialog"|aria-modal="true"|<BwSheet\b/;

type Kind = 'dialog' | { via: string; file: string } | { not: string };

const PORTALS: Record<string, Kind> = {
  // Dialogs (the trap hands over when they open above it).
  '/src/app/components/bw/Screen.tsx': 'dialog',
  '/src/app/components/event/rider/InputListEditor.tsx': 'dialog',
  '/src/app/components/ui/MapsLink.tsx': 'dialog',
  '/src/app/components/academy/AcademySheet.tsx': 'dialog',
  '/src/app/components/legal/LegalSheet.tsx': 'dialog',
  '/src/app/components/settings/AnalyticsConsentSheet.tsx': 'dialog',
  '/src/app/components/layout/UpdateRequired.tsx': 'dialog',
  '/src/app/components/layout/SwitchBandPopup.tsx': 'dialog',
  '/src/app/components/chat/DeleteChatSheet.tsx': 'dialog',
  '/src/app/components/quotes/BandPricingModal.tsx': 'dialog',
  '/src/app/components/quotes/QuoteShareModal.tsx': 'dialog',
  '/src/app/components/band/MemberDetail.tsx': 'dialog',
  '/src/app/components/dashboard/StageSongOnly.tsx': 'dialog',
  '/src/app/components/songs/ChordEditor.tsx': 'dialog',
  '/src/app/components/songs/SongSuggestionsView.tsx': 'dialog',
  '/src/app/components/songs/PersonalLayer.tsx': 'dialog',
  '/src/app/views/EventsView.tsx': 'dialog',
  '/src/app/components/event/GigSetlistEditor.tsx': { via: 'SongPicker', file: '/src/app/components/ui/SongPicker.tsx' },
  '/src/app/views/SetlistManagerView.tsx': { via: 'AddSongModal', file: '/src/app/components/rehearsal/AddSongModal.tsx' },
  // Not above a sheet or the composer.
  '/src/app/components/ui/SortableSongList.tsx': { not: 'the drag preview of a song: no controls' },
  '/src/app/components/duo/modes/FloorWedgeMode.tsx': { not: 'the click flash of Stage mode: no controls' },
  '/src/app/components/duo/FoldSplit.tsx': { not: 'Duo fold layout of a screen, not a layer above one' },
  '/src/app/components/duo/companion.tsx': { not: 'Duo leading-page companion beside the screen' },
  '/src/app/components/chat/ChatDetailModal.tsx': { not: 'event context pane beside a chat (Duo / iPad page)' },
  '/src/app/views/AnalyticsView.tsx': { not: 'Duo trailing page of Analytics' },
  '/src/app/views/TaskTemplatesView.tsx': { not: 'to-do list form, opened from its hub page' },
  '/src/app/views/ContractsView.tsx': { not: 'document form, opened from its hub page' },
  '/src/app/views/InventoryView.tsx': { not: 'kit detail, opened from the gear hub page' },
  '/src/app/components/dashboard/expanded/QuotesExpanded.tsx': {
    not: 'quote wizard and detail, opened from the Quotes card (the tablet wizard is a ComposerShell)',
  },
};

describe('portal layers and the focus trap', () => {
  it('every createPortal is listed', () => {
    const files = Object.entries(SOURCES)
      .filter(([, text]) => text.includes('createPortal('))
      .map(([f]) => f)
      .sort();
    expect(files).toEqual(Object.keys(PORTALS).sort());
  });

  for (const [file, kind] of Object.entries(PORTALS)) {
    if (typeof kind === 'object' && 'not' in kind) continue;
    it(`${file.replace('/src/', '')} opens a dialog the trap hands over to`, () => {
      if (kind === 'dialog') expect(SOURCES[file]).toMatch(DIALOG);
      else {
        expect(SOURCES[file]).toContain(`<${kind.via}`);
        expect(SOURCES[kind.file]).toMatch(DIALOG);
      }
    });
  }

  it('the composer and the sheet are trapped layers', () => {
    expect(SOURCES['/src/app/components/composer/Composer.tsx']).toContain('useFocusTrap(');
    expect(SOURCES['/src/app/components/bw/Screen.tsx']).toContain('useFocusTrap(');
  });
});

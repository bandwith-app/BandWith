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

/**
 * Layers rendered in place (no portal): full-screen modals, the band invite
 * cards and confirm cards inside a card. The trap takes over a modal one only
 * when it is shown above the top layer; it ignores aria-modal="false" cards
 * (an invite arriving under a sheet's scrim) and counts what sits inside a
 * trapped layer as part of it.
 */
type InPlace = 'modal' | { nonModal: string } | { inline: string };
const IN_PLACE: Record<string, InPlace> = {
  '/src/app/components/composer/Composer.tsx': 'modal',
  '/src/app/components/ui/LyricsViewer.tsx': 'modal',
  '/src/app/components/chat/NewChatModal.tsx': 'modal',
  '/src/app/components/modals/PersonalGigModal.tsx': 'modal',
  '/src/app/components/modals/ChooseBandProposalModal.tsx': 'modal',
  '/src/app/components/modals/NoBandRehearsalModal.tsx': 'modal',
  '/src/app/components/rehearsal/RehearsalPollVoteSheet.tsx': 'modal',
  '/src/app/components/rehearsal/ProposeRehearsalModal.tsx': 'modal',
  '/src/app/components/rehearsal/AddSongModal.tsx': 'modal',
  '/src/app/components/rehearsal/RehearsalPollModal.tsx': 'modal',
  '/src/app/components/dashboard/RehearsalSession.tsx': 'modal',
  '/src/app/components/dashboard/StageRegia.tsx': 'modal',
  '/src/app/components/dashboard/StageMode.tsx': 'modal',
  '/src/app/components/deputy/DeputyGigsScreen.tsx': 'modal',
  '/src/app/components/event/rider/RiderStage.tsx': 'modal',
  '/src/app/components/notifications/EventRSVPSheet.tsx': 'modal',
  '/src/app/components/onboarding/WelcomeScreen.tsx': 'modal',
  '/src/app/components/onboarding/SignInScreen.tsx': 'modal',
  '/src/app/components/onboarding/RoleTourModal.tsx': 'modal',
  '/src/app/components/onboarding/OnboardingChrome.tsx': 'modal',
  '/src/app/views/SettingsView.tsx': 'modal',
  '/src/app/components/profile/CreateBandModal.tsx': 'modal',
  '/src/app/components/notifications/NotificationDetailModal.tsx': 'modal',
  '/src/app/components/gear/KitDetail.tsx': 'modal',
  '/src/app/components/notifications/PendingInvitesPrompt.tsx': { nonModal: 'band invite card: can arrive while a sheet is open' },
  '/src/app/components/notifications/InviteLinkNotice.tsx': { nonModal: 'invite link card: can arrive while a sheet is open' },
  '/src/app/components/quotes/QuoteClientLink.tsx': { inline: 'confirm card inside the quote detail' },
  '/src/app/components/rehearsal/RehearsalPollCard.tsx': { inline: 'withdraw confirm inside the poll card' },
  '/src/app/components/rehearsal/ProposalDeclinePanel.tsx': { inline: 'decline confirm inside the proposal' },
};

/**
 * Menus and lists rendered inside the screen or layer that opens them: for
 * the trap they belong to that layer (a list on <body> belongs to it through
 * aria-controls), so they never switch its Tab cycle off.
 */
const POPOVERS: Record<string, { inline: string; controls?: true }> = {
  '/src/app/components/ui/VenueAutocomplete.tsx': { inline: 'venue suggestions under the field', controls: true },
  '/src/app/components/band/PendingInvitesSection.tsx': { inline: 'invite row actions' },
  '/src/app/components/event/rider/StagePlotView.tsx': { inline: '"Add here" on the stage' },
  '/src/app/views/BandMembersView.tsx': { inline: 'member row actions' },
  '/src/app/views/ContractsView.tsx': { inline: 'document row menu' },
  '/src/app/views/SetlistManagerView.tsx': { inline: 'setlist row menu' },
  '/src/app/views/TaskTemplatesView.tsx': { inline: 'to-do list row menu' },
};

/**
 * Every layer: a file named like one (…Modal, …Sheet, …Dialog, …Popup,
 * …Prompt, …Notice, …Overlay, …Drawer) or with a full-screen fixed element
 * (`fixed inset-0`). It must say what it is to the trap: a dialog (role,
 * aria-modal="true", or a dialog component such as BwSheet) or explicitly
 * not modal (aria-modal="false"). Otherwise it is listed here with the reason
 * it never opens above a sheet. A new layer fails until it is one of these.
 */
const LAYER_NAME = /(?:Modal|Sheet|Dialog|Popup|Prompt|Notice|Overlay|Drawer)\.tsx$/;
const SAYS_WHAT_IT_IS =
  /role="(?:alert)?dialog"|role=\{[^}]*dialog|aria-modal=|<(?:BwSheet|ComposerShell|OnboardingSheet)\b|(?:Dialog|AlertDialog|Drawer|Sheet)Primitive\./;
const NOT_A_LAYER_ABOVE_A_SHEET: Record<string, string> = {
  '/src/app/AuthenticatedApp.tsx': 'the app background, and the demo-chat notice opened from the chat list page',
  '/src/app/auth/callback.tsx': 'sign-in callback page, before the app',
  '/src/app/components/ui/ErrorBoundary.tsx': 'error page in place of the app',
  '/src/app/components/dashboard/StageClick.tsx': 'aria-hidden click flash of Stage mode, no controls',
  '/src/app/components/notifications/UrgentNotificationPopup.tsx':
    'role="alert" card that waits until no layer is open (#271); a dialog role would make it wait for itself',
  '/src/app/components/chat/ChatDetailModal.tsx': 'chat page, opened from the chat list page',
  '/src/app/components/quotes/QuoteDetailModal.tsx': 'quote page, opened from the Quotes hub',
  '/src/app/components/profile/EditProfileModal.tsx': 'profile page, opened from the identity hub',
  '/src/app/components/layout/IdentityHub.tsx': 'identity hub page',
  '/src/app/components/dashboard/expanded/ExpandedCardWrapper.tsx': 'hub page of a Home card',
  '/src/app/views/AnalyticsView.tsx': 'Analytics hub page',
  '/src/app/views/PastEventsView.tsx': 'past events hub page',
};

describe('every layer says what it is to the focus trap', () => {
  const layers = Object.entries(SOURCES)
    .filter(([f, text]) => LAYER_NAME.test(f) || /fixed inset-0/.test(text))
    .map(([f]) => f)
    .sort();

  it('found the layers', () => {
    expect(layers.length).toBeGreaterThan(40);
  });

  it('each is a dialog, explicitly not modal, or listed with its reason', () => {
    const unknown = layers.filter((f) => !SAYS_WHAT_IT_IS.test(SOURCES[f]) && !(f in NOT_A_LAYER_ABOVE_A_SHEET));
    expect(unknown).toEqual([]);
  });

  it('the list holds no file that already says what it is, or is gone', () => {
    const stale = Object.keys(NOT_A_LAYER_ABOVE_A_SHEET).filter((f) => !SOURCES[f] || SAYS_WHAT_IT_IS.test(SOURCES[f]));
    expect(stale).toEqual([]);
  });

  it('the inbox (every layout) and a kit page are modal dialogs: the bell can open them over a sheet', () => {
    const modal = /role="dialog"\s+aria-modal="true"/g;
    expect(SOURCES['/src/app/components/notifications/NotificationDetailModal.tsx'].match(modal)).toHaveLength(3);
    expect(SOURCES['/src/app/components/gear/KitDetail.tsx'].match(modal)).toHaveLength(1);
  });

  it('the urgent pop-up stays out of the layers #271 waits for (else it would wait for itself)', () => {
    // useLayerOpen (#271) watches [role="dialog"], [role="alertdialog"], [aria-modal="true"].
    expect(SOURCES['/src/app/components/notifications/UrgentNotificationPopup.tsx']).not.toMatch(/role="(?:alert)?dialog"|aria-modal="true"/);
  });

  it('Create band is a modal dialog (it opens beside the docked band switcher on the Duo)', () => {
    expect(SOURCES['/src/app/components/profile/CreateBandModal.tsx']).toMatch(/role="dialog"[\s\S]{0,40}aria-modal="true"/);
  });
});

describe('layers rendered in place and the focus trap', () => {
  it('every dialog without a portal is listed', () => {
    const files = Object.entries(SOURCES)
      .filter(([, text]) => !text.includes('createPortal(') && /role="(?:alert)?dialog"|aria-modal/.test(text))
      .map(([f]) => f)
      .sort();
    expect(files).toEqual(Object.keys(IN_PLACE).sort());
  });

  for (const [file, kind] of Object.entries(IN_PLACE)) {
    it(`${file.replace('/src/', '')}: ${kind === 'modal' ? 'modal' : 'nonModal' in kind ? 'not modal' : 'inline'}`, () => {
      const text = SOURCES[file];
      if (kind === 'modal') expect(text).toContain('aria-modal="true"');
      else if ('nonModal' in kind) {
        expect(text).toContain('aria-modal="false"');
        expect(text).not.toContain('aria-modal="true"');
      } else expect(text).not.toMatch(/aria-modal/);
    });
  }

  it('every menu and list is listed', () => {
    const files = Object.entries(SOURCES)
      .filter(([, text]) => /role="(?:listbox|menu)"/.test(text))
      .map(([f]) => f)
      .sort();
    expect(files).toEqual(Object.keys(POPOVERS).sort());
  });

  for (const [file, kind] of Object.entries(POPOVERS))
    if (kind.controls)
      it(`${file.replace('/src/', '')}: the field points at its list`, () => {
        expect(SOURCES[file]).toMatch(/aria-controls=/);
      });
});

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

import React, { useState, useEffect, useRef, useId } from 'react';
import { MapPin, Loader2 } from '@/app/components/icons';
import { cn } from './utils';
import { searchVenues, getGooglePlaceDetails, rememberPickedPlace, venueFields, type VenuePlace } from '@/lib/services/location';
import { useT } from '@/lib/i18n';

const newSessionToken = (): string | undefined => {
  try {
    return crypto.randomUUID();
  } catch {
    return undefined;
  }
};

export interface VenueAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (place: VenuePlace) => void;
  placeholder?: string;
  className?: string;
  containerClassName?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  /** Title of the suggestion list (default "Suggested venues"). */
  heading?: string;
  /** id for the input, so an external <label htmlFor> can point at it. */
  inputId?: string;
}

export const VenueAutocomplete: React.FC<VenueAutocompleteProps> = ({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  containerClassName,
  disabled = false,
  autoFocus = false,
  required = false,
  heading,
  inputId,
}) => {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<VenuePlace[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Read out by screen readers when a venue is picked (the list closes).
  const [announce, setAnnounce] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // One Google session from the first keystroke to the pick (billed as one search).
  const sessionTokenRef = useRef<string | undefined>(undefined);
  const listboxId = useId();
  // Where a touch on a suggestion started: a tap picks it, a scroll doesn't.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Debounced search when user types
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    onChange(query);
    setHighlightedIndex(-1);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    sessionTokenRef.current ??= newSessionToken();
    const sessionToken = sessionTokenRef.current;
    setIsLoading(true);
    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const results = await searchVenues(query, controller.signal, { sessionToken });
        setSuggestions(results);
        setIsOpen(results.length > 0);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('[VenueAutocomplete] Error fetching suggestions:', err);
          setSuggestions([]);
        }
      } finally {
        setIsLoading(false);
      }
    }, 280);
  };

  const handleSelectPlace = async (place: VenuePlace) => {
    let selectedPlace = place;
    if (place.provider === 'google' && place.placeId && (!place.latitude || !place.city || !place.address)) {
      try {
        const details = await getGooglePlaceDetails(place.placeId, undefined, sessionTokenRef.current);
        if (details) {
          selectedPlace = {
            ...place,
            ...details,
            // Keep user-friendly display name if details name is available
            name: details.name || place.name,
          };
        }
      } catch (err) {
        console.warn('[VenueAutocomplete] Could not fetch place details:', err);
      }
    }
    sessionTokenRef.current = undefined;
    rememberPickedPlace(selectedPlace);
    onChange(venueFields(selectedPlace).location);
    setAnnounce(t('Venue chosen: {name}', { name: venueFields(selectedPlace).location }));
    onSelect(selectedPlace);
    setIsOpen(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          handleSelectPlace(suggestions[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      case 'Tab':
        // Leaving the field picks the highlighted venue (ARIA 1.2 combobox),
        // or just closes the list; focus moves on as usual.
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) handleSelectPlace(suggestions[highlightedIndex]);
        else setIsOpen(false);
        break;
    }
  };

  const optionId = (idx: number) => `${listboxId}-option-${idx}`;
  const activeOption = isOpen && highlightedIndex >= 0 && highlightedIndex < suggestions.length ? highlightedIndex : -1;

  return (
    <div ref={containerRef} className={cn('relative w-full', containerClassName)}>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder ?? t('Venue name')}
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          autoFocus={autoFocus}
          required={required}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={activeOption >= 0 ? optionId(activeOption) : undefined}
          className={cn(
            'w-full bg-transparent bw-body-lg text-foreground focus:outline-none placeholder:text-muted-foreground/60 transition-colors pr-8',
            className
          )}
        />

        {/* Loading or Clear action indicator */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
          {isLoading && (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" aria-label={t('Searching')} />
          )}
        </div>
      </div>

      {/* Suggestions: dark sheet list (Figma Picker sheets: bg/sheet, radius 24, pill rows) */}
      {isOpen && suggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 left-0 right-0 top-full mt-2 p-2 bg-sheet text-sheet-foreground rounded-3xl shadow-[0_12px_32px_rgba(0,0,0,0.14)] max-h-72 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="px-3 pt-2 pb-2 flex items-center justify-between gap-3">
            <span className="bw-label-sm text-sheet-foreground/85">{heading ?? t('Suggested venues')}</span>
            <span className="bw-label-xs text-sheet-foreground/60">
              {suggestions[0]?.provider === 'google' ? 'Google Maps' : 'OpenStreetMap'}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {suggestions.map((item, idx) => {
              const isSelected = idx === highlightedIndex;
              // Same split the form gets: title = Location, subtext = Address.
              const { location: title, address: subtext } = venueFields(item);

              return (
                <button
                  key={`${item.placeId || item.name}-${idx}`}
                  type="button"
                  id={optionId(idx)}
                  role="option"
                  aria-selected={isSelected}
                  // The field keeps focus; arrows move the highlight (aria-activedescendant).
                  tabIndex={-1}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => handleSelectPlace(item)}
                  // iOS with the keyboard up: the tap only blurs the field (the
                  // keyboard closes, no click follows), so a tap picks on touchend.
                  // preventDefault there also stops the click that would follow.
                  onTouchStart={(e) => {
                    const p = e.touches[0];
                    touchStartRef.current = p ? { x: p.clientX, y: p.clientY } : null;
                  }}
                  onTouchEnd={(e) => {
                    const start = touchStartRef.current;
                    const p = e.changedTouches[0];
                    touchStartRef.current = null;
                    if (!start || !p || Math.abs(p.clientX - start.x) > 10 || Math.abs(p.clientY - start.y) > 10) return;
                    e.preventDefault();
                    handleSelectPlace(item);
                  }}
                  className={cn(
                    'w-full text-left p-3 rounded-full flex items-center gap-3 transition-colors',
                    isSelected ? 'bg-sheet-foreground/[0.08]' : 'hover:bg-sheet-foreground/[0.08]'
                  )}
                >
                  <MapPin className="w-5 h-5 shrink-0 text-sheet-foreground/85" aria-hidden />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="bw-label-md text-sheet-foreground truncate">{title}</span>
                    {subtext && <span className="bw-body-sm text-sheet-foreground/70 truncate">{subtext}</span>}
                  </span>
                  <span className="bw-label-xs text-sheet-foreground/60 shrink-0">
                    {item.provider === 'google' ? 'Google' : t('Map')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

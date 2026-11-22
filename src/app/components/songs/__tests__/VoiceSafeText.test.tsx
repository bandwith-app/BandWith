import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useVoiceSafeText, VoicePartsKept } from '../VoiceSafeText';

// A plain text box over marked lyrics: no {bv} markers on screen, the parts
// stay with their lines. Made-up lyrics (New York).
const SONG = '# Chorus\n[C]Paper boats\n{bv}(ooh, yeah){/bv}\n{all}All the way home{/all}';

let saved = '';
const Box: React.FC<{ initial: string }> = ({ initial }) => {
  const [lyrics, setLyrics] = React.useState(initial);
  saved = lyrics;
  const field = useVoiceSafeText(lyrics, setLyrics);
  return (
    <>
      <textarea aria-label="Lyrics" {...field} />
      <VoicePartsKept lyrics={lyrics} />
    </>
  );
};

afterEach(cleanup);

describe('lyrics in a plain text box', () => {
  it('shows no markers, keeps the parts while typing, and says so', () => {
    render(<Box initial={SONG} />);
    const box = screen.getByRole('textbox', { name: 'Lyrics' }) as HTMLTextAreaElement;
    expect(box.value).toBe('# Chorus\n[C]Paper boats\n(ooh, yeah)\nAll the way home');
    expect(screen.getByRole('status')).toHaveTextContent('2 lines have a voice part. They stay on their lines when you edit the words.');
    fireEvent.change(box, { target: { value: '# Chorus\n[C]Paper boats on the river\n(ooh, yeah)\nAll the way home tonight' } });
    expect(box.value).toBe('# Chorus\n[C]Paper boats on the river\n(ooh, yeah)\nAll the way home tonight');
    expect(saved).toBe('# Chorus\n[C]Paper boats on the river\n{bv}(ooh, yeah){/bv}\n{all}All the way home tonight{/all}');
  });

  it('says nothing when the song has no parts', () => {
    render(<Box initial={'# Verse\nPaper boats'} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('one line: singular', () => {
    render(<Box initial={'{bv}(ooh){/bv}'} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 line has a voice part. It stays on its line when you edit the words.');
  });
});

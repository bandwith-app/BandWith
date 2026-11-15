import type { AreaText } from './types';

/**
 * The translated texts for the reader's language, set by src/main.tsx before
 * the guide (and so ./index.ts) loads. null = English.
 */
let texts: AreaText[] | null = null;

export const setTexts = (t: AreaText[] | null) => {
  texts = t;
};

export const getTexts = () => texts;

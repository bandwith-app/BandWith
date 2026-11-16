import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Inline, plain } from '../../academy/src/inline';

// Required fields are written as **Song title \*** in the Academy content: the
// label must keep its asterisk, without the backslash or a stray "*".
describe('Academy inline labels', () => {
  it('renders a required-field label with its asterisk, not a backslash', () => {
    const html = renderToStaticMarkup(createElement(Inline, { text: 'Type the **Song title \\***, then **Save**.' }));
    expect(html).toBe('Type the <strong class="ui">Song title *</strong>, then <strong class="ui">Save</strong>.');
  });

  it('gives the plain text of a required-field label without the escape', () => {
    expect(plain('Check the **Document title \\*** and **Client email**.')).toBe('Check the Document title * and Client email.');
  });
});

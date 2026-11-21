// jsdom ships no types and @types/jsdom isn't installed: what tools/i18n.ts uses.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    window: Window & typeof globalThis;
    serialize(): string;
  }
}

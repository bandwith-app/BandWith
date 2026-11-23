# Handbook PDF: BandWith · Features and behavior

The handbook of every BandWith feature and behavior, built as one PDF to attach to an email. One generator makes two editions:

- Italian: *BandWith · Funzioni e comportamenti*;
- English: *BandWith · Features and behavior*, in American English. Labels the app shows stay exactly as in the app, even where the app still uses a British spelling (for example `Gig cancelled`).

## Rebuild

From the repo root, set up once:

```sh
python3 -m venv docs/handbook/.venv && docs/handbook/.venv/bin/pip install -r docs/handbook/requirements.txt
```

Then build either edition:

```sh
docs/handbook/.venv/bin/python docs/handbook/build.py --lang it   # out/BandWith-funzioni-e-comportamenti.pdf
docs/handbook/.venv/bin/python docs/handbook/build.py --lang en   # out/BandWith-features-and-behavior.pdf
```

`--lang` defaults to `it`. The PDFs are written to `docs/handbook/out/` (git-ignored, don't commit them).
Pass another path after the options to write the PDF elsewhere. It needs Google Chrome; set `CHROME` to use another binary.

Check the layout at a glance (4 × 3 pages per sheet). Pass the PDF and an output folder:

```sh
docs/handbook/.venv/bin/python docs/handbook/contact_sheet.py docs/handbook/out/BandWith-funzioni-e-comportamenti.pdf docs/handbook/out/contact-it
docs/handbook/.venv/bin/python docs/handbook/contact_sheet.py docs/handbook/out/BandWith-features-and-behavior.pdf docs/handbook/out/contact-en
```

With no arguments it renders the Italian PDF into `out/contact/`.

## How it works

- `it/` and `en/` hold the chapter fragments, `ch-*.html` and `glossary.html`, with the same file names, ids and structure. `build.py` sets the order in `CHAPTERS`.
- Every fixed string (cover, contents title, part names, running footer, role badges, device chips, note labels) is in `LANGS` in `build.py`. The footer reaches `doc.css` through its `{footer}` placeholder.
- Button and label names are always the English ones the app shows, highlighted: `<b class="ui">Save</b>`.
- Each Academy article has a heading with `id="art-<article id>"`. Both builds fail if an article in `academy/content/*.ts` has no section. The English build also fails if an article heading differs from the English Academy title.
- `data-roles="admin,member"` on a heading adds role badges. `<div class="devnote" data-devices="tablet,duoBook">` adds a device note.
- `<aside class="note tip|privacy|warning">` adds a labelled note.
- `<figure class="shot" data-shot="<id>" data-device="phone">` takes `academy/public/shots/<id>@<device>.webp`, converted to JPEG in `build/img/` (git-ignored). Both editions use the same screenshots. If that device is missing it falls back to another one, and the build reports it.
- `<a data-ref="<article id>">` links to that article's section.
- Chrome prints the PDF twice. Pass 1 reads back the page of each heading; pass 2 writes those page numbers in the clickable contents. The bookmarks come from the headings, without the role badges.
- The build stops with a list of problems: missing Academy articles, broken refs, unknown devices, shot fallbacks, duplicate ids or (English) article titles that differ from the Academy.

## Keeping it current

When Academy articles change, update the matching section in both `it/` and `en/` and rebuild both. The English edition follows the English Academy word for word where they overlap. The handbook describes how the app works today. It has no product status, known issues, roadmap or test process.

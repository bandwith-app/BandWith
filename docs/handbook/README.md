# Handbook PDF: BandWith · Funzioni e comportamenti

The Italian handbook of every BandWith feature and behaviour, built as one PDF to attach to an email.

## Rebuild

From the repo root:

```sh
python3 -m venv docs/handbook/.venv && docs/handbook/.venv/bin/pip install -r docs/handbook/requirements.txt && docs/handbook/.venv/bin/python docs/handbook/build.py
```

The PDF is written to `docs/handbook/out/BandWith-funzioni-e-comportamenti.pdf` (git-ignored, don't commit it).
Pass another path as the first argument to write it elsewhere. It needs Google Chrome; set `CHROME` to use another binary.

Check the layout at a glance (4 × 3 pages per sheet, written to `out/contact/`):

```sh
docs/handbook/.venv/bin/python docs/handbook/contact_sheet.py
```

## How it works

- `ch-*.html` and `glossary.html` are the chapter fragments, in Italian. `build.py` sets the order in `PARTS`.
- Button and label names stay in English as the app shows them: `<b class="ui">Save</b>`.
- Each Academy article has a heading with `id="art-<article id>"`. The build fails if an article in `academy/content/*.ts` has no section here.
- `data-roles="admin,member"` on a heading adds role badges. `<div class="devnote" data-devices="tablet,duoBook">` adds a device note.
- `<aside class="note tip|privacy|warning">` adds a labelled note.
- `<figure class="shot" data-shot="<id>" data-device="phone">` takes `academy/public/shots/<id>@<device>.webp`, converted to JPEG in `build/img/` (git-ignored). If that device is missing it falls back to another one, and the build reports it.
- `<a data-ref="<article id>">` links to that article's section.
- Chrome prints the PDF twice. Pass 1 reads back the page of each heading; pass 2 writes those page numbers in the clickable index. The bookmarks come from the headings.
- The build stops with a list of problems: missing Academy articles, broken refs, unknown devices, shot fallbacks or duplicate ids.

## Keeping it current

When Academy articles change, update the matching section here and rebuild. The handbook describes how the app works today. It has no product status, known issues, roadmap or test process.

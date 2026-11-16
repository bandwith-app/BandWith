"""Render every page of the handbook PDF into contact sheets, to check the layout at a glance.

usage: .venv/bin/python docs/handbook/contact_sheet.py [PDF] [OUT_DIR]
Writes OUT_DIR/sheet-01.png, sheet-02.png… (default: out/contact/), 4 × 3 pages per sheet,
each page labelled with its number.
"""
import os
import sys

import pypdfium2 as pdfium
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'BandWith-funzioni-e-comportamenti.pdf')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', 'contact')
COLS, ROWS, W = 4, 3, 420  # page thumbnail width in px

os.makedirs(OUT, exist_ok=True)
doc = pdfium.PdfDocument(PDF)
thumbs = []
for i in range(len(doc)):
    page = doc[i]
    img = page.render(scale=W / page.get_width()).to_pil().convert('RGB')
    thumbs.append(img)
h = max(t.height for t in thumbs)
per = COLS * ROWS
for s in range(0, len(thumbs), per):
    sheet = Image.new('RGB', (COLS * (W + 16) + 16, ROWS * (h + 40) + 16), '#c8cbc6')
    draw = ImageDraw.Draw(sheet)
    for k, t in enumerate(thumbs[s:s + per]):
        x = 16 + (k % COLS) * (W + 16)
        y = 16 + (k // COLS) * (h + 40)
        sheet.paste(t, (x, y + 24))
        draw.text((x, y + 4), f'p. {s + k + 1}', fill='#111')
    path = os.path.join(OUT, f'sheet-{s // per + 1:02d}.png')
    sheet.save(path)
    print(path)

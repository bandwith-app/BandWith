"""Assemble the BandWith handbook and print it to PDF, in Italian ("Funzioni e comportamenti")
or English ("Features and behaviour").

usage: .venv/bin/python docs/handbook/build.py [--lang it|en] [OUT.pdf]

Sources: the ch-*.html fragments and glossary.html in it/ or en/, doc.css, the logo in
public/brand and the Academy screenshots in academy/public/shots (converted to JPEG at build
time into build/, which is git-ignored). The PDF goes to out/ (git-ignored) unless OUT is given.
Both editions share the same chapters, ids, screenshots and checks; only the text differs.

Two passes: pass 1 prints with hidden markers in every heading and reads the page of each
marker back with pypdf; pass 2 prints again with those page numbers in the table of contents
(markers are absolutely positioned, so dropping them in pass 2 leaves the layout identical).
"""
import argparse
import html
import os
import re
import subprocess
import sys
import tempfile

from bs4 import BeautifulSoup
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, TextStringObject

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
SHOTS = os.path.join(REPO, 'academy', 'public', 'shots')
CONTENT = os.path.join(REPO, 'academy', 'content')
LOGO = os.path.join(REPO, 'public', 'brand', 'bandwith-logo.svg')
BUILD = os.path.join(HERE, 'build')
IMG = os.path.join(BUILD, 'img')
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
JPEG_QUALITY = 82

CHAPTERS = [
    ('I', ['ch-intro']),
    ('II', ['ch-devices']),
    ('III', ['ch-basics', 'ch-gigs', 'ch-business', 'ch-together', 'ch-music', 'ch-people']),
    ('IV', ['ch-external']),
    ('', ['ch-tech', 'glossary']),
]

# Every fixed string of an edition. The chapter text lives in <lang>/*.html.
LANGS = {
    'it': {
        'out': 'BandWith-funzioni-e-comportamenti.pdf',
        'title': 'BandWith · Funzioni e comportamenti',
        'parts': ['Panoramica', 'I terminali', 'Le funzioni', 'Fuori dall’app', 'Appendici'],
        'part': 'Parte',
        'toc': 'Indice',
        'dev': {
            'phone': 'Telefono', 'phoneLand': 'Telefono orizzontale', 'tablet': 'iPad / tablet',
            'duoClosed': 'Duo chiuso', 'duoBook': 'Duo Book', 'duoLaptop': 'Duo Laptop',
            'duoLand': 'Duo orizzontale', 'android': 'Android', 'web': 'Web',
        },
        'role': {'admin': 'Admin', 'member': 'Membro', 'deputy': 'Deputy'},
        'all_roles': 'Tutti i ruoli',
        'admin_only': 'Solo admin',
        'note': {'tip': 'Suggerimento', 'privacy': 'Privacy', 'warning': 'Attenzione', 'draft': 'Bozza'},
        'note_plain': 'Nota',
        'kicker': 'Documento funzionale',
        'cover_lines': ['Tutte le funzioni', 'e i comportamenti', 'di BandWith'],
        'cover_sub': 'Diviso per terminale: iPhone e Android, iPad e tablet, web,\n'
                     'iPhone Duo chiuso, Book, Laptop e orizzontale. Ruoli, privacy, pagine per clienti,\n'
                     'sostituti e locali, e una breve appendice tecnica.',
        'cover_foot': 'Novembre 2026 · app.bandwith.fun',
    },
    'en': {
        'out': 'BandWith-features-and-behaviour.pdf',
        'title': 'BandWith · Features and behaviour',
        'parts': ['Overview', 'Devices', 'Features', 'Outside the app', 'Appendices'],
        'part': 'Part',
        'toc': 'Contents',
        'dev': {
            'phone': 'Phone', 'phoneLand': 'Phone landscape', 'tablet': 'iPad / tablet',
            'duoClosed': 'Duo closed', 'duoBook': 'Duo Book', 'duoLaptop': 'Duo Laptop',
            'duoLand': 'Duo landscape', 'android': 'Android', 'web': 'Web',
        },
        'role': {'admin': 'Admin', 'member': 'Member', 'deputy': 'Deputy'},
        'all_roles': 'All roles',
        'admin_only': 'Admin only',
        'note': {'tip': 'Tip', 'privacy': 'Privacy', 'warning': 'Watch out', 'draft': 'Draft'},
        'note_plain': 'Note',
        'kicker': 'Feature handbook',
        'cover_lines': ['Every feature', 'of BandWith', 'and how it behaves'],
        'cover_sub': 'Organised by device: iPhone and Android, iPad and tablets, the web,\n'
                     'iPhone Duo closed, Book, Laptop and landscape. Roles, privacy, the pages for clients,\n'
                     'deputies and venues, and a short technical appendix.',
        'cover_foot': 'November 2026 · app.bandwith.fun',
    },
}
L = dict(LANGS['it'], code='it')  # set by main()
BADGES = set()  # role badges printed on headings, to drop from the bookmarks
SHOT_FALLBACK = ['phone', 'tablet', 'web', 'duoBook', 'duoClosed', 'duoLaptop']
TALL = {'phone', 'duoClosed', 'duoLaptop'}


def shot_src(sid, dev):
    """JPEG copy of an Academy screenshot, for the device asked or the nearest one."""
    order = [dev] + [d for d in SHOT_FALLBACK if d != dev]
    for d in order:
        src = os.path.join(SHOTS, f'{sid}@{d}.webp')
        if os.path.exists(src):
            out = os.path.join(IMG, f'{sid}@{d}.jpg')
            if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
                with Image.open(src) as im:
                    im.convert('RGB').save(out, 'JPEG', quality=JPEG_QUALITY, optimize=True)
            return out, d
    raise SystemExit(f'missing shot {sid}')


def academy_articles():
    """{article id: English title} of the Academy (academy/content/<area>.ts), in order.
    The translated Academies (academy/content/i18n/) reuse these ids."""
    arts = {}
    for area in ['basics', 'gigs', 'business', 'together', 'music', 'people']:
        src = open(os.path.join(CONTENT, area + '.ts'), encoding='utf-8').read()
        body = src.split('articles:', 1)[1].split('\n  faq:', 1)[0]
        for aid, q, title in re.findall(r'^\s+id: [\'"]([a-z0-9-]+)[\'"],\n\s+title: ([\'"])(.*?)\2,$', body, flags=re.M):
            arts[aid] = title.replace("\\'", "'").replace('\\"', '"')
    return arts


def roles_label(r):
    rs = [x for x in r.split(',') if x]
    if set(rs) == {'admin', 'member', 'deputy'}:
        return L['all_roles']
    if rs == ['admin']:
        return L['admin_only']
    return ' · '.join(L['role'][x] for x in rs)


def process(frag_html, used_shots, problems):
    soup = BeautifulSoup(frag_html, 'html.parser')
    for h in soup.find_all('h3'):
        if h.get('data-roles'):
            badge = soup.new_tag('span', attrs={'class': 'badge'})
            badge.string = roles_label(h['data-roles'])
            BADGES.add(badge.string)
            h.append(' ')
            h.append(badge)
    for d in soup.select('div.devnote'):
        chips = soup.new_tag('span', attrs={'class': 'chips'})
        for x in d.get('data-devices', '').split(','):
            x = x.strip()
            if x not in L['dev']:
                problems.append(f'unknown device {x}')
                continue
            c = soup.new_tag('span', attrs={'class': f'chip d-{x}'})
            c.string = L['dev'][x]
            chips.append(c)
        d.insert(0, chips)
    for r in soup.select('div.roles > div'):
        lab = soup.new_tag('span', attrs={'class': 'role-label'})
        lab.string = L['role'].get(r.get('data-role'), r.get('data-role'))
        r.insert(0, lab)
    for n in soup.select('aside.note'):
        tone = [c for c in n['class'] if c in L['note']]
        lab = soup.new_tag('span', attrs={'class': 'note-label'})
        lab.string = L['note'][tone[0]] if tone else L['note_plain']
        n.insert(0, lab)
    for f in soup.select('figure.shot'):
        sid, dev = f['data-shot'], f.get('data-device', 'phone')
        key = (sid, dev)
        if key in used_shots:
            f.decompose()
            continue
        used_shots.add(key)
        src, real = shot_src(sid, dev)
        if real != dev:
            problems.append(f'shot {sid}@{dev} -> {real}')
        f['class'] = f.get('class', []) + ['tall' if real in TALL else 'wide', f'd-{real}']
        img = soup.new_tag('img', attrs={'src': 'file://' + src, 'alt': ''})
        f.insert(0, img)
        cap = f.find('figcaption')
        if cap is not None:
            tag = soup.new_tag('span', attrs={'class': 'cap-dev'})
            tag.string = L['dev'][real] + ' · '
            cap.insert(0, tag)
    return soup


def cover_logo():
    svg = open(LOGO, encoding='utf-8').read()
    # the word mark is near-black on the light site; the cover is dark
    return svg.replace('fill="#050505"', 'fill="#FFFFFF"')


def marker_html(mk, pages):
    """Hidden page marker for pass 1; empty in pass 2 so it stays out of bookmarks and text."""
    return '' if pages else f'<span class="mk">{mk}</span>'


def build(markers, pages):
    used, problems = set(), []
    chapters, toc = [], []
    arts = academy_articles()
    n = 0
    for (pnum, ids), ptitle in zip(CHAPTERS, L['parts']):
        n += 1
        pid = f'part-{n}'
        mk = f'QQM{len(markers)}QQ'
        markers.append((mk, pid))
        label = f"{L['part']} {pnum}" if pnum else ''
        chapters.append(
            f'<section class="part" id="{pid}"><div class="part-inner">'
            f'<div class="part-num">{label}</div><h1 class="part-title">{ptitle}'
            f'{marker_html(mk, pages)}</h1></div></section>')
        toc.append(('part', pid, (label + ' · ' if label else '') + ptitle))
        for cid in ids:
            soup = process(open(os.path.join(HERE, L['code'], cid + '.html'), encoding='utf-8').read(), used, problems)
            sec = soup.find('section')
            if L['code'] == 'en':  # Part III follows the English Academy word for word: same article titles
                for h in sec.find_all('h3', id=re.compile('^art-')):
                    want = arts.get(h['id'][4:])
                    got = ''.join(t for t in h.find_all(string=True, recursive=False)).strip()
                    if want is not None and got != want:
                        problems.append(f'title of {h["id"]} is "{got}", the Academy says "{want}"')
            for h in sec.find_all(['h1', 'h2']):
                if h.name == 'h1':
                    hid = sec['id']
                else:
                    hid = h.get('id') or f'{sec["id"]}-s{len(markers)}'
                    h['id'] = hid
                mk = f'QQM{len(markers)}QQ'
                markers.append((mk, hid))
                if not pages:  # pass 1 only: pass 2 drops them (out of flow, so the layout is unchanged)
                    span = soup.new_tag('span', attrs={'class': 'mk'})
                    span.string = mk
                    h.append(span)
                toc.append(('h1' if h.name == 'h1' else 'h2', hid, h.get_text().replace(mk, '').strip()))
            chapters.append(str(soup))
    body = '\n'.join(chapters)
    all_ids = re.findall(r'id="([^"]+)"', body)
    ids = set(all_ids)
    dup = sorted({i for i in all_ids if all_ids.count(i) > 1})
    if dup:
        problems.append('duplicate ids: ' + ', '.join(dup))
    missing = [a for a in arts if f'art-{a}' not in ids]
    if missing:
        problems.append('Academy articles not covered: ' + ', '.join(missing))

    def ref(m):
        attrs, text = m.group(1), m.group(2)
        rid = re.search(r'data-ref="([^"]+)"', attrs).group(1)
        if f'art-{rid}' not in ids:
            problems.append(f'missing ref {rid}')
            return text
        return f'<a class="xref" href="#art-{rid}">{text}</a>'
    body = re.sub(r'<a ([^>]*data-ref="[^"]+"[^>]*)>(.*?)</a>', ref, body, flags=re.S)

    rows = []
    for kind, hid, text in toc:
        pg = pages.get(hid, '')
        rows.append(f'<li class="toc-{kind}"><a href="#{hid}"><span class="t">{html.escape(text)}</span>'
                    f'<span class="dots"></span><span class="pg">{pg}</span></a></li>')
    toc_html = f'<section class="toc" id="toc"><h1>{L["toc"]}</h1><ol>' + ''.join(rows) + '</ol></section>'
    lines = ' '.join(f'<span class="l">{x}</span>' for x in L['cover_lines'])
    cover = (f'''<section class="cover"><div class="cover-logo">{cover_logo()}</div>
<div class="cover-body"><div class="cover-kicker">{L['kicker']}</div>
<h1 class="cover-title">{lines}</h1>
<p class="cover-sub">{L['cover_sub']}</p></div>
<div class="cover-foot">{L['cover_foot']}</div></section>''')
    css = open(os.path.join(HERE, 'doc.css'), encoding='utf-8').read().replace('{footer}', L['title'])
    doc = (f'<!doctype html><html lang="{L["code"]}"><head><meta charset="utf-8"><title>{L["title"]}</title>'
           f'<style>{css}</style></head><body>{cover}{toc_html}{body}</body></html>')
    return doc, problems


def fix_outline(path, badges):
    """Clean up Chrome's bookmarks: it joins the cover title's lines without spaces, and it
    keeps the role badge of each article heading ("Sign in ALL ROLES"). Set the cover title
    whole and drop the badges."""
    w = PdfWriter(clone_from=path)
    first = w.root_object['/Outlines'].get_object()['/First'].get_object()
    first[NameObject('/Title')] = TextStringObject(' '.join(L['cover_lines']))
    tails = sorted({' ' + b.upper() for b in badges}, key=len, reverse=True)

    def walk(item):
        while item is not None:
            item = item.get_object()
            title = str(item.get('/Title', ''))
            for t in tails:
                if title.endswith(t):
                    item[NameObject('/Title')] = TextStringObject(title[:-len(t)])
                    break
            if '/First' in item:
                walk(item['/First'])
            item = item.get('/Next')
    walk(first)
    with open(path, 'wb') as f:
        w.write(f)


def print_pdf(doc, out):
    path = os.path.join(BUILD, L['code'], 'doc.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(doc)
    if os.path.exists(out):
        os.remove(out)
    # A throwaway profile, so a running Chrome doesn't take the job over. Headless Chrome can
    # hang for minutes in its teardown after writing the file, so stop it once it says so.
    log = []
    with tempfile.TemporaryDirectory() as profile:
        proc = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
                                 '--no-first-run', f'--user-data-dir={profile}',
                                 '--generate-pdf-document-outline', '--run-all-compositor-stages-before-draw',
                                 '--allow-file-access-from-files', '--virtual-time-budget=20000',
                                 f'--print-to-pdf={out}', 'file://' + path],
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        for line in proc.stderr:
            log.append(line)
            if 'bytes written to file' in line:
                break
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
    if not os.path.exists(out) or os.path.getsize(out) == 0:
        raise SystemExit('Chrome wrote no PDF:\n' + ''.join(log)[-2000:])


def main():
    global L
    ap = argparse.ArgumentParser(description='Build the BandWith handbook PDF.')
    ap.add_argument('--lang', choices=sorted(LANGS), default='it', help='edition (default: it)')
    ap.add_argument('out', nargs='?', help='output PDF (default: out/<edition name>.pdf)')
    args = ap.parse_args()
    L = dict(LANGS[args.lang], code=args.lang)
    out = os.path.abspath(args.out) if args.out else os.path.join(HERE, 'out', L['out'])
    os.makedirs(IMG, exist_ok=True)
    os.makedirs(os.path.join(BUILD, L['code']), exist_ok=True)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    markers = []
    doc, problems = build(markers, {})
    tmp = os.path.join(BUILD, L['code'], 'pass1.pdf')
    print_pdf(doc, tmp)
    pages = {}
    for i, p in enumerate(PdfReader(tmp).pages, 1):
        t = p.extract_text() or ''
        for mk, hid in markers:
            if hid not in pages and mk in t:
                pages[hid] = i
    unfound = [hid for mk, hid in markers if hid not in pages]
    doc, _ = build([], pages)
    print_pdf(doc, out)
    fix_outline(out, BADGES)
    size = os.path.getsize(out) / 1e6
    print(f'{out}\npages {len(PdfReader(out).pages)} · {size:.1f} MB · headings {len(markers)}'
          + (f' · no page for {unfound[:5]}' if unfound else ''))
    for p in sorted(set(problems)):
        print('!', p)
    if problems or unfound:
        sys.exit(1)


if __name__ == '__main__':
    main()

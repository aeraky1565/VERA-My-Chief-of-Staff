"""
Convert VERA_Documentation.md to a styled PDF.
Requires: pip install reportlab
"""

import re
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, HRFlowable, Preformatted
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus.flowables import KeepTogether

# ── Colour palette ────────────────────────────────────────────────────────────
VERA_PURPLE   = colors.HexColor('#6c63ff')
VERA_DARK_BG  = colors.HexColor('#1e1e2e')
VERA_DARK2    = colors.HexColor('#2d2d3f')
VERA_LIGHT_BG = colors.HexColor('#f5f4ff')
VERA_BORDER   = colors.HexColor('#e0deff')
CODE_BG       = colors.HexColor('#1e1e2e')
CODE_FG       = colors.HexColor('#cdd6f4')
TABLE_HEADER  = colors.HexColor('#6c63ff')
TABLE_ALT     = colors.HexColor('#f5f4ff')
TEXT_DARK     = colors.HexColor('#1a1a2e')
TEXT_MID      = colors.HexColor('#4a4a6a')
WHITE         = colors.white

# ── Styles ─────────────────────────────────────────────────────────────────────
def build_styles():
    base = getSampleStyleSheet()

    styles = {}

    styles['h1'] = ParagraphStyle(
        'h1', fontName='Helvetica-Bold', fontSize=22, leading=28,
        textColor=WHITE, spaceAfter=6, spaceBefore=0,
        backColor=VERA_PURPLE, leftIndent=-24, rightIndent=-24,
        borderPad=10,
    )
    styles['h2'] = ParagraphStyle(
        'h2', fontName='Helvetica-Bold', fontSize=15, leading=20,
        textColor=VERA_PURPLE, spaceBefore=18, spaceAfter=6,
        borderPad=0,
    )
    styles['h3'] = ParagraphStyle(
        'h3', fontName='Helvetica-Bold', fontSize=12, leading=16,
        textColor=TEXT_DARK, spaceBefore=12, spaceAfter=4,
    )
    styles['h4'] = ParagraphStyle(
        'h4', fontName='Helvetica-BoldOblique', fontSize=10, leading=14,
        textColor=TEXT_MID, spaceBefore=8, spaceAfter=2,
    )
    styles['body'] = ParagraphStyle(
        'body', fontName='Helvetica', fontSize=9.5, leading=14,
        textColor=TEXT_DARK, spaceAfter=6, spaceBefore=0,
    )
    styles['blockquote'] = ParagraphStyle(
        'blockquote', fontName='Helvetica-Oblique', fontSize=9.5, leading=14,
        textColor=TEXT_MID, spaceAfter=6, spaceBefore=6,
        leftIndent=18, borderPad=8,
        backColor=VERA_LIGHT_BG,
        borderColor=VERA_PURPLE, borderWidth=0,
        leftBorderColor=VERA_PURPLE, leftBorderWidth=3,
    )
    styles['bullet'] = ParagraphStyle(
        'bullet', fontName='Helvetica', fontSize=9.5, leading=14,
        textColor=TEXT_DARK, spaceAfter=2, spaceBefore=0,
        leftIndent=16, bulletIndent=4,
    )
    styles['bullet2'] = ParagraphStyle(
        'bullet2', fontName='Helvetica', fontSize=9, leading=13,
        textColor=TEXT_DARK, spaceAfter=2, spaceBefore=0,
        leftIndent=32, bulletIndent=20,
    )
    styles['toc_title'] = ParagraphStyle(
        'toc_title', fontName='Helvetica-Bold', fontSize=13, leading=18,
        textColor=VERA_PURPLE, spaceAfter=8, spaceBefore=4,
    )
    styles['toc_item'] = ParagraphStyle(
        'toc_item', fontName='Helvetica', fontSize=9.5, leading=16,
        textColor=TEXT_DARK, leftIndent=12,
    )
    styles['code'] = ParagraphStyle(
        'code', fontName='Courier', fontSize=8, leading=12,
        textColor=CODE_FG, backColor=CODE_BG,
        spaceBefore=4, spaceAfter=4,
        leftIndent=0, rightIndent=0,
        borderPad=8,
    )
    styles['hr_title'] = ParagraphStyle(
        'hr_title', fontName='Helvetica-Bold', fontSize=10, leading=14,
        textColor=WHITE,
    )

    return styles


# ── Inline markdown → HTML-ish for Paragraph ──────────────────────────────────
def inline_md(text):
    """Convert inline markdown to ReportLab-safe markup."""
    # Escape XML special chars first (except we'll re-add our own tags)
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;').replace('>', '&gt;')
    # Bold+italic ***text*** or ___text___
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<b><i>\1</i></b>', text)
    # Bold **text**
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    # Italic *text* or _text_
    text = re.sub(r'\*([^*\n]+?)\*', r'<i>\1</i>', text)
    # Inline code `text`
    text = re.sub(r'`([^`]+?)`', r'<font name="Courier" color="#6c63ff">\1</font>', text)
    # Links [text](url) -> just text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    return text


# ── Header/footer callbacks ───────────────────────────────────────────────────
def on_page(canvas, doc):
    canvas.saveState()
    w, h = letter
    # Footer rule
    canvas.setStrokeColor(VERA_PURPLE)
    canvas.setLineWidth(0.5)
    canvas.line(0.65*inch, 0.55*inch, w - 0.65*inch, 0.55*inch)
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(TEXT_MID)
    canvas.drawString(0.65*inch, 0.38*inch, 'VERA System Documentation — Inner Workings & Architecture')
    canvas.drawRightString(w - 0.65*inch, 0.38*inch, f'Page {doc.page}')
    canvas.restoreState()

def on_first_page(canvas, doc):
    """Cover page callback — draws full purple banner."""
    canvas.saveState()
    w, h = letter
    # Top banner
    canvas.setFillColor(VERA_PURPLE)
    canvas.rect(0, h - 1.8*inch, w, 1.8*inch, fill=1, stroke=0)
    # Title
    canvas.setFillColor(WHITE)
    canvas.setFont('Helvetica-Bold', 28)
    canvas.drawCentredString(w/2, h - 0.9*inch, 'VERA System Documentation')
    canvas.setFont('Helvetica', 13)
    canvas.drawCentredString(w/2, h - 1.3*inch, 'Inner Workings, Architecture & Design Decisions')
    # Footer
    canvas.setStrokeColor(VERA_PURPLE)
    canvas.setLineWidth(0.5)
    canvas.line(0.65*inch, 0.55*inch, w - 0.65*inch, 0.55*inch)
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(TEXT_MID)
    canvas.drawString(0.65*inch, 0.38*inch, 'VERA System Documentation — Inner Workings & Architecture')
    canvas.drawRightString(w - 0.65*inch, 0.38*inch, f'Page {doc.page}')
    canvas.restoreState()


# ── Table parser ──────────────────────────────────────────────────────────────
def parse_md_table(lines):
    """Parse a markdown table block into a list of row-lists."""
    rows = []
    for line in lines:
        line = line.strip()
        if re.match(r'^\|[-:| ]+\|$', line):
            continue  # separator row
        if line.startswith('|') and line.endswith('|'):
            cells = [c.strip() for c in line[1:-1].split('|')]
            rows.append(cells)
    return rows


def make_pdf_table(rows, styles_map):
    if not rows:
        return None
    col_count = max(len(r) for r in rows)
    # Normalise row lengths
    rows = [r + [''] * (col_count - len(r)) for r in rows]

    # Convert cells to Paragraphs
    cell_style = ParagraphStyle(
        'tc', fontName='Helvetica', fontSize=8.5, leading=12, textColor=TEXT_DARK
    )
    header_style = ParagraphStyle(
        'th', fontName='Helvetica-Bold', fontSize=8.5, leading=12, textColor=WHITE
    )
    code_cell = ParagraphStyle(
        'tcc', fontName='Courier', fontSize=8, leading=12, textColor=TEXT_DARK
    )

    def cell_para(text, is_header=False):
        text = inline_md(str(text))
        st = header_style if is_header else cell_style
        try:
            return Paragraph(text, st)
        except Exception:
            return Paragraph(str(text), st)

    pdf_rows = []
    for i, row in enumerate(rows):
        pdf_rows.append([cell_para(cell, is_header=(i == 0)) for cell in row])

    # Column widths — distribute evenly within available width
    available = 6.7 * inch
    col_width = available / col_count

    t = Table(pdf_rows, colWidths=[col_width] * col_count, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER),
        ('TEXTCOLOR',  (0, 0), (-1, 0), WHITE),
        ('GRID',       (0, 0), (-1, -1), 0.4, colors.HexColor('#d0ceff')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, TABLE_ALT]),
        ('TOPPADDING',  (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING',  (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN',     (0, 0), (-1, -1), 'TOP'),
    ]))
    return t


# ── Main converter ────────────────────────────────────────────────────────────
def convert(md_path, pdf_path):
    styles = build_styles()

    with open(md_path, encoding='utf-8') as f:
        raw_lines = f.readlines()

    story = []
    i = 0
    skip_first_h1 = True   # covered by the banner on_first_page

    def add_spacer(h=6):
        story.append(Spacer(1, h))

    while i < len(raw_lines):
        line = raw_lines[i].rstrip('\n')

        # ── Code block ────────────────────────────────────────────────────────
        if line.strip().startswith('```'):
            code_lines = []
            i += 1
            while i < len(raw_lines) and not raw_lines[i].strip().startswith('```'):
                code_lines.append(raw_lines[i].rstrip('\n'))
                i += 1
            i += 1  # skip closing ```
            code_text = '\n'.join(code_lines)
            # Use Preformatted for code blocks (handles whitespace correctly)
            pre = Preformatted(code_text, styles['code'])
            story.append(pre)
            add_spacer(4)
            continue

        # ── Markdown table ────────────────────────────────────────────────────
        if line.startswith('|'):
            table_lines = []
            while i < len(raw_lines) and raw_lines[i].strip().startswith('|'):
                table_lines.append(raw_lines[i].rstrip('\n'))
                i += 1
            rows = parse_md_table(table_lines)
            if rows:
                t = make_pdf_table(rows, styles)
                if t:
                    story.append(t)
                    add_spacer(8)
            continue

        # ── Horizontal rule ────────────────────────────────────────────────────
        if line.strip() in ('---', '***', '___'):
            story.append(HRFlowable(width='100%', thickness=0.5,
                                    color=VERA_BORDER, spaceAfter=8, spaceBefore=8))
            i += 1
            continue

        # ── Headings ──────────────────────────────────────────────────────────
        if line.startswith('# '):
            text = line[2:].strip()
            if skip_first_h1:
                skip_first_h1 = False
                i += 1
                continue
            story.append(PageBreak())
            story.append(Paragraph(inline_md(text), styles['h1']))
            add_spacer(10)
            i += 1
            continue

        if line.startswith('## '):
            text = line[3:].strip()
            story.append(Paragraph(inline_md(text), styles['h2']))
            story.append(HRFlowable(width='100%', thickness=1,
                                    color=VERA_PURPLE, spaceAfter=6, spaceBefore=0))
            i += 1
            continue

        if line.startswith('### '):
            text = line[4:].strip()
            story.append(Paragraph(inline_md(text), styles['h3']))
            i += 1
            continue

        if line.startswith('#### '):
            text = line[5:].strip()
            story.append(Paragraph(inline_md(text), styles['h4']))
            i += 1
            continue

        # ── Blockquote ────────────────────────────────────────────────────────
        if line.startswith('> '):
            bq_lines = []
            while i < len(raw_lines) and raw_lines[i].startswith('> '):
                bq_lines.append(raw_lines[i][2:].rstrip('\n'))
                i += 1
            bq_text = ' '.join(bq_lines)
            story.append(Paragraph(inline_md(bq_text), styles['blockquote']))
            add_spacer(4)
            continue

        # ── Unordered list ────────────────────────────────────────────────────
        if re.match(r'^(\s*)[-*+] ', line):
            indent = len(line) - len(line.lstrip())
            text = re.sub(r'^(\s*)[-*+] ', '', line).strip()
            bullet_char = '\u2022'
            st = styles['bullet2'] if indent >= 2 else styles['bullet']
            story.append(Paragraph(f'{bullet_char}  {inline_md(text)}', st))
            i += 1
            continue

        # ── Numbered list ─────────────────────────────────────────────────────
        if re.match(r'^\d+\. ', line):
            text = re.sub(r'^\d+\. ', '', line).strip()
            num = re.match(r'^(\d+)\.', line).group(1)
            story.append(Paragraph(f'<b>{num}.</b>  {inline_md(text)}', styles['bullet']))
            i += 1
            continue

        # ── Empty line ────────────────────────────────────────────────────────
        if line.strip() == '':
            add_spacer(4)
            i += 1
            continue

        # ── Regular paragraph ─────────────────────────────────────────────────
        story.append(Paragraph(inline_md(line.strip()), styles['body']))
        i += 1

    # ── Build document ────────────────────────────────────────────────────────
    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=letter,
        leftMargin=0.65*inch,
        rightMargin=0.65*inch,
        topMargin=0.75*inch,
        bottomMargin=0.75*inch,
        title='VERA System Documentation',
        author='VERA',
        subject='Inner Workings, Architecture & Design Decisions',
    )

    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_page)
    print(f'PDF written to: {pdf_path}')


if __name__ == '__main__':
    base = os.path.dirname(os.path.abspath(__file__))
    convert(
        os.path.join(base, 'VERA_Documentation.md'),
        os.path.join(base, 'VERA_Documentation.pdf'),
    )

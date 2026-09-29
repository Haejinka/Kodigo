from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.section import WD_SECTION
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile

source = Path(r'C:\Kodigo v0.1.0\docs\Chapter 1-4 Manuscript v3.docx')
out = Path(r'C:\Kodigo v0.1.0\docs\Post-Survey Questionnaire RQ3.docx')
doc = Document(str(source))

# Retain the thesis package's page setup, real styles, header, and PAGE field.
body = doc._element.body
for child in list(body):
    if child.tag != qn('w:sectPr'):
        body.remove(child)

# Exact RQ3 wording from the thesis.
rq = ('What is the level of acceptability of the developed Cloud-Based Inventory and Financial '
      'Management System among intended users and technical evaluators in terms of:')
sections = [
    ('Cost-effectiveness', [
        'The system reduces reliance on separate tools to keep inventory and sales records.',
        'The system reduces the effort I spend maintaining routine business records.',
        'The benefits of the system justify the resources required to use it.'
    ]),
    ('System reliability', [
        'The system retains the records I submit without losing or changing them unexpectedly.',
        'Updates to inventory and sales records appear consistently across stores I am authorized to access.',
        'The system is available when I need to perform my assigned tasks.'
    ]),
    ('Operational efficiency', [
        'I can complete my assigned sales or inventory tasks in fewer steps using the system.',
        'I can locate the inventory or sales information I need without reconciling separate records.',
        'The system reports provide the information I need in time to act on routine operational issues.'
    ]),
    ('Security', [
        'I must sign in before accessing business information in the system.',
        'The system restricts its functions according to my assigned role.',
        'My account can access only records for stores assigned to me.'
    ])
]

# Use the source title style and manuscript section heading style.
p = doc.add_paragraph(style='Title')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.add_run('POST-SURVEY QUESTIONNAIRE')

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
p.paragraph_format.line_spacing = 2.0
p.add_run('This questionnaire asks about your experience with the developed Cloud-Based Inventory and Financial Management System. Your responses will be used for academic research on the system’s acceptability. Responses will be handled confidentially and reported in summary form. Please do not write your name or account credentials on this questionnaire.')

h = doc.add_paragraph('Instructions', style='Heading 1')
h.paragraph_format.keep_with_next = True
p = doc.add_paragraph()
p.paragraph_format.line_spacing = 2.0
p.add_run('For each statement, mark one response that best reflects your experience using the system. Mark N/A only when you have not had an opportunity to use or observe the feature described. N/A is not a rating and will be excluded from rating averages. Please answer based on the system developed for this study.')

scale = doc.add_table(rows=1, cols=5)
scale.alignment = WD_TABLE_ALIGNMENT.CENTER
scale.autofit = False
scale_widths = [Inches(1.2), Inches(1.2), Inches(1.2), Inches(1.2), Inches(1.2)]
labels = ['5 – Strongly Agree', '4 – Agree', '3 – Neutral', '2 – Disagree', '1 – Strongly Disagree']
for c, label, width in zip(scale.rows[0].cells, labels, scale_widths):
    c.width = width
    c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    para = c.paragraphs[0]
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para.paragraph_format.line_spacing = 1.0
    run = para.add_run(label)
    run.bold = True
    run.font.name = 'Cambria'
    run.font.size = Pt(9)
    run._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), 'Cambria')

# Give scale key visible, light borders with compact internal margins.
def set_cell_borders(table, color='B7B7B7', size='4'):
    tblPr = table._tbl.tblPr
    borders = tblPr.find(qn('w:tblBorders'))
    if borders is None:
        borders = OxmlElement('w:tblBorders')
        tblPr.append(borders)
    for edge in ('top','left','bottom','right','insideH','insideV'):
        el = borders.find(qn('w:'+edge))
        if el is None:
            el = OxmlElement('w:'+edge); borders.append(el)
        el.set(qn('w:val'),'single'); el.set(qn('w:sz'),size); el.set(qn('w:color'),color)

def cell_margins(cell, top=65, start=70, bottom=65, end=70):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    mar = tcPr.first_child_found_in('w:tcMar')
    if mar is None:
        mar = OxmlElement('w:tcMar'); tcPr.append(mar)
    for side, val in [('top',top),('start',start),('bottom',bottom),('end',end)]:
        node = mar.find(qn('w:'+side))
        if node is None: node = OxmlElement('w:'+side); mar.append(node)
        node.set(qn('w:w'),str(val)); node.set(qn('w:type'),'dxa')
set_cell_borders(scale)
for row in scale.rows:
    for c in row.cells: cell_margins(c)

h = doc.add_paragraph('Section RQ3', style='Heading 1')
h.paragraph_format.keep_with_next = True
p = doc.add_paragraph(rq)
p.paragraph_format.line_spacing = 2.0
p.paragraph_format.keep_with_next = True
for letter, (construct, items) in zip('abcd', sections):
    h = doc.add_paragraph(f'{letter}. {construct}', style='Heading 2')
    h.paragraph_format.keep_with_next = True
    for text in items:
        n = len(doc.paragraphs) # stable question number, 1-based from first survey item
        # assign by count of already added question paragraphs
        n = getattr(doc, '_survey_item_no', 0) + 1
        doc._survey_item_no = n
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.keep_together = True
        r = p.add_run(f'Q{n}. '); r.bold = True
        p.add_run(text)
        p = doc.add_paragraph()
        p.paragraph_format.line_spacing = 1.0
        p.paragraph_format.left_indent = Inches(0.25)
        p.paragraph_format.space_after = Pt(8)
        p.paragraph_format.keep_together = True
        p.add_run('[ ] 5    [ ] 4    [ ] 3    [ ] 2    [ ] 1    [ ] N/A')

# Researcher-only alignment matrix, following the administered questionnaire.
doc.add_page_break()
h = doc.add_paragraph('RQ3 Alignment Matrix', style='Heading 1')
h.paragraph_format.keep_with_next = True
p = doc.add_paragraph('Researcher-facing validation table linking each survey item to the criterion it measures and the data it produces.')
p.paragraph_format.line_spacing = 1.5
p.paragraph_format.keep_with_next = True

headers = ['No.', 'Survey Question', 'RQ', 'Construct/Indicator', 'Data Produced', 'How It Answers the RQ']
rows = []
number = 1
how = [
 'Rates perceived reduction in duplicated recordkeeping tools as evidence of cost-effectiveness.',
 'Rates perceived effort savings in routine recordkeeping as a resource-related acceptability indicator.',
 'Rates perceived benefits relative to the resources needed to use the system.',
 'Rates the perceived accuracy and retention of submitted records.',
 'Rates consistency of synchronized records across the respondent’s authorized stores.',
 'Rates system availability during assigned work.',
 'Rates efficiency of completing assigned sales or inventory tasks.',
 'Rates access to needed information without manual reconciliation.',
 'Rates timeliness and usefulness of system reports for operational action.',
 'Rates the presence of authenticated access to business information.',
 'Rates role-based limits on system functions.',
 'Rates store-scoped access to records.'
]
for construct, items in sections:
    for item in items:
        rows.append([f'Q{number}', item, 'RQ3', construct, '5-point agreement rating (or N/A)', how[number-1]])
        number += 1

table = doc.add_table(rows=1, cols=len(headers))
table.alignment = WD_TABLE_ALIGNMENT.CENTER
table.autofit = False
try: table.style = 'Table Grid'
except KeyError: pass
widths = [Inches(.34), Inches(1.55), Inches(.34), Inches(.83), Inches(.88), Inches(1.82)]
for i, (cell, title) in enumerate(zip(table.rows[0].cells, headers)):
    cell.width = widths[i]
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    cell_margins(cell, top=80, bottom=80)
    p = cell.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.line_spacing = 1.0
    r = p.add_run(title); r.bold = True; r.font.name='Cambria'; r.font.size=Pt(8.5)
    r._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Cambria')
# Repeat header row across pages.
trPr = table.rows[0]._tr.get_or_add_trPr()
repeat = OxmlElement('w:tblHeader'); repeat.set(qn('w:val'),'true'); trPr.append(repeat)
for rowdata in rows:
    cells = table.add_row().cells
    trpr = table.rows[-1]._tr.get_or_add_trPr()
    cant = OxmlElement('w:cantSplit'); trpr.append(cant)
    for i, (cell, text, width) in enumerate(zip(cells, rowdata, widths)):
        cell.width=width; cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
        cell_margins(cell, top=70, bottom=70, start=55, end=55)
        p=cell.paragraphs[0]; p.paragraph_format.line_spacing=1.0; p.paragraph_format.space_after=Pt(0)
        if i in (0,2): p.alignment=WD_ALIGN_PARAGRAPH.CENTER
        else: p.alignment=WD_ALIGN_PARAGRAPH.LEFT
        r=p.add_run(text); r.font.name='Cambria'; r.font.size=Pt(8)
        r._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Cambria')
set_cell_borders(table)

# Rebuild the first-page header with the thesis banner and a dynamic page number.
first_header = doc.sections[0].first_page_header
for child in list(first_header._element):
    first_header._element.remove(child)
with ZipFile(source) as template_zip:
    banner = template_zip.read('word/media/image36.png')
pnum = first_header.add_paragraph()
pnum.alignment = WD_ALIGN_PARAGRAPH.RIGHT
pnum.paragraph_format.line_spacing = 1.0
pnum.paragraph_format.space_after = Pt(0)
r = pnum.add_run()
r.font.name = 'Cambria'; r.font.size = Pt(9)
begin = OxmlElement('w:fldChar'); begin.set(qn('w:fldCharType'),'begin')
instr = OxmlElement('w:instrText'); instr.set(qn('xml:space'),'preserve'); instr.text = ' PAGE '
sep = OxmlElement('w:fldChar'); sep.set(qn('w:fldCharType'),'separate')
text_run = OxmlElement('w:t'); text_run.text = '1'
end = OxmlElement('w:fldChar'); end.set(qn('w:fldCharType'),'end')
for node in (begin,instr,sep,text_run,end): r._r.append(node)
pbanner = first_header.add_paragraph()
pbanner.paragraph_format.line_spacing = 1.0
pbanner.paragraph_format.space_after = Pt(0)
pbanner.add_run().add_picture(BytesIO(banner), width=Inches(6.0))
# Point the section's first-page header reference to the populated header part.
first_rel = next(rel.rId for rel in doc.part.rels.values() if rel.reltype.endswith('/header') and rel.target_part is first_header.part)
sect_pr = doc.sections[0]._sectPr
for ref in list(sect_pr.findall(qn('w:headerReference'))):
    if ref.get(qn('w:type')) == 'first': sect_pr.remove(ref)
ref = OxmlElement('w:headerReference'); ref.set(qn('w:type'),'first'); ref.set(qn('r:id'),first_rel)
refs = list(sect_pr.findall(qn('w:headerReference')))
sect_pr.insert(max((sect_pr.index(x) for x in refs), default=-1)+1, ref)
doc.sections[0].different_first_page_header_footer = True

# Explicit target audience and presentation metadata.
doc.core_properties.title = 'Post-Survey Questionnaire for Research Question 3'
doc.core_properties.subject = 'System acceptability among intended users and technical evaluators'
doc.core_properties.keywords = 'post-survey, RQ3, system acceptability'
doc.save(str(out))
print(out)

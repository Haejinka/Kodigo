from pathlib import Path
from docx import Document
from pypdf import PdfReader
from zipfile import ZipFile
from collections import Counter
import hashlib,json,re,unicodedata
R=Path.cwd();B=R/'outputs/rq2-validation-2026-10-27';F=R/'deliverables/thesis/Chapter 1-4 Manuscript v3 RQ2 Technical Review.docx'
s=Document(B/'manuscript-before-rq2.docx');d=Document(F);current=Document(R/'docs/Chapter 1-4 Manuscript v3.docx')
exceptions=[p.text for p in s.paragraphs if p.text.startswith('This chapter presents, analyzes') or p.text.startswith('The quantitative and qualitative findings converge')]
texts=[p.text for p in d.paragraphs]
assert all(p.text in texts for p in s.paragraphs if p.text.strip() and p.text not in exceptions)
assert len(d.tables)==len(s.tables)+2
for a,b in zip(s.tables[2:],d.tables[2:len(s.tables)]):assert [[c.text for c in r.cells] for r in a.rows]==[[c.text for c in r.cells] for r in b.rows]
za=ZipFile(B/'manuscript-before-rq2.docx');zb=ZipFile(F)
media=lambda z:Counter(hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('word/media/'))
assert media(za)==media(zb)
p=PdfReader(B/'final-render/thesis.pdf');pages=[x.extract_text() or '' for x in p.pages]
assert len(pages)==105
assert not any('Error! Reference source not found.' in t or 'Error! Bookmark not defined.' in t for t in pages)
assert len(list((B/'final-render-v3/pages').glob('page-*.png')))==len(pages)
normal=lambda s:re.sub(r'\s+',' ',unicodedata.normalize('NFKC',s)).strip()
normalized=[normal(t) for t in pages]
mapping=json.loads((B/'caption-reference-map.json').read_text());verified=[]
for m in mapping:
 t=d.tables[0 if m['kind']=='Figure' else 1]
 row=next(row for row in t.rows if row.cells[0].text.strip()==m['number'])
 n=int(row.cells[2].text.strip());caption=normal(m['caption'])
 assert caption[:65] in normalized[n-1],(m['caption'],n)
 verified.append({'kind':m['kind'],'number':m['number'],'page':n})
assert len(verified)==40
assert any('AI-assisted technical assessment' in t for t in texts)
assert any('20 of 22' in t for t in texts)
assert any('create_store_with_owner' in t for t in texts)
assert any('log_audit_event' in t for t in texts)
alltext='\n'.join(texts)
assert not re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]{15,}|sk-proj-[A-Za-z0-9_-]{15,}',alltext)
record={'final_sha256':hashlib.sha256(F.read_bytes()).hexdigest(),'source_snapshot_sha256':hashlib.sha256((B/'manuscript-before-rq2.docx').read_bytes()).hexdigest(),'pages':105,'all_untargeted_paragraphs_preserved':True,'original_data_tables_preserved':True,'original_media_preserved':sum(media(za).values()),'caption_page_references_verified':verified,'source_current_paragraph_text_matches_snapshot':[x.text for x in current.paragraphs]==[x.text for x in s.paragraphs],'source_file_not_overwritten_by_this_workflow':True,'source_metadata_or_formatting_changed_since_snapshot':hashlib.sha256((R/'docs/Chapter 1-4 Manuscript v3.docx').read_bytes()).hexdigest()!=hashlib.sha256((B/'manuscript-before-rq2.docx').read_bytes()).hexdigest(),'review_method':'AI-assisted technical assessment; no human evaluator ratings','tests':{'unit_passed':17,'controlled_database_passed':20,'controlled_database_failed':2,'browser_routes_passed':4,'network_checks_passed':4},'render_method':'Microsoft Word export and packaged render_docx.py rasterization; LibreOffice absent'}
(B/'final-qa.json').write_text(json.dumps(record,indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in record.items() if k!='caption_page_references_verified'}));print('Verified 40 caption page references')

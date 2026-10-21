from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import json,re,hashlib

root=Path(r'C:\Kodigo v0.1.0')
build=root/'outputs/pre-defense-build'
out=root/'deliverables/pre-defense'
pptx=out/'Kodigo_Pre_Defense.pptx'
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
z=ZipFile(pptx)
assert z.testzip() is None
slide_names=sorted([x for x in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+.xml',x)],key=lambda x:int(re.search(r'slide(\d+)',x).group(1)))
note_names=sorted([x for x in z.namelist() if re.fullmatch(r'ppt/notesSlides/notesSlide\d+.xml',x)],key=lambda x:int(re.search(r'notesSlide(\d+)',x).group(1)))
assert len(slide_names)==len(note_names)==12
rows=[]
all_text=''
for i,(sn,nn) in enumerate(zip(slide_names,note_names),1):
    sr=ET.fromstring(z.read(sn));nr=ET.fromstring(z.read(nn))
    texts=[''.join(t.text or '' for t in para.findall('.//a:t',ns)) for para in sr.findall('.//a:p',ns)]
    notes='\n'.join(t.text or '' for t in nr.findall('.//a:t',ns))
    assert f'Presenter {(i-1)//4+1}' in notes
    assert 'Repository evidence (not spoken)' in notes
    assert len(notes.split())>80
    # Source render is of the exact candidate copied without changes by finalization.
    assert (build/f'renders/slide-{i:02d}.png').exists()
    assert len(sr.findall('.//p:sp',ns))>=5
    if i in (5,6,7): assert len(sr.findall('.//p:cxnSp',ns))>0
    rows.append({'slide':i,'presenter':(i-1)//4+1,'note_words_with_sources':len(notes.split()),'native_shapes':len(sr.findall('.//p:sp',ns)),'native_connectors':len(sr.findall('.//p:cxnSp',ns)),'native_tables':len(sr.findall('.//a:tbl',ns))})
    all_text+='\n'.join(texts)+'\n'+notes
assert rows[7]['native_tables']==1
for f in out.glob('*.md'):all_text+='\n'+f.read_text(encoding='utf-8')
patterns={'JWT':r'eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','secret key':r'(?:sb_secret_|sk-proj-|sk_live_)[A-Za-z0-9_-]{8,}','private key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----','credential assignment':r'(?i)(?:password|service_role_key|anon_key)\s*[:=]\s*[\x22\x27][A-Za-z0-9_+/=-]{15,}'}
hits=[name for name,pattern in patterns.items() if re.search(pattern,all_text)]
assert not hits,hits
assert hashlib.sha256(pptx.read_bytes()).hexdigest()==hashlib.sha256((build/'candidate.pptx').read_bytes()).hexdigest()
assert len(list(out.glob('*')))==5
report={'slides':12,'notes':12,'presenter_allocations':[4,4,4],'native_objects':rows,'sensitive_pattern_hits':hits,'candidate_equals_final':True,'final_sha256':hashlib.sha256(pptx.read_bytes()).hexdigest()}
(build/'qa.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

# Include the complete editable slide copy in the requested outline.
outline=out/'Kodigo_Presentation_Outline.md'
content=outline.read_text(encoding='utf-8')
appendix='\n## Complete on-slide copy\n\nThe following is the visible text in slide order. Diagram links remain editable in the PowerPoint.\n'
for i in range(1,13):
    layout=json.loads((build/f'renders/slide-{i:02d}.layout.json').read_text(encoding='utf-8'))
    appendix+=f'\n### Slide {i}\n\n'
    for el in layout['elements']:
        txt=el.get('text','')
        if not txt or txt.startswith('Kodigo   /   Presenter') or re.fullmatch(r'\d{2}',txt):continue
        if el['kind']=='table':
            data=[line.split('\t') for line in txt.splitlines()]
            appendix+='| '+' | '.join(data[0])+' |\n|'+ '|'.join(['---']*len(data[0]))+'|\n'
            appendix+=''.join('| '+' | '.join(r)+' |\n' for r in data[1:])+'\n'
        else:appendix+=txt.replace('\n',' / ')+'\n\n'
if '## Complete on-slide copy' not in content:outline.write_text(content+appendix,encoding='utf-8')

verification=out/'Kodigo_Verification_Report.md'
txt=verification.read_text(encoding='utf-8')
old='The final QA record will be completed after export, full-slide rendering and visual inspection. The package is intended to contain 12 main slides and all five requested files. It must preserve speaker notes on every slide and the 1–4 / 5–8 / 9–12 presenter allocation. Structural import is a file-opening check, not a claim that Microsoft PowerPoint itself was launched. Rendering through the authoring tool is a visual check, not live system testing.'
new='''Completed for the final deliverable:

- 12 main slides, 16:9, 1920 × 1080 composition. All five requested files exist in `deliverables/pre-defense/`.
- PowerPoint OOXML/ZIP integrity passes. Artifact Tool successfully imports all 12 slides, confirming the exported file can be opened by that reader. Microsoft PowerPoint itself was not launched.
- Every slide rendered at full size and received individual visual inspection. Process-arrow direction, architecture routing and font encoding were corrected before finalization. Final package bytes exactly match the rendered candidate.
- Layout validation reports zero findings and zero warnings for the declared geometry, heading fit, slide count, font policy and native permission table. Visual review found no unintended text clipping or overlap. These checks do not establish behavior in every native PowerPoint installation.
- Architecture, entity relationships and workflows use native editable shapes/connectors. Slide 8 contains one native editable permission table. Slides are not flattened images.
- All 12 slides contain editable notes with presenter allocation, timing, conversational script and source references. The 1–4 / 5–8 / 9–12 allocation is complete. Total target speaking time is 14:20.
- Privacy review and text-pattern checks found no credential/token/private-key values. Only the intentional academic identity information and original application/icon artwork appear. No production records or screenshots were embedded.
- Adviser and academic year are the only intentional title-page placeholders. Final objective wording, deployed migrations and live readiness remain manual confirmations.
- Inter is installed on this authoring host and encoded as the presentation font. Verify the font and native rendering on the presentation computer before defense.

Private build evidence: `outputs/pre-defense-build/Kodigo_Pre_Defense.validation.json`, `qa.json`, and `renders/slide-01.png` through `slide-12.png`. These are verification artifacts, not extra required deliverables. Final PPTX SHA-256: `'''+report['final_sha256']+'''`.
'''
assert old in txt
verification.write_text(txt.replace(old,new),encoding='utf-8')
print(json.dumps({'slide_count':12,'notes_count':12,'sensitive_hits':hits,'files':[f.name for f in out.iterdir()],'sha256':report['final_sha256']}))

from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from PIL import Image
import json,hashlib
R=Path.cwd();B=R/'outputs/pre-defense-visual-update';O=R/'deliverables/pre-defense'
a=ZipFile(B/'before.pptx');f=O/'Kodigo_Pre_Defense_SWU_Visual_Revision_v2.pptx';b=ZipFile(f)
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
assert len(E.fromstring(b.read('ppt/presentation.xml')).findall('.//p:sldId',ns))==16
assert b.testzip() is None
changes=[3,10,11,14]
for i in range(2,17):
 if i not in changes:
  tx=lambda z,name:[t.text for t in E.fromstring(z.read(name)).findall('.//a:t',ns)]
  assert tx(a,f'ppt/slides/slide{i}.xml')==tx(b,f'ppt/slides/slide{i}.xml'),i
  assert tx(a,f'ppt/notesSlides/notesSlide{i}.xml')==tx(b,f'ppt/notesSlides/notesSlide{i}.xml'),i
r=E.fromstring(b.read('ppt/slides/slide11.xml'))
assert len(r.findall('.//a:prstGeom[@prst="ellipse"]',ns))==12
assert not r.findall('.//a:tbl',ns)
assert len(r.findall('.//p:cxnSp',ns))+len(r.findall('.//a:prstGeom[@prst="straightConnector1"]',ns))>=24
assert len(E.fromstring(b.read('ppt/slides/slide8.xml')).findall('.//a:tbl',ns))==1
assert len(E.fromstring(b.read('ppt/slides/slide3.xml')).findall('.//p:pic',ns))>=1
validation=json.loads((B/'validation-v3.json').read_text())
assert validation['packageIntegrity']['finding_count']==validation['presentationLayout']['finding_count']==0
assert validation['firstPartyImport']['passed']
canvas=Image.new('RGB',(1920,1080),'#eeeeee')
for i in range(1,17):
 im=Image.open(B/f'after-v3/slide-{i:02d}.png').convert('RGB');im.thumbnail((480,270));canvas.paste(im,(((i-1)%4)*480,((i-1)//4)*270))
canvas.save(B/'whole-deck-review.jpg')
report={'slide_count':16,'changed_content_slides':changes,'unchanged_content_and_notes_elsewhere':True,'UML_native_ellipses':12,'native_diagrams':[10,11,14],'source_manuscript_framework':'Figure 3.2, layout and groups preserved; shorter presentation wording','native_baseline_table':8,'no_application_or_database_changes':True,'new_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'before_sha256':hashlib.sha256((B/'before.pptx').read_bytes()).hexdigest()}
(B/'qa.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))

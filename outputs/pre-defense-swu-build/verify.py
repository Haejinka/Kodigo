from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
from PIL import Image
import re,json,hashlib,shutil
R=Path(r'C:\Kodigo v0.1.0');B=R/'outputs/pre-defense-swu-build';O=R/'deliverables/pre-defense'
P=O/'Kodigo_Pre_Defense_SWU_Final.pptx';z=ZipFile(P)
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
assert z.testzip() is None
sn=sorted([n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+.xml',n)],key=lambda n:int(re.search(r'slide(\d+)',n).group(1)))
nn=sorted([n for n in z.namelist() if re.fullmatch(r'ppt/notesSlides/notesSlide\d+.xml',n)],key=lambda n:int(re.search(r'notesSlide(\d+)',n).group(1)))
assert len(sn)==len(nn)==17
review=B/'final-review-v4';review.mkdir(exist_ok=True)
text='';rows=[]
for i,(s,n) in enumerate(zip(sn,nn),1):
 sr=E.fromstring(z.read(s));nr=E.fromstring(z.read(n));notes='\n'.join(t.text or '' for t in nr.findall('.//a:t',ns))
 presenter=1 if i<=8 else 2 if i<=14 else 3
 assert f'Presenter {presenter}' in notes
 assert 'Evidence (not spoken)' in notes
 assert len(notes.split())>35
 slide_text='\n'.join(t.text or '' for t in sr.findall('.//a:t',ns));text+=slide_text+'\n'+notes+'\n'
 if i in (8,11):assert len(sr.findall('.//a:tbl',ns))==1
 if i in (3,10,12,13,14):assert len(sr.findall('.//p:cxnSp',ns))>0
 render=B/f'renders/slide-{i:02d}.png';assert render.exists()
 im=Image.open(render).convert('RGB');assert im.size==(1920,1080)
 logo_count=sum(1 for rgb in im.crop((1380,50,1850,210)).get_flattened_data() if min(rgb)<180) if i>1 else None
 if i>1:assert logo_count>10000,(i,logo_count)
 shutil.copyfile(render,review/f'final-{i:02d}.png')
 rows.append({'slide':i,'presenter':presenter,'notes_words_with_sources':len(notes.split()),'native_shapes':len(sr.findall('.//p:sp',ns)),'native_connectors':len(sr.findall('.//p:cxnSp',ns)),'native_tables':len(sr.findall('.//a:tbl',ns)),'header_logo_nonwhite_pixels':logo_count})
assert hashlib.sha256(P.read_bytes()).digest()==hashlib.sha256((B/'candidate-v4.pptx').read_bytes()).digest()
for f in O.glob('*.md'):text+='\n'+f.read_text(encoding='utf-8')
pat={'JWT':r'eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','secret':r'(?:sb_secret_|sk-proj-|sk_live_)[A-Za-z0-9_-]{8,}','private_key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'}
hits=[n for n,p in pat.items() if re.search(p,text)];assert not hits,hits
expected=[(13,72.2),(12,66.7),(16,88.9),(18,100.0)]
assert all(round(c/18*100,1)==percent for c,percent in expected)
source=Path(r'C:\Users\verga\Downloads\Final defense SWU 002.pptx')
assert hashlib.sha256(source.read_bytes()).hexdigest()=='e7456a215ce1b1989fc8bbd7e9c08a6ee65d15dc7f79866c748f0680cc8c10e3'
validation=json.loads((B/'validation-v4.json').read_text())
assert validation['packageIntegrity']['finding_count']==0
assert validation['presentationLayout']['finding_count']==0
assert validation['firstPartyImport']['passed'] is True
report={'slide_count':17,'notes_count':17,'presenter_allocation':{'1':'1-8','2':'9-14','3':'15-17'},'duration_seconds':840,'source_unchanged':True,'candidate_equals_final':True,'sensitive_value_hits':hits,'baseline_arithmetic_matches':True,'slides':rows,'final_sha256':hashlib.sha256(P.read_bytes()).hexdigest()}
(B/'qa.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='slides'}))

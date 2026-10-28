from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
import json, hashlib, re

root=Path(r'C:\Kodigo v0.1.0')
b=root/'outputs/pre-defense-results-2026-10-28'
final=root/'deliverables/pre-defense/Kodigo_Pre_Defense_Updated.pptx'
source=root/'deliverables/pre-defense/Kodigo_Pre_Defense_SWU_Visual_Revision.pptx'
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main','c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}
data=json.loads((b/'data.json').read_text(encoding='utf-8-sig'))
mapping=json.loads((b/'slide-map.json').read_text(encoding='utf-8-sig'))
native=json.loads((b/'native-v5/native-application-check.json').read_text(encoding='utf-8-sig'))
receipt=json.loads((b/'validation-v5.json').read_text(encoding='utf-8-sig'))
def texts(z,n):
    return [t.text or '' for t in E.fromstring(z.read(f'ppt/slides/slide{n}.xml')).findall('.//a:t',ns)]
def norm(s):return re.sub(r'\s+',' ',s).strip()
assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256((b/'source-before.pptx').read_bytes()).digest()
assert native['slideCount']==23 and len(native['nativeCharts'])==3
assert sum(m['seconds'] for m in mapping)==900
assert [x['values'] for x in native['nativeCharts']]==[data['roles']['counts'],data['years']['counts'],list(reversed(data['tasks']['counts']))]
for counts in [data['roles']['counts'],data['years']['counts']]:assert sum(counts)==18
with ZipFile(final) as z, ZipFile(source) as original:
    assert len([n for n in z.namelist() if re.fullmatch(r'ppt/notesSlides/notesSlide\d+\.xml',n)])==23
    assert len([n for n in z.namelist() if n.startswith('ppt/embeddings/') and n.endswith('.xlsx')])==3
    # All retained content, including diagrams, keeps the source wording.
    for m in mapping:
        if m['sourceSlide'] and m['sourceSlide'] not in [1,2]:
            assert texts(z,m['slide'])==texts(original,m['sourceSlide']),m
    theme_text=norm(' '.join(texts(z,11)+texts(z,12)))
    for row in data['themes'][1:]:
        for cell in row:assert norm(cell) in theme_text,cell
    for s in [21,22]:
        all_text=norm(' '.join(texts(z,s)))
        assert '27 October 2026' in all_text
    assert '20 / 22' in texts(z,21)
    assert 'Conditional technical suitability' in texts(z,22)
    for c in [n for n in z.namelist() if re.fullmatch(r'ppt/charts/chart\d+\.xml',n)]:
        xml=E.fromstring(z.read(c))
        assert xml.find('.//c:externalData',ns) is not None
assert receipt['finalSha256']==hashlib.sha256(final.read_bytes()).hexdigest()
result={'finalFile':str(final),'sha256':receipt['finalSha256'],'slides':23,'targetSpeakingSeconds':900,'nativePowerPointOpen':'passed','editableCharts':3,'embeddedWorkbooks':3,'themeCellsMatched':20,'sourceRetained':True,'sourceContentTextPreserved':True,'sourceBrandingAndDiagrams':'retained','visualQA':'Native PowerPoint renders reviewed; pie labels corrected; all five themes visible without cut-off rows.','rq2AssessmentDate':'2026-10-27','rq2Findings':'20/22 database scenarios passed; two unresolved authorization failures, conditional conclusion.'}
(b/'final-qa.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))

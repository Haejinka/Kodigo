from pathlib import Path
import importlib.util,json
from PIL import Image,ImageOps,ImageDraw
B=Path(r'C:\Kodigo v0.1.0\outputs\rq2-validation-2026-10-27')
S=Path(r'C:\Users\verga\.codex\plugins\cache\openai-primary-runtime\documents\26.1025.11240\skills\documents')
spec=importlib.util.spec_from_file_location('docx_renderer',S/'render_docx.py');renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
# The packaged LibreOffice conversion failed because soffice is not installed.
# Microsoft Word exported the saved final DOCX to this PDF. Reuse the packaged
# PNG rasterization and naming workflow without changing any installed files.
renderer.convert_to_pdf=lambda *args,**kwargs:(str(B/'final-render/thesis.pdf'),'Native Microsoft Word PDF export; LibreOffice unavailable')
pages=renderer.rasterize(r'C:\Kodigo v0.1.0\deliverables\thesis\Chapter 1-4 Manuscript v3 RQ2 Technical Review.docx',str(B/'final-render-v3/pages'),96,verbose=False,emit_pdf=False)
for start in range(0,len(pages),15):
 sheet=Image.new('RGB',(1530,5*440),'#dddddd');draw=ImageDraw.Draw(sheet)
 for j,name in enumerate(pages[start:start+15]):
  im=Image.open(name).convert('RGB');im.thumbnail((495,410));x=(j%3)*510+(510-im.width)//2;y=(j//3)*440+20
  sheet.paste(im,(x,y));draw.text(((j%3)*510+8,(j//3)*440+4),f'Page {start+j+1}',fill='black')
 sheet.save(B/f'final-render-v3/review-{start//15+1}.jpg')
(B/'render-record.json').write_text(json.dumps({'pages':len(pages),'conversion':'Microsoft Word native PDF export','rasterization':'packaged render_docx.py, 96 DPI','fallback_reason':'LibreOffice soffice.exe unavailable','contact_sheets':(len(pages)+14)//15},indent=2))
print('Rendered',len(pages),'page images')

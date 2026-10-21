from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
from PIL import Image,ImageOps,ImageDraw
import re,json,collections
base=Path(r'C:\Kodigo v0.1.0\outputs\pre-defense-swu-build')
z=ZipFile(r'C:\Users\verga\Downloads\Final defense SWU 002.pptx')
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
(base/'assets').mkdir(exist_ok=True)
imgs=[]
for n in z.namelist():
 if n.startswith('ppt/media/'):
  dest=base/'assets'/Path(n).name;dest.write_bytes(z.read(n));im=Image.open(dest).convert('RGBA');imgs.append((n,im.copy()))
sheet=Image.new('RGB',(1200,((len(imgs)+5)//6)*145),'#e9e9e9');d=ImageDraw.Draw(sheet)
for i,(n,im) in enumerate(imgs):
 x=(i%6)*200;y=(i//6)*145
 thumb=ImageOps.contain(im,(190,115));sheet.paste(thumb,(x+(190-thumb.width)//2,y),thumb)
 d.text((x+5,y+118),Path(n).name,fill='black')
sheet.save(base/'media-contact.jpg')
for si in [1,2,3,5,18,19,26,27]:
 root=E.fromstring(z.read(f'ppt/slides/slide{si}.xml'))
 rels={r.attrib['Id']:r.attrib['Target'] for r in E.fromstring(z.read(f'ppt/slides/_rels/slide{si}.xml.rels'))}
 print('SLIDE',si)
 for pic in root.findall('.//p:pic',ns):
  blip=pic.find('.//a:blip',ns);off=pic.find('.//a:xfrm/a:off',ns);ext=pic.find('.//a:xfrm/a:ext',ns)
  print('IMAGE',rels.get(blip.get('{'+ns['r']+'}embed')) if blip is not None else None,off.attrib if off is not None else None,ext.attrib if ext is not None else None)
 for sp in root.findall('.//p:sp',ns):
  txt=' '.join(t.text or '' for t in sp.findall('.//a:t',ns));off=sp.find('.//a:xfrm/a:off',ns);ext=sp.find('.//a:xfrm/a:ext',ns)
  if txt:print('TEXT',txt[:100],off.attrib if off is not None else None,ext.attrib if ext is not None else None)

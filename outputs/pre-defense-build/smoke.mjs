import fs from 'node:fs/promises';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
const p=Presentation.create({slideSize:{width:1920,height:1080}});
const s=p.slides.add();s.background.fill='#0B1120';
const t=s.shapes.add({geometry:'textbox',position:{left:100,top:100,width:1500,height:100},fill:'none',line:{fill:'none',width:0}});t.text='Kodigo technical pre-defense';t.text.style={fontFamily:'Inter',fontSize:60,color:'#F8FAFC'};t.text.insets=0;
s.speakerNotes.text='Speaker notes test';
await (await PresentationFile.exportPptx(p)).save('C:/Kodigo v0.1.0/outputs/pre-defense-build/smoke.pptx');
const b=await p.export({slide:s,format:'png',scale:0.5});await fs.writeFile('C:/Kodigo v0.1.0/outputs/pre-defense-build/smoke.png',new Uint8Array(await b.arrayBuffer()));
console.log('Authoring and rendering ready');

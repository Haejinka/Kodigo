import fs from 'node:fs/promises';
import {Presentation,PresentationFile,FileBlob} from '@oai/artifact-tool';
const B='C:/Kodigo v0.1.0/outputs/pre-defense-swu-build';
await fs.mkdir(B+'/source-renders',{recursive:true});
const p=await PresentationFile.importPptx(await FileBlob.load('C:/Users/verga/Downloads/Final defense SWU 002.pptx'));
console.log('Slides',p.slides.items.length,'Masters',p.masters.items.length,'Layouts',p.layouts.items.length);
const a=await p.inspect({kind:'layout',maxChars:5000});console.log(a.ndjson);
for(let i=0;i<p.slides.items.length;i++){
 const s=p.slides.items[i];let blob=await p.export({slide:s,format:'png',scale:1});await fs.writeFile(B+'/source-renders/slide-'+String(i+1).padStart(2,'0')+'.png',new Uint8Array(await blob.arrayBuffer()));
 const layout=await s.export({format:'layout',detail:'full'});await fs.writeFile(B+'/source-renders/slide-'+String(i+1).padStart(2,'0')+'.json',await layout.text());
 console.log('Rendered source',i+1);
}
await fs.writeFile(B+'/source.proto.json',JSON.stringify(p.toProto()));
console.log(p.help('slides',{include:['index','notes'],maxChars:4000}));

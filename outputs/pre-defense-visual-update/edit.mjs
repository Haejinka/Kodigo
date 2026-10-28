import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
const ROOT='C:/Kodigo v0.1.0', B=ROOT+'/outputs/pre-defense-visual-update';
const SOURCE=ROOT+'/deliverables/pre-defense/Kodigo_Pre_Defense_SWU_Refined.pptx';
const SK='C:/Users/verga/.codex/plugins/cache/openai-primary-runtime/presentations/26.1025.11240/skills/presentations';
process.env.RUNTIME_NODE_MODULES='C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
process.env.RUNTIME_NODE=process.execPath;
const sourceBytes=await fs.readFile(SOURCE);await fs.writeFile(B+'/before.pptx',sourceBytes);
const p=await PresentationFile.importPptx(await FileBlob.load(SOURCE));
const C={blue:'#0070C0',navy:'#202C61',ink:'#171717',muted:'#595959',pale:'#EAF2FA',green:'#19713C',amber:'#9D5B00'};
await fs.mkdir(B+'/before',{recursive:true});await fs.mkdir(B+'/after-v3',{recursive:true});
for(const n of [3,10,11,14]){
 const s=p.slides.items[n-1];
 await fs.writeFile(B+`/before/slide-${n}.png`,new Uint8Array(await(await p.export({slide:s,format:'png',scale:2})).arrayBuffer()));
 const l=JSON.parse(await(await s.export({format:'layout'})).text());
 await fs.writeFile(B+`/before/slide-${n}.json`,JSON.stringify(l,null,2));
 const ids=l.elements.filter(e=>['shape','textbox','table','chart','image'].includes(e.kind)&&e.position?.top>=115&&e.position?.top<495).map(e=>e.id);
 if(ids.length)p.delete(ids);
}
function text(s,v,x,y,w,h,size=20,color=C.ink,bold=false,align='left',font='Arial'){
 const a=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 a.text=v;a.text.style={typeface:font,fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',insets:0,wrap:'square',autoFit:'none'};return a;
}
function shape(s,v,x,y,w,h,size=18,geometry='rect',color=C.navy,fill='#FFFFFF'){
 const a=s.shapes.add({geometry,position:{left:x,top:y,width:w,height:h},fill,line:{fill:color,width:1.4}});
 if(v&&(geometry==='ellipse'||geometry==='diamond')){text(s,v,x+8,y+3,w-16,h-6,size,C.ink,false,'center');}else if(v){a.text=v;a.text.style={typeface:'Arial',fontSize:size,color:C.ink,alignment:'center',verticalAlignment:'middle',insets:4,wrap:'square',autoFit:'none'};}return a;
}
function seg(s,x1,y1,x2,y2,arrow=false,color=C.navy,width=1.3){
 const rev=false;
 return s.shapes.add({geometry:'connector',kind:'straight',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1),horizontalFlip:x2<x1,verticalFlip:y2<y1},line:{fill:color,width},...(arrow?{[rev?'head':'tail']:{type:'triangle',width:'sm',length:'sm'}}:{})});
}
function link(s,a,b,arrow=true,from='right',to='left',color=C.blue){return s.shapes.connect(a,b,{kind:'straight',fromSide:from,toSide:to,line:{fill:color,width:1.6},...(arrow?{tail:{type:'triangle',width:'sm',length:'sm'}}:{})});}
async function image(s,file,x,y,w,h,alt){s.images.add({blob:await fs.readFile(file),contentType:'image/png',position:{left:x,top:y,width:w,height:h},fit:'contain',alt});}
function notes(s,script,evidence){const old=s.speakerNotes.text;const prefix=old.split('\n\n')[0];s.speakerNotes.text=prefix+'\n\n'+script+'\n\nEvidence (not spoken):\n'+evidence+'\n\nVisual template: Final defense SWU 002.pptx. SWU retained only on cover; PHINMA retained in headers.';}
// Picture-led case scenario. Editable captions carry the story, not text inside the artwork.
{
 const s=p.slides.items[2];
 text(s,'One sale, three separate records',56,123,846,36,27,C.navy,true,'left','Raleway');
 await image(s,B+'/assets/background-storyboard.png',43,168,874,291,'AI-generated vector-style illustrative story: a cashier records a sale, inventory staff update stock later, and an owner reconciles records before ordering. Not actual study participants.');
 const captions=[['1  A sale is written down','The cashier records it in a notebook.'],['2  Stock waits for an update','A separate count is encoded later.'],['3  The owner checks again','Ordering waits for reconciliation.']];
 captions.forEach(([h,b],i)=>{let x=56+i*289;text(s,h,x,414,268,28,20,C.navy,true);text(s,b,x,445,270,37,17,C.muted);});
 notes(s,'Imagine a busy neighborhood shop. A customer buys groceries and the cashier writes the sale in a notebook. The inventory worker updates a separate stock record later. When the owner needs to reorder, the notebook, stock count and receipts must first be compared. The pictures illustrate the fragmentation described in the manuscript. They are not a real respondent account. This is the operational problem that motivates linking sales, stock and reports in Kodigo.','docs/Chapter 1-4 Manuscript v3.docx, Chapters 1 and 4. Generated illustration: built-in Imagegen, 27 October 2026; prompt recorded in imagegen-prompts.md.');
}
// Current manuscript Figure 3.2: same role -> platform -> output structure, condensed for projection.
{
 const s=p.slides.items[9];
 text(s,'System roles',56,126,190,27,19,C.navy,true);
 text(s,'Kodigo cloud-based platform',293,126,410,27,20,C.navy,true,'center');
 text(s,'System outputs',739,126,171,27,19,C.navy,true);
 const roles=[['Super Admin','Admin invite codes'],['Admin','Store operations'],['Inventory','Products and stock'],['Cashier','Sales and receipts']];
 roles.forEach(([h,b],i)=>{let y=170+i*73;shape(s,'',56,y,181,58);text(s,h,65,y+5,163,24,20,C.navy,true,'center');text(s,b,62,y+31,169,22,15,C.muted,false,'center');seg(s,237,y+29,283,y+29,true,C.blue);});
 const frame=shape(s,'',283,163,427,305,18,'rect',C.blue);
 const modules=[['Authentication and\nrole controls','Store and user\nadministration'],['Product and\ninventory control','Suppliers and\npurchasing'],['Consignment\ninventory','POS, receipts\nand reporting']];
 modules.forEach((row,i)=>row.forEach((v,j)=>{shape(s,v,299+j*202,180+i*93,191,74,18,'rect',C.navy,i===0?C.pale:'#FFFFFF');}));
 shape(s,'',740,163,177,305,18,'rect',C.blue,'none');
 const outputs=[['Online writes','Validated records'],['Stock history','Base-unit movements'],['Decision support','Recorded-data reports'],['Continuity','Bounded queue replay']];
 outputs.forEach(([h,b],i)=>{let y=170+i*73;shape(s,'',754,y,153,58);text(s,h,758,y+5,145,23,16,C.navy,true,'center');text(s,b,758,y+29,145,25,13.5,C.muted,false,'center');});
 seg(s,710,315,740,315,true,C.blue);
 text(s,'Authorized staff enter supplier, delivery and consignment details.',56,468,850,23,17,C.muted);
 notes(s,'This is the current manuscript’s conceptual framework, condensed to keep its structure readable on a slide. Four roles use the Kodigo platform. Super Admin only generates Admin invite codes. Admin manages assigned-store operations, Inventory staff maintain products and stock, and Cashiers process sales and receipts. The platform groups authentication and role controls, store administration, inventory, purchasing, consignment, and POS reporting. Its outputs are validated connected records, base-unit movement history, reports derived from recorded transactions, and bounded queue replay after reconnection. Supplier information is recorded internally by authorized staff. These outputs describe the design and implementation; improved decision-making remains an evaluation objective.','docs/Chapter 1-4 Manuscript v3.docx, Figure 3.2 and accompanying conceptual-framework description. Original figure extracted to assets/image2.png. Native slide recreation preserves its four roles, six platform groups and four output groups; wording is shortened for presentation.');
}
// UML actors are native stick figures; associations have no arrowheads, as in UML use-case notation.
{
 const s=p.slides.items[10];
 const title=s.shapes.items.find(x=>x.text?.toString?.()==='Use cases and user access');if(title)title.text='UML use-case diagram';
 shape(s,'',168,127,634,336,18,'rect',C.navy,'none');
 text(s,'Kodigo system',385,131,200,25,19,C.navy,true,'center');
 function actor(label,x,y){shape(s,'',x-7,y,14,14,14,'ellipse',C.ink);seg(s,x,y+14,x,y+44,false,C.ink);seg(s,x-19,y+25,x+19,y+25,false,C.ink);seg(s,x,y+44,x-17,y+66,false,C.ink);seg(s,x,y+44,x+17,y+66,false,C.ink);text(s,label,x-65,y+70,130,23,19,C.ink,true,'center');return {x,y:y+25};}
 const admin=actor('Admin',85,195),sup=actor('Super Admin',85,373),cash=actor('Cashier',875,196),inv=actor('Inventory',875,373);
 const cases=[['Manage assigned\nstores and users',219,158],['Manage suppliers\nand purchasing',219,231],['Manage inventory\nand business reports',219,304],['Generate Admin\ninvite codes',219,403],['Process POS sales\nand payments',552,158],['Generate / reprint\nreceipts',552,231],['Maintain products\nand stock',552,332],['View inventory\nreports',552,405]];
 const els=cases.map(([v,x,y])=>shape(s,v,x,y,202,55,17,'ellipse',C.ink));
 for(const i of [0,1,2])seg(s,admin.x+21,admin.y,219,cases[i][2]+27.5,false,C.ink,1.1);
 seg(s,sup.x+21,sup.y,219,430.5,false,C.ink,1.1);
 for(const i of [4,5])seg(s,cash.x-21,cash.y,754,cases[i][2]+27.5,false,C.ink,1.1);
 for(const i of [6,7])seg(s,inv.x-21,inv.y,754,cases[i][2]+27.5,false,C.ink,1.1);
 text(s,'All roles authenticate. Configured MFA and role/store checks apply.',56,468,850,23,17,C.muted);
 notes(s,'The rectangle is the Kodigo system boundary. Each stick figure represents an actor role and each oval represents a user goal. The lines show which actor performs each use case. Admin manages assigned stores and users, purchasing and supplier balances, inventory, analytics and reports. Super Admin separately generates Admin invite codes. Cashier processes sales and payments and generates or reprints receipts. Inventory staff maintain product and stock records and view inventory reports. All roles authenticate, with TOTP assurance when configured. This is a presentation-level view of the current role separation. Suppliers are internal records, so there is no external Supplier actor.','docs/Chapter 1-4 Manuscript v3.docx, Figure 3.3 and role descriptions. User-provided Bank ATM diagram is a notation/layout reference only. All Kodigo use cases come from the current manuscript and existing deck evidence.');
}
// Visual checkout decision and piece-level conversion, all editable native objects.
{
 const s=p.slides.items[13];
 const cart=shape(s,'Cart and\npayment',56,143,145,58,20),val=shape(s,'Server validates\nrole, store and stock',240,143,192,58,18);
 const valid=shape(s,'Valid?',475,136,105,72,18,'diamond');
 const commit=shape(s,'Commit sale + stock\nReturn receipt data',697,143,207,58,18,'rect',C.green);
 link(s,cart,val);link(s,val,valid);link(s,valid,commit);text(s,'Yes',614,143,55,26,17,C.green,true);
 const reject=shape(s,'Reject / roll back',445,235,165,44,18,'rect',C.amber);link(s,valid,reject,true,'bottom','top',C.amber);text(s,'No',538,210,45,23,16,C.amber,true);
 text(s,'Illustrative bulk sale: 2 packs of 6 consume 12 base units',56,292,848,31,23,C.navy,true,'left','Raleway');
 const groups=[{x:56,n:24,title:'Before: 24 pieces',color:C.blue},{x:365,n:12,title:'Sold: 2 × 6 = 12',color:C.amber},{x:674,n:12,title:'After: 12 pieces',color:C.green}];
 groups.forEach(g=>{text(s,g.title,g.x,335,230,30,22,g.color,true);for(let i=0;i<g.n;i++){shape(s,'',g.x+(i%6)*30,374+Math.floor(i/6)*18,21,11,12,'rect',g.color,g.color);}});
 seg(s,260,405,333,405,true,C.blue,2);text(s,'deduct',261,374,75,24,16,C.muted,false,'center');
 seg(s,570,405,643,405,true,C.blue,2);text(s,'balance',572,374,75,24,16,C.muted,false,'center');
 text(s,'Each block = 1 piece. Receiving adds base units. Selling-price approval is separate.',56,465,850,23,17,C.muted);
 notes(s,'Read the top flow from left to right. A checkout sends the cart and payment to the server. The server validates the caller, store, stock and pricing. A valid request commits the sale and stock updates and returns receipt data. An invalid request rejects or rolls back. The lower diagram makes bulk conversion tangible. Each block is one piece. There are twenty-four pieces before the sale. Two packs with six pieces each consume twelve pieces, leaving twelve. This is an arithmetic example, not an observed test result. Receiving performs the reverse stock conversion and records cost history. A selling-price change requires its own authorized review. I will now hand over to Presenter 3.','Existing deck sources for process_pos_sale_v4, v3 transaction validation and stock triggers. Bulk arithmetic is illustrative: 24 - (2 × 6) = 12. No live transaction executed for this edit.');
}
// Preserve stable diagram object ordering: connectors sit behind labels and objects.
for(const n of [10,11,14])for(const a of p.slides.items[n-1].shapes.items)if(a.geometry.toLowerCase().includes('connector'))a.sendToBack();
for(const s of p.slides.items)for(const sh of s.shapes.items){if(sh.text?.toString?.()==='01 / 17')sh.text='01 / 16';}
await(await PresentationFile.exportPptx(p)).save(B+'/candidate.pptx');
for(let i=0;i<p.slides.items.length;i++){
 const s=p.slides.items[i];const stem='slide-'+String(i+1).padStart(2,'0');
 await fs.writeFile(B+'/after-v3/'+stem+'.png',new Uint8Array(await(await p.export({slide:s,format:'png',scale:2})).arrayBuffer()));
 await fs.writeFile(B+'/after-v3/'+stem+'.json',await(await s.export({format:'layout'})).text());console.log('Rendered',i+1);
}
const {finalizePresentation}=await import(pathToFileURL(SK+'/container_tools/artifact_tool_utils.mjs').href);
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:B+'/candidate.pptx',finalPath:ROOT+'/deliverables/pre-defense/Kodigo_Pre_Defense_SWU_Visual_Revision_v2.pptx',pythonExecutable:'C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:SK+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:SK+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','9144000,5143500','--validate-heading-fit','--require-native-table-slide','8'],explicitTotalSlideCount:p.slides.items.length,requiredNativeTableOwnerSlides:[8],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'reference',families:['Raleway','Cambria','Arial'],referencePath:SOURCE,referenceSha256:crypto.createHash('sha256').update(sourceBytes).digest('hex')},verifyArtifactToolImport:true,receiptPath:B+'/validation-v3.json'});
console.log('Finalized',result.finalPath);

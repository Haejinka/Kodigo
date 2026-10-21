import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {Presentation,PresentationFile,FileBlob} from '@oai/artifact-tool';
import {slides as data} from './content.mjs';
const ROOT='C:/Kodigo v0.1.0',B=ROOT+'/outputs/pre-defense-swu-build',O=ROOT+'/deliverables/pre-defense';
const TEMPLATE='C:/Users/verga/Downloads/Final defense SWU 002.pptx';
const SK='C:/Users/verga/.codex/plugins/cache/openai-primary-runtime/presentations/26.1015.12040/skills/presentations';
process.env.RUNTIME_NODE_MODULES='C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';process.env.RUNTIME_NODE=process.execPath;
await fs.mkdir(B+'/renders',{recursive:true});await fs.mkdir(O,{recursive:true});
// Extract the original logo artwork, avoiding full-page image crops in the renderer.
await sharp(B+'/assets/image13.png').extract({left:1305,top:90,width:535,height:85}).png().toFile(B+'/assets/swu-wordmark.png');
await sharp(B+'/assets/image18.png').extract({left:1384,top:52,width:456,height:146}).png().toFile(B+'/assets/phinma-wordmark.png');
const p=await PresentationFile.importPptx(await FileBlob.load(TEMPLATE));
// Retain source slide objects, source masters and source theme, in the requested flow.
p.slides.keep([0,1,2,4,5,6,8,12,17,18,19,20,21,22,23,24,25]);
const standard=p.layouts.items.find(l=>l.name==='OBJECT');
for(let i=0;i<p.slides.items.length;i++){
 const s=p.slides.items[i];const layout=JSON.parse(await(await s.export({format:'layout'})).text());
 const owned=layout.elements.filter(e=>['shape','textbox','image','table','chart'].includes(e.kind)).map(e=>e.id);
 if(owned.length)p.delete(owned);
 if(i>0)s.setLayout(standard);
}
const C={ink:'#171717',blue:'#0070C0',navy:'#202C61',muted:'#595959',line:'#A6B0BE',pale:'#D9E2F3',green:'#19713C',amber:'#9D5B00'};
let id=0;
function t(s,str,x,y,w,h,size=24,color=C.ink,bold=false,font='Arial',align='left'){
 const a=s.shapes.add({geometry:'textbox',name:`current-content-${++id}`,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 a.text=str;a.text.style={typeface:font,fontSize:size,bold,color,alignment:align,verticalAlignment:'top',wrap:'square',autoFit:'none',insets:0};return a;
}
function line(s,x,y,w,color=C.line){return s.shapes.add({geometry:'line',position:{left:x,top:y,width:w,height:0},line:{fill:color,width:1}});}
function box(s,str,x,y,w,h,size=21,fill='#FFFFFF',geometry='rect'){
 const a=s.shapes.add({geometry,position:{left:x,top:y,width:w,height:h},fill,line:{fill:C.navy,width:1.5}});
 a.text=str;a.text.style={typeface:'Arial',fontSize:size,color:C.ink,alignment:'center',verticalAlignment:'middle',insets:10,wrap:'square'};return a;
}
function con(s,a,b,from='right',to='left',both=false){return s.shapes.connect(a,b,{kind:'straight',fromSide:from,toSide:to,line:{fill:C.blue,width:2},tail:{type:'triangle'},...(both?{head:{type:'triangle'}}:{})});}
function segment(s,x1,y1,x2,y2,arr=''){
 const r=x2<x1||y2<y1;
 return s.shapes.add({geometry:'connector',kind:'straight',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x1-x2),height:Math.abs(y1-y2)},line:{fill:C.blue,width:2},...(arr.includes(r?'e':'s')?{head:{type:'triangle'}}:{}),...(arr.includes(r?'s':'e')?{tail:{type:'triangle'}}:{})});
}
async function img(s,name,pos,alt,crop){const a=await fs.readFile(name);return s.images.add({blob:a,contentType:'image/png',position:pos,fit:'contain',alt,...(crop?{crop}:{})});}
const swuCrop={left:0.678,top:0.078,right:0.035,bottom:0.833};
for(let i=0;i<data.length;i++){
 const s=p.slides.items[i];const d=data[i];
 if(i>0)await img(s,B+'/assets/phinma-wordmark.png',{left:690,top:25,width:235,height:80},'Original PHINMA Education logo extracted from supplied template');
 s.speakerNotes.text=`Presenter ${d.presenter}. Target ${Math.floor(d.seconds/60)}:${String(d.seconds%60).padStart(2,'0')}.\n\n${d.notes}\n\nEvidence (not spoken):\n${d.sources.map(x=>'- '+x).join('\n')}\n\nVisual template: Final defense SWU 002.pptx. Original SWU and PHINMA artwork retained. Old slide wording is not factual authority.`;
 if(i>0)t(s,d.title,56,48,605,58,33.6,C.blue,true,'Raleway');
 await img(s,B+'/assets/swu-wordmark.png',{left:i===0?56:370,top:i===0?89:491,width:i===0?465:220,height:i===0?75:35},'Original Southwestern University PHINMA wordmark extracted from supplied template');
 t(s,`${String(i+1).padStart(2,'0')} / 17`,835,502,85,20,14,C.muted,false,'Arial','right');
}

// 01: source cover layout retains the large PHINMA mark and four footer dots.
{
const s=p.slides.items[0];
t(s,'Kodigo  •  Capstone Pre-Defense',56,165,505,33,26,C.blue,true,'Raleway');
t(s,'Architecting a Lightweight Cloud-Based Inventory and Financial Management System: A Mixed-Methods Evaluation of Decision-Making Efficiency in Philippine SMEs',47,210,515,140,25,C.ink,true,'Cambria','center');
t(s,'Evon Christian Pahugot Vergara\nJustin Comendador\nXymmer James Nadera',56,363,495,67,18,C.ink,true,'Arial','center');
t(s,'College of Information Technology and Engineering\nSouthwestern University – PHINMA',56,437,495,35,14,C.muted,false,'Arial','center');
t(s,'Adviser: [Adviser name]     Academic year: [Academic year]',56,470,650,18,13,C.muted);
}
// 02: original agenda flow, grouped for a 14-minute delivery.
{
const s=p.slides.items[1];
const a=[['Research context','Background and case scenario\nProblem statement and goals\nRelated literature'],['Research evidence','Methodology\nBaseline findings for RQ1'],['Developed system','Solution and conceptual framework\nUse cases, architecture and database\nCore logic and development platform'],['Evaluation and walkthrough','Testing evidence and limitations\nDemonstration sequence']];
a.forEach(([h,b],i)=>{let y=131+i*88;t(s,h,56,y,265,40,24,C.navy,true,'Raleway');t(s,b,355,y,555,80,22);});
}
// 03: background followed by an explicitly illustrative case.
{
const s=p.slides.items[2];
t(s,'Separate sales and stock records create delayed visibility',56,133,850,56,28,C.ink,true);
t(s,'Manual entry and later reconciliation make owners compare\nseveral records before routine decisions.',56,203,850,67,24,C.muted);
const a=box(s,'Sale recorded',56,315,240,70),b=box(s,'Stock encoded later',359,315,240,70),c=box(s,'Owner reconciles\nbefore ordering',662,315,240,70);con(s,a,b);con(s,b,c);
t(s,'Illustrative scenario based on the manuscript’s operational problem',56,418,846,31,20,C.muted);
}
// 04: current SOP.
{
const s=p.slides.items[3];const rows=[['RQ1','Which tracking and reconciliation bottlenecks affect SME operations?'],['RQ2','Which system framework and security measures are appropriate?'],['RQ3','How acceptable is the developed system to intended users?']];
rows.forEach(([n,tx],i)=>{let y=141+i*102;t(s,n,56,y,95,43,28,C.blue,true,'Raleway');t(s,tx,185,y,715,70,26);if(i<2)line(s,185,y+78,715);});
t(s,'Acceptability dimensions: cost-effectiveness, reliability, efficiency and security',56,457,846,27,20,C.muted);
}
// 05: goals retain official scope, using current manuscript wording.
{
const s=p.slides.items[4];t(s,'Design, develop, and evaluate a cloud-based inventory\nand financial management framework tailored for SMEs',56,133,846,85,28,C.ink,true);
const tx=['Identify manual tracking and reconciliation bottlenecks','Determine the framework and information security measures','Evaluate acceptability after prototype interaction'];
tx.forEach((v,i)=>{let y=258+i*65;t(s,String(i+1).padStart(2,'0'),56,y,70,40,27,C.blue,true);t(s,v,150,y,750,52,25);});
t(s,'Condensed from current manuscript objectives. Adviser confirmation remains pending.',56,463,850,24,18,C.muted);
}
// 06: literature is attributed to the current manuscript, not the obsolete deck.
{
const s=p.slides.items[5];
const rows=[['Record accuracy','Inventory mismatch and manual consolidation','Shabani et al. (2021); Kosadi et al. (2021)'],['Cloud framework','Integrated records, cost, safety and flexibility','Luo (2024)'],['Security and acceptance','Controlled access and organizational readiness','Mohammad (2022); Nagahawatta et al. (2024); Rashid et al. (2024)']];
rows.forEach(([h,b,c],i)=>{let y=140+i*108;t(s,h,56,y,280,37,25,C.navy,true,'Raleway');t(s,b,355,y,548,38,24);t(s,c,355,y+43,548,43,17,C.muted);if(i<2)line(s,56,y+89,847);});
t(s,'Literature themes and citations as reported in the current manuscript, Chapter 2',56,471,846,22,18,C.muted);
}
// 07: current research framework, including method vs development method.
{
const s=p.slides.items[6];t(s,'Exploratory sequential mixed methods',56,132,846,43,29,C.navy,true,'Raleway');
const rows=[['RQ1','Interviews + baseline questionnaire','Operational bottlenecks'],['RQ2','Quantitative technical validation','Framework and security'],['RQ3','Quantitative acceptability survey','After prototype interaction']];
rows.forEach(([a,b,c],i)=>{let y=204+i*77;t(s,a,56,y,85,38,27,C.blue,true);t(s,b,180,y,710,34,24);t(s,c,180,y+35,710,30,20,C.muted);});
t(s,'Sampling: criterion-based purposive, with maximum variation\nDevelopment methodology: Agile Scrum',56,437,846,50,20,C.muted);
}
// 08: native editable baseline evidence table with clear denominator and status.
{
const s=p.slides.items[7];t(s,'Manuscript-reported baseline   •   18 pre-survey respondents',56,130,846,34,22,C.navy,true);
const values=[['Baseline indicator','Count','Percent'],['Stock update takes 16+ minutes','13 / 18','72.2%'],['3+ discrepancies in the past 30 days','12 / 18','66.7%'],['Uncertain information delays decisions*','16 / 18','88.9%'],['Records from different sources mismatch*','18 / 18','100.0%']];
const tb=s.tables.add({rows:5,columns:3,left:56,top:180,width:846,height:230,columnWidths:[566,130,150],values});
for(let r=0;r<5;r++)for(let c=0;c<3;c++){let cell=tb.getCell(r,c);cell.fill=r===0?C.pale:'#FFFFFF';cell.text.style={typeface:'Arial',fontSize:20,color:C.ink,bold:r===0,verticalAlignment:'middle',insets:10};}
t(s,'* At least sometimes. Table 4.1. Baseline results, not Kodigo improvement rates.',56,422,846,29,17,C.muted);
t(s,'Interview themes: fragmented records, delayed visibility, repeated correction',56,459,846,30,20,C.navy);
}
// 09: developed solution instead of the proposal-era label.
{
const s=p.slides.items[8];await img(s,ROOT+'/kodigo-ui/public/kodigo-icon.png',{left:60,top:162,width:190,height:190},'Current Kodigo application icon');
t(s,'Point-of-sale and inventory management',303,133,600,52,27,C.navy,true,'Raleway');
const rows=[['Sales','Checkout, receipts and transaction history'],['Inventory','Base stock, options, adjustments and import'],['Purchasing','Suppliers, receiving and consignment balances'],['Monitoring','Alerts, descriptive analytics and reports'],['Access','Assigned-store accounts and TOTP MFA']];
rows.forEach(([a,b],i)=>{let y=205+i*51;t(s,a,303,y,140,35,22,C.blue,true);t(s,b,450,y,453,47,22);});
}
// 10: framework retains the source flow while correcting roles and non-claims.
{
const s=p.slides.items[9];const a=box(s,'Authorized users\nAdmin / Cashier / Inventory',56,155,285,90,22),b=box(s,'Kodigo\nRole and store scope',400,155,245,90,23),c=box(s,'Stored records\nSales and stock history',704,155,200,90,21);con(s,a,b);con(s,b,c);
const d=box(s,'Products, units,\nstock and supplier data',56,327,285,85,22),e=box(s,'Validated transactions\nand stock operations',400,327,245,85,21),f=box(s,'Reports and\noperational views',704,327,200,85,21);con(s,d,e);con(s,e,f);con(s,b,e,'bottom','top');
t(s,'Super Admin governs owner invite codes separately. Supplier records are internal.',56,457,846,30,20,C.muted);
}
// 11: editable role/use-case matrix and explicit backend boundary.
{
const s=p.slides.items[10];const values=[['Role','Main use cases','Store scope'],['Admin','Manage operations and users','Assigned stores'],['Cashier','Process sales and review POS history','Assigned store'],['Inventory','Maintain products, stock and inventory reports','Permitted stores'],['Super Admin','Generate owner invite codes','Separate invite portal']];
const tb=s.tables.add({rows:5,columns:3,left:56,top:145,width:846,height:250,columnWidths:[160,466,220],values});
for(let r=0;r<5;r++)for(let c=0;c<3;c++){const a=tb.getCell(r,c);a.fill=r===0?C.pale:'#FFFFFF';a.text.style={typeface:'Arial',fontSize:20,color:C.ink,bold:r===0||c===0,verticalAlignment:'middle',insets:10};}
t(s,'Frontend route gates + database RLS and role/store checks\nTOTP supported. AAL2 applies when a verified factor requires it.',56,426,846,59,21,C.navy);
}
// 12: native architecture at the template's actual dimensions.
{
const s=p.slides.items[11];
const client=box(s,'Browser application\nReact + TypeScript\nZustand + TanStack Query',56,145,310,115,21);
const cache=box(s,'IndexedDB\nCache + selected queues',56,355,310,78,21);con(s,client,cache,'bottom','top',true);
const auth=box(s,'Supabase Auth',468,138,215,58,21),api=box(s,'Data API + RPC',468,228,215,58,21),edge=box(s,'Edge Functions',468,318,215,58,21),storage=box(s,'Storage',468,408,215,58,21);
const db=box(s,'PostgreSQL\n\nRLS + validation\nStock triggers\nBusiness records',735,220,167,210,19);
segment(s,366,203,414,203,'s');segment(s,414,167,414,437);for(const y of [167,257,347,437])segment(s,414,y,468,y,'e');
segment(s,683,257,735,257,'se');segment(s,683,347,735,347,'se');
t(s,'Vercel SPA routing configured. Live deployment and applied migrations require verification.',56,472,846,22,17,C.muted);
}
// 13: native ER overview, no imaginary inventory table.
{
const s=p.slides.items[12];
const product=box(s,'products\ncurrent_stock',56,160,230,75,23),opt=box(s,'product_selling_options',370,160,285,75,20),sale=box(s,'sales',747,160,155,75,23);
const hist=box(s,'restock_history',56,344,230,75,21),items=box(s,'sale_items\nProduct and price snapshots',370,327,285,92,21),move=box(s,'inventory_movements',710,344,192,75,16.5);
con(s,product,opt);con(s,product,hist,'bottom','top');con(s,opt,items,'bottom','top');
segment(s,747,197,690,197);segment(s,690,197,690,373);segment(s,690,373,655,373,'e');
segment(s,286,217,324,217);segment(s,324,217,324,373);segment(s,324,373,370,373,'e');
t(s,'1:N',305,168,60,26,17,C.blue);t(s,'1:N',170,275,60,26,17,C.blue);t(s,'1:N',516,276,60,26,17,C.blue);t(s,'1:N',697,277,60,26,17,C.blue);
t(s,'Movement history references products and records before/after stock.\nStore membership: stores, profiles and store_users. Other entities omitted.',56,439,846,48,20,C.muted);
}
// 14: native, directional workflow and illustrative conversion.
{
const s=p.slides.items[13];
const rows=[['Checkout',['Cart and payment','Server validation','Commit sale + stock']],['Bulk conversion',['2 packs × 6 pieces','12 base units','24 pieces become 12']],['Receiving',['Configured packages','Stock + cost history','Review suggested price']]];
rows.forEach(([name,parts],i)=>{let y=137+i*109;t(s,name,56,y,846,30,24,C.navy,true,'Raleway');let a=parts.map((str,j)=>box(s,str,56+j*305,y+37,236,53,19));con(s,a[0],a[1]);con(s,a[1],a[2]);});
t(s,'v4 calls v3 for validated checkout. Bulk arithmetic is illustrative. Price approval is separate.',56,468,846,23,16.5,C.muted);
}
// 15: old development-platform progression, current actual dependencies.
{
const s=p.slides.items[14];const rows=[['Hardware','Desktop browser, barcode input, optional printer/drawer'],['Software workflow','Git, TypeScript checks, ESLint and GitHub Actions'],['Frontend','React, TypeScript, Vite, Tailwind, Zustand, TanStack Query'],['Backend','Supabase Auth, PostgreSQL, RLS, Storage, Edge Functions'],['Deployment','Vercel SPA routing configuration']];
rows.forEach(([a,b],i)=>{let y=139+i*66;t(s,a,56,y,240,39,24,C.navy,true,'Raleway');t(s,b,328,y,574,52,22);if(i<4)line(s,56,y+52,846);});
t(s,'Current optional hardware bridge: QZ Tray. Device readiness remains unverified.',56,465,846,22,17,C.muted);
}
// 16: known evidence separated from pending evidence and future scope.
{
const s=p.slides.items[15];t(s,'Verified locally',56,139,395,38,26,C.navy,true,'Raleway');t(s,'Pending live checks',510,139,392,38,26,C.navy,true,'Raleway');
t(s,'7 / 7 unit tests passed\nTypeScript check passed\nESLint check passed',56,204,395,120,27,C.ink);
t(s,'Checkout, stock and RLS\nMFA and deployed migrations\nIntended-user acceptability',510,204,392,120,25,C.ink);
line(s,56,352,846);
t(s,'Limits: bounded offline queues, no automatic conflict resolution\nOperational reporting, no full accounting or tax filing\nOCR and predictive AI remain future options',56,377,846,89,22,C.muted);
t(s,'Local checks: 20 October 2026. Integration harness inspected, not run.',56,465,846,23,17,C.muted);
}
// 17: source walkthrough transition with preparation state and concise sequence.
{
const s=p.slides.items[16];t(s,'Planned initial state',56,139,390,38,26,C.navy,true,'Raleway');t(s,'Cleared business records\nRequired schema, Auth and\nconfiguration retained',56,202,390,109,25);
t(s,'Preparation pending.\nNo reset performed for this task.',56,358,390,60,22,C.amber);
['Login','Product setup','Receive stock','POS transaction','Verify deduction','Verify reports'].forEach((v,i)=>{let y=139+i*47;t(s,String(i+1).padStart(2,'0'),510,y,53,32,24,C.blue,true);t(s,v,590,y,312,34,24);});
t(s,'LIVE SYSTEM DEMONSTRATION',56,448,846,43,31,C.blue,true,'Raleway','center');
}

for(const s of p.slides.items)for(const shape of s.shapes.items){if(shape.geometry.toLowerCase().includes('connector'))shape.bringToFront();}
await (await PresentationFile.exportPptx(p)).save(B+'/candidate-v4.pptx');
console.log('Exported revised template-based draft');
let copies=[];
for(let i=0;i<data.length;i++){
const s=p.slides.items[i];const stem='slide-'+String(i+1).padStart(2,'0');
const blob=await p.export({slide:s,format:'png',scale:2});await fs.writeFile(B+'/renders/'+stem+'.png',new Uint8Array(await blob.arrayBuffer()));
const layout=JSON.parse(await(await s.export({format:'layout'})).text());await fs.writeFile(B+'/renders/'+stem+'.json',JSON.stringify(layout,null,2));copies.push(layout.elements.filter(e=>e.text).map(e=>({kind:e.kind,text:e.text})));
console.log('Rendered',i+1,'/ 17');
}
await fs.writeFile(B+'/visible-copy.json',JSON.stringify(copies,null,2));
const finalPath=O+'/Kodigo_Pre_Defense_SWU_Final.pptx';
const {finalizePresentation}=await import(pathToFileURL(SK+'/container_tools/artifact_tool_utils.mjs').href);
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:B+'/candidate-v4.pptx',finalPath,pythonExecutable:'C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:SK+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:SK+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','9144000,5143500','--validate-heading-fit','--require-native-table-slide','8','--require-native-table-slide','11'],explicitTotalSlideCount:17,requiredNativeTableOwnerSlides:[8,11],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'reference',families:['Raleway','Cambria','Arial'],referencePath:TEMPLATE,referenceSha256:crypto.createHash('sha256').update(await fs.readFile(TEMPLATE)).digest('hex')},verifyArtifactToolImport:true,receiptPath:B+'/validation-v4.json'});
console.log('Finalized',result.finalPath);

import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
import {slides as data} from './content.mjs';

const ROOT='C:/Kodigo v0.1.0';
const BUILD=ROOT+'/outputs/pre-defense-build';
const OUT=ROOT+'/deliverables/pre-defense';
const SKILL='C:/Users/verga/.codex/plugins/cache/openai-primary-runtime/presentations/26.1015.12040/skills/presentations';
const PY='C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
process.env.RUNTIME_NODE_MODULES='C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
process.env.RUNTIME_NODE=process.execPath;
await fs.mkdir(OUT,{recursive:true});await fs.mkdir(BUILD+'/renders',{recursive:true});
const C={bg:'#0B1120',surface:'#111827',ink:'#F8FAFC',muted:'#A9B8CB',blue:'#60A5FA',cyan:'#22D3EE',line:'#334155',amber:'#FBBF24'};
const p=Presentation.create({slideSize:{width:1920,height:1080}});
p.theme.defaultFont='Inter';
let id=0;
const text=(s,str,x,y,w,h,size=34,color=C.ink,bold=false,align='left')=>{
 const t=s.shapes.add({geometry:'textbox',name:`text-${++id}`,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 t.text=str;t.text.style={fontFamily:'Inter',fontSize:size,color,bold,alignment:align,verticalAlignment:'top',wrap:'word',autoFit:'none'};t.text.insets=0;return t;
};
const rule=(s,x,y,w,color=C.line)=>s.shapes.add({geometry:'line',name:`rule-${++id}`,position:{left:x,top:y,width:w,height:0},line:{style:'solid',fill:color,width:2}});
const box=(s,str,x,y,w,h,color=C.surface,size=30)=>{
 const b=s.shapes.add({geometry:'rect',name:`node-${++id}`,position:{left:x,top:y,width:w,height:h},fill:color,line:{fill:C.line,width:2}});
 b.text=str;b.text.style={fontFamily:'Inter',fontSize:size,color:C.ink,alignment:'center',verticalAlignment:'middle',wrap:'word'};b.text.insets=20;return b;
};
const conn=(s,a,b,from='right',to='left',both=false)=>s.shapes.connect(a,b,{kind:'straight',fromSide:from,toSide:to,line:{fill:C.blue,width:3},tail:{type:'triangle',width:'med',length:'med'},...(both?{head:{type:'triangle',width:'med',length:'med'}}:{})});
const segment=(s,x1,y1,x2,y2,arrows='')=>{const reverse=x2<x1||y2<y1;return s.shapes.add({geometry:'connector',kind:'straight',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)},line:{fill:C.blue,width:3},...(arrows.includes(reverse?'e':'s')?{head:{type:'triangle'}}:{}),...(arrows.includes(reverse?'s':'e')?{tail:{type:'triangle'}}:{})});};
const add=(i)=>{
 const s=p.slides.add();s.background.fill=C.bg;
 text(s,data[i].title,100,80,1700,95,64,C.ink,true);
 text(s,`Kodigo   /   Presenter ${data[i].presenter}`,100,1005,1400,30,22,C.muted);
 text(s,String(i+1).padStart(2,'0'),1710,1005,110,32,22,C.muted,false,'right');
 s.speakerNotes.text=`Presenter ${data[i].presenter} • ${data[i].seconds} seconds\n\n${data[i].notes}\n\nRepository evidence (not spoken):\n${data[i].sources.map(x=>'- '+x).join('\n')}`;
 return s;
};
const sub=(s,str)=>text(s,str,100,190,1720,68,30,C.muted);
const bytes=async(file)=>{const b=await fs.readFile(file);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};

// Existing Lucide artwork, sourced from the application's installed icon library.
const appReq=createRequire(ROOT+'/kodigo-ui/package.json');
const React=appReq('react');const {renderToStaticMarkup}=appReq('react-dom/server');const icons=appReq('lucide-react');
const sharp=(await import('sharp')).default;
const iconBuffers={};
for(const name of ['ShoppingCart','Package','Truck','ChartColumn','Users']){
 const svg=renderToStaticMarkup(React.createElement(icons[name],{size:72,color:C.cyan,strokeWidth:1.65}));
 const b=await sharp(Buffer.from(svg)).png().toBuffer();iconBuffers[name]=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
}

// 01 — Title: manuscript title is retained without replacing the system name.
{
const s=add(0);
// Cover uses its own title treatment.
s.shapes.items[0].text='CAPSTONE PRE-DEFENSE';s.shapes.items[0].text.style={fontFamily:'Inter',fontSize:26,color:C.cyan,bold:true};
text(s,'KodiGo',100,195,1130,165,136,C.ink,true);
text(s,'Point-of-Sale and Inventory Management System',106,380,1170,60,38,C.blue);
text(s,'Architecting a Lightweight Cloud-Based Inventory and Financial\nManagement System: A Mixed-Methods Evaluation of\nDecision-Making Efficiency in Philippine SMEs',106,475,1240,155,32,C.ink);
text(s,'Evon Christian Pahugot Vergara\nJustin Comendador\nXymmer James Nadera',106,708,1080,135,32,C.ink);
text(s,'Southwestern University – PHINMA\nCollege of Information Technology and Engineering',106,888,1150,72,25,C.muted);
text(s,'Adviser: [Adviser name]\nAcademic year: [Academic year]',1290,890,530,72,25,C.muted);
s.images.add({blob:await bytes(ROOT+'/kodigo-ui/public/kodigo-icon.png'),contentType:'image/png',alt:'Original Kodigo application icon',fit:'contain',position:{left:1390,top:230,width:400,height:400}});
}

// 02 — Editable problem-to-impact rows.
{
const s=add(1);sub(s,'Operational problems described in the capstone manuscript');
text(s,'Current workflow',100,285,720,45,29,C.cyan,true);text(s,'Operational impact',1090,285,730,45,29,C.cyan,true);
const rows=[['Manual transaction recording','Repeated entry and reconciliation'],['Separate stock monitoring','Delayed visibility of available stock'],['Fragmented branch records','Inconsistent sales and inventory views'],['Manual report preparation','Slower access to decision information']];
rows.forEach(([a,b],i)=>{const y=376+i*135;const l=text(s,a,100,y,760,70,37);const r=text(s,b,1090,y,730,95,37);conn(s,l,r);if(i<3)rule(s,100,y+107,1720);});
text(s,'Design response: connect sales, stock movements, and reporting through stored records',100,934,1720,45,29,C.blue);
}

// 03 — Official objectives, concise paraphrase and observable link.
{
const s=add(2);
text(s,'Design, develop, and evaluate a cloud-based inventory and\nfinancial management framework tailored for SMEs',100,214,1690,126,44,C.ink,true);
text(s,'Specific objectives',100,392,760,45,28,C.cyan,true);text(s,'Connection to the system',1040,392,780,45,28,C.cyan,true);
const rows=[['01','Identify tracking and\nreconciliation bottlenecks','Connected POS and stock records'],['02','Determine the framework\nand security measures','Database validation and scoped access'],['03','Evaluate system acceptability','Planned user and technical evaluation']];
rows.forEach(([n,a,b],i)=>{let y=490+i*142;text(s,n,100,y,90,65,40,C.blue,true);text(s,a,225,y,760,110,35);text(s,b,1040,y,780,100,33,C.muted);if(i<2)rule(s,225,y+118,1595);});
text(s,'Condensed from manuscript objectives. Final wording and evaluation status require adviser confirmation.',100,946,1720,45,24,C.muted);
}

// 04 — Flat feature index with existing application iconography.
{
const s=add(3);sub(s,'Browser-based retail operations within assigned stores');
const rows=[['ShoppingCart','Sales management','Checkout, receipts, transaction history, voids and refunds'],['Package','Product and inventory','Base stock, selling options, adjustments, import and archival'],['Truck','Replenishment and suppliers','Receiving, purchase orders, consignment stock and balances'],['ChartColumn','Monitoring and reports','Stock alerts, descriptive analytics, sales and inventory exports'],['Users','User administration','Invite onboarding, assigned-store accounts and TOTP MFA']];
rows.forEach(([icon,a,b],i)=>{let y=307+i*126;s.images.add({blob:iconBuffers[icon],contentType:'image/png',alt:a+' icon',position:{left:100,top:y+4,width:58,height:58}});text(s,a,210,y,650,55,37,C.ink,true);text(s,b,880,y+3,940,90,31,C.muted);if(i<4)rule(s,210,y+97,1610);});
text(s,'Roles: Admin, Cashier, Inventory, and a separate Super Admin invite portal',100,956,1720,40,28,C.blue);
}

// 05 — Native architecture nodes and connectors.
{
const s=add(4);sub(s,'Client logic, backend services, and authoritative persistence');
const users=box(s,'Authorized users\nAssigned role and store',100,285,650,120);
const browser=box(s,'React + TypeScript\nVite browser application\nZustand + TanStack Query',100,470,650,180,C.surface,32);
conn(s,users,browser,'bottom','top',true);
const local=box(s,'IndexedDB\nProduct cache + selected queues',100,790,650,120,C.surface,29);
conn(s,browser,local,'bottom','top',true);
const auth=box(s,'Supabase Auth\nEmail/password + TOTP',980,285,400,120,C.surface,29);
const api=box(s,'Data API + RPC\nTables + SQL functions',980,470,400,120,C.surface,29);
const edge=box(s,'Edge Functions\nAccounts and invites',980,655,400,120,C.surface,29);
const storage=box(s,'Supabase Storage\nUploaded assets',980,840,400,110,C.surface,29);
const db=box(s,'PostgreSQL\n\nRLS\nSQL validation\nStock triggers\n\nRecords and\nsnapshots',1530,470,290,305,C.surface,28);
// Branches share a request/response bus in the open gutter.
segment(s,750,560,865,560,'s');segment(s,865,345,865,895);
for(const y of [345,530,715,895])segment(s,865,y,980,y,'e');
// Backend database paths occupy a separate gutter and never cross the client bus.
segment(s,1380,530,1530,530,'se');segment(s,1380,715,1530,715,'se');
text(s,'HTTPS + user JWT',100,692,650,42,28,C.muted);
text(s,'Vercel SPA configuration present. Applied migrations and live hosting require confirmation.',100,962,1720,36,24,C.muted);
}

// 06 — Simplified real-entity graph; 1:N labels, scoped omission explained.
{
const s=add(5);sub(s,'Key product and transaction relationships   ·   simplified 1:N overview');
const prod=box(s,'products\ncurrent_stock, store_id',100,300,460,130,C.surface,34);
const options=box(s,'product_selling_options\nproduct_id, multiplier',730,300,530,130,C.surface,30);
const sale=box(s,'sales\nstore_id, cashier_id, total',1410,300,410,130,C.surface,31);
const restock=box(s,'restock_history\nproduct_id, base_units_added',100,655,460,140,C.surface,29);
const items=box(s,'sale_items\nsale_id, product_id\nselling_option_id, snapshots',730,625,530,170,C.surface,31);
const move=box(s,'inventory_movements\nproduct_id, stock_before\nstock_after, reference_id',1410,655,410,155,C.surface,27);
conn(s,prod,options);text(s,'1 : N',615,328,110,40,25,C.cyan);
conn(s,prod,restock,'bottom','top');text(s,'1 : N',310,520,110,40,25,C.cyan);
conn(s,options,items,'bottom','top');text(s,'1 : N',1020,513,110,40,25,C.cyan);
s.shapes.connect(sale,items,{kind:'elbow',fromSide:'left',toSide:'right',line:{fill:C.blue,width:3},tail:{type:'triangle'}});text(s,'1 : N',1290,525,110,40,25,C.cyan);
s.shapes.connect(prod,items,{kind:'elbow',fromSide:'right',toSide:'left',line:{fill:C.blue,width:3},tail:{type:'triangle'}});text(s,'1 : N',587,543,110,40,25,C.cyan);
segment(s,100,365,60,365);segment(s,60,365,60,840);segment(s,60,840,1615,840);segment(s,1615,840,1615,810,'e');text(s,'1 : N',1640,818,110,40,25,C.cyan);
// Movement references are described in a readable note rather than crossing the entity graph.
text(s,'Stock history references products. Sale movements also record the sale ID.',100,871,1720,50,31,C.blue);
text(s,'stores / profiles / store_users enforce scope. Receipt, payment, lot and supplier entities omitted for readability.',100,944,1720,42,24,C.muted);
}

// 07 — Three mechanisms, workflows remain editable.
{
const s=add(6);
const row=(y,num,title,parts,note)=>{text(s,num,100,y,85,65,43,C.blue,true);text(s,title,220,y,1600,55,37,C.ink,true);const w=470;let nodes=parts.map((v,i)=>box(s,v,220+i*565,y+82,w,95,C.surface,29));conn(s,nodes[0],nodes[1]);conn(s,nodes[1],nodes[2]);text(s,note,220,y+196,1590,48,29,C.muted);};
row(255,'01','Database-validated checkout',['Cart + payment','Role, stock, price checks','Commit sale + stock'],'process_pos_sale_v4 calls v3. Row locks and exceptions protect the transaction.');
row(490,'02','Bulk sales use base-unit stock',['2 packs × 6 pieces','12 base units required','24 pieces become 12'],'Illustrative arithmetic only. The stock-deduction trigger uses the configured multiplier.');
row(725,'03','Receiving separates stock from price approval',['Receive configured units','Record cost + stock history','Review suggested price'],'receive_product_stock calls the receiving function. An authorized action applies a price change.');
}

// 08 — Native editable permission matrix.
{
const s=add(7);sub(s,'Interface gates and backend authorization form separate layers');
const vals=[['Role','POS','Products / stock','Reports','User setup'],['Admin','Desktop','Assigned stores','Sales + inventory','Scoped users'],['Cashier','Assigned store','No management','POS history','No'],['Inventory','No','Permitted stock work','Inventory only','No'],['Super Admin','No','No store workspace','No store reports','Invite codes']];
const table=s.tables.add({rows:5,columns:5,left:100,top:305,width:1720,height:420,columnWidths:[320,300,420,350,330],values:vals});
for(let r=0;r<5;r++)for(let c=0;c<5;c++){let cell=table.getCell(r,c);cell.fill=r===0?'#1E3A5F':(r%2?C.surface:C.bg);cell.text.style={fontFamily:'Inter',fontSize:r===0?29:28,color:r===0?C.cyan:C.ink,bold:r===0||c===0,verticalAlignment:'middle',alignment:'left',insets:18};}
text(s,'Authentication',100,793,480,44,31,C.cyan,true);text(s,'Database boundary',680,793,500,44,31,C.cyan,true);text(s,'Assurance',1280,793,500,44,31,C.cyan,true);
text(s,'Supabase Auth\nTOTP enrollment supported',100,850,510,88,29,C.muted);
text(s,'RLS + role/store checks\nPrivileged account functions',680,850,550,88,29,C.muted);
text(s,'AAL2 when a verified\nfactor requires it',1280,850,540,88,29,C.muted);
text(s,'Repository controls are implemented. Live authorization and security evaluation remain to be verified.',100,951,1720,40,24,C.muted);
}

// 09 — Evidence levels, without fictitious acceptance metrics.
{
const s=add(8);sub(s,'Manuscript methodology: Agile Scrum');
text(s,'Plan   /   Design   /   Develop   /   Test   /   Deploy   /   Review',100,290,1720,70,39,C.blue,true);
rule(s,100,399,1720);
text(s,'Verified locally',100,460,800,55,39,C.ink,true);text(s,'Pending live evidence',1040,460,780,55,39,C.ink,true);
text(s,'7 / 7',100,545,600,130,100,C.cyan,true);text(s,'reporting unit tests passed',100,685,820,55,33);
text(s,'TypeScript check: passed\nESLint check: passed',100,775,800,110,34,C.muted);
text(s,'Checkout, stock and RLS integration\nMFA and deployed migration checks\nIntended-user acceptability evaluation',1040,565,780,245,34,C.muted);
text(s,'Integration harness exists but was not run. It creates and deletes records. CI can skip it.',1040,841,770,95,28,C.amber);
text(s,'Local results: 20 October 2026. Unit results do not establish end-to-end readiness or ISO compliance.',100,952,1720,45,24,C.muted);
}

// 10 — Native demo sequence with initial state and expected validation.
{
const s=add(9);sub(s,'Proposed sequence after an authorized operator prepares the demonstration environment');
text(s,'Initial state',100,293,360,50,35,C.cyan,true);
text(s,'Cleared business records',100,365,600,56,34);text(s,'Schema and infrastructure retained',100,444,660,90,34);text(s,'Required Auth and configuration retained',100,563,660,100,34);
text(s,'Preparation is pending.\nNo reset was performed for this task.',100,759,660,105,31,C.amber);
const names=['Login','Product setup','Receive stock','POS sale','Verify deduction','Verify reports'];
names.forEach((v,i)=>{let y=292+i*89;text(s,String(i+1).padStart(2,'0'),850,y,85,55,35,C.blue,true);text(s,v,960,y,860,57,36);if(i<5)rule(s,960,y+66,860);});
text(s,'Validation target: persisted transaction, matching stock arithmetic, reports from recorded activity',850,858,970,105,31,C.cyan);
}

// 11 — Limitations vs proposals, deterministic behavior rationale.
{
const s=add(10);
text(s,'Current limitations',100,265,800,60,40,C.ink,true);text(s,'Potential future work',1040,265,780,60,40,C.ink,true);
const left=['Online-first with bounded queues','No automatic offline conflict resolution','Live migration and RLS evidence pending','No full accounting or tax-filing system'];
const right=['Queue recovery and conflict handling','Broader concurrency and role tests','Receipt OCR, subject to scope approval','Forecasting, subject to validation'];
left.forEach((a,i)=>{text(s,a,100,375+i*107,810,95,34,C.muted);});
right.forEach((a,i)=>{text(s,a,1040,375+i*107,780,95,34,C.muted);});
rule(s,100,846,1720);
text(s,'Rule-based calculations fit the current scope',100,883,1720,55,39,C.cyan,true);
text(s,'Configured conversions and recorded consumption support explainable stock decisions. No AI/ML claim.',100,949,1720,44,28,C.muted);
}

// 12 — Minimal transition.
{
const s=add(11);s.shapes.items[0].text='Kodigo';
text(s,'Connected sales and inventory',100,268,1700,92,62,C.ink,true);
text(s,'Database validation\nBase-unit stock calculations\nRole and store authorization',100,423,1700,218,44,C.muted);
text(s,'Repository evidence supports evaluation.\nLive behavior and deployment checks remain.',100,717,1500,100,34,C.blue);
text(s,'LIVE SYSTEM DEMONSTRATION',100,894,1720,75,52,C.cyan,true);
}

// Documentation mirrors the editable notes and the verified slide narrative.
const time=n=>`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;
let t=0;
let outline='# Kodigo pre-defense presentation outline\n\n12 main slides. Target: 14 minutes 20 seconds, excluding the live walkthrough and Q&A. Widescreen 1920 × 1080. Sources are recorded in editable slide notes.\n\n';
outline+='| Slide | Topic | Presenter | Duration | Elapsed |\n|---|---|---|---|---|\n';
for(let i=0;i<data.length;i++){t+=data[i].seconds;outline+=`| ${i+1} | ${data[i].title} | ${data[i].presenter} | ${time(data[i].seconds)} | ${time(t)} |\n`;}
outline+='\nAssignments are delivery roles only, not claims of personal authorship. Presenter 1: slides 1–4. Presenter 2: slides 5–8. Presenter 3: slides 9–12.\n\n';
for(let i=0;i<data.length;i++)outline+=`## Slide ${i+1}: ${data[i].title}\n\n${data[i].summary}\n\nPresenter ${data[i].presenter}, ${data[i].seconds} seconds.\n\nEvidence: ${data[i].sources.join('; ')}.\n\n`;
outline+='## Academic fields\n\nNames, institution, college and official research title come from the manuscript title page. Adviser and academic year remain explicit placeholders. The manuscript says 2026, but does not establish the academic-year range. Confirm the final title, name spelling, and year with the adviser. Objective copy is condensed from Chapter 1, not a new study scope.\n';
await fs.writeFile(OUT+'/Kodigo_Presentation_Outline.md',outline);
let notes='# Kodigo speaker notes\n\nTarget: 14:20. Rehearse at a conversational pace and use the remaining time on each slide for pointing to the diagram. Bracketed instructions are preparation cues, not spoken lines. Evidence references are not spoken.\n\n';
for(let i=0;i<data.length;i++)notes+=`## Slide ${i+1}: ${data[i].title}\n\nPresenter ${data[i].presenter}. Target ${time(data[i].seconds)}.\n\n${data[i].notes}\n\nEvidence: ${data[i].sources.join('; ')}.\n\n`;
await fs.writeFile(OUT+'/Kodigo_Speaker_Notes.md',notes);

await fs.writeFile(BUILD+'/deck.proto.json',JSON.stringify(p.toProto()));
await (await PresentationFile.exportPptx(p)).save(BUILD+'/candidate.pptx');
console.log('Draft exported. Rendering all 12 slides.');
for(let i=0;i<p.slides.items.length;i++){
 let s=p.slides.items[i];let stem=`slide-${String(i+1).padStart(2,'0')}`;
 let blob=await p.export({slide:s,format:'png',scale:1});await fs.writeFile(BUILD+'/renders/'+stem+'.png',new Uint8Array(await blob.arrayBuffer()));
 let layout=await s.export({format:'layout'});await fs.writeFile(BUILD+'/renders/'+stem+'.layout.json',await layout.text());
 console.log(`Rendered ${i+1}/12`);
}
const {finalizePresentation}=await import(pathToFileURL(SKILL+'/container_tools/artifact_tool_utils.mjs').href);
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:BUILD+'/candidate.pptx',finalPath:OUT+'/Kodigo_Pre_Defense.pptx',pythonExecutable:PY,integrityValidatorPath:SKILL+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:SKILL+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','18288000,10287000','--validate-heading-fit','--require-native-table-slide','8'],explicitTotalSlideCount:12,requiredNativeTableOwnerSlides:[8],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'user_request',families:['Inter']},verifyArtifactToolImport:true,receiptPath:BUILD+'/Kodigo_Pre_Defense.validation.json'});
console.log(JSON.stringify(result));

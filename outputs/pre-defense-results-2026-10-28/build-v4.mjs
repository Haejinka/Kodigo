import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
try {
const ROOT='C:/Kodigo v0.1.0',B=ROOT+'/outputs/pre-defense-results-2026-10-28',O=ROOT+'/deliverables/pre-defense';
const SOURCE=O+'/Kodigo_Pre_Defense_SWU_Visual_Revision.pptx';
const SK='C:/Users/verga/.codex/plugins/cache/openai-primary-runtime/presentations/26.1025.11240/skills/presentations';
process.env.RUNTIME_NODE_MODULES='C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';process.env.RUNTIME_NODE=process.execPath;
const {applyPresentationChartFont,finalizePresentation}=await import(pathToFileURL(SK+'/container_tools/artifact_tool_utils.mjs').href);
const D=JSON.parse(await fs.readFile(B+'/data.json','utf8'));
const sourceBytes=await fs.readFile(SOURCE);await fs.writeFile(B+'/source-before.pptx',sourceBytes);
const p=await PresentationFile.importPptx(await FileBlob.load(SOURCE));
const original=[...p.slides.items];if(original.length!==16)throw new Error('Unexpected current deck length');
const C={blue:'#0070C0',navy:'#202C61',ink:'#171717',muted:'#595959',pale:'#D9E2F3',grid:'#A6B0BE',green:'#19713C',amber:'#9D5B00'};
const colors=['#3366CC','#DC3912','#FF9900','#109618'];
const standard=p.layouts.items.find(x=>x.name==='OBJECT');
await fs.mkdir(B+'/before',{recursive:true});await fs.mkdir(B+'/renders-v4',{recursive:true});
for(let i=0;i<original.length;i++){
 const s=original[i];await fs.writeFile(B+`/before/slide-${String(i+1).padStart(2,'0')}.json`,await(await s.export({format:'layout'})).text());
 if([1,7,15].includes(i))await fs.writeFile(B+`/before/slide-${i+1}.png`,new Uint8Array(await(await p.export({slide:s,format:'png',scale:2})).arrayBuffer()));
}
function text(s,v,x,y,w,h,size=22,color=C.ink,bold=false,font='Arial',align='left'){
 const a=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{style:'solid',fill:'none',width:0}});
 a.text=v;a.text.style={typeface:font,fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',insets:0,wrap:'square',autoFit:'none'};return a;
}
function nativeTable(s,values,x,y,w,h,widths,size=18,heights,alignCols=[]){
 const tb=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width:w,height:h,columnWidths:widths,values});
 tb.borders.assign({fill:C.grid,width:0.8,style:'solid'});
 for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){
  const cell=tb.getCell(r,c);cell.fill=r===0?C.pale:'#FFFFFF';
  cell.text.style={typeface:'Cambria',fontSize:size,color:C.ink,bold:r===0,verticalAlignment:'middle',alignment:r===0||alignCols.includes(c)?'center':'left',insets:4,wrap:'square'};
 }
 if(heights)heights.forEach((height,i)=>tb.rows[i].height=height);
 return tb;
}
async function newSlide(title){
 const s=p.slides.add({layoutId:standard.id});
 s.images.add({blob:await fs.readFile(ROOT+'/outputs/pre-defense-swu-build/assets/phinma-wordmark.png'),contentType:'image/png',position:{left:690,top:25,width:235,height:80},fit:'contain',alt:'Original PHINMA Education wordmark retained from the defense template'});
 text(s,title,56,48,605,58,33.6,C.blue,true,'Raleway');return s;
}
function setNotes(s,presenter,seconds,script,evidence){s.speakerNotes.text=`Presenter ${presenter}. Target ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}.\n\n${script}\n\nEvidence (not spoken):\n${evidence}\n\nDesign follows the supplied RQ1 examples and the existing SWU/PHINMA defense deck. SWU branding remains limited to the cover.`;}
function pie(s,title,data,x){
 const chart=s.charts.add('pie',{position:{left:x,top:285,width:420,height:207},title,titleTextStyle:{fontSize:19,fill:C.ink},categories:data.categories.map(x=>x.replace('Owner/Manager','Owner /\nManager').replace('Stock Custodian','Stock\nCustodian').replace('Cashier/Sales Encoder','Cashier / Sales\nEncoder').replace('Operations Staff','Operations\nStaff').replace('Less than 1 year','Less than\n1 year').replace('More than 5 years','More than\n5 years')),series:[{name:'Respondents',values:data.counts,valuesFormatCode:'0',points:colors.map((fill,idx)=>({idx,fill,line:{style:'solid',fill:'#FFFFFF',width:1}}))}],hasLegend:true,legend:{position:'right',overlay:false,textStyle:{fontSize:13,fill:C.ink}},dataLabels:{showPercent:true,showValue:false,position:'bestFit',numberFormatCode:'0.0%',numberFormatSourceLinked:false,textStyle:{fontSize:13,fill:'#FFFFFF'}},pieOptions:{firstSliceAngle:90},chartFill:'#FFFFFF',chartLine:{style:'solid',fill:'none',width:0},plotAreaFill:'#FFFFFF',plotAreaLine:{style:'solid',fill:'none',width:0}});
 applyPresentationChartFont(chart,{fontFamily:'Arial'});return chart;
}
const rq1=[];
// RQ1 participation and respondent profile, matching the reference composition.
{
 const s=await newSlide('Results and findings of RQ1');rq1.push(s);
 text(s,'Participation and respondent profile',56,119,846,29,23,C.navy,true);
 const tb=nativeTable(s,D.participation,56,155,846,116,[380,150,150,166],20,[44,36,36],[1,2,3]);
 pie(s,'Role in the organization',D.roles,46);pie(s,'Years in current role',D.years,494);
 setNotes(s,1,20,'The RQ1 evidence includes all eighteen targeted pre-survey respondents and all five interview transcripts. Both completion rates are one hundred percent. Operations staff form the largest role group, and respondents include both new and experienced personnel. These are baseline participants, not post-use acceptability respondents.','Current manuscript, Chapter 4 Response Rate and Figure 4.1. Counts of 6, 2, 3, 7 and 5, 2, 6, 5 reproduce the displayed percentages for n=18. User reference images 1 and 2.');
}
// RQ1 tasks, with native editable horizontal bars and source percentages.
{
 const s=await newSlide('Results and findings of RQ1');rq1.push(s);
 const data={categories:[...D.tasks.categories].reverse(),counts:[...D.tasks.counts].reverse()};const chart=s.charts.add('bar',{position:{left:56,top:126,width:846,height:335},title:'Primary tasks related to inventory and finance',titleTextStyle:{fontSize:23,fill:C.navy,bold:true},categories:data.categories,series:[{name:'Respondents',values:data.counts,valuesFormatCode:'0',fill:'#4CAF50',dataLabelOverrides:data.counts.map((v,idx)=>({idx,text:`${v} (${(v/18*100).toFixed(1)}%)`,showValue:false,position:'outEnd',textStyle:{fontSize:17,fill:C.ink}}))}],barOptions:{direction:'bar',grouping:'clustered',gapWidth:70},hasLegend:false,xAxis:{visible:true,textStyle:{fontSize:18,fill:C.ink},line:{style:'solid',fill:'#777777',width:0.8},majorGridlines:null},yAxis:{visible:true,min:0,max:15,majorUnit:5,textStyle:{fontSize:16,fill:C.muted},line:{style:'solid',fill:'#777777',width:0.8},majorGridlines:{style:'solid',fill:'#E5E7EB',width:0.8}},dataLabels:{showValue:false,position:'outEnd',textStyle:{fontSize:17,fill:C.ink}},chartFill:'#FFFFFF',chartLine:{style:'solid',fill:'none',width:0},plotAreaFill:'#FFFFFF',plotAreaLine:{style:'solid',fill:'none',width:0}});
 applyPresentationChartFont(chart,{fontFamily:'Arial'});
 text(s,'18 respondents. Multiple answers allowed, so percentages do not total 100%.',56,468,846,24,17,C.muted);
 setNotes(s,1,25,'Reporting is the most frequently selected task, with thirteen of eighteen respondents. Stock counts follow with twelve. Ten respondents handle receiving and ten handle stock issuance or sales logging. Since participants could select several tasks, the percentages overlap. This profile shows that the diagnosed record problems affect connected daily responsibilities.','Current manuscript Figure 4.1, primary-tasks chart. Counts and labels match user reference image 2. Denominator n=18.');
}
// Retain the existing quantitative baseline evidence as its own slide.
rq1.push(original[7]);
setNotes(original[7],1,25,'The baseline establishes the scale of the problem. Thirteen respondents report an inventory update delay of sixteen minutes or more. Twelve report at least three discrepancies in thirty days. Sixteen experience decision delays from uncertain information at least sometimes, and all eighteen report mismatches between records at least sometimes. These describe the existing workflow, not measured improvements from Kodigo.','Current manuscript Table 4.1. Four selected baseline indicators retained from the preceding presentation.');
// Full qualitative table across two slides, with all five themes and exact quotes.
for(const [part,rows,seconds] of [[1,D.themes.slice(1,4),30],[2,D.themes.slice(4),25]]){
 const s=await newSlide('Results and findings of RQ1');rq1.push(s);
 text(s,`Interview themes  ${part} / 2`,298,496,604,22,15,C.muted);
 const heights=part===1?[52,100,100,100]:[52,150,150];
 nativeTable(s,[D.themes[0],...rows],56,130,846,heights.reduce((a,b)=>a+b),[195,200,250,201],part===1?16:18,heights);
 setNotes(s,1,seconds,part===1?'The interviews explain how the baseline problems develop. First, fragmented records prevent one dependable view of operations. Second, delayed updates mean that an accurate picture can arrive after a decision is needed. Third, inaccurate records affect customer promises, fulfillment and restocking. The quotations on the slide are the manuscript’s illustrative excerpts.':'The remaining themes concern the cost of correction and the basis of trust. Recounting and after-hours verification draw effort away from normal operations. When records conflict, staff return to physical counts, signed slips and receipts. Together, these themes show why digitizing isolated records alone does not resolve the problem.',`Current manuscript Table 4.4, rows ${part===1?'1–3':'4–5'}. All five themes, sub-themes, illustrative quotes and operational meanings are retained across the two slides. User reference images 3 and 4.`);
}
// Synthesis follows the reference's single dark text area, with concise source-based wording.
{
 const s=await newSlide('Results and findings of RQ1');rq1.push(s);
 s.shapes.add({geometry:'rect',position:{left:56,top:143,width:846,height:333},fill:'#171717',line:{style:'solid',fill:'none',width:0}});
 const rows=[['Operational bottlenecks','Delayed updates and discrepancies slow restocking and disrupt customer service.'],['Data inconsistency','Staff compare several records before deciding which figures to trust.'],['Financial impact','Recounting, overtime and emergency purchases add work and avoidable costs.'],['Overall finding','Routine decisions need a shared, timely and auditable record.']];
 rows.forEach(([h,b],i)=>{let y=154+i*79;text(s,h,75,y,808,25,22,'#FFFFFF',true);text(s,b,75,y+28,808,43,22,'#FFFFFF');});
 setNotes(s,1,25,'The survey and interviews converge on one operational finding: fragmented and delayed records make routine decisions depend on repeated checking. The effects include slower replenishment, customer-service disruption and avoidable correction costs. This supports Kodigo’s focus on connected records, while any claim of measured improvement still requires post-implementation evidence. I will now hand over to Presenter 2 for the developed system.','Current manuscript Table 4.5 and RQ1 Summary of Findings. User reference image 5 supplies the synthesis layout. The wording avoids an unverified claim of continuous real-time operation.');
}
const rq2=[];
{
 const s=await newSlide('Results and findings of RQ2');rq2.push(s);
 text(s,'AI-assisted technical assessment, 27 October 2026',56,119,846,29,22,C.navy,true);
 const values=[['Verification','Result','Evidence'],['Build, TypeScript and lint','Passed','Local checks completed'],['Unit tests','17 / 17','Calculation checks passed'],['Controlled database scenarios','20 / 22','2 authorization failures'],['Anonymous browser routes','4 / 4','Redirected to login'],['TLS and anonymous API checks','4 / 4','TLS 1.3 and HTTP 401'],['Client credential scan','105 files','No matching secret patterns'],['Live database controls','36 tables / 8 views','RLS / invoker security']];
 const tb=nativeTable(s,values,56,159,846,320,[398,166,282],18,Array(8).fill(40),[1]);
 text(s,'Executed test outcomes. These are separate from expert-survey ratings.',285,489,617,23,15,C.muted);
 setNotes(s,3,45,'The technical assessment on October twenty-seven combined local checks, live deployment inspection and controlled scenarios. TypeScript, lint and production build passed. All seventeen unit tests passed. Twenty of twenty-two database scenarios passed, while four anonymous route checks and four HTTPS or API checks also passed. All thirty-six inspected public tables had RLS enabled and all eight views used invoker security. These counts represent technical checks from an AI-assisted assessment, not ratings from human experts. The next slide explains the two failures.','Revised thesis Table 4.6 and Kodigo_RQ2_Technical_Validation_Report.md. Assessment date 27 October 2026. Source evidence: outputs/rq2-validation-2026-10-27/. Database checks simulated roles and JWT claims inside rollback-only transactions. Browser checks used the local production preview. No new validation run is claimed for 28 October.');
}
{
 const s=await newSlide('Results and findings of RQ2');rq2.push(s);
 text(s,'Authorization failures observed on 27 October 2026',56,119,846,29,22,C.navy,true);
 const values=[['Finding','Priority','Observed behavior and required action'],['MFA assurance for store creation','High','An MFA-enrolled account at AAL1 created a store.\nEnforce assurance in the privileged function and retest.'],['Anonymous audit-event creation','Medium','An anonymous caller inserted an audit event through an RPC.\nRestrict execution, validate the caller and retest.']];
 const tb=nativeTable(s,values,56,162,846,240,[230,115,501],20,[44,98,98],[1]);
 for(const [r,color] of [[1,'#B42318'],[2,C.amber]])tb.getCell(r,1).text.style={typeface:'Cambria',fontSize:20,color,alignment:'center',verticalAlignment:'middle',insets:4,wrap:'square'};
 text(s,'Conditional technical suitability',56,418,846,37,29,C.navy,true,'Raleway');
 text(s,'Remediation and retesting are required for a full security pass.',56,458,846,29,22);
 setNotes(s,3,45,'The two observed failures limit the security conclusion. A synthetic Admin with a verified MFA factor could create a store while its simulated session was still at AAL1. Separately, the anonymous role could insert an audit event through a database function. The first requires consistent assurance checks for privileged operations. The second requires restricted execution and caller validation. All test fixtures were rolled back. The conclusion is conditional technical suitability, with remediation and retesting still required for the assessed state. These results do not complete the separate qualified-evaluator survey requirement or RQ3 acceptability evaluation.','Revised thesis Table 4.7 and technical answer to RQ2. Failed scenarios DB17 and DB20 in controlled-security-results-v2.json. Follow-up cleanup verification recorded zero synthetic Auth users, stores, products and audit events. No production remediation or later retest is claimed.');
}
// Source slides and native diagrams retain their identities and sequence.
const ordered=[...original.slice(0,7),...rq1,...original.slice(8,15),...rq2,original[15]];
const canonicalIds=[];for(const s of ordered){const l=JSON.parse(await(await s.export({format:'layout'})).text());canonicalIds.push(l.slide.id);}
p.slides.reorder(canonicalIds);
if(p.slides.items.length!==23)throw new Error('Expected 23 slides');
// Update agenda wording for the added evidence, retaining its established layout.
for(const shape of original[1].shapes.items){
 const v=shape.text?.toString?.();
 if(v==='Methodology\nBaseline findings for RQ1')shape.text='Methodology\nRQ1 survey and interview findings';
 if(v==='Testing evidence and limitations\nDemonstration sequence')shape.text='RQ2 technical assessment and limitations\nDemonstration sequence';
}
const seconds=[30,20,55,40,40,40,55,20,25,25,30,25,25,40,40,40,60,45,50,45,45,45,60];
if(seconds.reduce((a,b)=>a+b,0)!==900)throw new Error('Timing must total 15 minutes');
for(let i=0;i<ordered.length;i++){
 const s=ordered[i];const presenter=i<13?1:i<19?2:3;
 s.speakerNotes.text=s.speakerNotes.text.replace(/^Presenter \d+\. Target [^\n]+/,`Presenter ${presenter}. Target ${Math.floor(seconds[i]/60)}:${String(seconds[i]%60).padStart(2,'0')}.`);
 for(const sh of s.shapes.items)if(/^01 \/ \d+$/.test(sh.text?.toString?.()??''))sh.text='01 / 23';
}
await(await PresentationFile.exportPptx(p)).save(B+'/candidate-v4.pptx');
const layouts=[];
for(let i=0;i<ordered.length;i++){
 const s=ordered[i],stem='slide-'+String(i+1).padStart(2,'0');
 await fs.writeFile(B+'/renders-v4/'+stem+'.png',new Uint8Array(await(await p.export({slide:s,format:'png',scale:2})).arrayBuffer()));
 const layout=JSON.parse(await(await s.export({format:'layout'})).text());layouts.push(layout);
 await fs.writeFile(B+'/renders-v4/'+stem+'.json',JSON.stringify(layout,null,2));console.log('Rendered',i+1,'/ 23');
}
await fs.writeFile(B+'/slide-map.json',JSON.stringify(ordered.map((s,i)=>({slide:i+1,id:canonicalIds[i],presenter:i<13?1:i<19?2:3,seconds:seconds[i],sourceSlide:original.indexOf(s)+1||null,title:layouts[i].elements.find(e=>e.text&&e.position?.top===48)?.text??'Kodigo'})),null,2));
const tableOwners=[8,10,11,12,21,22],chartOwners=[8,9];
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:B+'/candidate-v4.pptx',finalPath:B+'/final-v4.pptx',pythonExecutable:'C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:SK+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:SK+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','9144000,5143500','--validate-heading-fit',...tableOwners.flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:23,requiredNativeTableOwnerSlides:tableOwners,requiredNativeChartOwnerSlides:chartOwners,materializeLiteralChartWorkbooks:true,fontPolicy:{basis:'reference',families:['Raleway','Cambria','Arial'],referencePath:SOURCE,referenceSha256:crypto.createHash('sha256').update(sourceBytes).digest('hex')},verifyArtifactToolImport:true,receiptPath:B+'/validation-v4.json'});
console.log('Finalized',result.finalPath);

} catch(e) { console.error(e.name+': '+e.message); console.error(e.stack?.split('\n').filter(x=>x.includes('/outputs/')).join('\n')??''); process.exitCode=1; }


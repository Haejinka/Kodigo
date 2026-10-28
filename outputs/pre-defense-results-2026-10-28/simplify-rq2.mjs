import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
try {
const ROOT='C:/Kodigo v0.1.0', B=ROOT+'/outputs/pre-defense-results-2026-10-28', O=ROOT+'/deliverables/pre-defense';
const SOURCE=O+'/Kodigo_Pre_Defense_Updated.pptx';
const SK='C:/Users/verga/.codex/plugins/cache/openai-primary-runtime/presentations/26.1025.11240/skills/presentations';
process.env.RUNTIME_NODE_MODULES='C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';process.env.RUNTIME_NODE=process.execPath;
const {finalizePresentation}=await import(pathToFileURL(SK+'/container_tools/artifact_tool_utils.mjs').href);
const p=await PresentationFile.importPptx(await FileBlob.load(SOURCE));
if(p.slides.items.length!==23)throw new Error('Unexpected slide count');
await fs.mkdir(B+'/rq2-simple',{recursive:true});
function replace(slide,oldText,newText){const shape=slide.shapes.items.find(s=>s.text?.toString?.()===oldText);if(!shape)throw new Error('Missing source text: '+oldText);shape.text=newText;return shape;}
function updateTable(slide,values,widths,heights,size){
 const table=slide.tables.items[0];if(!table)throw new Error('Missing native table');
 if(table.rows.length>values.length)table.deleteRows({index:values.length,count:table.rows.length-values.length});
 widths.forEach((w,i)=>table.columns.get(i).width=w);
 heights.forEach((h,i)=>table.rows[i].height=h);
 values.forEach((row,r)=>row.forEach((value,c)=>{const cell=table.getCell(r,c);cell.value=value;cell.fill=r===0?'#D9E2F3':'#FFFFFF';cell.text.style={typeface:'Cambria',fontSize:size,color:'#171717',bold:r===0,verticalAlignment:'middle',alignment:r===0||c===1&&values.length===6?'center':'left',insets:5,wrap:'square'};}));
}
for(const i of [20,21]){
 const s=p.slides.items[i];await fs.writeFile(B+`/rq2-simple/before-${i+1}.json`,await(await s.export({format:'layout'})).text());
 await fs.writeFile(B+`/rq2-simple/before-${i+1}.png`,new Uint8Array(await(await p.export({slide:s,format:'png',scale:2})).arrayBuffer()));
}
const a=p.slides.items[20],b=p.slides.items[21];
replace(a,'AI-assisted technical assessment, 27 October 2026','System checks, 27 October 2026');
replace(a,'Executed test outcomes. These are separate from expert-survey ratings.','AI-assisted system checks. Detailed evidence is in the speaker notes.');
updateTable(a,[
 ['What was checked','Result','What it means'],
 ['Application build','Passed','The application built without errors.'],
 ['Sales calculations','17 of 17 passed','Tested calculations gave the expected results.'],
 ['Login protection','4 of 4 passed','Protected pages required users to sign in.'],
 ['Access rules','20 of 22 passed','Two security gaps still need fixing.'],
 ['Data protection','Controls present','Secure connections and record-access limits were confirmed.']
],[245,170,431],[45,55,55,55,55,55],20);
replace(b,'Authorization failures observed on 27 October 2026','Two issues found during the system checks');
updateTable(b,[
 ['Area','What was found','What needs to change'],
 ['Store creation','The extra identity check could be bypassed.','Require the check before allowing store creation.'],
 ['Activity history','Someone who was not signed in could add an activity record.','Only authorized users should add these records.']
],[200,340,306],[44,98,98],21);
replace(b,'Conditional technical suitability','Two security gaps still need fixing');
replace(b,'Remediation and retesting are required for a full security pass.','Fix both gaps and test again before giving a full security pass.');
const oldA=a.speakerNotes.text,oldB=b.speakerNotes.text;
a.speakerNotes.text='Presenter 3. Target 0:45.\n\nThe system passed the application build checks, all seventeen calculation tests and all four protected-page checks. Twenty of twenty-two access-rule checks passed. Secure connections and record-access controls were also confirmed. The main finding is that basic safeguards are present, but two security gaps still need fixing. These are results of AI-assisted system checks conducted on 27 October 2026.\n\nTechnical details and evidence for questions:\n'+oldA;
b.speakerNotes.text='Presenter 3. Target 0:45.\n\nTwo issues remain. First, an administrator could create a store before completing the extra identity check. Second, a person who was not signed in could add an entry to the activity history. The system must enforce the identity check and restrict who can add activity records. Both fixes must be tested before giving a full security pass.\n\nTechnical details and evidence for questions:\n'+oldB;
for(const i of [20,21]){
 const s=p.slides.items[i];await fs.writeFile(B+`/rq2-simple/after-${i+1}.json`,await(await s.export({format:'layout'})).text());
 await fs.writeFile(B+`/rq2-simple/after-${i+1}.png`,new Uint8Array(await(await p.export({slide:s,format:'png',scale:2})).arrayBuffer()));
}
const candidate=B+'/rq2-simple/candidate.pptx';await(await PresentationFile.exportPptx(p)).save(candidate);
const tableOwners=[8,10,11,12,21,22];
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:candidate,finalPath:O+'/Kodigo_Pre_Defense_Simplified_RQ2.pptx',pythonExecutable:'C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:SK+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:SK+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','9144000,5143500','--validate-heading-fit',...tableOwners.flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:23,requiredNativeTableOwnerSlides:tableOwners,requiredNativeChartOwnerSlides:[8,9],materializeLiteralChartWorkbooks:true,fontPolicy:{basis:'reference',families:['Raleway','Cambria','Arial'],referencePath:SOURCE,referenceSha256:crypto.createHash('sha256').update(await fs.readFile(SOURCE)).digest('hex')},verifyArtifactToolImport:true,receiptPath:B+'/rq2-simple/validation.json'});
console.log('Finalized',result.finalPath);
}catch(e){console.error(e.name+': '+e.message);process.exitCode=1;}


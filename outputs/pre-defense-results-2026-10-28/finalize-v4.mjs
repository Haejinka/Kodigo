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
const sourceBytes=await fs.readFile(SOURCE);
const tableOwners=[8,10,11,12,21,22],chartOwners=[8,9];
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:B+'/candidate-v4.pptx',finalPath:O+'/Kodigo_Pre_Defense_RQ1_RQ2_Results_Final.pptx',pythonExecutable:'C:/Users/verga/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:SK+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:SK+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','9144000,5143500','--validate-heading-fit',...tableOwners.flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:23,requiredNativeTableOwnerSlides:tableOwners,requiredNativeChartOwnerSlides:chartOwners,materializeLiteralChartWorkbooks:true,fontPolicy:{basis:'reference',families:['Raleway','Cambria','Arial'],referencePath:SOURCE,referenceSha256:crypto.createHash('sha256').update(sourceBytes).digest('hex')},verifyArtifactToolImport:true,receiptPath:B+'/validation-v4.json'});
console.log('Finalized',result.finalPath);

} catch(e) { console.error(e.name+': '+e.message); console.error(e.stack?.split('\n').filter(x=>x.includes('/outputs/')).join('\n')??''); process.exitCode=1; }



import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
const out='C:/Kodigo v0.1.0/outputs/rq2-validation-2026-10-27';
const cwd='C:/Kodigo v0.1.0/kodigo-ui';await fs.mkdir(out,{recursive:true});
const jobs=[['typecheck',['node_modules/typescript/bin/tsc','-b']],['lint',['node_modules/eslint/bin/eslint.js','.']],['unit',['--experimental-strip-types','--test','scripts/unit/consignment-calculations.test.mjs','scripts/unit/reporting-calculations.test.mjs']]];
async function run(name,args){const start=new Date();const r=await new Promise(resolve=>{let stdout='',stderr='';const c=spawn(process.execPath,args,{cwd,env:process.env,windowsHide:true});c.stdout.on('data',x=>stdout+=x);c.stderr.on('data',x=>stderr+=x);c.on('close',code=>resolve({code,stdout,stderr}));c.on('error',e=>resolve({code:-1,stdout,stderr:String(e)}));});await fs.writeFile(out+'/'+name+'.log',r.stdout+r.stderr);const result={name,command:'node '+args.join(' '),started:start.toISOString(),finished:new Date().toISOString(),exitCode:r.code,log:name+'.log'};console.log(JSON.stringify(result));return result;}
const results=await Promise.all(jobs.map(([name,args])=>run(name,args)));
if(results.find(x=>x.name==='typecheck').exitCode===0)results.push(await run('build',['node_modules/vite/bin/vite.js','build']));
const credentialNames=['KODIGO_TEST_SUPABASE_URL','KODIGO_TEST_SUPABASE_ANON_KEY','KODIGO_TEST_SUPABASE_SERVICE_ROLE_KEY'];
const envKeys=new Set(Object.keys(process.env));for(const file of ['.env','.env.local','.env.test','.env.test.local']){try{const t=await fs.readFile(cwd+'/'+file,'utf8');for(const m of t.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm))envKeys.add(m[1]);}catch{}}
const serviceCredentialAvailable=envKeys.has(credentialNames[2]);
await fs.writeFile(out+'/local-checks.json',JSON.stringify({results,integrationTestCredentialAvailable:serviceCredentialAvailable,packageLockSha256:crypto.createHash('sha256').update(await fs.readFile(cwd+'/package-lock.json')).digest('hex')},null,2));
console.log('Integration service credential available:',serviceCredentialAvailable);

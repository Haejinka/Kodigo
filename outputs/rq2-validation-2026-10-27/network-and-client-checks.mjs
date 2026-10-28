import fs from 'node:fs/promises';
import tls from 'node:tls';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root='C:/Kodigo v0.1.0',cwd=root+'/kodigo-ui',out=root+'/outputs/rq2-validation-2026-10-27';
const env={...process.env};for(const f of ['.env','.env.local']){try{for(const line of(await fs.readFile(cwd+'/'+f,'utf8')).split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}}catch{}}
const u=new URL(env.VITE_SUPABASE_URL);const key=env.VITE_SUPABASE_ANON_KEY;
const network=[];
network.push(await new Promise(resolve=>{const sock=tls.connect({host:u.hostname,port:443,servername:u.hostname,rejectUnauthorized:true},()=>{const c=sock.getPeerCertificate();resolve({id:'NET01',test:'Backend HTTPS certificate and encrypted connection',passed:sock.authorized,protocol:sock.getProtocol(),validTo:c.valid_to});sock.end();});sock.setTimeout(15000,()=>{sock.destroy();resolve({id:'NET01',passed:false,error:'timeout'});});sock.on('error',e=>resolve({id:'NET01',passed:false,error:e.message}));}));
for(const [id,path,method,body] of [['NET02','/rest/v1/products?select=id&limit=1','GET'],['NET03','/functions/v1/admin-users','POST',{action:'list'}],['NET04','/functions/v1/generate-invite','POST',{}]]){
 try{const r=await fetch(u.origin+path,{method,headers:{apikey:key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});network.push({id,test:id==='NET02'?'Anonymous direct product request denied':'Unauthenticated privileged Edge Function denied',path:path.split('?')[0],status:r.status,passed:[401,403].includes(r.status)});}catch(e){network.push({id,passed:false,error:e.message});}
}
// Scan concrete key formats, not innocuous strings such as a server variable name.
const hits=[];let scanned=0;
async function walk(dir){let ents;try{ents=await fs.readdir(dir,{withFileTypes:true});}catch{return;}for(const e of ents){const p=dir+'/'+e.name;if(e.isDirectory())await walk(p);else if(/\.(?:ts|tsx|js|mjs|json|html|css)$/.test(e.name)){scanned++;const s=await fs.readFile(p,'utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]{15,}|sk-proj-[A-Za-z0-9_-]{15,}/.test(s))hits.push(p.replace(root+'/',''));for(const m of s.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)){try{if(JSON.parse(Buffer.from(m[1],'base64url')).role==='service_role')hits.push(p.replace(root+'/',''));}catch{}}}}}
for(const d of ['src','public','dist'])await walk(cwd+'/'+d);
const report={network,clientSecretScan:{passed:hits.length===0,filesScanned:scanned,matchingFiles:[...new Set(hits)],scope:'Concrete private keys, Supabase secret keys and JWT service-role credentials in source/public/built artifacts; no credential values recorded'}};
// Anonymous route checks use a local preview and do not sign in or write records.
const require=createRequire(cwd+'/package.json');const {chromium}=require('playwright');
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4179','--strictPort'],{cwd,stdio:'ignore',windowsHide:true});
try{
 for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:4179/login');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 let browser;try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
 report.browser=[];
 try{for(const path of ['/dashboard','/inventory','/pos','/super-admin']){const page=await browser.newPage();await page.goto('http://127.0.0.1:4179'+path);await page.waitForURL('**/login',{timeout:20000});report.browser.push({route:path,expected:'/login',actual:new URL(page.url()).pathname,passed:true});if(path==='/dashboard')await page.screenshot({path:out+'/anonymous-route-login.png',fullPage:true});await page.close();}}finally{await browser.close();}
}catch(e){report.browserError=String(e);}finally{child.kill();}
await fs.writeFile(out+'/network-and-client-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));

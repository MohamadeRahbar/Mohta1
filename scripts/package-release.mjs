import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
assert(/^\d+\.\d+\.\d+$/.test(version));
const output=path.join(root,'artifacts'),name='mohta1-v'+version;
fs.mkdirSync(output,{recursive:true});
const stage=fs.mkdtempSync(path.join(output,name+'-'));
// A positive allowlist prevents installation data and local review tools from entering releases.
const entries=['server.mjs','package.json','src','public','scripts','docs','deploy','LICENSES','README.md','CHANGELOG.fa.md','Dockerfile'];
function files(directory,prefix=''){
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  assert(!entry.isSymbolicLink(),'Release source must not contain symlinks');
  const name=path.posix.join(prefix,entry.name);return entry.isDirectory()?files(path.join(directory,entry.name),name):[name];
 });
}
const sources=entries.flatMap(entry=>fs.statSync(path.join(root,entry)).isDirectory()?files(path.join(root,entry),entry):[entry]);
for(const file of sources){
 assert(!/(^|\/)(data|backups|qa-local|review-evidence|node_modules|\.git)(\/|$)|\.(sqlite(?:-.*)?|db(?:-.*)?|key|log)$|(^|\/)\.env(?:\.|$)/i.test(file),'Private file in package: '+file);
 const dest=path.join(stage,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,file),dest);
}
const sha=file=>createHash('sha256').update(fs.readFileSync(path.join(stage,file))).digest('hex');
fs.writeFileSync(path.join(stage,'release.json'),JSON.stringify({version,files:Object.fromEntries(sources.map(file=>[file,sha(file)]))},null,2)+'\n');
const archive=path.join(output,name+'.tar.gz'),temporary=stage+'.tar.gz';
try{
 execFileSync('tar',['-czf',temporary,'-C',stage,'.'],{stdio:'pipe'});
 fs.renameSync(temporary,archive);
}finally{
 // Only remove this invocation's generated staging directory, never a user-supplied path.
 assert(path.dirname(stage)===output&&path.basename(stage).startsWith(name+'-'));
 fs.rmSync(stage,{recursive:true,force:true});
 if(fs.existsSync(temporary))fs.unlinkSync(temporary);
}
console.log('Data-free release package: artifacts/'+name+'.tar.gz ('+sources.length+' files)');

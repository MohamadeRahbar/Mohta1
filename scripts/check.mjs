import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
function walk(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
 const name=path.join(directory,entry.name);return entry.isDirectory()?walk(name):[name];
});}
const files=['server.mjs',...['src','public','scripts','tests'].flatMap(dir=>walk(path.join(root,dir)))].filter(file=>/\.(mjs|js)$/.test(file));
for(const file of files){
 execFileSync(process.execPath,['--check',file],{cwd:root,stdio:'pipe'});
 const source=fs.readFileSync(file,'utf8');
 for(const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.{1,2}\/[^'"\s]+\.(?:mjs|js))['"]/g)){
  const target=path.resolve(path.dirname(path.resolve(root,file)),match[1]);
  if(!fs.statSync(target,{throwIfNoEntry:false})?.isFile())throw Error('Missing module: '+file+' -> '+match[1]);
 }
}
console.log('Syntax and local imports verified: '+files.length+' files.');

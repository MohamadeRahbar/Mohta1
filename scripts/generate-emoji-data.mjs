// Usage: node scripts/generate-emoji-data.mjs emoji-test.txt fa.json fa-derived.json
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const paths=process.argv.slice(2);if(paths.length!==3)throw Error('Provide Unicode emoji-test and CLDR Persian annotations/derived files');
const [source,fa,derived]=paths.map(p=>fs.readFileSync(p,'utf8'));
if(!source.includes('# Version: 17.0'))throw Error('Expected Emoji 17.0');
const annotations={...JSON.parse(fa).annotations.annotations,...JSON.parse(derived).annotationsDerived.annotations};
const groups=['چهره‌ها و احساسات','افراد و بدن','حیوانات و طبیعت','خوراکی‌ها','سفر و مکان‌ها','فعالیت‌ها','اشیا','نمادها','پرچم‌ها'];
const groupNames=['Smileys & Emotion','People & Body','Animals & Nature','Food & Drink','Travel & Places','Activities','Objects','Symbols','Flags'];
const strip=s=>s.replaceAll('\uFE0F','');const byKey=new Map(Object.entries(annotations).map(([key,value])=>[strip(key),value]));
let group=-1;const emojis=[];
for(const line of source.split(/\r?\n/)){
 if(line.startsWith('# group: '))group=groupNames.indexOf(line.slice(9));
 const match=line.match(/^([A-F0-9 ]+)\s*; fully-qualified\s*#\s*\S+\s+E[\d.]+\s+(.+)$/);if(!match)continue;
 const emoji=String.fromCodePoint(...match[1].trim().split(/\s+/).map(hex=>parseInt(hex,16))),english=match[2];
 const words=byKey.get(strip(emoji))||byKey.get(strip(emoji).replace(/[\u{1F3FB}-\u{1F3FF}]/gu,''))||{};
 emojis.push([emoji,words.tts?.[0]||english,[english,...(words.default||[])].join(' '),group]);
}
if(emojis.length!==3944||emojis.some(e=>e[3]<0))throw Error('Incomplete official emoji inventory');
const hashes=Object.fromEntries(paths.map((p,i)=>[p.split(/[\\/]/).at(-1),createHash('sha256').update([source,fa,derived][i]).digest('hex')]));
fs.writeFileSync('public/emoji-data.js','// Unicode Emoji 17.0 + Unicode CLDR Persian annotations. See LICENSES/Unicode-LICENSE.txt.\nexport const emojiVersion="17.0";\nexport const emojiGroups='+JSON.stringify(groups)+';\nexport const emojiData='+JSON.stringify(emojis)+';\n');
fs.mkdirSync('docs',{recursive:true});const previous=fs.existsSync('docs/emoji-data-sources.json')?JSON.parse(fs.readFileSync('docs/emoji-data-sources.json','utf8').replace(/^\uFEFF/,'')):{};fs.writeFileSync('docs/emoji-data-sources.json',JSON.stringify({version:'17.0',count:emojis.length,sources:['https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt','https://github.com/unicode-org/cldr-json'],hashes,...(previous.font?{font:previous.font}:{})},null,2));
console.log('Generated '+emojis.length+' fully-qualified emoji sequences');

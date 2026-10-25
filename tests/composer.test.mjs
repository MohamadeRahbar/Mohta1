import test from 'node:test';
import assert from 'node:assert/strict';
import {syncComposer,editComposer,rebuildComposer,undoComposer,signatureOf} from '../public/composer.js';
import {prepareDocument} from '../content.mjs';

const input={type:'stock',title:'Headline',fields:{brand:'HPE',model:'DL380',description:'Original'},channels:['telegram'],media:[]};
test('manual document survives changes to structured fields, title and destination, including reopen',()=>{
 let editor=syncComposer({body_mode:'generated'},input,{});
 editor=editComposer(editor,input,'Hand edited 👋 text');editor.body_entities=[{type:'bold',offset:0,length:4}];
 const changed={...input,title:'Changed headline',fields:{...input.fields,model:'DL360',description:'Changed'},channels:['bale']};
 editor=syncComposer(editor,changed,{});
 assert.equal(editor.body,'Hand edited 👋 text');assert.notEqual(editor.body_source,signatureOf(changed));
 assert.deepEqual(prepareDocument({...editor,body_mode:'manual'},changed.title,changed.fields,{}),{body:editor.body,entities:editor.body_entities});
 const reopened=syncComposer(structuredClone(editor),changed,{});assert.equal(reopened.body,editor.body);assert.deepEqual(reopened.body_entities,editor.body_entities);
});
test('explicit regeneration has an undo and legacy documents are protected',()=>{
 const legacy={...input,body:'Old manual text',body_entities:[{type:'italic',offset:0,length:3}]};
 const protectedDoc=syncComposer(legacy,input,{});assert.equal(protectedDoc.body,legacy.body);
 const rebuilt=rebuildComposer(protectedDoc,input,{});assert(rebuilt.body.includes('DL380'));assert.equal(rebuilt.body_mode,'generated');
 const undo=undoComposer(rebuilt);assert.equal(undo.body,legacy.body);assert.deepEqual(undo.body_entities,legacy.body_entities);assert.equal(undo.body_mode,'manual');
});
test('an empty manual caption stays empty and free message labels are independent',()=>{
 assert.equal(prepareDocument({type:'free',body:'',body_mode:'manual'},'Internal',{description:'Old source'},{}).body,'');
 const free={type:'free',title:'Internal',fields:{description:'Message'}};
 assert.equal(signatureOf(free),signatureOf({...free,title:'New internal label'}));
 const generated=syncComposer({body_mode:'generated'},free,{});assert.equal(generated.body,'Message');
});

test('manual text boundary whitespace does not corrupt UTF-16 formatting offsets',()=>{
 assert.deepEqual(prepareDocument({type:'free',body_mode:'manual',body:'  Text  ',body_entities:[{type:'bold',offset:2,length:4}]},'Label',{},{}),{body:'Text',entities:[{type:'bold',offset:0,length:4}]});
});

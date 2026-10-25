import {previewDocument} from './caption-template.js';
import {rebaseEntities} from './rich-text.js';

export function signatureOf(data){
 const fields={...data.fields};delete fields.topic;delete fields.contact_config;
 return JSON.stringify([data.type,data.type==='free'?'':data.title,fields]);
}

// Existing documents are protected unless they explicitly opted into generation.
export function syncComposer(editor,data,settings){
 const signature=signatureOf(data),mode=editor.body_mode||(editor.body?'manual':'generated');
 if(mode==='manual')return {...editor,...data,body:editor.body||'',body_entities:editor.body_entities||[],body_mode:mode,body_source:editor.body_source||signature};
 if(editor.body_source===signature)return {...editor,...data,body_mode:mode};
 const document=previewDocument(data,settings);
 return {...editor,...data,body:document.body,body_entities:document.entities,body_mode:'generated',body_source:signature};
}

export function editComposer(editor,data,body){
 return {...editor,...data,body,body_entities:rebaseEntities(editor.body||'',body,editor.body_entities||[]),body_mode:'manual',body_source:editor.body_source||signatureOf(data)};
}

export function rebuildComposer(editor,data,settings){
 const undo={body:editor.body||'',body_entities:structuredClone(editor.body_entities||[]),body_mode:editor.body_mode||'manual',body_source:editor.body_source||signatureOf(data)};
 return {...syncComposer({...editor,body_mode:'generated',body_source:null},data,settings),caption_undo:undo};
}

export function undoComposer(editor){return editor.caption_undo?{...editor,...editor.caption_undo,caption_undo:null}:editor;}

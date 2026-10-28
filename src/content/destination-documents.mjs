import {check,text} from './content.mjs';
import {cleanDocument} from '../../public/rich-text.js';
export function destinationDocuments(input,channels,previous={}){
 const value=input===undefined?previous:input;
 check(value&&typeof value==='object'&&!Array.isArray(value),'متن اختصاصی مقصدها معتبر نیست');
 check(Object.keys(value).length<=100,'تعداد متن‌های اختصاصی بیش از حد است');
 const documents={};
 for(const [id,document] of Object.entries(value)){
  if(!channels.includes(id)){check(input===undefined,'متن اختصاصی باید متعلق به مقصد انتخاب‌شده باشد');continue;}
  check(document&&typeof document==='object'&&!Array.isArray(document),'متن اختصاصی مقصد معتبر نیست');
  text(document.body,15000);documents[id]=cleanDocument(document.body,document.entities||[]);
 }
 return documents;
}

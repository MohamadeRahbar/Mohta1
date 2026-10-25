import {registerHooks} from 'node:module';
registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);if(!url.endsWith('/network.mjs'))return result;
 const source=String(result.source).replace('export async function requestJson(','async function originalRequestJson(');
 return {...result,source:source+`
export async function requestJson(url,options={}){
 const method=new URL(url).pathname.split('/').at(-1);let upload='';
 if(options.bodyStream)for await(const chunk of options.bodyStream)upload+=Buffer.from(chunk).toString('utf8');
 const body=options.body||Object.fromEntries(new URLSearchParams(options.rawBody||''));
 const platform=url.includes('rubika')?'rubika':url.includes('bale')?'bale':url.includes('eitaayar')?'eitaa':'telegram';
 if(process.env.FIXTURE_EVENTS)(await import('node:fs')).appendFileSync(process.env.FIXTURE_EVENTS,JSON.stringify({platform,method,body,upload})+'\\n');
 let value;
 if(method==='getMe')value={id:123456,is_bot:true,username:'fixture_bot'};
 else if(method==='getChat')value=platform==='rubika'?{chat:{chat_type:'Channel',chat_id:'c0fixturechannel'}}:{id:-1001,type:'channel',title:'Fixture channel'};
 else if(method==='getChatMember')value={user:{id:123456},status:'administrator',can_post_messages:true,can_edit_messages:true};
 else if(['sendMessage','sendPhoto','sendVideo','sendFile'].includes(method))value={message_id:444,chat:{id:-1001}};
 else if(method==='sendMediaGroup')value=[{message_id:444,chat:{id:-1001}},{message_id:445,chat:{id:-1001}}];
 else if(['editMessageText','editMessageCaption','editMessageMedia','deleteMessage','pinChatMessage','unpinChatMessage','unPinChatMessage'].includes(method))value=platform==='rubika'?{}:true;
 else throw Error('Unmocked provider method: '+method);
 return {status:200,data:platform==='rubika'?{status:'OK',data:value}:{ok:true,result:value}};
}
`};
}});

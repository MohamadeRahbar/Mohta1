// Destination IDs, not platform names, distinguish two channels on the same network.
export function documentForDestination(post,destination){
 const id=typeof destination==='object'?destination?.id||destination?.platform:destination;
 const document=post.destination_documents?.[id];
 return document?{body:document.body,entities:document.entities||[],custom:true}:{body:post.body||'',entities:post.body_entities||[],custom:false};
}

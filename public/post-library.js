// Library placement is independent of delivery status and publication receipts
export function libraryState(post){return post.deleted_at?'deleted':post.archived_at||post.status==='archived'?'archived':'active';}
export function canManageLibrary(post,user){
 if(!post||!user||!['admin','publisher','editor'].includes(user.role)||post.status==='publishing'||post.publications?.some(row=>row.status==='sending'))return false;
 const channels=Array.isArray(user.channels)?user.channels:JSON.parse(user.channels||'[]');
 return (user.role!=='editor'||post.author_id===user.id)&&(user.role==='admin'||post.channels.every(id=>channels.includes(id)));
}
export function filterLibrary(posts,{search='',filter='all',queue=false}={}){
 return posts.filter(post=>{
  const placement=libraryState(post);
  if(!(post.library_title||post.title).toLowerCase().includes(search.toLowerCase()))return false;
  if(queue)return placement==='active'&&post.status==='ready';
  if(filter==='deleted'||filter==='archived')return placement===filter;
  return placement==='active'&&(filter==='all'||post.status===filter);
 }).sort((a,b)=>queue?(a.scheduled_at||'9999').localeCompare(b.scheduled_at||'9999'):0);
}

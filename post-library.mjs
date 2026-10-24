import {check} from './content.mjs';
import {publicPost} from './store.mjs';
import {canManageLibrary,libraryState} from './public/post-library.js';
import {cancelScheduled} from './scheduler.mjs';

export function changePostLibrary(store,user,action,items){
 check(['archive','delete','restore'].includes(action),'عملیات کتابخانه معتبر نیست');
 check(Array.isArray(items)&&items.length>0&&items.length<=1000,'بین ۱ تا ۱۰۰۰ محتوا انتخاب کنید');
 check(items.every(item=>item&&typeof item.id==='string'&&Number.isSafeInteger(item.version)&&Number.isSafeInteger(item.library_revision)),'مشخصات انتخاب محتوا معتبر نیست');
 check(new Set(items.map(item=>item.id)).size===items.length,'محتوای تکراری در انتخاب وجود دارد');
 return store.transaction(()=>{
  const posts=items.map(item=>{
   const post=publicPost(store.db.prepare('SELECT * FROM posts WHERE id=?').get(item.id));
   check(post,'یکی از محتواها در این برند پیدا نشد',404);
   check(post.status!=='publishing'&&!store.db.prepare("SELECT 1 FROM publications WHERE post_id=? AND status='sending'").get(post.id),'ارسال یکی از محتواها در حال انجام است؛ پس از پایان ارسال دوباره اقدام کنید',409);
   check(canManageLibrary(post,user),'اجازه مدیریت یکی از محتواهای انتخاب شده را ندارید',403);
   check(item.version===post.version&&item.library_revision===post.library_revision,'نسخه یا وضعیت یکی از محتواها تغییر کرده است؛ صفحه را تازه کنید',409);
   const placement=libraryState(post);
   check(action==='delete'?placement!=='deleted':action==='archive'?placement==='active':placement!=='active','وضعیت یکی از محتواها برای این عملیات مناسب نیست',409);
   return post;
  });
  const timestamp=new Date().toISOString();
  for(const post of posts){
   let {archived_at,deleted_at,status}=post;
   if(action==='delete')deleted_at=timestamp;
   else if(action==='archive')archived_at=timestamp;
   else if(deleted_at)deleted_at=null;
   else {archived_at=null;if(status==='archived')status='draft';}
   // Returning a hidden queue item never silently reactivates scheduled delivery
   if(status==='ready')status='draft';
   store.db.prepare('UPDATE posts SET archived_at=?,deleted_at=?,status=?,library_revision=library_revision+1,updated_at=? WHERE id=?').run(archived_at??null,deleted_at??null,status,timestamp,post.id);
   cancelScheduled(store,post.id);
   store.audit(user.id,'post.'+action,post.id,{title:post.library_title||post.title,from:libraryState(post),fromStatus:post.status,count:posts.length,localOnly:true});
  }
  return {ok:true,count:posts.length,posts:posts.map(post=>store.db.prepare('SELECT id,status,archived_at,deleted_at,library_revision,updated_at FROM posts WHERE id=?').get(post.id))};
 });
}

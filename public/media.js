// The ordered publication selection is separate from all uploaded files.
export function publicationMedia(post){
 const ids=post.publication_media_ids===undefined?(post.primary_media_id?[post.primary_media_id]:[]):post.publication_media_ids;
 const invalid=message=>{const error=new Error(message);error.status=400;throw error;};
 if(!Array.isArray(ids)||ids.length>8||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)invalid('فهرست فایل های پست معتبر نیست؛ حداکثر ۸ فایل بدون تکرار انتخاب کنید');
 if(ids.some(id=>!post.media?.includes(id)))invalid('فایل انتخاب شده باید از فایل های همین محتوا باشد');
 return [...ids];
}

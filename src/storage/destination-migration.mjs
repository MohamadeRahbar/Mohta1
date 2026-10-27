// Legacy IDs are already stable foreign keys. Keep them, their secrets, grants
// and receipts unchanged; new destinations receive independent UUIDs.
export function migrateDestinations(db){
 const columns={channels:{deleted_at:'TEXT',identity_version:'INTEGER NOT NULL DEFAULT 0'},publications:{channel_name:'TEXT',platform:'TEXT'},scheduled_publications:{destination_snapshot:'TEXT'}};
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const [table,fields] of Object.entries(columns))for(const [name,type] of Object.entries(fields))if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);
  if(!db.prepare('SELECT id FROM schema_migrations WHERE id=?').get('destinations-v1')){
   db.exec('UPDATE publications SET channel_name=(SELECT name FROM channels WHERE channels.id=channel_id),platform=(SELECT platform FROM channels WHERE channels.id=channel_id) WHERE platform IS NULL');
   const message='صف قدیمی نیاز به تایید دوباره مقصدها دارد محتوا را بررسی و ارسال به صف را بزنید';
   db.prepare("UPDATE posts SET status='draft' WHERE status='ready' AND id IN (SELECT post_id FROM scheduled_publications WHERE state='queued' AND destination_snapshot IS NULL)").run();
   db.prepare("UPDATE scheduled_publications SET state='failed',message=? WHERE state='queued' AND destination_snapshot IS NULL").run(message);
   db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('destinations-v1',new Date().toISOString());
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}

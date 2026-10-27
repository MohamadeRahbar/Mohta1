export function migrateMessageControls(db){
 const extend=(table,columns)=>{const existing=new Set(db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name));for(const [name,type] of Object.entries(columns))if(!existing.has(name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);};
 extend('posts',{publish_options:"TEXT NOT NULL DEFAULT '{}'",control_revision:'INTEGER NOT NULL DEFAULT 0',remote_body:'TEXT',remote_entities:'TEXT',remote_media:'TEXT'});
 extend('publications',{identity_version:'INTEGER',remote_body:'TEXT',remote_entities:'TEXT',remote_media:'TEXT',remote_deleted_at:'TEXT',pinned:'INTEGER NOT NULL DEFAULT 0'});
 db.exec(`CREATE TABLE IF NOT EXISTS message_operations(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,post_id TEXT NOT NULL REFERENCES posts(id),publication_id TEXT NOT NULL REFERENCES publications(id),action TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL,results TEXT NOT NULL DEFAULT '[]',message TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(request_id,publication_id));
 CREATE INDEX IF NOT EXISTS operations_post ON message_operations(post_id,created_at);
 CREATE TABLE IF NOT EXISTS tracked_links(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES posts(id),channel_id TEXT NOT NULL REFERENCES channels(id),url TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(post_id,channel_id,url));
 CREATE TABLE IF NOT EXISTS link_events(id INTEGER PRIMARY KEY,link_id TEXT NOT NULL REFERENCES tracked_links(id),created_at TEXT NOT NULL,kind TEXT NOT NULL,visitor_hash TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS link_events_time ON link_events(link_id,created_at);`);
}

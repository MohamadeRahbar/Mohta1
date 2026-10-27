import test from 'node:test';
import assert from 'node:assert/strict';
import {contentSecurityPolicy} from '../security-headers.mjs';

const directives=policy=>Object.fromEntries(policy.split(';').map(part=>part.trim().split(/\s+/)).map(([name,...sources])=>[name,sources]));

test('local annotation compatibility grants only the reviewed stylesheet hash',()=>{
 for(const host of ['127.0.0.1','localhost','::1']){
  const policy=directives(contentSecurityPolicy({host}));
  assert.deepEqual(policy['style-src'],["'self'","'sha256-62lPaUtpvg47KrxPOXYc0Ki8fkE6PNsbY5I9DpyEwZ4='"]);
  assert.deepEqual(policy['script-src'],["'self'"]);assert.deepEqual(policy['connect-src'],["'self'"]);assert.deepEqual(policy['frame-ancestors'],["'none'"]);
  assert(!contentSecurityPolicy({host}).includes('unsafe-inline'));assert(!contentSecurityPolicy({host}).includes('unsafe-eval'));
 }
});

test('public hosting and network listeners retain the original strict stylesheet policy',()=>{
 for(const config of [{host:'127.0.0.1',publicUrl:new URL('https://example.org')},{host:'0.0.0.0'},{host:'::'},{host:'example.org'},{}]){
  const policy=directives(contentSecurityPolicy(config));assert.deepEqual(policy['style-src'],["'self'"]);assert.deepEqual(policy['script-src'],["'self'"]);assert.deepEqual(policy['base-uri'],["'none'"]);assert.deepEqual(policy['form-action'],["'self'"]);
 }
});

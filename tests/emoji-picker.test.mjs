import test from 'node:test';
import assert from 'node:assert/strict';
import {emojiData,emojiGroups,emojiVersion} from '../public/emoji-data.js';
import {emojiMatches,skinMatches} from '../public/emoji-picker.js';
test('complete Unicode 17 catalog preserves qualified sequences, variants and Persian search',()=>{
 assert.equal(emojiVersion,'17.0');assert.equal(emojiData.length,3944);assert.equal(new Set(emojiData.map(row=>row[0])).size,3944);assert.equal(emojiGroups.length,9);
 for(const emoji of ['🇮🇷','🫩','👨‍👩‍👧‍👦','👍🏿','❤️','🧑🏽‍💻','1️⃣'])assert(emojiData.some(row=>row[0]===emoji),emoji);
 const heart=emojiData.find(row=>row[0]==='❤️');assert(emojiMatches(heart,'قلب'));assert(emojiMatches(heart,'heart'));assert(!emojiMatches(heart,'ناموجود'));
 assert(emojiData.filter(row=>emojiMatches(row,'ایران')).some(row=>row[0]==='🇮🇷'));
 assert(emojiData.every(row=>row[3]>=0&&row[3]<9&&row[1]));
});
test('skin filters preserve unmodified emoji and only admit requested tone variants',()=>{
 assert(skinMatches('👋🏻','1'));assert(!skinMatches('👋🏿','1'));assert(skinMatches('👋🏿','all'));assert(!skinMatches('👋🏻','0'));assert(skinMatches('❤️','3'));assert(skinMatches('👋','0'));
});

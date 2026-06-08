// ========================================================================
//  db.js — ชั้นจัดการฐานข้อมูล (Data Layer) ผ่าน Supabase (PostgreSQL)
//
//  แนวคิด: server ของเราไม่ได้ต่อ Postgres ตรงๆ แต่คุยกับ Supabase
//  ผ่าน HTTPS API (library @supabase/supabase-js ห่อให้)
//
//      [server.js] → supabase-js → [Supabase REST API] → [PostgreSQL]
//
//  คีย์ที่ใช้คือ SERVICE_ROLE key (ฝั่ง server เท่านั้น ห้ามหลุดไป frontend!)
// ========================================================================
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

// ถ้ายังไม่ตั้งค่า env → ปิดฟีเจอร์ leaderboard ไปเลย (เกมยังเล่นได้ปกติ)
const enabled = Boolean(url && key);
const supabase = enabled ? createClient(url, key) : null;

if (!enabled) {
  console.log('[db] ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_KEY — leaderboard ปิดอยู่');
}

// บันทึกผลผู้เล่น 1 คนหลังเกมจบ (won = true ถ้าได้อันดับ 1)
// เรียก Postgres function record_result() ให้ upsert + บวกค่าแบบ atomic
async function recordPlayer(name, won) {
  if (!enabled) return;
  const { error } = await supabase.rpc('record_result', {
    p_name: name,
    p_win: won ? 1 : 0,
  });
  if (error) console.error('[db] recordPlayer error:', error.message);
}

// ดึงตารางอันดับ (คนชนะมากสุดก่อน)
async function topPlayers(limit = 20) {
  if (!enabled) return [];
  const { data, error } = await supabase
    .from('stats')
    .select('name, wins, games')
    .order('wins', { ascending: false })
    .order('games', { ascending: true })
    .limit(limit);
  if (error) { console.error('[db] topPlayers error:', error.message); return []; }
  return data;
}

module.exports = { recordPlayer, topPlayers, enabled };

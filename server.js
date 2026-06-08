require('dotenv').config();              // โหลดค่าจากไฟล์ .env เข้า process.env (ตอนรัน local)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const db = require('./db');              // ชั้นฐานข้อมูล (Supabase)

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ----- REST API: ให้ frontend ดึงตารางอันดับ -----
//   frontend เรียก fetch('/api/leaderboard') → ได้ JSON กลับไปวาดตาราง
app.get('/api/leaderboard', async (req, res) => {
  const list = await db.topPlayers(20);
  res.json({ enabled: db.enabled, list });
});

const rooms = {};

// บันทึกผลลงฐานข้อมูลเมื่อเกมจบ (เรียกครั้งเดียวต่อเกม)
function recordGameResult(room) {
  if (room.recorded) return;
  room.recorded = true;
  room.players
    .filter(p => p.rank > 0)
    .forEach(p => db.recordPlayer(p.name, p.rank === 1));
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function createDeck() {
  const colors = ['red', 'green', 'blue', 'yellow'];
  const deck = [];
  for (const color of colors) {
    deck.push({ color, value: '0' });
    for (let i = 1; i <= 9; i++) {
      deck.push({ color, value: String(i) });
      deck.push({ color, value: String(i) });
    }
    for (const s of ['skip', 'reverse', 'draw2']) {
      deck.push({ color, value: s });
      deck.push({ color, value: s });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild' });
    deck.push({ color: 'wild', value: 'wild4' });
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function canPlay(card, topCard, currentColor) {
  if (card.color === 'wild') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms[code]);
  return code;
}

function drawCards(room, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) {
      const top = room.discard[room.discard.length - 1];
      room.deck = shuffle(room.discard.slice(0, -1));
      room.discard = [top];
    }
    if (room.deck.length > 0) drawn.push(room.deck.pop());
  }
  return drawn;
}

function nextPlayerIndex(room) {
  const n = room.players.length;
  let idx = room.currentPlayer;
  // เลื่อนไปคนถัดไปที่ยังไม่จบ (ข้ามคนที่ไพ่หมดแล้ว)
  for (let step = 0; step < n; step++) {
    idx = (idx + room.direction + n) % n;
    if (!room.players[idx].finished) return idx;
  }
  return room.currentPlayer;
}

function advanceTurn(room) {
  room.currentPlayer = nextPlayerIndex(room);
}

function activeCount(room) {
  return room.players.filter(p => !p.finished).length;
}

function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.players.forEach((player, idx) => {
    const socket = io.sockets.sockets.get(player.id);
    if (!socket) return;
    socket.emit('gameState', {
      hand: player.hand,
      players: room.players.map((p, i) => ({
        name: p.name,
        cardCount: p.hand.length,
        isCurrentPlayer: i === room.currentPlayer,
        isOwner: i === 0,
        finished: p.finished,
        rank: p.rank,
      })),
      rankings: room.gameOver
        ? room.players.filter(p => p.rank > 0).sort((a, b) => a.rank - b.rank).map(p => ({ name: p.name, rank: p.rank }))
        : null,
      topCard: room.discard[room.discard.length - 1],
      currentColor: room.currentColor,
      currentPlayer: room.currentPlayer,
      myIndex: idx,
      direction: room.direction,
      drawPending: room.drawPending,
      gameOver: room.gameOver,
      winner: room.winner,
      // ข้อ 2: ไพ่ที่เพิ่งจั่ว รอตัดสินใจ
      awaitingDrawPlay: room.awaitingDrawPlay && room.currentPlayer === idx,
      drawnCardIdx: room.awaitingDrawPlay && room.currentPlayer === idx ? room.drawnCardIdx : -1,
      awaitingFreePlay: room.awaitingFreePlay && room.currentPlayer === idx,
    });
  });
}

function removePlayerFromRoom(socketId) {
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    const idx = room.players.findIndex(p => p.id === socketId);
    if (idx === -1) continue;

    const name = room.players[idx].name;
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      delete rooms[code];
      return;
    }

    // ถ้าเกมยังไม่เริ่ม
    if (!room.started) {
      io.to(code).emit('playerList', room.players.map(p => p.name));
      return;
    }

    // เกมเริ่มแล้ว — ปรับ currentPlayer ถ้าจำเป็น
    if (room.currentPlayer >= room.players.length) {
      room.currentPlayer = 0;
    }
    // reset awaitingDrawPlay ถ้าคนนั้นออก
    if (room.awaitingDrawPlay || room.awaitingFreePlay) {
      room.awaitingDrawPlay = false;
      room.awaitingFreePlay = false;
      room.drawnCardIdx = -1;
    }
    // ถ้าคนที่ออกคือคนปัจจุบัน (หรือ slot ชี้ไปคนที่จบแล้ว) เลื่อนไปคน active ถัดไป
    if (!room.gameOver && room.players[room.currentPlayer] && room.players[room.currentPlayer].finished) {
      advanceTurn(room);
    }
    // เหลือ active <= 1 → จบเกม จัดอันดับคนสุดท้าย
    if (!room.gameOver && activeCount(room) <= 1) {
      const last = room.players.find(p => !p.finished);
      if (last) { last.finished = true; last.rank = room.players.filter(p => p.finished).length; }
      room.gameOver = true;
      const champ = room.players.find(p => p.rank === 1);
      room.winner = champ ? champ.name : null;
      recordGameResult(room);
    }
    io.to(code).emit('playerLeft', name);
    broadcastState(code);
    return;
  }
}

io.on('connection', (socket) => {

  socket.on('createRoom', ({ name }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code, players: [{ id: socket.id, name, hand: [] }],
      deck: [], discard: [], currentPlayer: 0, direction: 1,
      currentColor: null, started: false, drawPending: 0,
      gameOver: false, winner: null,
      awaitingDrawPlay: false, drawnCardIdx: -1, awaitingFreePlay: false,
    };
    socket.join(code);
    socket.emit('roomCreated', { code, name });
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', 'ไม่พบห้องนี้');
    if (room.started) return socket.emit('error', 'เกมเริ่มไปแล้ว');
    if (room.players.length >= 10) return socket.emit('error', 'ห้องเต็มแล้ว');
    room.players.push({ id: socket.id, name, hand: [] });
    socket.join(code);
    socket.emit('roomJoined', { code, name });
    io.to(code).emit('playerList', room.players.map(p => p.name));
  });

  // ข้อ 1: ออกจากห้อง
  socket.on('leaveRoom', ({ code }) => {
    removePlayerFromRoom(socket.id);
    socket.leave(code);
    socket.emit('leftRoom');
  });

  socket.on('startGame', ({ code }) => {
    const room = rooms[code];
    if (!room || room.started) return;
    if (room.players[0].id !== socket.id) return socket.emit('error', 'เฉพาะเจ้าของห้องเท่านั้น');
    if (room.players.length < 2) return socket.emit('error', 'ต้องมีผู้เล่นอย่างน้อย 2 คน');
    room.deck = createDeck();
    room.players.forEach(p => { p.hand = drawCards(room, 7); p.finished = false; p.rank = 0; });
    let startCard;
    do { startCard = room.deck.pop(); } while (startCard.color === 'wild');
    room.discard = [startCard];
    room.currentColor = startCard.color;
    room.started = true;
    if (startCard.value === 'skip') {
      advanceTurn(room); advanceTurn(room);
    } else if (startCard.value === 'reverse') {
      room.direction = -1; advanceTurn(room);
    } else if (startCard.value === 'draw2') {
      const next = nextPlayerIndex(room);
      room.players[next].hand.push(...drawCards(room, 2));
      advanceTurn(room); advanceTurn(room);
    }
    broadcastState(code);
  });

  socket.on('playCard', ({ code, cardIndex, cardIndices, chosenColor }) => {
    const room = rooms[code];
    if (!room || !room.started || room.gameOver) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentPlayer) return socket.emit('error', 'ยังไม่ถึงตาคุณ');
    const player = room.players[playerIdx];

    // รองรับทั้งลงใบเดียว (cardIndex) และหลายใบ (cardIndices)
    let indices = Array.isArray(cardIndices) ? cardIndices : [cardIndex];
    // กันค่าซ้ำ/ไม่ถูกต้อง
    if (new Set(indices).size !== indices.length) return socket.emit('error', 'ไพ่ซ้ำ');
    const cards = indices.map(i => player.hand[i]);
    if (cards.some(c => !c)) return socket.emit('error', 'ไพ่ไม่ถูกต้อง');

    const topCard = room.discard[room.discard.length - 1];
    const leadCard = cards[0];        // ใบแรกคือใบที่ต้องลงได้ถูกกฎ
    const isMulti = indices.length > 1;

    // ลงหลายใบได้เฉพาะไพ่ตัวเลขที่เลขเดียวกันเท่านั้น
    if (isMulti) {
      const isNumber = /^[0-9]$/.test(leadCard.value);
      if (!isNumber) return socket.emit('error', 'ลงหลายใบได้เฉพาะไพ่ตัวเลข');
      if (!cards.every(c => c.value === leadCard.value)) return socket.emit('error', 'ต้องเป็นเลขเดียวกัน');
    }

    // ตรวจกฎตามสถานะ (ใช้ leadCard เป็นตัวตัดสิน)
    if (room.awaitingDrawPlay) {
      if (isMulti) return socket.emit('error', 'จั่วแล้วเล่นได้เฉพาะใบที่จั่วมา');
      if (indices[0] !== room.drawnCardIdx) return socket.emit('error', 'เล่นได้เฉพาะไพ่ที่เพิ่งจั่วมา');
      room.awaitingDrawPlay = false;
      room.drawnCardIdx = -1;
    } else if (room.awaitingFreePlay) {
      if (!canPlay(leadCard, topCard, room.currentColor)) return socket.emit('error', 'ลงไพ่นี้ไม่ได้');
      room.awaitingFreePlay = false;
    } else if (room.drawPending > 0) {
      if (isMulti) return socket.emit('error', 'ตอนโดน + ลงได้ทีละใบเท่านั้น');
      const stackType = topCard.value === 'draw2' ? 'draw2' : 'wild4';
      if (leadCard.value !== stackType) {
        return socket.emit('error', `ต้องลงไพ่ ${stackType === 'draw2' ? '+2' : '+4'} เพื่อต่อ หรือจั่วไพ่`);
      }
    } else {
      if (!canPlay(leadCard, topCard, room.currentColor)) return socket.emit('error', 'ลงไพ่นี้ไม่ได้');
    }

    // เอาไพ่ออกจากมือ (เรียงจาก index มากไปน้อยกัน index เลื่อน)
    [...indices].sort((a, b) => b - a).forEach(i => player.hand.splice(i, 1));

    // วางลงกองทิ้งตามลำดับที่เลือก ใบสุดท้ายอยู่บนสุด
    cards.forEach(c => room.discard.push(c));
    const lastCard = cards[cards.length - 1];
    if (lastCard.color === 'wild') room.currentColor = chosenColor || 'red';
    else room.currentColor = lastCard.color;

    // ไพ่หมดมือ → จบเกมสำหรับคนนี้ ได้อันดับตามลำดับที่หมด (ยังเล่นต่อ)
    if (player.hand.length === 0) {
      player.finished = true;
      player.rank = room.players.filter(p => p.finished).length;
    }

    // ใช้เอฟเฟกต์ของไพ่ (advanceTurn จะข้ามคนที่จบแล้วอัตโนมัติ)
    const card = leadCard;
    if (isMulti) {
      advanceTurn(room);
    } else if (card.value === 'skip') {
      advanceTurn(room); advanceTurn(room);
    } else if (card.value === 'reverse') {
      room.direction *= -1;
      // เหลือ 2 คนที่ยังเล่น → reverse ทำงานเหมือน skip
      if (activeCount(room) === 2) { advanceTurn(room); advanceTurn(room); }
      else advanceTurn(room);
    } else if (card.value === 'draw2') {
      room.drawPending += 2; advanceTurn(room);
    } else if (card.value === 'wild4') {
      room.drawPending += 4; advanceTurn(room);
    } else {
      advanceTurn(room);
    }

    // เหลือคนเล่น 1 คน → จบเกม คนสุดท้ายได้อันดับสุดท้าย
    if (activeCount(room) <= 1) {
      const last = room.players.find(p => !p.finished);
      if (last) { last.finished = true; last.rank = room.players.filter(p => p.finished).length; }
      room.gameOver = true;
      const champ = room.players.find(p => p.rank === 1);
      room.winner = champ ? champ.name : null;
      recordGameResult(room);
    }
    broadcastState(code);
  });

  socket.on('drawCard', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.started || room.gameOver) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentPlayer) return socket.emit('error', 'ยังไม่ถึงตาคุณ');
    if (room.awaitingDrawPlay || room.awaitingFreePlay) return socket.emit('error', 'จั่วไปแล้ว เลือกเล่นหรือกดข้ามตา');
    const player = room.players[playerIdx];

    if (room.drawPending > 0) {
      // จั่วโทษบังคับ +2/+4 แล้วเล่นต่อในตาเดียวกันได้ถ้ามีไพ่ลงได้
      const count = room.drawPending;
      room.drawPending = 0;
      player.hand.push(...drawCards(room, count));
      const topCard = room.discard[room.discard.length - 1];
      const canPlayAny = player.hand.some(c => canPlay(c, topCard, room.currentColor));
      if (canPlayAny) room.awaitingFreePlay = true;
      else advanceTurn(room);
      broadcastState(code);
    } else {
      // ข้อ 2: จั่ว 1 ใบ ตรวจว่าเล่นได้ไหม
      const [drawn] = drawCards(room, 1);
      if (!drawn) { advanceTurn(room); broadcastState(code); return; }
      player.hand.push(drawn);
      const topCard = room.discard[room.discard.length - 1];
      const playable = canPlay(drawn, topCard, room.currentColor);
      if (playable) {
        // รอให้คนเล่นตัดสินใจ
        room.awaitingDrawPlay = true;
        room.drawnCardIdx = player.hand.length - 1;
      } else {
        // เล่นไม่ได้ — ข้ามตาทันที
        advanceTurn(room);
      }
      broadcastState(code);
    }
  });

  // ข้อ 2: ข้ามตาหลังจั่ว
  socket.on('passTurn', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.started || room.gameOver) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentPlayer) return socket.emit('error', 'ยังไม่ถึงตาคุณ');
    if (!room.awaitingDrawPlay && !room.awaitingFreePlay) return socket.emit('error', 'ไม่มีอะไรให้ข้าม');
    room.awaitingDrawPlay = false;
    room.awaitingFreePlay = false;
    room.drawnCardIdx = -1;
    advanceTurn(room);
    broadcastState(code);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('UNO Server running');
  console.log(`Local:   http://localhost:${PORT}`);
  console.log(`Network: http://${ip}:${PORT}`);
  console.log('บอก IP นี้ให้เพื่อนเปิดในเบราว์เซอร์ (ต้องอยู่ Wi-Fi เดียวกัน)');
});

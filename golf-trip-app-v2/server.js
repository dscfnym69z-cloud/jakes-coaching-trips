const express = require('express');
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const {
  computeIndividualLeaderboard,
  computeTeamLeaderboard,
  computeMatch,
  suggestStrokes,
} = require('./scoring');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function defaultCourse() {
  return {
    name: 'Trip Course',
    holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, si: i + 1 })),
  };
}

function defaultData() {
  return {
    course: defaultCourse(),
    teams: { A: { name: 'Team USA' }, B: { name: 'Team Europe' } },
    players: [],
    individualRounds: [
      { id: 'r1', label: 'Round 1', scores: {} },
      { id: 'r2', label: 'Round 2', scores: {} },
    ],
    matches: [],
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const d = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
    return d;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    const d = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
    return d;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

// ---------- State ----------
app.get('/api/state', (req, res) => {
  res.json({
    course: data.course,
    teams: data.teams,
    players: data.players,
    individualRounds: data.individualRounds.map((r) => ({ id: r.id, label: r.label })),
    matches: data.matches.map((m) => ({
      id: m.id,
      roundLabel: m.roundLabel,
      format: m.format,
      teamAPlayers: m.teamAPlayers,
      teamBPlayers: m.teamBPlayers,
      strokesA: m.strokesA,
      strokesB: m.strokesB,
      points: m.points,
    })),
  });
});

// ---------- Course ----------
app.put('/api/course', (req, res) => {
  const { name, holes } = req.body;
  if (name != null) data.course.name = name;
  if (Array.isArray(holes) && holes.length === data.course.holes.length) {
    data.course.holes = holes.map((h, i) => ({
      number: i + 1,
      par: Number(h.par) || 4,
      si: Number(h.si) || i + 1,
    }));
  }
  saveData(data);
  res.json(data.course);
});

// ---------- Players ----------
app.post('/api/players', (req, res) => {
  const { name, handicap, team } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const player = { id: nanoid(8), name, handicap: Number(handicap) || 0, team: team === 'B' ? 'B' : 'A' };
  data.players.push(player);
  saveData(data);
  res.json(player);
});

app.put('/api/players/:id', (req, res) => {
  const p = data.players.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const { name, handicap, team } = req.body;
  if (name != null) p.name = name;
  if (handicap != null) p.handicap = Number(handicap);
  if (team != null) p.team = team === 'B' ? 'B' : 'A';
  saveData(data);
  res.json(p);
});

app.delete('/api/players/:id', (req, res) => {
  data.players = data.players.filter((x) => x.id !== req.params.id);
  // also strip from any match rosters left dangling is fine, they just show name still in matches created earlier
  saveData(data);
  res.json({ ok: true });
});

// ---------- Individual rounds & scores ----------
app.post('/api/individual-rounds', (req, res) => {
  const { label } = req.body;
  const round = { id: nanoid(8), label: label || `Round ${data.individualRounds.length + 1}`, scores: {} };
  data.individualRounds.push(round);
  saveData(data);
  res.json({ id: round.id, label: round.label });
});

app.get('/api/individual-rounds/:id/scores/:playerId', (req, res) => {
  const round = data.individualRounds.find((r) => r.id === req.params.id);
  if (!round) return res.status(404).json({ error: 'round not found' });
  const holes = round.scores[req.params.playerId] || new Array(data.course.holes.length).fill(null);
  res.json({ holes });
});

app.put('/api/individual-rounds/:id/scores/:playerId', (req, res) => {
  const round = data.individualRounds.find((r) => r.id === req.params.id);
  if (!round) return res.status(404).json({ error: 'round not found' });
  const { holes } = req.body;
  if (!Array.isArray(holes)) return res.status(400).json({ error: 'holes array required' });
  round.scores[req.params.playerId] = holes.map((h) => (h === '' || h == null ? null : Number(h)));
  saveData(data);
  res.json({ ok: true });
});

app.get('/api/leaderboard/individual', (req, res) => {
  const lb = computeIndividualLeaderboard(data.course, data.players, data.individualRounds);
  res.json(lb);
});

// ---------- Matches ----------
app.get('/api/matches', (req, res) => {
  const results = data.matches.map((m) => ({ match: m, ...computeMatch(data.course, m) }));
  res.json(results);
});

app.get('/api/matches/:id', (req, res) => {
  const m = data.matches.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  res.json({ match: m, ...computeMatch(data.course, m) });
});

app.post('/api/matches/suggest-strokes', (req, res) => {
  const { format, teamAHandicaps, teamBHandicaps } = req.body;
  res.json(suggestStrokes(format, teamAHandicaps || [], teamBHandicaps || []));
});

app.post('/api/matches', (req, res) => {
  const { roundLabel, format, teamAPlayers, teamBPlayers, strokesA, strokesB, points } = req.body;
  if (!['singles', 'betterball', 'greensomes'].includes(format)) {
    return res.status(400).json({ error: 'invalid format' });
  }
  const match = {
    id: nanoid(8),
    roundLabel: roundLabel || 'Match Play',
    format,
    teamAPlayers: teamAPlayers || [],
    teamBPlayers: teamBPlayers || [],
    strokesA: format === 'betterball' ? (Array.isArray(strokesA) ? strokesA : []) : Number(strokesA) || 0,
    strokesB: format === 'betterball' ? (Array.isArray(strokesB) ? strokesB : []) : Number(strokesB) || 0,
    points: Number(points) || 1,
    holes: format === 'betterball' ? { players: {} } : { A: new Array(data.course.holes.length).fill(null), B: new Array(data.course.holes.length).fill(null) },
  };
  if (format === 'betterball') {
    [...match.teamAPlayers, ...match.teamBPlayers].forEach((p) => {
      match.holes.players[p.id] = new Array(data.course.holes.length).fill(null);
    });
  }
  data.matches.push(match);
  saveData(data);
  res.json(match);
});

app.put('/api/matches/:id/score', (req, res) => {
  const m = data.matches.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const { side, playerId, holes } = req.body;
  if (!Array.isArray(holes)) return res.status(400).json({ error: 'holes array required' });
  const cleaned = holes.map((h) => (h === '' || h == null ? null : Number(h)));
  if (m.format === 'betterball') {
    if (!playerId) return res.status(400).json({ error: 'playerId required for betterball' });
    if (!m.holes.players) m.holes.players = {};
    m.holes.players[playerId] = cleaned;
  } else {
    if (side !== 'A' && side !== 'B') return res.status(400).json({ error: 'side A or B required' });
    m.holes[side] = cleaned;
  }
  saveData(data);
  res.json({ ok: true });
});

app.put('/api/matches/:id', (req, res) => {
  const m = data.matches.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const { strokesA, strokesB, points, roundLabel } = req.body;
  if (strokesA != null) m.strokesA = m.format === 'betterball' ? strokesA : Number(strokesA);
  if (strokesB != null) m.strokesB = m.format === 'betterball' ? strokesB : Number(strokesB);
  if (points != null) m.points = Number(points);
  if (roundLabel != null) m.roundLabel = roundLabel;
  saveData(data);
  res.json(m);
});

app.delete('/api/matches/:id', (req, res) => {
  data.matches = data.matches.filter((x) => x.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

app.get('/api/leaderboard/team', (req, res) => {
  res.json(computeTeamLeaderboard(data.course, data.teams, data.matches));
});

// ---------- Reset (danger) ----------
app.post('/api/reset', (req, res) => {
  data = defaultData();
  saveData(data);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Golf Trip Live running on port ${PORT}`);
});

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
const { PAR3_COURSE, MATCH_COURSES, DEFAULT_MATCH_COURSE_KEY } = require('./courses');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function defaultData() {
  return {
    teams: { A: { name: 'Team USA' }, B: { name: 'Team Europe' } },
    players: [],
    individualRounds: [
      { id: 'r1', label: 'Round 1', scores: {}, handicaps: {} },
      { id: 'r2', label: 'Round 5', scores: {}, handicaps: {} },
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

function courseForMatch(m) {
  return MATCH_COURSES[m.courseKey] || MATCH_COURSES[DEFAULT_MATCH_COURSE_KEY];
}

let data = loadData();

// ---------- State ----------
app.get('/api/state', (req, res) => {
  res.json({
    individualCourse: PAR3_COURSE,
    matchCourses: MATCH_COURSES,
    teams: data.teams,
    players: data.players,
    individualRounds: data.individualRounds.map((r) => ({ id: r.id, label: r.label })),
    matches: data.matches.map((m) => ({
      id: m.id,
      roundLabel: m.roundLabel,
      format: m.format,
      courseKey: m.courseKey,
      teamAPlayers: m.teamAPlayers,
      teamBPlayers: m.teamBPlayers,
      strokesA: m.strokesA,
      strokesB: m.strokesB,
      points: m.points,
    })),
  });
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

// ---------- Individual rounds & scores (always on the Par 3 course) ----------
app.post('/api/individual-rounds', (req, res) => {
  const { label } = req.body;
  const round = { id: nanoid(8), label: label || `Round ${data.individualRounds.length + 1}`, scores: {}, handicaps: {} };
  data.individualRounds.push(round);
  saveData(data);
  res.json({ id: round.id, label: round.label });
});

// Returns the scores entered for this player in this round, plus the handicap that
// applies to this specific round (pinned once saved, so later handicap changes don't
// retroactively change already-played rounds). Falls back to the player's current
// handicap if this round has never had a handicap saved for them yet.
app.get('/api/individual-rounds/:id/scores/:playerId', (req, res) => {
  const round = data.individualRounds.find((r) => r.id === req.params.id);
  if (!round) return res.status(404).json({ error: 'round not found' });
  const holes = round.scores[req.params.playerId] || new Array(PAR3_COURSE.holes.length).fill(null);
  const player = data.players.find((p) => p.id === req.params.playerId);
  const handicap = (round.handicaps && round.handicaps[req.params.playerId] != null)
    ? round.handicaps[req.params.playerId]
    : (player ? player.handicap : 0);
  res.json({ holes, handicap });
});

app.put('/api/individual-rounds/:id/scores/:playerId', (req, res) => {
  const round = data.individualRounds.find((r) => r.id === req.params.id);
  if (!round) return res.status(404).json({ error: 'round not found' });
  const { holes, handicap } = req.body;
  if (!Array.isArray(holes)) return res.status(400).json({ error: 'holes array required' });
  round.scores[req.params.playerId] = holes.map((h) => (h === '' || h == null ? null : Number(h)));
  if (!round.handicaps) round.handicaps = {};
  if (handicap != null && handicap !== '') {
    round.handicaps[req.params.playerId] = Number(handicap);
  } else if (round.handicaps[req.params.playerId] == null) {
    const player = data.players.find((p) => p.id === req.params.playerId);
    if (player) round.handicaps[req.params.playerId] = player.handicap;
  }
  saveData(data);
  res.json({ ok: true });
});

app.get('/api/leaderboard/individual', (req, res) => {
  const lb = computeIndividualLeaderboard(PAR3_COURSE, data.players, data.individualRounds);
  res.json(lb);
});

// ---------- Matches (played on one of the three main-course combos) ----------
app.get('/api/matches', (req, res) => {
  const results = data.matches.map((m) => ({ match: m, ...computeMatch(courseForMatch(m), m) }));
  res.json(results);
});

app.get('/api/matches/:id', (req, res) => {
  const m = data.matches.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  res.json({ match: m, ...computeMatch(courseForMatch(m), m) });
});

app.post('/api/matches/suggest-strokes', (req, res) => {
  const { format, teamAHandicaps, teamBHandicaps } = req.body;
  res.json(suggestStrokes(format, teamAHandicaps || [], teamBHandicaps || []));
});

app.post('/api/matches', (req, res) => {
  const { roundLabel, format, courseKey, teamAPlayers, teamBPlayers, strokesA, strokesB, points } = req.body;
  if (!['singles', 'betterball', 'greensomes'].includes(format)) {
    return res.status(400).json({ error: 'invalid format' });
  }
  const resolvedCourseKey = MATCH_COURSES[courseKey] ? courseKey : DEFAULT_MATCH_COURSE_KEY;
  const holeCount = MATCH_COURSES[resolvedCourseKey].holes.length;
  const match = {
    id: nanoid(8),
    roundLabel: roundLabel || 'Match Play',
    format,
    courseKey: resolvedCourseKey,
    teamAPlayers: teamAPlayers || [],
    teamBPlayers: teamBPlayers || [],
    strokesA: format === 'betterball' ? (Array.isArray(strokesA) ? strokesA : []) : Number(strokesA) || 0,
    strokesB: format === 'betterball' ? (Array.isArray(strokesB) ? strokesB : []) : Number(strokesB) || 0,
    points: Number(points) || 1,
    holes: format === 'betterball' ? { players: {} } : { A: new Array(holeCount).fill(null), B: new Array(holeCount).fill(null) },
  };
  if (format === 'betterball') {
    [...match.teamAPlayers, ...match.teamBPlayers].forEach((p) => {
      match.holes.players[p.id] = new Array(holeCount).fill(null);
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
  res.json(computeTeamLeaderboard(data.teams, data.matches, courseForMatch));
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

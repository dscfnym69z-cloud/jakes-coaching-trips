// scoring.js
// Pure functions for computing golf scoring: individual net stableford,
// and Ryder Cup style match play (singles / better ball / greensomes).

/**
 * Standard stroke allocation across 18 holes ranked by stroke index (SI 1 = hardest).
 * Works for handicaps above 18 (extra stroke on the hardest holes) or above 36.
 */
function strokesForHole(handicap, si) {
  const h = Math.max(0, Math.round(Number(handicap) || 0));
  const full = Math.floor(h / 18);
  const remainder = h % 18;
  return full + (si <= remainder ? 1 : 0);
}

function stablefordPoints(netScore, par) {
  if (netScore == null) return null;
  const diff = netScore - par;
  if (diff <= -3) return 5; // albatross or better
  if (diff === -2) return 4; // eagle
  if (diff === -1) return 3; // birdie
  if (diff === 0) return 2; // par
  if (diff === 1) return 1; // bogey
  return 0; // double bogey or worse
}

/**
 * Compute one player's stableford result for one round.
 * holesGross: array of 18 values (number or null if not yet entered)
 */
function computeIndividualRound(course, handicap, holesGross) {
  let totalPoints = 0;
  let holesPlayed = 0;
  let totalGross = 0;
  const perHole = course.holes.map((h, i) => {
    const gross = holesGross ? holesGross[i] : null;
    if (gross == null || gross === '') {
      return { hole: h.number, par: h.par, si: h.si, gross: null, strokesReceived: strokesForHole(handicap, h.si), net: null, points: null };
    }
    const g = Number(gross);
    const strokes = strokesForHole(handicap, h.si);
    const net = g - strokes;
    const pts = stablefordPoints(net, h.par);
    totalPoints += pts;
    holesPlayed += 1;
    totalGross += g;
    return { hole: h.number, par: h.par, si: h.si, gross: g, strokesReceived: strokes, net, points: pts };
  });
  return { perHole, totalPoints, holesPlayed, totalGross };
}

/**
 * Build the full individual leaderboard across all "counting" rounds.
 */
function computeIndividualLeaderboard(course, players, individualRounds) {
  const results = players.map((p) => {
    const rounds = individualRounds.map((r) => {
      const holesGross = (r.scores && r.scores[p.id]) || new Array(course.holes.length).fill(null);
      const res = computeIndividualRound(course, p.handicap, holesGross);
      return { roundId: r.id, roundLabel: r.label, ...res };
    });
    const totalPoints = rounds.reduce((s, r) => s + r.totalPoints, 0);
    const totalHolesPlayed = rounds.reduce((s, r) => s + r.holesPlayed, 0);
    return {
      playerId: p.id,
      name: p.name,
      team: p.team,
      handicap: p.handicap,
      rounds,
      totalPoints,
      totalHolesPlayed,
    };
  });
  results.sort((a, b) => b.totalPoints - a.totalPoints || b.totalHolesPlayed - a.totalHolesPlayed);
  return results;
}

/**
 * Suggested strokes for a match based on format & handicaps (editable by organiser afterwards).
 */
function suggestStrokes(format, teamAHandicaps, teamBHandicaps) {
  const avg = (arr) => arr.reduce((s, v) => s + Number(v || 0), 0) / arr.length;
  if (format === 'singles') {
    const a = Number(teamAHandicaps[0] || 0);
    const b = Number(teamBHandicaps[0] || 0);
    const diff = Math.round(Math.abs(a - b));
    return a > b ? { strokesA: diff, strokesB: 0 } : { strokesA: 0, strokesB: diff };
  }
  if (format === 'betterball') {
    // Each player plays off 100% handicap; lowest in the four plays scratch, others get the difference.
    const all = [...teamAHandicaps, ...teamBHandicaps].map(Number);
    const low = Math.min(...all);
    return {
      strokesA: teamAHandicaps.map((h) => Math.round(Number(h) - low)),
      strokesB: teamBHandicaps.map((h) => Math.round(Number(h) - low)),
    };
  }
  if (format === 'greensomes') {
    // Combined handicap = 0.5 * (sum of the pair's handicaps). Difference between the two teams applied to higher side.
    const combinedA = 0.5 * teamAHandicaps.reduce((s, v) => s + Number(v || 0), 0);
    const combinedB = 0.5 * teamBHandicaps.reduce((s, v) => s + Number(v || 0), 0);
    const diff = Math.round(Math.abs(combinedA - combinedB));
    return combinedA > combinedB ? { strokesA: diff, strokesB: 0 } : { strokesA: 0, strokesB: diff };
  }
  return { strokesA: 0, strokesB: 0 };
}

/**
 * Compute the live/final status of one match.
 * match = {
 *   id, roundLabel, format: 'singles'|'betterball'|'greensomes', points (default 1),
 *   teamAPlayers: [{id,name}], teamBPlayers: [{id,name}],
 *   strokesA, strokesB  (number for singles/greensomes; array parallel to players for betterball)
 *   holes: for singles/greensomes -> { A: [18 grosses], B: [18 grosses] }
 *          for betterball -> { players: { playerId: [18 grosses] } }
 * }
 */
function computeMatch(course, match) {
  const n = course.holes.length;
  const holesResult = new Array(n).fill(null); // 'A' | 'B' | 'AS' | null
  const holeDetail = [];

  for (let i = 0; i < n; i++) {
    const h = course.holes[i];
    let netA = null;
    let netB = null;

    if (match.format === 'betterball') {
      const aNets = match.teamAPlayers.map((p, idx) => {
        const gross = match.holes?.players?.[p.id]?.[i];
        if (gross == null || gross === '') return null;
        const strokesGiven = Array.isArray(match.strokesA) ? Number(match.strokesA[idx] || 0) : 0;
        return Number(gross) - strokesForHole(strokesGiven, h.si);
      });
      const bNets = match.teamBPlayers.map((p, idx) => {
        const gross = match.holes?.players?.[p.id]?.[i];
        if (gross == null || gross === '') return null;
        const strokesGiven = Array.isArray(match.strokesB) ? Number(match.strokesB[idx] || 0) : 0;
        return Number(gross) - strokesForHole(strokesGiven, h.si);
      });
      const aValid = aNets.filter((v) => v != null);
      const bValid = bNets.filter((v) => v != null);
      netA = aValid.length ? Math.min(...aValid) : null;
      netB = bValid.length ? Math.min(...bValid) : null;
    } else {
      // singles or greensomes: one team score per side
      const grossA = match.holes?.A?.[i];
      const grossB = match.holes?.B?.[i];
      const strokesA = strokesForHole(match.strokesA || 0, h.si);
      const strokesB = strokesForHole(match.strokesB || 0, h.si);
      netA = grossA == null || grossA === '' ? null : Number(grossA) - strokesA;
      netB = grossB == null || grossB === '' ? null : Number(grossB) - strokesB;
    }

    let winner = null;
    if (netA != null && netB != null) {
      if (netA < netB) winner = 'A';
      else if (netB < netA) winner = 'B';
      else winner = 'AS';
    }
    holesResult[i] = winner;
    holeDetail.push({ hole: h.number, par: h.par, si: h.si, netA, netB, winner });
  }

  // Walk through holes in order, tracking running diff, and detect match closure.
  let diff = 0; // positive = A up
  let closedAtHole = null;
  let closedMargin = null;
  let holesPlayed = 0;
  for (let i = 0; i < n; i++) {
    const w = holesResult[i];
    if (w == null) break; // not yet played, stop counting (assumes holes entered in order)
    holesPlayed = i + 1;
    if (w === 'A') diff += 1;
    else if (w === 'B') diff -= 1;
    const holesRemaining = n - holesPlayed;
    if (Math.abs(diff) > holesRemaining && closedAtHole == null) {
      closedAtHole = holesPlayed;
      closedMargin = Math.abs(diff);
      break;
    }
  }

  const allPlayed = holesPlayed === n;
  let status = 'not started';
  let result = null; // {winner: 'A'|'B'|'halved', label}
  const points = match.points || 1;

  if (holesPlayed === 0) {
    status = 'Not started';
  } else if (closedAtHole) {
    const winnerSide = diff > 0 ? 'A' : 'B';
    status = `${winnerSide === 'A' ? teamName(match, 'A') : teamName(match, 'B')} win ${closedMargin}&${n - closedAtHole}`;
    result = { winner: winnerSide, label: `${closedMargin}&${n - closedAtHole}` };
  } else if (allPlayed) {
    if (diff === 0) {
      status = 'Match halved';
      result = { winner: 'halved', label: 'Halved' };
    } else {
      const winnerSide = diff > 0 ? 'A' : 'B';
      status = `${winnerSide === 'A' ? teamName(match, 'A') : teamName(match, 'B')} win ${Math.abs(diff)} up`;
      result = { winner: winnerSide, label: `${Math.abs(diff)} up` };
    }
  } else {
    const upSide = diff === 0 ? null : diff > 0 ? 'A' : 'B';
    status = upSide
      ? `${upSide === 'A' ? teamName(match, 'A') : teamName(match, 'B')} ${Math.abs(diff)} up thru ${holesPlayed}`
      : `All square thru ${holesPlayed}`;
  }

  let pointsA = 0;
  let pointsB = 0;
  if (result) {
    if (result.winner === 'A') pointsA = points;
    else if (result.winner === 'B') pointsB = points;
    else {
      pointsA = points / 2;
      pointsB = points / 2;
    }
  }

  return { holeDetail, holesPlayed, diff, status, result, pointsA, pointsB, finished: !!result };
}

function teamName(match, side) {
  const players = side === 'A' ? match.teamAPlayers : match.teamBPlayers;
  return (players || []).map((p) => p.name).join(' & ') || `Team ${side}`;
}

function computeTeamLeaderboard(course, teams, matches) {
  let pointsA = 0;
  let pointsB = 0;
  const matchResults = matches.map((m) => {
    const res = computeMatch(course, m);
    pointsA += res.pointsA;
    pointsB += res.pointsB;
    return { match: m, ...res };
  });
  return {
    teamA: { name: teams.A.name, points: pointsA },
    teamB: { name: teams.B.name, points: pointsB },
    matches: matchResults,
  };
}

module.exports = {
  strokesForHole,
  stablefordPoints,
  computeIndividualRound,
  computeIndividualLeaderboard,
  suggestStrokes,
  computeMatch,
  computeTeamLeaderboard,
};

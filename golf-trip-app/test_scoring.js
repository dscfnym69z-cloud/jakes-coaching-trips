const assert = require('assert');
const {
  strokesForHole, stablefordPoints, computeIndividualRound,
  computeIndividualLeaderboard, suggestStrokes, computeMatch, computeTeamLeaderboard
} = require('./scoring');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL:', name); }
}

// strokesForHole
check('si1 hcp10 gets 1', strokesForHole(10, 1) === 1);
check('si15 hcp10 gets 0', strokesForHole(10, 15) === 0);
check('hcp20 si1 gets 2', strokesForHole(20, 1) === 2); // 18+2 -> full=1,rem=2, si1<=2 -> 1+1=2
check('hcp20 si3 gets 1', strokesForHole(20, 3) === 1);
check('hcp0 gets 0 everywhere', strokesForHole(0, 1) === 0);

// stablefordPoints
check('eagle=4', stablefordPoints(-2 + 4, 4) === 4); // net=2,par=4,diff=-2
check('par=2', stablefordPoints(4, 4) === 2);
check('double bogey+=0', stablefordPoints(7, 4) === 0);
check('null net = null pts', stablefordPoints(null, 4) === null);

// course fixture: 18 holes par4 si=1..18
const course = { name: 'Test', holes: Array.from({length:18},(_,i)=>({number:i+1,par:4,si:i+1})) };

// computeIndividualRound: player hcp 0, shoots par every hole -> 36 points (2 per hole)
const parRound = new Array(18).fill(4);
const res0 = computeIndividualRound(course, 0, parRound);
check('scratch par round = 36 pts', res0.totalPoints === 36);
check('scratch par round holesPlayed=18', res0.holesPlayed === 18);

// player hcp 18, shoots par every hole (gets 1 stroke every hole) -> net 3 = birdie = 3pts * 18 = 54
const res18 = computeIndividualRound(course, 18, parRound);
check('hcp18 par round = 54 pts', res18.totalPoints === 54);

// partial round (only 9 holes entered)
const partial = [4,4,4,4,4,4,4,4,4,null,null,null,null,null,null,null,null,null];
const resPartial = computeIndividualRound(course, 0, partial);
check('partial holesPlayed=9', resPartial.holesPlayed === 9);
check('partial totalPoints=18', resPartial.totalPoints === 18);

// leaderboard sorting
const players = [
  { id:'p1', name:'Alice', team:'A', handicap:0 },
  { id:'p2', name:'Bob', team:'B', handicap:18 },
];
const rounds = [{ id:'r1', label:'Round 1', scores: { p1: parRound, p2: parRound } }];
const lb = computeIndividualLeaderboard(course, players, rounds);
check('leaderboard sorted desc by points (Bob first)', lb[0].playerId === 'p2' && lb[0].totalPoints === 54);
check('leaderboard second Alice 36', lb[1].totalPoints === 36);

// suggestStrokes singles
const s1 = suggestStrokes('singles', [10], [4]);
check('singles strokesA=6', s1.strokesA === 6 && s1.strokesB === 0);

// suggestStrokes betterball
const s2 = suggestStrokes('betterball', [10,12], [4,20]);
check('betterball low=4, strokesA=[6,8]', JSON.stringify(s2.strokesA) === JSON.stringify([6,8]));
check('betterball strokesB=[0,16]', JSON.stringify(s2.strokesB) === JSON.stringify([0,16]));

// suggestStrokes greensomes
const s3 = suggestStrokes('greensomes', [10,10], [4,4]);
check('greensomes combinedA=10 combinedB=4 diff=6 -> strokesA=6', s3.strokesA === 6 && s3.strokesB === 0);

// computeMatch: singles, A wins every hole for first 10 -> should close at 10&8 (10up, 8 remaining)
function matchSingles(grossA, grossB, strokesA=0, strokesB=0, points=1) {
  return {
    id:'m1', roundLabel:'Test', format:'singles', points,
    teamAPlayers:[{id:'a1',name:'Alice'}], teamBPlayers:[{id:'b1',name:'Bob'}],
    strokesA, strokesB,
    holes: { A: grossA, B: grossB }
  };
}
const winA = new Array(18).fill(3); // A shoots 3 (birdie) every hole
const loseB = new Array(18).fill(5); // B shoots 5 every hole
const m1 = matchSingles(winA, loseB);
const r1 = computeMatch(course, m1);
check('A wins match closed', r1.finished === true && r1.result.winner === 'A');
check('A wins 10&8', r1.result.label === '10&8');
check('pointsA = 1', r1.pointsA === 1 && r1.pointsB === 0);

// halved match: identical scores all 18
const eq = new Array(18).fill(4);
const m2 = matchSingles(eq, eq);
const r2 = computeMatch(course, m2);
check('halved match', r2.result.winner === 'halved' && r2.pointsA === 0.5 && r2.pointsB === 0.5);

// in-progress match: only 5 holes entered, A up 2
const partialA = [3,3,4,4,4, null,null,null,null,null,null,null,null,null,null,null,null,null];
const partialB = [4,4,4,4,5, null,null,null,null,null,null,null,null,null,null,null,null,null];
const m3 = matchSingles(partialA, partialB);
const r3 = computeMatch(course, m3);
check('in-progress not finished', r3.finished === false);
check('in-progress status text', r3.status.includes('up thru 5'));

// betterball match
function matchBetterball(playersA, playersB, holesMap, strokesA, strokesB, points=1) {
  return {
    id:'m2', roundLabel:'Test', format:'betterball', points,
    teamAPlayers: playersA, teamBPlayers: playersB,
    strokesA, strokesB,
    holes: { players: holesMap }
  };
}
const pA = [{id:'a1',name:'A1'},{id:'a2',name:'A2'}];
const pB = [{id:'b1',name:'B1'},{id:'b2',name:'B2'}];
const holesMap = {
  a1: new Array(18).fill(5),
  a2: new Array(18).fill(3), // best ball for A = 3 every hole
  b1: new Array(18).fill(4),
  b2: new Array(18).fill(4),
};
const m4 = matchBetterball(pA, pB, holesMap, [0,0], [0,0]);
const r4 = computeMatch(course, m4);
check('betterball A best-ball wins big', r4.finished === true && r4.result.winner === 'A');

// team leaderboard aggregation
const teams = { A: {name:'Team A'}, B: {name:'Team B'} };
const tlb = computeTeamLeaderboard(course, teams, [m1, m2]);
check('team leaderboard points A = 1.5', tlb.teamA.points === 1.5);
check('team leaderboard points B = 0.5', tlb.teamB.points === 0.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

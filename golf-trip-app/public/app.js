// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- admin gate ----------
function getAdminPassword() {
  return localStorage.getItem('adminPassword') || '';
}
function isAdmin() {
  return !!getAdminPassword();
}
function updateAdminUI() {
  const admin = isAdmin();
  const enterTab = document.querySelector('.tab-btn[data-view="enter"]');
  const setupTab = document.querySelector('.tab-btn[data-view="setup"]');
  if (enterTab) enterTab.style.display = admin ? '' : 'none';
  if (setupTab) setupTab.style.display = admin ? '' : 'none';
  const btn = $('#admin-toggle-btn');
  if (btn) btn.textContent = admin ? '🔓 Admin' : '🔒 Admin';
  const activeBtn = $('.tab-btn.active');
  if (!admin && activeBtn && (activeBtn.dataset.view === 'enter' || activeBtn.dataset.view === 'setup')) {
    $('.tab-btn[data-view="leaderboard"]').click();
  }
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-Admin-Password': getAdminPassword() },
    ...options,
  });
  if (res.status === 401) {
    localStorage.removeItem('adminPassword');
    updateAdminUI();
    toast('Admin session expired — log in again to make changes');
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function strokesForHole(handicap, si) {
  const h = Math.max(0, Math.round(Number(handicap) || 0));
  const full = Math.floor(h / 18);
  const remainder = h % 18;
  return full + (si <= remainder ? 1 : 0);
}
function stablefordPoints(net, par) {
  if (net == null) return null;
  const diff = net - par;
  if (diff <= -3) return 5;
  if (diff === -2) return 4;
  if (diff === -1) return 3;
  if (diff === 0) return 2;
  if (diff === 1) return 1;
  return 0;
}

// ---------- global state cache ----------
let state = { individualCourse: null, matchCourses: null, teams: null, players: [], individualRounds: [], matches: [] };

// ---------- tabs ----------
$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'leaderboard') refreshLeaderboard();
    if (btn.dataset.view === 'matches') refreshMatchesTab();
    if (btn.dataset.view === 'setup') refreshSetupTab();
    if (btn.dataset.view === 'enter') refreshEnterTab();
  });
});

// ---------- load full state ----------
async function loadState() {
  state = await api('/api/state');
}

// ============ LEADERBOARD ============
async function refreshLeaderboard() {
  await loadState();
  $('#lb-team-a-name').textContent = state.teams.A.name;
  $('#lb-team-b-name').textContent = state.teams.B.name;
  $('#lb-rounds-note').textContent = `Counts: ${state.individualRounds.map((r) => r.label).join(' + ')} on ${state.individualCourse.name}`;

  const team = await api('/api/leaderboard/team');
  $('#lb-team-a-pts').textContent = team.teamA.points;
  $('#lb-team-b-pts').textContent = team.teamB.points;

  const list = $('#lb-matches-list');
  list.innerHTML = '';
  if (!team.matches.length) {
    list.innerHTML = '<div class="muted">No matches created yet.</div>';
  }
  const groups = groupBy(team.matches, (r) => r.match.roundLabel);
  Object.keys(groups).forEach((label) => {
    const h = document.createElement('div');
    h.innerHTML = `<div class="muted" style="margin:8px 0 2px;font-weight:700;">${escapeHtml(label)}</div>`;
    list.appendChild(h);
    groups[label].forEach((r) => {
      list.appendChild(matchItemEl(r));
    });
  });

  const indiv = await api('/api/leaderboard/individual');
  const tbody = $('#lb-individual-table tbody');
  tbody.innerHTML = '';
  indiv.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="${i === 0 && p.totalHolesPlayed > 0 ? 'rank-1' : ''}">${i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td><span class="badge ${p.team}">${escapeHtml(teamShort(p.team))}</span></td>
      <td><strong>${p.totalPoints}</strong></td>`;
    tbody.appendChild(tr);
  });
}

function matchItemEl(r) {
  const div = document.createElement('div');
  div.className = 'match-item';
  const aNames = r.match.teamAPlayers.map((p) => p.name).join(' & ');
  const bNames = r.match.teamBPlayers.map((p) => p.name).join(' & ');
  const courseName = state.matchCourses?.[r.match.courseKey]?.name || '';
  div.innerHTML = `
    <div class="players">${escapeHtml(aNames)} <span class="muted">vs</span> ${escapeHtml(bNames)}</div>
    <div class="status ${r.finished ? 'done' : ''}">${escapeHtml(r.status)} &middot; ${formatLabel(r.match.format)}${courseName ? ` &middot; ${escapeHtml(courseName)}` : ''}</div>`;
  return div;
}

function formatLabel(f) {
  return { singles: 'Singles', betterball: 'Better Ball', greensomes: 'Greensomes' }[f] || f;
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function teamShort(team) {
  const name = state.teams?.[team]?.name || team;
  return name.replace(/^Team\s+/i, '');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============ MATCHES TAB ============
async function refreshMatchesTab() {
  await loadState();
  const results = await api('/api/matches');
  const list = $('#matches-full-list');
  list.innerHTML = '';
  if (!results.length) {
    list.innerHTML = '<div class="muted">No matches yet — add some in Setup.</div>';
    return;
  }
  const groups = groupBy(results, (r) => r.match.roundLabel);
  Object.keys(groups).forEach((label) => {
    const h = document.createElement('div');
    h.innerHTML = `<div class="muted" style="margin:10px 0 2px;font-weight:700;">${escapeHtml(label)}</div>`;
    list.appendChild(h);
    groups[label].forEach((r) => list.appendChild(matchItemEl(r)));
  });
}

// ============ ENTER SCORE TAB ============
let enterMode = 'individual';
$('#enter-mode-individual').addEventListener('click', () => setEnterMode('individual'));
$('#enter-mode-match').addEventListener('click', () => setEnterMode('match'));

function setEnterMode(mode) {
  enterMode = mode;
  $('#enter-mode-individual').classList.toggle('active', mode === 'individual');
  $('#enter-mode-match').classList.toggle('active', mode === 'match');
  $('#enter-individual-panel').style.display = mode === 'individual' ? '' : 'none';
  $('#enter-match-panel').style.display = mode === 'match' ? '' : 'none';
}

async function refreshEnterTab() {
  await loadState();
  const playerSel = $('#enter-player-select');
  playerSel.innerHTML = state.players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(teamShort(p.team))})</option>`).join('');
  const roundSel = $('#enter-round-select');
  roundSel.innerHTML = state.individualRounds.map((r) => `<option value="${r.id}">${escapeHtml(r.label)}</option>`).join('');

  const matchSel = $('#enter-match-select');
  matchSel.innerHTML = state.matches.map((m) => {
    const a = m.teamAPlayers.map((p) => p.name).join('&');
    const b = m.teamBPlayers.map((p) => p.name).join('&');
    return `<option value="${m.id}">${escapeHtml(m.roundLabel)}: ${escapeHtml(a)} vs ${escapeHtml(b)} (${formatLabel(m.format)})</option>`;
  }).join('');

  if (state.players.length) await loadIndividualHoles();
  if (state.matches.length) await loadMatchHoles();
}

const playerOrRoundChanged = async () => { await loadIndividualHoles(); };
$('#enter-player-select').addEventListener('change', playerOrRoundChanged);
$('#enter-round-select').addEventListener('change', playerOrRoundChanged);
$('#enter-match-select').addEventListener('change', loadMatchHoles);

async function loadIndividualHoles() {
  const playerId = $('#enter-player-select').value;
  const roundId = $('#enter-round-select').value;
  if (!playerId || !roundId) {
    $('#enter-individual-holes').innerHTML = '<div class="muted">Add a player first in Setup.</div>';
    return;
  }
  const { holes, handicap } = await api(`/api/individual-rounds/${roundId}/scores/${playerId}`);
  const holesDef = state.individualCourse.holes;

  const hcpWrap = document.createElement('div');
  hcpWrap.className = 'inline-form';
  hcpWrap.style.marginBottom = '10px';
  hcpWrap.innerHTML = `
    <div>
      <label>Handicap for this round</label>
      <input type="number" id="round-handicap-input" value="${handicap}" />
    </div>`;

  const grid = document.createElement('div');
  grid.className = 'hole-grid';
  holesDef.forEach((h, i) => {
    const box = document.createElement('div');
    box.className = 'hole-box';
    const val = holes[i] == null ? '' : holes[i];
    box.innerHTML = `
      <div class="h-label">H${h.number} · Par ${h.par}</div>
      <input type="number" inputmode="numeric" min="1" max="15" data-idx="${i}" value="${val}" />
      <div class="pt" data-pt="${i}"></div>`;
    grid.appendChild(box);
  });
  const container = $('#enter-individual-holes');
  container.innerHTML = '';
  container.appendChild(hcpWrap);
  container.appendChild(grid);

  const hcpInput = $('#round-handicap-input');

  function updatePoint(i) {
    const input = grid.querySelector(`input[data-idx="${i}"]`);
    const ptEl = grid.querySelector(`[data-pt="${i}"]`);
    const g = input.value === '' ? null : Number(input.value);
    if (g == null) { ptEl.textContent = ''; return; }
    const hcp = Number(hcpInput.value) || 0;
    const strokes = strokesForHole(hcp, holesDef[i].si);
    const net = g - strokes;
    const pts = stablefordPoints(net, holesDef[i].par);
    ptEl.textContent = `${pts} pt${pts === 1 ? '' : 's'}`;
  }
  holesDef.forEach((h, i) => {
    updatePoint(i);
    grid.querySelector(`input[data-idx="${i}"]`).addEventListener('input', () => updatePoint(i));
  });
  hcpInput.addEventListener('input', () => {
    holesDef.forEach((h, i) => updatePoint(i));
  });

  $('#save-individual-btn').onclick = async () => {
    const holesOut = holesDef.map((h, i) => {
      const v = grid.querySelector(`input[data-idx="${i}"]`).value;
      return v === '' ? null : Number(v);
    });
    const handicapOut = Number(hcpInput.value) || 0;
    await api(`/api/individual-rounds/${roundId}/scores/${playerId}`, { method: 'PUT', body: JSON.stringify({ holes: holesOut, handicap: handicapOut }) });
    toast('Scores saved');
  };

  const clearBtn = $('#clear-individual-btn');
  if (clearBtn) {
    clearBtn.onclick = async () => {
      if (!confirm('Clear this player\'s entire round? This deletes all their hole scores for this round.')) return;
      await api(`/api/individual-rounds/${roundId}/scores/${playerId}`, { method: 'DELETE' });
      toast('Round cleared');
      await loadIndividualHoles();
    };
  }
}

async function loadMatchHoles() {
  const matchId = $('#enter-match-select').value;
  const container = $('#enter-match-holes');
  const saveBtn = $('#save-match-btn');
  if (!matchId) {
    container.innerHTML = '<div class="muted">Create a match first in Setup.</div>';
    saveBtn.style.display = 'none';
    return;
  }
  const data = await api(`/api/matches/${matchId}`);
  const m = data.match;
  const holesDef = (state.matchCourses[m.courseKey] || Object.values(state.matchCourses)[0]).holes;
  const wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';

  const table = document.createElement('table');
  const aNames = m.teamAPlayers.map((p) => p.name);
  const bNames = m.teamBPlayers.map((p) => p.name);

  if (m.format === 'betterball') {
    const cols = [...m.teamAPlayers.map((p) => ({ id: p.id, name: p.name, side: 'A' })), ...m.teamBPlayers.map((p) => ({ id: p.id, name: p.name, side: 'B' }))];
    table.innerHTML = `<thead><tr><th>Hole</th>${cols.map((c) => `<th>${escapeHtml(c.name)}<br><span class="badge ${c.side}">${c.side}</span></th>`).join('')}</tr></thead>`;
    const tbody = document.createElement('tbody');
    holesDef.forEach((h, i) => {
      const tr = document.createElement('tr');
      let cellsHtml = `<td>${h.number}<br><span class="muted">Par ${h.par}</span></td>`;
      cols.forEach((c) => {
        const val = m.holes.players?.[c.id]?.[i];
        cellsHtml += `<td><input type="number" style="width:52px;" min="1" max="15" data-player="${c.id}" data-idx="${i}" value="${val == null ? '' : val}" /></td>`;
      });
      tr.innerHTML = cellsHtml;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.innerHTML = '';
    container.appendChild(wrap);

    const clearRow = document.createElement('div');
    clearRow.className = 'inline-form';
    clearRow.style.marginTop = '10px';
    clearRow.innerHTML = cols.map((c) => `<button class="btn small danger" data-clear-player="${c.id}" type="button">Clear ${escapeHtml(c.name)}</button>`).join('');
    container.appendChild(clearRow);
    cols.forEach((c) => {
      clearRow.querySelector(`[data-clear-player="${c.id}"]`).addEventListener('click', async () => {
        if (!confirm(`Clear all of ${c.name}'s hole scores for this match?`)) return;
        await api(`/api/matches/${matchId}/score`, { method: 'DELETE', body: JSON.stringify({ playerId: c.id }) });
        toast('Scores cleared');
        await loadMatchHoles();
      });
    });

    saveBtn.style.display = '';
    saveBtn.onclick = async () => {
      for (const c of cols) {
        const holesOut = holesDef.map((h, i) => {
          const v = table.querySelector(`input[data-player="${c.id}"][data-idx="${i}"]`).value;
          return v === '' ? null : Number(v);
        });
        await api(`/api/matches/${matchId}/score`, { method: 'PUT', body: JSON.stringify({ playerId: c.id, holes: holesOut }) });
      }
      toast('Match scores saved');
    };
  } else {
    table.innerHTML = `<thead><tr><th>Hole</th><th>${escapeHtml(aNames.join(' & '))}<br><span class="badge A">A</span></th><th>${escapeHtml(bNames.join(' & '))}<br><span class="badge B">B</span></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    holesDef.forEach((h, i) => {
      const valA = m.holes.A?.[i];
      const valB = m.holes.B?.[i];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${h.number}<br><span class="muted">Par ${h.par}</span></td>
        <td><input type="number" style="width:60px;" min="1" max="15" data-side="A" data-idx="${i}" value="${valA == null ? '' : valA}" /></td>
        <td><input type="number" style="width:60px;" min="1" max="15" data-side="B" data-idx="${i}" value="${valB == null ? '' : valB}" /></td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.innerHTML = '';
    container.appendChild(wrap);

    const clearRow = document.createElement('div');
    clearRow.className = 'inline-form';
    clearRow.style.marginTop = '10px';
    clearRow.innerHTML = `
      <button class="btn small danger" data-clear-side="A" type="button">Clear ${escapeHtml(aNames.join(' & '))}</button>
      <button class="btn small danger" data-clear-side="B" type="button">Clear ${escapeHtml(bNames.join(' & '))}</button>`;
    container.appendChild(clearRow);
    ['A', 'B'].forEach((side) => {
      clearRow.querySelector(`[data-clear-side="${side}"]`).addEventListener('click', async () => {
        if (!confirm(`Clear all hole scores for ${side === 'A' ? aNames.join(' & ') : bNames.join(' & ')}?`)) return;
        await api(`/api/matches/${matchId}/score`, { method: 'DELETE', body: JSON.stringify({ side }) });
        toast('Scores cleared');
        await loadMatchHoles();
      });
    });

    saveBtn.style.display = '';
    saveBtn.onclick = async () => {
      for (const side of ['A', 'B']) {
        const holesOut = holesDef.map((h, i) => {
          const v = table.querySelector(`input[data-side="${side}"][data-idx="${i}"]`).value;
          return v === '' ? null : Number(v);
        });
        await api(`/api/matches/${matchId}/score`, { method: 'PUT', body: JSON.stringify({ side, holes: holesOut }) });
      }
      toast('Match scores saved');
    };
  }

  const statusLine = document.createElement('div');
  statusLine.className = 'muted';
  statusLine.style.marginTop = '8px';
  statusLine.textContent = data.status;
  container.appendChild(statusLine);
}

// ============ SETUP TAB ============
async function refreshSetupTab() {
  await loadState();
  renderPlayersList();
  renderRoundsList();
  renderMatchCourseOptions();
  renderNewMatchPlayerFields();
  renderExistingMatches();
}

function renderMatchCourseOptions() {
  const sel = $('#new-match-course');
  const prev = sel.value;
  sel.innerHTML = Object.entries(state.matchCourses)
    .map(([key, c]) => `<option value="${key}">${escapeHtml(c.name)} (Par ${c.holes.reduce((s, h) => s + h.par, 0)})</option>`)
    .join('');
  if (prev && state.matchCourses[prev]) sel.value = prev;
}

function renderPlayersList() {
  const list = $('#players-list');
  list.innerHTML = '';
  if (!state.players.length) list.innerHTML = '<div class="muted">No players yet.</div>';
  state.players.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <div class="info">
        ${escapeHtml(p.name)} <span class="badge ${p.team}">${escapeHtml(teamShort(p.team))}</span>
        <div class="sub" style="display:flex;align-items:center;gap:6px;margin-top:4px;">
          Handicap
          <input type="number" class="hcp-edit" value="${p.handicap}" style="width:60px;padding:4px 6px;" />
          <button class="btn small secondary" data-save-hcp type="button">Save</button>
        </div>
      </div>
      <button class="btn small danger" data-remove>Remove</button>`;
    row.querySelector('[data-save-hcp]').addEventListener('click', async () => {
      const handicap = Number(row.querySelector('.hcp-edit').value) || 0;
      await api(`/api/players/${p.id}`, { method: 'PUT', body: JSON.stringify({ handicap }) });
      toast(`${p.name}'s handicap updated — future rounds will use it`);
      await refreshSetupTab();
    });
    row.querySelector('[data-remove]').addEventListener('click', async () => {
      if (!confirm(`Remove ${p.name}?`)) return;
      await api(`/api/players/${p.id}`, { method: 'DELETE' });
      toast('Player removed');
      await refreshSetupTab();
    });
    list.appendChild(row);
  });
}

$('#add-player-btn').addEventListener('click', async () => {
  const name = $('#new-player-name').value.trim();
  const handicap = $('#new-player-hcp').value;
  const team = $('#new-player-team').value;
  if (!name) return toast('Enter a name');
  await api('/api/players', { method: 'POST', body: JSON.stringify({ name, handicap, team }) });
  $('#new-player-name').value = '';
  $('#new-player-hcp').value = 0;
  toast('Player added');
  await refreshSetupTab();
});

function renderRoundsList() {
  $('#rounds-list').innerHTML = state.individualRounds.map((r) => `&bull; ${escapeHtml(r.label)}`).join('<br>') || 'None yet';
}

$('#add-round-btn').addEventListener('click', async () => {
  const label = $('#new-round-label').value.trim();
  await api('/api/individual-rounds', { method: 'POST', body: JSON.stringify({ label }) });
  $('#new-round-label').value = '';
  toast('Round added');
  await refreshSetupTab();
});

$('#new-match-format').addEventListener('change', renderNewMatchPlayerFields);

function playerOptions(team) {
  return state.players.filter((p) => p.team === team).map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (hcp ${p.handicap})</option>`).join('');
}

function renderNewMatchPlayerFields() {
  const format = $('#new-match-format').value;
  const container = $('#new-match-players');
  if (format === 'singles') {
    container.innerHTML = `
      <div class="row2">
        <div><label>${escapeHtml(state.teams.A.name)} player</label><select id="mp-a1">${playerOptions('A')}</select></div>
        <div><label>${escapeHtml(state.teams.B.name)} player</label><select id="mp-b1">${playerOptions('B')}</select></div>
      </div>`;
  } else {
    container.innerHTML = `
      <div class="row2">
        <div><label>${escapeHtml(state.teams.A.name)} player 1</label><select id="mp-a1">${playerOptions('A')}</select></div>
        <div><label>${escapeHtml(state.teams.A.name)} player 2</label><select id="mp-a2">${playerOptions('A')}</select></div>
      </div>
      <div class="row2">
        <div><label>${escapeHtml(state.teams.B.name)} player 1</label><select id="mp-b1">${playerOptions('B')}</select></div>
        <div><label>${escapeHtml(state.teams.B.name)} player 2</label><select id="mp-b2">${playerOptions('B')}</select></div>
      </div>`;
  }
  renderStrokesFields();
}

function selectedMatchPlayers() {
  const format = $('#new-match-format').value;
  const getP = (id) => state.players.find((p) => p.id === $(id)?.value);
  const a = [getP('#mp-a1')].filter(Boolean);
  const b = [getP('#mp-b1')].filter(Boolean);
  if (format !== 'singles') {
    const a2 = getP('#mp-a2'); if (a2) a.push(a2);
    const b2 = getP('#mp-b2'); if (b2) b.push(b2);
  }
  return { format, a, b };
}

function renderStrokesFields() {
  const { format, a, b } = selectedMatchPlayers();
  const container = $('#new-match-strokes');
  if (format === 'betterball') {
    container.innerHTML = `
      <label>Strokes given (per player, editable)</label>
      <div class="row2">
        ${a.map((p, i) => `<div><span class="muted">${escapeHtml(p.name)}</span><input type="number" id="sa-${i}" value="0" /></div>`).join('')}
      </div>
      <div class="row2">
        ${b.map((p, i) => `<div><span class="muted">${escapeHtml(p.name)}</span><input type="number" id="sb-${i}" value="0" /></div>`).join('')}
      </div>
      <button class="btn secondary small" id="suggest-strokes-btn" type="button">Suggest strokes from handicaps</button>`;
  } else {
    container.innerHTML = `
      <label>Strokes given</label>
      <div class="row2">
        <div><span class="muted">${escapeHtml(state.teams.A.name)}</span><input type="number" id="sa-total" value="0" /></div>
        <div><span class="muted">${escapeHtml(state.teams.B.name)}</span><input type="number" id="sb-total" value="0" /></div>
      </div>
      <button class="btn secondary small" id="suggest-strokes-btn" type="button">Suggest strokes from handicaps</button>`;
  }
  $('#suggest-strokes-btn').addEventListener('click', async () => {
    const { format, a, b } = selectedMatchPlayers();
    const sugg = await api('/api/matches/suggest-strokes', { method: 'POST', body: JSON.stringify({ format, teamAHandicaps: a.map((p) => p.handicap), teamBHandicaps: b.map((p) => p.handicap) }) });
    if (format === 'betterball') {
      (sugg.strokesA || []).forEach((v, i) => { const el = $(`#sa-${i}`); if (el) el.value = v; });
      (sugg.strokesB || []).forEach((v, i) => { const el = $(`#sb-${i}`); if (el) el.value = v; });
    } else {
      $('#sa-total').value = sugg.strokesA;
      $('#sb-total').value = sugg.strokesB;
    }
    toast('Suggested strokes filled in');
  });
}

$('#create-match-btn').addEventListener('click', async () => {
  const roundLabel = $('#new-match-round-label').value.trim() || 'Match Play';
  const courseKey = $('#new-match-course').value;
  const points = $('#new-match-points').value;
  const { format, a, b } = selectedMatchPlayers();
  if (!a.length || !b.length || (format !== 'singles' && (a.length < 2 || b.length < 2))) {
    return toast('Select all players for this format');
  }
  let strokesA, strokesB;
  if (format === 'betterball') {
    strokesA = a.map((_, i) => Number($(`#sa-${i}`)?.value || 0));
    strokesB = b.map((_, i) => Number($(`#sb-${i}`)?.value || 0));
  } else {
    strokesA = Number($('#sa-total')?.value || 0);
    strokesB = Number($('#sb-total')?.value || 0);
  }
  await api('/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      roundLabel, format, courseKey, points,
      teamAPlayers: a.map((p) => ({ id: p.id, name: p.name })),
      teamBPlayers: b.map((p) => ({ id: p.id, name: p.name })),
      strokesA, strokesB,
    }),
  });
  $('#new-match-round-label').value = '';
  toast('Match created');
  await refreshSetupTab();
});

function renderExistingMatches() {
  const list = $('#setup-matches-list');
  list.innerHTML = '';
  if (!state.matches.length) { list.innerHTML = '<div class="muted">No matches yet.</div>'; return; }
  state.matches.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'match-row';
    const a = m.teamAPlayers.map((p) => p.name).join(' & ');
    const b = m.teamBPlayers.map((p) => p.name).join(' & ');
    row.innerHTML = `
      <div class="info">
        <div style="font-weight:600;">${escapeHtml(m.roundLabel)}</div>
        <div class="sub muted">${escapeHtml(a)} vs ${escapeHtml(b)} &middot; ${formatLabel(m.format)} &middot; ${m.points} pt</div>
      </div>
      <button class="btn small danger" data-id="${m.id}">Delete</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      if (!confirm('Delete this match?')) return;
      await api(`/api/matches/${m.id}`, { method: 'DELETE' });
      toast('Match deleted');
      await refreshSetupTab();
    });
    list.appendChild(row);
  });
}

// ============ ADMIN LOGIN ============
const adminBtn = $('#admin-toggle-btn');
if (adminBtn) {
  adminBtn.addEventListener('click', async () => {
    if (isAdmin()) {
      if (confirm('Log out of admin mode?')) {
        localStorage.removeItem('adminPassword');
        updateAdminUI();
        toast('Logged out');
      }
      return;
    }
    const pw = prompt('Enter admin password:');
    if (!pw) return;
    try {
      const res = await fetch('/api/admin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      if (!res.ok) { toast('Incorrect password'); return; }
      localStorage.setItem('adminPassword', pw);
      updateAdminUI();
      toast('Admin unlocked');
    } catch (e) {
      toast('Login failed');
    }
  });
}

// ============ INIT + POLLING ============
async function init() {
  updateAdminUI();
  await refreshLeaderboard();
}
init();

setInterval(() => {
  const active = $('.tab-btn.active')?.dataset.view;
  if (active === 'leaderboard') refreshLeaderboard();
  if (active === 'matches') refreshMatchesTab();
}, 8000);

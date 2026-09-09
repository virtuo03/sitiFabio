/* =========================================================
   STATE E PARAMETRI
========================================================= */
const ROLES = ['P','D','C','A'];
const ROLE_LABEL = { P:'Portiere', D:'Difensore', C:'Centrocampista', A:'Attaccante' };
const TIERS = ['Top','Semi-Top','Buono','Terza Fascia','Scommessa','Riserva'];
const STORAGE_KEY = 'prezzogiusto_state_v1';

// Limiti di spesa ideali per calcolare la saturazione
const MAX_ROLE_ALLOCATION = { P: 0.10, D: 0.15, C: 0.30, A: 0.45 }; 

function defaultState(){
  return {
    version: 2,
    view: 'setup',
    setupDone: false,
    listoneImported: false,
    budget: 500,
    numTeams: 8,
    slots: { P:3, D:8, C:8, A:6 },
    myTeamId: null,
    weights: { scarcity: 1.0, market: 1.0, fasciaScarcity: 0.8 },
    teams: [],
    players: [],
    saleSeq: 0,
    listoneFilter: { role: 'ALL', q: '', status: 'FREE', sortKey: 'qtA', sortDir: 'desc' },
    activeCallPlayerId: null,
    auctionPhase: 'P', 
  };
}

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const def = defaultState();
    return {
      ...def,
      ...parsed,
      slots: { ...def.slots, ...(parsed.slots || {}) },
      weights: { ...def.weights, ...(parsed.weights || {}) },
      listoneFilter: { ...def.listoneFilter, ...(parsed.listoneFilter || {}) },
      version: parsed.version || 2
    };
  }catch(e){ return defaultState(); }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function setState(patch){ Object.assign(state, patch); saveState(); render(); }

function isAuctionStarted(){
  return (state.saleSeq > 0) || state.players.some(p => p.assignedTeam);
}

function showToast(msg, type='info'){
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function emptyAllTeams(){
  if(!isAuctionStarted()) {
    showToast('Nessun giocatore assegnato, le rose sono già vuote.', 'info');
    return;
  }
  if(!confirm('Sicuro di voler SVUOTARE TUTTE LE SQUADRE? Tutti i giocatori torneranno liberi nel listone e i budget verranno ripristinati. Questa azione non si può annullare.')) return;
  
  state.teams.forEach(t => {
    t.spent = 0;
    t.roster = { P:[], D:[], C:[], A:[] };
  });
  
  state.players.forEach(p => {
    p.assignedTeam = null;
    p.price = null;
    p.saleSeq = null;
  });
  
  state.saleSeq = 0;
  saveState();
  render();
  showToast('Tutte le squadre sono state svuotate.', 'success');
}

function resetAll(){
  if(isAuctionStarted() && !confirm('ATTENZIONE: L\'asta è in corso. Vuoi davvero cancellare TUTTO (squadre, giocatori assegnati, crediti)?')) return;
  else if (!isAuctionStarted() && !confirm('Sicuro di voler azzerare tutta la lega, il listone e le assegnazioni?')) return;
  state = defaultState();
  saveState();
  render();
}

function exportBackup(){
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  a.href = url;
  a.download = 'prezzogiusto-backup-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Backup esportato con successo', 'success');
}

const importBackupInputEl = document.getElementById('importBackupInput');
if(importBackupInputEl) importBackupInputEl.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    try{
      const parsed = JSON.parse(ev.target.result);
      if(!confirm('Importare questo backup? Sovrascriverà i dati attuali della lega.')) return;
      state = defaultState();
      state = {
        ...state,
        ...parsed,
        slots: { ...state.slots, ...(parsed.slots || {}) },
        weights: { ...state.weights, ...(parsed.weights || {}) },
        listoneFilter: { ...state.listoneFilter, ...(parsed.listoneFilter || {}) }
      };
      saveState();
      render();
      showToast('Backup ripristinato con successo', 'success');
    }catch(err){
      showToast('File non valido: impossibile leggere il backup.', 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
});

/* =========================================================
   HELPERS
========================================================= */
function uid(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,9); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function fmt(n){ return Math.round(n).toLocaleString('it-IT'); }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function getTeam(id){ return state.teams.find(t=>t.id===id); }
function freePlayers(role){ return state.players.filter(p => (!role || role==='ALL' || p.ruolo===role) && !p.assignedTeam); }
function totalSlots(role){ return state.numTeams * state.slots[role]; }
function filledSlots(role){ return state.teams.reduce((s,t)=> s + t.roster[role].length, 0); }
function remainingSlots(role){ return Math.max(totalSlots(role) - filledSlots(role), 0); }
function totalCreditsRemainingLeague(){ return state.teams.reduce((s,t)=> s + (state.budget - t.spent), 0); }
function teamRemainingSlots(team){ return ROLES.reduce((s,r)=> s + (state.slots[r]-team.roster[r].length), 0); }

/* =========================================================
   SUGGESTION ENGINE
========================================================= */

function scarcityFactor(role){
  const isPlayable = p => (p.mio_prezzo || p.fvm || p.qtA) >= 5;
  const freePlayable = freePlayers(role).filter(isPlayable).length;
  const remSlots = remainingSlots(role);
  const ratio = remSlots / Math.max(freePlayable, 1);
  return clamp(0.65 + 0.4*Math.min(ratio,2.5), 0.65, 1.8);
}

function fvmScaled(player){
  return player.fvm != null && player.fvm !== '' ? parseFloat(player.fvm) : null;
}
function weighted(factor, weight){
  return 1 + (factor-1)*weight;
}

function getBaseValue(player) {
  if (player.mio_prezzo != null && player.mio_prezzo !== '') {
    return { val: player.mio_prezzo, src: 'Mio Prezzo' };
  }
  const fvmS = fvmScaled(player);
  if (fvmS != null) {
    return { val: fvmS, src: 'FVM' };
  }
  return { val: player.qtA, src: 'Qt.A' };
}

function suggestPrice(playerId, teamId){
  const player = state.players.find(p=>p.id===playerId);
  const team = getTeam(teamId);
  if(!player) return null;

  const baseObj = getBaseValue(player);
  const base = baseObj.val;
  
  const scar = weighted(scarcityFactor(player.ruolo), state.weights.scarcity);

  // LOGICA: Tetto del "Più Ricco" Intelligente e calcolo Rivali Attivi
  let maxOpponentBid = 0;
  let activeRivalsList = [];
  let totalActiveRivalBudget = 0;
  let activeRivalSlots = 0; 

  state.teams.forEach(t => {
    if(team && t.id === team.id) return;
    const remRoleSlots = state.slots[player.ruolo] - t.roster[player.ruolo].length;
    if(remRoleSlots <= 0) return; 
    
    const rem = state.budget - t.spent;
    const slots = teamRemainingSlots(t);
    if (slots > 0) {
      let mBid = rem - (slots - 1); 
      
      const roleSpent = t.roster[player.ruolo].reduce((sum, id) => sum + (state.players.find(pl=>pl.id===id)?.price||0), 0);
      const roleIdealLimit = state.budget * MAX_ROLE_ALLOCATION[player.ruolo];
      
      if (player.ruolo !== 'A') {
         const maxRoleWillingness = (roleIdealLimit * 1.35) - roleSpent; 
         const realisticBid = Math.max(Math.round(maxRoleWillingness), 0);
         mBid = Math.min(mBid, realisticBid);
      }

      if (mBid > maxOpponentBid) maxOpponentBid = mBid;

      if (roleSpent < roleIdealLimit * 0.90 && mBid > 0) {
        activeRivalsList.push(t);
        totalActiveRivalBudget += rem;
        activeRivalSlots += remRoleSlots;
      }
    }
  });

  const activeRivalsCount = activeRivalsList.length;
  const avgActiveRivalBudget = activeRivalsCount > 0 ? Math.round(totalActiveRivalBudget / activeRivalsCount) : 0;

  const isPlayable = p => (p.mio_prezzo || p.fvm || p.qtA) >= 5;
  const playableLeft = freePlayers(player.ruolo).filter(isPlayable).length;

  let saturationMult = 1;
  const minValToDiscount = 4;
  
  if (activeRivalSlots < playableLeft && base >= minValToDiscount) {
    const ratio = activeRivalSlots / Math.max(playableLeft, 1);
    saturationMult = clamp(0.5 + 0.5 * ratio, 0.5, 1.0);
  }
  const saturationMultWeighted = weighted(saturationMult, state.weights.scarcity);

  // --- LOGICA REATTIVA (Stile FantaLab) ---
  let reactiveMulti = 1;
  let actualRem = state.budget;
  let expectedRem = state.budget;

  const needsThisRole = !team || team.roster[player.ruolo].length < state.slots[player.ruolo];
  if (team && needsThisRole) {
    let idealSpent = 0;
    ROLES.forEach(r => {
      const slotsFilled = team.roster[r].length;
      const totRoleSlots = state.slots[r];
      const roleBudget = state.budget * MAX_ROLE_ALLOCATION[r];
      idealSpent += (roleBudget / totRoleSlots) * slotsFilled; 
    });

    expectedRem = state.budget - idealSpent;
    actualRem = state.budget - team.spent;

    if (expectedRem > 0 && actualRem > 0) {
      reactiveMulti = actualRem / expectedRem;
      
      if (reactiveMulti > 1 && (player.fascia === 'Top' || player.fascia === 'Semi-Top')) {
          reactiveMulti = 1 + ((reactiveMulti - 1) * 1.3);
      }
      else if (reactiveMulti < 1 && (player.fascia === 'Scommessa' || player.fascia === 'Riserva')) {
          reactiveMulti = 1 - ((1 - reactiveMulti) * 1.3);
      }
    }
    
    reactiveMulti = clamp(reactiveMulti, 0.4, 2.5);
  }

  // Andamento di mercato
  const mkt = marketFactor(player.ruolo, player.fascia);
  const mktMult = weighted(mkt.factor, state.weights.market);
  const fasciaScar = fasciaScarcityFactor(player.ruolo, player.fascia);
  const fasciaScarMult = weighted(fasciaScar, state.weights.fasciaScarcity);

  let combinedMult = scar * saturationMultWeighted * reactiveMulti * mktMult * fasciaScarMult;
  combinedMult = clamp(combinedMult, 0.3, 3.0);

  let raw = base * combinedMult;
  let cap = Infinity, myRemaining = Infinity, mySlotsLeft = null;
  const warnings = [];
  
  if(team){
    myRemaining = state.budget - team.spent;
    mySlotsLeft = teamRemainingSlots(team);
    const otherSlots = Math.max(mySlotsLeft - 1, 0);
    cap = myRemaining - otherSlots; 
    
    const teamRoleSpent = team.roster[player.ruolo].reduce((sum, id) => {
      const p = state.players.find(pl => pl.id === id);
      return sum + (p ? p.price : 0);
    }, 0);
    const softLimit = state.budget * MAX_ROLE_ALLOCATION[player.ruolo];

    if(team.roster[player.ruolo].length >= state.slots[player.ruolo]){
      warnings.push('Questo ruolo è già completo per la squadra selezionata: non servono altri ' + ROLE_LABEL[player.ruolo].toLowerCase() + '.');
    }
    
    if(teamRoleSpent + raw > softLimit && player.ruolo !== 'A'){
      warnings.push(`ATTENZIONE BUDGET: Se spendi questa cifra, supererai il ${Math.round(MAX_ROLE_ALLOCATION[player.ruolo]*100)}% del budget in ${ROLE_LABEL[player.ruolo]}. Rischio di rimanere senza crediti per l'Attacco.`);
    }

    if(cap < base*0.7){
      warnings.push('Budget residuo tirato: per completare la rosa conviene restare sotto base su questo giocatore.');
    }
    if(myRemaining <= 0){
      warnings.push('Budget esaurito per questa squadra.');
    }
  }

  const marketSample = mkt.nFascia>0 ? mkt.nFascia : mkt.nRole;
  if(marketSample >= 2 && Math.abs(mkt.factor-1) >= 0.08){
    const pct = Math.round(mkt.factor*100);
    const bucketLabel = mkt.nFascia>0 ? (player.fascia||'senza fascia')+' · '+ROLE_LABEL[player.ruolo].toLowerCase() : ROLE_LABEL[player.ruolo].toLowerCase();
    if(mkt.factor < 1){
      warnings.push(`Mercato in calo per ${bucketLabel}: finora pagati in media al ${pct}% del valore base. Prezzo abbassato.`);
    } else {
      warnings.push(`Mercato acceso per ${bucketLabel}: finora pagati in media al ${pct}% del valore base. Prezzo alzato.`);
    }
  }

  let suggested = raw;

  if (suggested > (maxOpponentBid + 1) && maxOpponentBid > 0 && team) {
     suggested = maxOpponentBid + 1;
     warnings.push(`Limite Matematico Avversari: il rivale più ricco può offrire massimo ${maxOpponentBid}cr. Rilanciare oltre ${maxOpponentBid + 1}cr non serve.`);
  }

  suggested = Math.min(suggested, isFinite(cap) ? Math.max(cap,1) : suggested, isFinite(myRemaining) ? myRemaining : suggested);
  suggested = Math.max(suggested, 1);

  let stopPrice = Math.round(raw * 1.35);
  if (isFinite(cap)) stopPrice = Math.min(stopPrice, cap);
  if (team && stopPrice > maxOpponentBid + 1 && maxOpponentBid > 0) {
      stopPrice = Math.min(stopPrice, maxOpponentBid + 1);
  }
  if (stopPrice < suggested) stopPrice = suggested;

  let min = Math.max(Math.round(suggested*0.85), 1);
  let max = Math.round(Math.min(raw * 1.25, isFinite(cap) ? cap : raw * 1.25));
  if (team && max > maxOpponentBid + 1 && maxOpponentBid > 0) max = maxOpponentBid + 1; 
  if (max > cap) max = cap;
  
  if(max < min) max = min;
  if(min > suggested) min = suggested;

  return {
    base, baseSource: baseObj.src, suggested: Math.round(suggested), min, max, stopPrice,
    factors: { scarcity: scar, saturation: saturationMultWeighted, reactive: reactiveMulti, market: mktMult, fasciaScarcity: fasciaScarMult },
    marketMeta: mkt,
    warnings, myRemaining: isFinite(myRemaining)?myRemaining:null, maxOpponentBid,
    rivals: { count: activeRivalsCount, avgBudget: avgActiveRivalBudget }
  };
}

/* ---- Logiche di Mercato ---- */

function assignedInRole(role){
  return state.players.filter(p=>p.assignedTeam && p.ruolo===role);
}
function assignedInBucket(role, fascia){
  return state.players.filter(p=>p.assignedTeam && p.ruolo===role && p.fascia===fascia);
}
const RECENCY_DECAY = 0.85;
function avgPaidRatio(list){
  if(!list.length) return null;
  const maxSeq = Math.max(...list.map(p=>p.saleSeq||0));
  let wSum = 0, vSum = 0;
  list.forEach(p=>{
    const b = Math.max(getBaseValue(p).val || 1, 1);
    const ratio = (p.price||0) / b;
    const age = Math.max(maxSeq - (p.saleSeq||0), 0);
    const w = Math.pow(RECENCY_DECAY, age);
    wSum += w;
    vSum += w*ratio;
  });
  return wSum>0 ? vSum/wSum : null;
}

function marketConfidence(nFascia, nRole){
  if(nFascia>=4) return { label:'Alta', cls:'high' };
  if(nFascia>=2 || nRole>=5) return { label:'Media', cls:'medium' };
  return { label:'Bassa', cls:'low' };
}

function marketFactor(role, fascia){
  const PRIOR = 1;
  const ROLE_PRIOR_WEIGHT = 3;
  const FASCIA_PRIOR_WEIGHT = 2;

  const roleList = assignedInRole(role);
  const roleAvg = avgPaidRatio(roleList);
  const roleEffective = roleAvg!=null
    ? (roleAvg*roleList.length + PRIOR*ROLE_PRIOR_WEIGHT) / (roleList.length+ROLE_PRIOR_WEIGHT)
    : PRIOR;

  const fasciaList = fascia ? assignedInBucket(role, fascia) : [];
  const fasciaAvg = avgPaidRatio(fasciaList);
  const fasciaEffective = fasciaAvg!=null
    ? (fasciaAvg*fasciaList.length + roleEffective*FASCIA_PRIOR_WEIGHT) / (fasciaList.length+FASCIA_PRIOR_WEIGHT)
    : roleEffective;

  return {
    factor: clamp(fasciaEffective, 0.6, 1.6),
    nRole: roleList.length,
    nFascia: fasciaList.length,
    roleAvg, fasciaAvg,
    confidence: marketConfidence(fasciaList.length, roleList.length)
  };
}

function fasciaScarcityFactor(role, fascia){
  if(!fascia) return 1;
  const total = state.players.filter(p=>p.ruolo===role && p.fascia===fascia).length;
  if(total===0) return 1;
  const free = state.players.filter(p=>p.ruolo===role && p.fascia===fascia && !p.assignedTeam).length;
  const depletion = 1 - (free/total);
  return clamp(0.8 + 0.6*depletion, 0.8, 1.6);
}

/* =========================================================
   NAV / RENDER SHELL
========================================================= */
const NAV_ITEMS = [
  { id:'setup', label:'Setup Lega', n:'01' },
  { id:'listone', label:'Listone', n:'02' },
  { id:'asta', label:'Asta Live', n:'03' },
  { id:'squadre', label:'Squadre', n:'04' },
];

function render(){
  renderNav();
  renderSideStats();
  const c = document.getElementById('content');
  c.innerHTML = '';
  if(state.view==='setup') renderSetup(c);
  else if(state.view==='listone') renderListone(c);
  else if(state.view==='asta') renderAsta(c);
  else if(state.view==='squadre') renderSquadre(c);
}

function renderNav(){
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  NAV_ITEMS.forEach(item=>{
    const btn = document.createElement('button');
    btn.className = item.id===state.view ? 'active' : '';
    const locked = (item.id!=='setup' && !state.setupDone) || (item.id==='asta' && !state.listoneImported) || (item.id==='squadre' && !state.setupDone);
    btn.disabled = locked;
    btn.innerHTML = '<span class="n">'+item.n+'</span>' + esc(item.label);
    btn.onclick = ()=> setState({ view:item.id });
    nav.appendChild(btn);
  });
}

function renderSideStats(){
  const el = document.getElementById('sideStats');
  if(!state.setupDone){ el.innerHTML=''; return; }
  const creditiRimasti = totalCreditsRemainingLeague();
  
  let spentIdeal = 0;
  let spentActual = 0;
  state.teams.forEach(t => {
      ROLES.forEach(r => {
          const roleSpent = t.roster[r].reduce((s, id) => s + (state.players.find(p=>p.id===id)?.price||0), 0);
          spentActual += roleSpent;
          const filledPct = t.roster[r].length / state.slots[r];
          spentIdeal += (state.budget * MAX_ROLE_ALLOCATION[r]) * filledPct;
      });
  });
  
  const extraMoney = spentIdeal - spentActual;
  let pressureMsg = `<div class="val" style="color:var(--chalk-dim); font-size: 14px;">Mercato Equilibrato</div>`;
  if (extraMoney > (state.numTeams * 10)) {
      pressureMsg = `<div class="val" style="color:var(--red); font-size: 14px;">Tutti risparmiano: Attaccanti costeranno carissimi!</div>`;
  } else if (extraMoney < -(state.numTeams * 10)) {
      pressureMsg = `<div class="val" style="color:var(--green); font-size: 14px;">Tutti spendono troppo: Attaccanti a saldo!</div>`;
  }

  el.innerHTML = `
    <div class="side-stat"><div class="label">Crediti liberi in lega</div><div class="val">${fmt(creditiRimasti)}</div></div>
    <div class="side-stat" style="margin-top:10px;"><div class="label">Pressione sui prossimi ruoli</div>${pressureMsg}</div>
  `;
}

/* =========================================================
   VIEW: SETUP
========================================================= */
function renderSetup(c){
  const title = document.createElement('div');
  title.innerHTML = `
    <h1 class="view-title">Setup Lega</h1>
    <p class="view-sub">Configura budget, rose e partecipanti. Questi parametri guidano tutti i calcoli del prezzo consigliato durante l'asta.</p>
  `;
  c.appendChild(title);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <h3>Parametri lega</h3>
    <div class="grid3">
      <label class="field"><span class="lbl">Numero di squadre</span>
        <input type="number" id="f_numTeams" min="2" max="20" value="${state.numTeams}" ${isAuctionStarted()?'disabled':''}>
      </label>
      <label class="field"><span class="lbl">Crediti a squadra</span>
        <input type="number" id="f_budget" min="1" value="${state.budget}" ${isAuctionStarted()?'disabled':''}>
      </label>
      <label class="field"><span class="lbl">&nbsp;</span>
        <span style="color:var(--chalk-dim);font-size:12.5px;">Crediti totali in lega: <b style="color:var(--chalk)">${fmt(state.numTeams*state.budget)}</b></span>
      </label>
    </div>
    <h3 style="margin-top:8px;">Composizione rosa (per squadra)</h3>
    <div class="grid3">
      ${ROLES.map(r=>`
        <label class="field"><span class="lbl">${ROLE_LABEL[r]} <span class="role-tag role-${r}" style="width:16px;height:16px;font-size:10px;vertical-align:middle;">${r}</span></span>
          <input type="number" id="f_slot_${r}" min="0" max="15" value="${state.slots[r]}" ${isAuctionStarted()?'disabled':''}>
        </label>`).join('')}
    </div>
    <p class="hint">Totale giocatori a rosa: <b id="rosterTotalPreview" style="color:var(--chalk)">${ROLES.reduce((s,r)=>s+state.slots[r],0)}</b>. Standard Classic Serie A: 3 P, 8 D, 8 C, 6 A (25 totali).</p>
  `;
  c.appendChild(panel);

  const panel2 = document.createElement('div');
  panel2.className = 'panel';
  panel2.innerHTML = `<h3>Squadre partecipanti</h3><p class="hint">Rinomina le squadre della lega e indica qual è la tua.</p><div id="teamsEditor"></div>`;
  c.appendChild(panel2);

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';
  btnRow.innerHTML = `<button class="btn btn-primary" id="saveSetupBtn">Salva configurazione</button>`;
  c.appendChild(btnRow);

  function currentSlotVals(){
    return {
      numTeams: parseInt(document.getElementById('f_numTeams').value)||state.numTeams,
      budget: parseInt(document.getElementById('f_budget').value)||state.budget,
      slots: Object.fromEntries(ROLES.map(r=>[r, parseInt(document.getElementById('f_slot_'+r).value)||0]))
    };
  }

  function renderTeamsEditor(){
    const cfg = currentSlotVals();
    const names = [];
    for(let i=0;i<cfg.numTeams;i++){
      const existing = state.teams[i];
      names.push(existing ? existing.name : ('Squadra '+(i+1)));
    }
    const wrap = document.getElementById('teamsEditor');
    wrap.innerHTML = names.map((n,i)=>`
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
        <input type="text" class="teamNameInput" data-i="${i}" value="${esc(n)}" style="flex:1;" ${isAuctionStarted()?'disabled':''}>
        <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--chalk-dim);">
          <input type="radio" name="myTeamRadio" value="${i}" ${ (state.myTeamId && state.teams[i] && state.teams[i].id===state.myTeamId) || (state.myTeamId===null && i===0) ? 'checked':''}>
          la mia squadra
        </label>
      </div>
    `).join('');
  }
  renderTeamsEditor();
  ['f_numTeams','f_budget',...ROLES.map(r=>'f_slot_'+r)].forEach(id=>{
    document.getElementById(id).addEventListener('input', ()=>{
      const cfg = currentSlotVals();
      document.getElementById('rosterTotalPreview').textContent = ROLES.reduce((s,r)=>s+cfg.slots[r],0);
      if(document.activeElement.id==='f_numTeams') renderTeamsEditor();
    });
  });

  document.getElementById('saveSetupBtn').onclick = ()=>{
    if(isAuctionStarted()){
      showToast('Asta già iniziata. Non puoi modificare le impostazioni strutturali.', 'error');
      return;
    }
    const cfg = currentSlotVals();
    const nameInputs = Array.from(document.querySelectorAll('.teamNameInput'));
    const myIdx = parseInt((document.querySelector('input[name=myTeamRadio]:checked')||{}).value ?? 0);

    const newTeams = nameInputs.map((inp,i)=>{
      const existing = state.teams[i];
      return existing ? { ...existing, name: inp.value.trim() || ('Squadra '+(i+1)) } : {
        id: uid('team'),
        name: inp.value.trim() || ('Squadra '+(i+1)),
        spent: 0,
        roster: { P:[], D:[], C:[], A:[] }
      };
    });

    setState({
      numTeams: cfg.numTeams,
      budget: cfg.budget,
      slots: cfg.slots,
      teams: newTeams,
      myTeamId: newTeams[myIdx] ? newTeams[myIdx].id : (newTeams[0] ? newTeams[0].id : null),
      setupDone: true,
      view: state.listoneImported ? state.view : 'listone'
    });
    showToast('Impostazioni salvate con successo', 'success');
  };
}

/* =========================================================
   VIEW: LISTONE
========================================================= */
let csvStaging = null;

function renderListone(c){
  c.innerHTML = `
    <h1 class="view-title">Listone Giocatori</h1>
    <p class="view-sub">Importa il listino quotazioni (copia/incolla da Excel, Fantacalcio.it o Gazzetta) oppure aggiungi giocatori manualmente. La "Fascia" rimane a scopo visivo e ordinamento.</p>
  `;

  if(!state.listoneImported || document.getElementById('forceImportPanel')){
    c.appendChild(buildImportPanel());
  } else {
    const reopen = document.createElement('div');
    reopen.className = 'btn-row';
    reopen.style.marginBottom = '18px';
    reopen.innerHTML = `<button class="btn btn-outline btn-sm" id="reopenImport" ${isAuctionStarted()?'disabled':''}>+ Importa altri giocatori / correggi listone</button>`;
    c.appendChild(reopen);
    if(!isAuctionStarted()){
      reopen.querySelector('#reopenImport').onclick = ()=>{
        const p = buildImportPanel();
        p.id = 'forceImportPanel';
        c.insertBefore(p, c.children[1]);
      };
    } else {
      reopen.innerHTML += `<span style="font-size:12px; color:var(--chalk-dim); margin-left: 10px; align-self:center;">Importazione disabilitata (Asta Iniziata)</span>`;
    }
  }

  if(state.listoneImported){
    c.appendChild(buildListoneTable());
  }
}

function parseCSVFull(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"'; i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if ((char === ',' || char === ';') && !insideQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if (char === '\n' && !insideQuotes) {
      currentRow.push(currentVal.trim());
      rows.push(currentRow);
      currentRow = [];
      currentVal = "";
    } else if (char === '\r' && !insideQuotes) {
      // Ignora return
    } else {
      currentVal += char;
    }
  }
  if (currentVal !== "" || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    rows.push(currentRow);
  }
  return rows.filter(r => r.some(c => c !== ""));
}

function buildImportPanel(){
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <h3>Importa listone</h3>
    <p class="hint">Carica direttamente il file CSV esportato oppure incolla il testo qui sotto.</p>
    <div class="btn-row" style="margin-bottom:10px;">
      <label class="btn btn-outline btn-sm" style="display:inline-block;">
        Carica file CSV
        <input type="file" id="csvFileInput" accept=".csv,text/csv,text/plain" style="display:none;">
      </label>
      <span id="csvFileName" style="color:var(--chalk-dim);font-size:12.5px;align-self:center;"></span>
    </div>
    <textarea id="csvInput" rows="6" style="width:100%;" placeholder="Ruolo;Nome;Squadra;Quotazione&#10;A;Lautaro Martinez;Inter;38&#10;C;Calhanoglu;Inter;24&#10;..."></textarea>
    <div class="btn-row"><button class="btn btn-outline btn-sm" id="parseCsvBtn">Analizza colonne</button></div>
    <div id="mappingArea"></div>
  `;

  function parseCsvText(raw){
    if(!raw) return;
    const allRows = parseCSVFull(raw);
    if(allRows.length===0) return;
    // Alcuni export (es. Fantacalcio.it) hanno una riga di titolo prima della vera intestazione
    let headerIdx = allRows.findIndex(r => r.map(c=>c.toLowerCase().trim()).includes('nome'));
    const rows = headerIdx > 0 ? allRows.slice(headerIdx) : allRows;
    csvStaging = { rows };
    renderMapping(panel);
  }

  panel.querySelector('#parseCsvBtn').onclick = ()=>{
    parseCsvText(panel.querySelector('#csvInput').value.trim());
  };
  panel.querySelector('#csvFileInput').onchange = (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    panel.querySelector('#csvFileName').textContent = file.name;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      const text = ev.target.result;
      panel.querySelector('#csvInput').value = text;
      parseCsvText(text.trim());
    };
    reader.readAsText(file, 'UTF-8');
  };

  const manual = document.createElement('div');
  manual.className = 'panel';
  manual.innerHTML = `
    <h3>Aggiungi giocatore manualmente</h3>
    <div class="grid3">
      <label class="field"><span class="lbl">Ruolo</span>
        <select id="man_ruolo">${ROLES.map(r=>`<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}</select>
      </label>
      <label class="field"><span class="lbl">Nome</span><input type="text" id="man_nome" placeholder="Es. Retegui"></label>
      <label class="field"><span class="lbl">Squadra reale</span><input type="text" id="man_squadra" placeholder="Es. Atalanta"></label>
      <label class="field"><span class="lbl">Qt.A (quotazione attuale)</span><input type="number" id="man_qta" min="1" value="10"></label>
      <label class="field"><span class="lbl">FVM (opz.)</span><input type="number" id="man_fvm" min="1" placeholder="es. 22"></label>
      <label class="field"><span class="lbl">Mio Prezzo (personale, opz.)</span><input type="number" id="man_mio" min="1" placeholder="es. 25"></label>
      <label class="field"><span class="lbl">Fascia</span>
        <select id="man_fascia">${TIERS.map(t=>`<option value="${t}">${t}</option>`).join('')}</select>
      </label>
    </div>
    <div class="btn-row"><button class="btn btn-primary btn-sm" id="addManualBtn">Aggiungi al listone</button></div>
  `;
  const wrap = document.createElement('div');
  wrap.appendChild(panel);
  wrap.appendChild(manual);

  manual.querySelector('#addManualBtn').onclick = ()=>{
    if (isAuctionStarted()) {
        showToast("L'asta è iniziata, non puoi aggiungere nuovi giocatori manuali.", "error");
        return;
    }
    const nome = manual.querySelector('#man_nome').value.trim();
    if(!nome){ showToast('Inserisci il nome del giocatore.', 'error'); return; }
    const qta = parseFloat(manual.querySelector('#man_qta').value)||1;
    const fvmVal = manual.querySelector('#man_fvm').value;
    const mioVal = manual.querySelector('#man_mio').value;
    state.players.push({
      id: uid('pl'),
      ruolo: manual.querySelector('#man_ruolo').value,
      nome, squadra: manual.querySelector('#man_squadra').value.trim(),
      qtA: qta,
      fvm: fvmVal ? parseFloat(fvmVal) : null,
      mio_prezzo: mioVal ? (parseFloat(mioVal)||null) : null,
      fascia: manual.querySelector('#man_fascia').value,
      assignedTeam: null, price: null
    });
    state.listoneImported = true;
    saveState();
    render();
    showToast(`Giocatore ${nome} aggiunto con successo.`, 'success');
  };
  return wrap;
}

function renderMapping(panel){
  const area = panel.querySelector('#mappingArea');
  const rows = csvStaging.rows;
  const sample = rows[0];
  const nCols = sample.length;
  const fieldOptions = ['(ignora)','Ruolo','Nome','Squadra','Quotazione','FVM','Mio Prezzo','Fascia'];

  function guessField(colIdx){
    const header = (rows[0][colIdx]||'').toLowerCase().trim();
    if(header==='r' || header==='ruolo') return 'Ruolo';
    if(header==='nome') return 'Nome';
    if(header==='squadra' || header==='team') return 'Squadra';
    if(header==='qt.a' || header==='quotazione' || header==='prezzo' || header==='qta') return 'Quotazione';
    if(header==='fvm') return 'FVM';
    if(header==='mio prezzo' || header.includes('mio')) return 'Mio Prezzo';
    if(header==='fascia' || header==='tier') return 'Fascia';
    return '(ignora)';
  }

  let html = `<h3 style="margin-top:18px;">Associa le colonne</h3>
    <label class="field" style="max-width:260px;"><span class="lbl">La prima riga è un'intestazione?</span>
      <select id="hasHeaderSel"><option value="yes">Sì</option><option value="no">No</option></select>
    </label>
    <div class="col-map" style="display:flex; gap:10px; overflow-x:auto; padding-bottom:10px;">`;
  for(let i=0;i<nCols;i++){
    html += `<div class="cm-item" style="min-width:140px; background:var(--bg-alt); padding:10px; border:1px solid var(--line); border-radius:3px;">
      <div class="cm-head" style="font-size:11px; color:var(--chalk-dim); margin-bottom:6px;">Colonna ${i+1}</div>
      <select class="colField" data-col="${i}" style="width:100%; margin-bottom:6px;">
        ${fieldOptions.map(f=>`<option value="${f}" ${f===guessField(i)?'selected':''}>${f}</option>`).join('')}
      </select>
      <div class="cm-sample" style="font-size:12px; color:var(--gold); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">es: ${esc((rows[1]||rows[0])[i] ?? '')}</div>
    </div>`;
  }
  html += `</div><div class="btn-row"><button class="btn btn-primary btn-sm" id="confirmImportBtn">Importa nel listone</button></div>`;
  area.innerHTML = html;

  area.querySelector('#confirmImportBtn').onclick = ()=>{
    if (isAuctionStarted()) {
        showToast("L'asta è già iniziata. Import bloccato per prevenire alterazioni.", "error");
        return;
    }
    const hasHeader = area.querySelector('#hasHeaderSel').value === 'yes';
    const mapping = {};
    area.querySelectorAll('.colField').forEach(sel=>{
      const col = parseInt(sel.dataset.col);
      if(sel.value !== '(ignora)') mapping[sel.value] = col;
    });
    if(mapping['Nome']===undefined || mapping['Ruolo']===undefined || mapping['Quotazione']===undefined){
      showToast('Devi associare almeno Ruolo, Nome e Quotazione.', 'error');
      return;
    }
    
    const dataRows = hasHeader ? rows.slice(1) : rows;
    let addedCount = 0;
    let updatedCount = 0;

    dataRows.forEach(r=>{
      const ruoloRaw = (r[mapping['Ruolo']]||'').toUpperCase().trim();
      const ruolo = ROLES.includes(ruoloRaw) ? ruoloRaw : ruoloRaw[0];
      if(!ROLES.includes(ruolo)) return;
      const nome = (r[mapping['Nome']]||'').trim();
      if(!nome) return;
      
      const qtA = parseFloat((r[mapping['Quotazione']]||'0').replace(',','.')) || 1;
      const squadra = mapping['Squadra']!==undefined ? (r[mapping['Squadra']]||'').trim() : '';
      const fasciaRaw = mapping['Fascia']!==undefined ? (r[mapping['Fascia']]||'').trim() : '';
      const fvmRaw = mapping['FVM']!==undefined ? (r[mapping['FVM']]||'').replace(',','.') : '';
      const mioRaw = mapping['Mio Prezzo']!==undefined ? (r[mapping['Mio Prezzo']]||'').replace(',','.') : '';
      
      const fvmParsed = fvmRaw !== '' && !isNaN(parseFloat(fvmRaw)) ? parseFloat(fvmRaw) : null;
      const mioParsed = mioRaw !== '' && !isNaN(parseFloat(mioRaw)) ? parseFloat(mioRaw) : null;
      const fasciaParsed = TIERS.includes(fasciaRaw) ? fasciaRaw : null;

      let existing = state.players.find(p => 
          p.ruolo === ruolo &&
          p.nome.toLowerCase() === nome.toLowerCase() && 
          (!squadra || !p.squadra || p.squadra.toLowerCase() === squadra.toLowerCase())
      );

      if (existing) {
          if(!existing.assignedTeam) {
              existing.qtA = qtA;
              if (fvmParsed !== null) existing.fvm = fvmParsed;
              if (mioParsed !== null) existing.mio_prezzo = mioParsed;
              if (fasciaParsed !== null) existing.fascia = fasciaParsed;
              updatedCount++;
          }
      } else {
          state.players.push({
            id: uid('pl'), ruolo, nome, squadra, qtA,
            fvm: fvmParsed,
            mio_prezzo: mioParsed,
            fascia: fasciaParsed,
            assignedTeam: null, price: null
          });
          addedCount++;
      }
    });

    if(addedCount === 0 && updatedCount === 0){ 
        showToast('Nessuna riga valida trovata o aggiornata.', 'error'); 
        return; 
    }
    
    autoAssignTiers();
    state.listoneImported = true;
    saveState();
    render();
    showToast(`Import completato: ${addedCount} nuovi giocatori, ${updatedCount} aggiornati.`, 'success');
  };
}

function autoAssignTiers(){
  const rankMetric = p => (p.mio_prezzo != null ? p.mio_prezzo : (p.fvm != null ? parseFloat(p.fvm) : p.qtA));
  ROLES.forEach(role=>{
    const validPlayers = state.players.filter(p=>p.ruolo===role && !p.fascia && rankMetric(p) > 0);
    validPlayers.sort((a,b)=>rankMetric(b)-rankMetric(a));
    const n = validPlayers.length;
    
    validPlayers.forEach((p,i)=>{
      const pct = n>0 ? i/n : 1;
      if(pct <= 0.05) p.fascia = 'Top';               
      else if(pct <= 0.15) p.fascia = 'Semi-Top';     
      else if(pct <= 0.30) p.fascia = 'Buono';        
      else if(pct <= 0.50) p.fascia = 'Terza Fascia';    
      else if(pct <= 0.75) p.fascia = 'Scommessa';    
      else p.fascia = 'Riserva';                     
    });
    
    state.players.filter(p=>p.ruolo===role && !p.fascia).forEach(p=>{ p.fascia = 'Riserva'; });
  });
}

function sortArrow(key){
  const f = state.listoneFilter;
  if(f.sortKey !== key) return '';
  return f.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function buildListoneTable(){
  const wrap = document.createElement('div');
  wrap.className = 'panel';

  const f = state.listoneFilter;
  wrap.innerHTML = `
    <h3>Giocatori (${state.players.length} totali · ${freePlayers('ALL').length} liberi)</h3>
    <p class="hint">Clicca su Qt.A, FVM o Mio Prezzo per modificare il valore in tabella. Se compili "Mio Prezzo", questo sovrascrive automaticamente Qt.A e FVM nell'algoritmo.</p>
    <div class="tabs" id="roleTabs">
      ${['ALL',...ROLES].map(r=>`<button data-r="${r}" class="${f.role===r?'active':''}">${r==='ALL'?'Tutti':ROLE_LABEL[r]}</button>`).join('')}
    </div>
    <div class="searchbar">
      <input type="text" id="qSearch" placeholder="Cerca nome o squadra…" value="${esc(f.q)}">
      <select id="statusSel">
        <option value="ALL" ${f.status==='ALL'?'selected':''}>Tutti gli stati</option>
        <option value="FREE" ${f.status==='FREE'?'selected':''}>Solo liberi</option>
        <option value="TAKEN" ${f.status==='TAKEN'?'selected':''}>Solo assegnati</option>
      </select>
    </div>
    <div style="max-height:520px;overflow:auto;">
    <table>
      <thead><tr>
        <th>Ruolo</th>
        <th class="sortable" data-sort="nome" style="cursor:pointer;">Nome${sortArrow('nome')}</th>
        <th>Squadra</th>
        <th class="num sortable" data-sort="qtA" style="cursor:pointer;">Qt.A${sortArrow('qtA')}</th>
        <th class="num sortable" data-sort="fvm" style="cursor:pointer;">FVM${sortArrow('fvm')}</th>
        <th class="num sortable" data-sort="mio_prezzo" style="cursor:pointer;">Mio Prezzo${sortArrow('mio_prezzo')}</th>
        <th>Fascia</th><th>Stato</th><th></th>
      </tr></thead>
      <tbody id="listoneBody"></tbody>
    </table>
    </div>
  `;

  wrap.querySelectorAll('#roleTabs button').forEach(btn=>{
    btn.onclick = ()=>{ state.listoneFilter.role = btn.dataset.r; saveState(); render(); };
  });
  wrap.querySelector('#qSearch').oninput = (e)=>{ state.listoneFilter.q = e.target.value; saveState(); renderListoneBody(wrap); };
  wrap.querySelector('#statusSel').onchange = (e)=>{ state.listoneFilter.status = e.target.value; saveState(); renderListoneBody(wrap); };
  wrap.querySelectorAll('th.sortable').forEach(th=>{
    th.onclick = ()=>{
      const key = th.dataset.sort;
      if(state.listoneFilter.sortKey === key){
        state.listoneFilter.sortDir = state.listoneFilter.sortDir==='asc' ? 'desc' : 'asc';
      } else {
        state.listoneFilter.sortKey = key;
        state.listoneFilter.sortDir = key==='nome' ? 'asc' : 'desc';
      }
      saveState();
      render();
    };
  });

  setTimeout(()=>renderListoneBody(wrap), 0);
  return wrap;
}

function renderListoneBody(wrap){
  const f = state.listoneFilter;
  const sortKey = f.sortKey || 'qtA';
  const sortDir = f.sortDir || 'desc';
  let list = state.players.filter(p=>{
    if(f.role!=='ALL' && p.ruolo!==f.role) return false;
    if(f.status==='FREE' && p.assignedTeam) return false;
    if(f.status==='TAKEN' && !p.assignedTeam) return false;
    if(f.q){
      const q = f.q.toLowerCase();
      if(!p.nome.toLowerCase().includes(q) && !(p.squadra||'').toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a,b)=>{
    let va, vb;
    if(sortKey==='nome'){ va=a.nome.toLowerCase(); vb=b.nome.toLowerCase(); }
    else if(sortKey==='fvm'){ va = fvmScaled(a) == null ? -Infinity : fvmScaled(a); vb = fvmScaled(b) == null ? -Infinity : fvmScaled(b); }
    else { va = a[sortKey]==null ? -Infinity : a[sortKey]; vb = b[sortKey]==null ? -Infinity : b[sortKey]; }
    if(va<vb) return sortDir==='asc' ? -1 : 1;
    if(va>vb) return sortDir==='asc' ? 1 : -1;
    return 0;
  });

  const body = wrap.querySelector('#listoneBody');
  body.innerHTML = list.slice(0,300).map(p=>{
    const team = p.assignedTeam ? getTeam(p.assignedTeam) : null;
    return `<tr>
      <td><span class="role-tag role-${p.ruolo}">${p.ruolo}</span></td>
      <td>${esc(p.nome)}</td>
      <td style="color:var(--chalk-dim)">${esc(p.squadra||'—')}</td>
      <td class="num"><input type="number" class="editable-num" data-pid="${p.id}" data-field="qtA" value="${p.qtA}"></td>
      <td class="num"><input type="number" class="editable-num" data-pid="${p.id}" data-field="fvm" value="${p.fvm!=null? Math.round(parseFloat(p.fvm)) :''}" placeholder="—"></td>
      <td class="num"><input type="number" class="editable-num" data-pid="${p.id}" data-field="mio_prezzo" value="${p.mio_prezzo!=null? p.mio_prezzo :''}" placeholder="—"></td>
      <td>
        <select class="tier-select" data-pid="${p.id}">
          ${TIERS.map(t=>`<option value="${t}" ${p.fascia===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </td>
      <td>${team ? `<span class="pill taken">${esc(team.name)} · ${fmt(p.price)}cr</span>` : `<span class="pill free">Libero</span>`}</td>
      <td>${!p.assignedTeam ? `<button class="btn btn-outline btn-sm" data-call="${p.id}">Chiama</button>` : `<button class="btn btn-danger btn-sm" data-undo="${p.id}">Annulla</button>`}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="color:var(--chalk-dim);text-align:center;padding:24px;">Nessun giocatore trovato con questi filtri.</td></tr>`;

  body.querySelectorAll('.editable-num').forEach(inp=>{
    inp.onchange = ()=>{
      const p = state.players.find(pl=>pl.id===inp.dataset.pid);
      const val = inp.value==='' ? null : parseFloat(inp.value);
      p[inp.dataset.field] = (val==null || isNaN(val)) ? null : val;
      saveState();
    };
  });
  body.querySelectorAll('.tier-select').forEach(sel=>{
    sel.onchange = ()=>{
      const p = state.players.find(pl=>pl.id===sel.dataset.pid);
      p.fascia = sel.value; saveState();
    };
  });
  body.querySelectorAll('[data-call]').forEach(btn=>{
    btn.onclick = ()=>{ 
      const p = state.players.find(pl=>pl.id===btn.dataset.call);
      setState({ activeCallPlayerId: btn.dataset.call, view:'asta', auctionPhase: p.ruolo }); 
    };
  });
  body.querySelectorAll('[data-undo]').forEach(btn=>{
    btn.onclick = ()=> undoAssignment(btn.dataset.undo);
  });
}

/* =========================================================
   VIEW: ASTA LIVE (SEQUENZIALE)
========================================================= */
function renderAsta(c){
  c.innerHTML = `
    <h1 class="view-title">Asta Live Sequenziale</h1>
    <p class="view-sub">Seleziona il ruolo attualmente in asta. Le ricerche e i consigli saranno limitati ai giocatori di questo ruolo per non inquinare il calcolo dei budget.</p>
  `;

  const phasePanel = document.createElement('div');
  phasePanel.className = 'phase-selector';
  phasePanel.innerHTML = ROLES.map(r => `
    <div class="phase-btn ${state.auctionPhase === r ? 'active' : ''}" data-phase="${r}">
      Fase ${ROLE_LABEL[r]}
    </div>
  `).join('');
  c.appendChild(phasePanel);

  phasePanel.querySelectorAll('.phase-btn').forEach(btn => {
    btn.onclick = () => {
      state.auctionPhase = btn.dataset.phase;
      if(state.activeCallPlayerId){
        const p = state.players.find(pl=>pl.id===state.activeCallPlayerId);
        if(p && p.ruolo !== state.auctionPhase) state.activeCallPlayerId = null;
      }
      saveState();
      render();
    };
  });

  const myTeam = getTeam(state.myTeamId);
  if(myTeam){
    const statusBar = document.createElement('div');
    statusBar.className = 'panel';
    const pct = clamp(myTeam.spent/state.budget,0,1.3)*100;
    const barClass = pct>95?'danger':(pct>75?'warn':'');
    
    const roleSpent = myTeam.roster[state.auctionPhase].reduce((sum, id) => sum + (state.players.find(p=>p.id===id)?.price||0), 0);
    const roleMax = state.budget * MAX_ROLE_ALLOCATION[state.auctionPhase];
    const rolePct = clamp(roleSpent/roleMax, 0, 1.2)*100;
    
    statusBar.innerHTML = `
      <h3>La tua situazione — ${esc(myTeam.name)}</h3>
      <div class="grid2">
        <div>
          <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--chalk-dim);">
            <span>Budget speso (Totale)</span><span><b style="color:var(--chalk); font-family:'Oswald',sans-serif;">${fmt(myTeam.spent)}</b> / ${fmt(state.budget)}</span>
          </div>
          <div class="budget-bar"><div class="fill ${barClass}" style="width:${Math.min(pct,100)}%"></div></div>
        </div>
        <div>
          <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--chalk-dim);">
            <span>Budget per i ${ROLE_LABEL[state.auctionPhase]} (Consigliato)</span><span><b style="color:var(--chalk); font-family:'Oswald',sans-serif;">${fmt(roleSpent)}</b> / MAX ${fmt(roleMax)}</span>
          </div>
          <div class="budget-bar"><div class="fill ${rolePct>100?'danger':(rolePct>80?'warn':'')}" style="width:${Math.min(rolePct,100)}%"></div></div>
        </div>
      </div>
    `;
    c.appendChild(statusBar);
  }

  const adv = document.createElement('details');
  adv.className = 'panel';
  adv.id = 'advSettingsPanel';
  const W = state.weights;
  adv.innerHTML = `
    <summary style="cursor:pointer; font-family:'Oswald',sans-serif; font-size:15px; color:var(--gold);">⚙ Impostazioni avanzate — regola i pesi dell'algoritmo</summary>
    <div class="grid2" style="margin-top:14px;">
      ${weightSlider('scarcity','Scarsità di QUALITÀ (per ruolo)', W.scarcity)}
      ${weightSlider('market','Trend di Mercato Reale (Andamento asta)', W.market)}
      ${weightSlider('fasciaScarcity','Scarsità della fascia specifica', W.fasciaScarcity)}
    </div>
  `;
  c.appendChild(adv);
  adv.querySelectorAll('.weightRange').forEach(inp=>{
    inp.oninput = (e)=>{
      state.weights[e.target.dataset.w] = parseFloat(e.target.value);
      adv.querySelector('#wval_'+e.target.dataset.w).textContent = parseFloat(e.target.value).toFixed(1);
      saveState();
      renderCallCard();
      renderOpportunities();
    };
  });
  function weightSlider(key,label,val){
    return `<label class="field">
      <span class="lbl">${label} — <span id="wval_${key}">${val.toFixed(1)}</span>×</span>
      <input type="range" class="weightRange" data-w="${key}" min="0" max="2" step="0.1" value="${val}">
    </label>`;
  }

  const searchPanel = document.createElement('div');
  searchPanel.className = 'panel';
  searchPanel.innerHTML = `
    <h3>① Cerca ${ROLE_LABEL[state.auctionPhase]} da chiamare</h3>
    <div class="searchbar">
      <input type="text" id="quickSearch" placeholder="Digita il cognome..." style="min-width:260px;" autocomplete="off">
      <select id="callPlayerSel" style="min-width:260px;"></select>
    </div>
    <div id="quickSearchResults" style="margin-top:8px; display:flex; flex-direction:column; gap:4px;"></div>
  `;
  c.appendChild(searchPanel);

  searchPanel.querySelector('#quickSearch').oninput = (e)=>{
    const q = e.target.value.trim().toLowerCase();
    const box = searchPanel.querySelector('#quickSearchResults');
    if(q.length<2){ box.innerHTML=''; return; }
    
    const matches = freePlayers(state.auctionPhase).filter(p=>p.nome.toLowerCase().includes(q)).slice(0,8);
    box.innerHTML = matches.map(p=>`
      <button class="btn btn-outline btn-sm" data-pick="${p.id}" style="text-align:left; justify-content:flex-start; display:flex; gap:8px; align-items:center;">
        <span class="role-tag role-${p.ruolo}" style="width:16px;height:16px;font-size:9px;">${p.ruolo}</span> ${esc(p.nome)} <span style="color:var(--chalk-dim);">${esc(p.squadra||'')} · Qt.A ${fmt(p.qtA)}</span>
      </button>
    `).join('') || `<span style="color:var(--chalk-dim); font-size:12.5px;">Nessun ${ROLE_LABEL[state.auctionPhase].toLowerCase()} libero corrisponde.</span>`;
    
    box.querySelectorAll('[data-pick]').forEach(btn=>{
      btn.onclick = ()=>{
        state.activeCallPlayerId = btn.dataset.pick;
        saveState();
        box.innerHTML = '';
        refreshPlayerOptions();
      };
    });
  };

  const callCard = document.createElement('div');
  callCard.id = 'callCard';
  c.appendChild(callCard);

  const oppPanel = document.createElement('div');
  oppPanel.className = 'panel';
  oppPanel.id = 'opportunitiesPanel';
  c.appendChild(oppPanel);
  renderOpportunities();

  function renderOpportunities(){
    const team = getTeam(state.myTeamId);
    let html = `<h3>Prossimi obiettivi consigliati (${ROLE_LABEL[state.auctionPhase]})</h3>
      <p class="hint">I migliori giocatori ancora liberi, ordinati per priorità (Mio Prezzo > FVM > Qt.A).</p>`;
    
    const role = state.auctionPhase;
    const roleAssigned = assignedInRole(role);
    const roleAvg = avgPaidRatio(roleAssigned);
    let badge = '';
    if(roleAssigned.length>=2 && roleAvg!=null && Math.abs(roleAvg-1)>=0.08){
      const pct = Math.round(roleAvg*100);
      const cls = roleAvg<1 ? 'cheap' : 'expensive';
      const txt = roleAvg<1 ? `mercato fiacco: pagati al ${pct}%` : `mercato acceso: pagati al ${pct}%`;
      badge = `<span class="market-badge ${cls}">${txt} (${roleAssigned.length} presi)</span>`;
    }

    if(team && team.roster[role].length >= state.slots[role]){
      html += `<div class="roster-role-block"><h4><span class="role-tag role-${role}" style="width:18px;height:18px;font-size:11px;">${role}</span> Hai completato il ruolo dei ${ROLE_LABEL[role]}!</h4></div>`;
    } else {
      const rankMetric = p => (p.mio_prezzo != null ? p.mio_prezzo : (p.fvm != null ? parseFloat(p.fvm) : p.qtA));
      const top = freePlayers(role).sort((a,b)=>rankMetric(b)-rankMetric(a)).slice(0,6);
      html += `<div class="roster-role-block"><h4><span class="role-tag role-${role}" style="width:18px;height:18px;font-size:11px;">${role}</span> Top ${ROLE_LABEL[role]} Liberi ${badge}</h4>`;
      if(top.length===0){ html += `<div style="color:var(--chalk-dim); font-size:12.5px;">Nessun giocatore libero in questo ruolo.</div>`; }
      else{
        html += '<table><tbody>';
        top.forEach(p=>{
          const s = suggestPrice(p.id, team ? team.id : null);
          html += `<tr>
            <td>${esc(p.nome)}</td>
            <td style="color:var(--chalk-dim)">${esc(p.squadra||'')}</td>
            <td style="color:var(--chalk-dim); font-size:11px;">${esc(p.fascia||'—')}</td>
            <td class="num" style="color:var(--chalk-dim)">Qt.A ${fmt(p.qtA)}</td>
            <td class="num" style="color:var(--gold)">consiglio ${fmt(s.suggested)}cr</td>
            <td><button class="btn btn-outline btn-sm" data-target="${p.id}">Chiama</button></td>
          </tr>`;
        });
        html += '</tbody></table>';
      }
      html += '</div>';
    }
    
    oppPanel.innerHTML = html;
    oppPanel.querySelectorAll('[data-target]').forEach(btn=>{
      btn.onclick = ()=>{
        state.activeCallPlayerId = btn.dataset.target;
        saveState();
        refreshPlayerOptions();
        window.scrollTo({top: callCard.offsetTop-20, behavior:'smooth'});
      };
    });
  }

  function refreshPlayerOptions(){
    const role = state.auctionPhase;
    const list = freePlayers(role).sort((a,b)=>b.qtA-a.qtA);
    const sel = document.getElementById('callPlayerSel');
    sel.innerHTML = list.map(p=>`<option value="${p.id}">${esc(p.nome)} (${esc(p.squadra||'')}) · Qt.A ${fmt(p.qtA)}</option>`).join('') || `<option value="">Nessun ${ROLE_LABEL[role].toLowerCase()} libero</option>`;
    
    if(state.activeCallPlayerId && list.some(p=>p.id===state.activeCallPlayerId)){
      sel.value = state.activeCallPlayerId;
    } else if(list[0]){
      state.activeCallPlayerId = list[0].id;
    }
    renderCallCard();
  }

  document.getElementById('callPlayerSel').onchange = (e)=>{ state.activeCallPlayerId = e.target.value; saveState(); renderCallCard(); };

  refreshPlayerOptions();
}

function renderCallCard(){
  const card = document.getElementById('callCard');
  if(!card) return;
  const player = state.players.find(p=>p.id===state.activeCallPlayerId);
  
  if(!player || player.assignedTeam || player.ruolo !== state.auctionPhase){
    card.innerHTML = `<div class="call-card"><div class="call-empty">Seleziona un giocatore libero per vedere il prezzo consigliato.</div></div>`;
    return;
  }

  const myTeam = getTeam(state.myTeamId);
  const teamForCalc = myTeam || state.teams[0];
  const sug = suggestPrice(player.id, teamForCalc ? teamForCalc.id : null);

  card.innerHTML = `
    <div class="call-card">
      <div class="call-head">
        <span class="role-tag role-${player.ruolo}" style="width:30px;height:30px;font-size:14px;">${player.ruolo}</span>
        <div>
          <div class="name">${esc(player.nome)}</div>
          <div class="team">${esc(player.squadra||'')} · Fascia ${esc(player.fascia||'—')} · Qt.A ${fmt(player.qtA)}${player.fvm!=null?' · FVM '+fmt(player.fvm):''}${player.mio_prezzo!=null?' · Mio Prezzo '+fmt(player.mio_prezzo):''}</div>
        </div>
      </div>

      <div class="price-row" style="margin-bottom:24px;">
        <div class="price-box"><div class="lbl">Prezzo Minimo</div><div class="v">${fmt(sug.min)}</div></div>
        <div class="price-box main"><div class="lbl">Consigliato</div><div class="v">${fmt(sug.suggested)}</div></div>
        <div class="price-box stop"><div class="lbl">Prezzo Stop (Max)</div><div class="v">${fmt(sug.stopPrice)}</div></div>
      </div>

      <div style="background:var(--bg-alt); padding:10px 14px; border:1px solid var(--line); border-radius:var(--radius); display:flex; gap:20px; font-size:13px; color:var(--chalk-dim); margin-bottom:20px;">
        <div><span>Rivali Attivi:</span> <b style="color:var(--chalk); font-family:'Oswald'; font-size:16px;">${sug.rivals.count}</b></div>
        <div><span>Budget Medio Rivali:</span> <b style="color:var(--chalk); font-family:'Oswald'; font-size:16px;">${fmt(sug.rivals.avgBudget)}</b><span style="font-size:11px;">cr</span></div>
        ${sug.myRemaining!==null ? `<div><span>Tuo Budget Residuo:</span> <b style="color:var(--chalk); font-family:'Oswald'; font-size:16px;">${fmt(sug.myRemaining)}</b><span style="font-size:11px;">cr</span></div>` : ''}
      </div>

      <div class="factor-list">
        <div class="factor" style="margin-bottom:8px; border-bottom:1px solid var(--line); padding-bottom:10px;">
          <div class="flbl" style="color:var(--chalk)">Base dell'algoritmo</div>
          <div class="fbar" style="background:transparent;"></div>
          <div class="fval" style="color:var(--gold)">${fmt(sug.base)} cr <span style="font-size:10.5px; font-weight:normal; color:var(--chalk-dim)">(${sug.baseSource})</span></div>
        </div>
        ${factorRow('Scarsità di QUALITÀ ('+player.ruolo+')', sug.factors.scarcity)}
        ${sug.factors.saturation < 1 ? factorRow('Saturazione (avversari senza soldi/slot)', sug.factors.saturation) : ''}
        ${factorRow('Andamento prezzi reali (ruolo+fascia)', sug.factors.market, `<span class="confidence-badge conf-${sug.marketMeta.confidence.cls}">Affidabilità ${sug.marketMeta.confidence.label}</span>`)}
        ${sug.marketMeta.nFascia>0 ? `<div class="factor-note">Basato su ${sug.marketMeta.nFascia} acquisti nella fascia "${esc(player.fascia||'—')}" (+ ${sug.marketMeta.nRole} nel ruolo come contesto).</div>` : (sug.marketMeta.nRole>0 ? `<div class="factor-note">Ancora nessun acquisto nella fascia "${esc(player.fascia||'—')}": mi baso sui ${sug.marketMeta.nRole} acquisti già fatti per i ${ROLE_LABEL[player.ruolo]}.</div>` : `<div class="factor-note">Nessun acquisto ancora per i ${ROLE_LABEL[player.ruolo]}: fattore neutro.</div>`)}
        ${factorRow('Scarsità della fascia specifica', sug.factors.fasciaScarcity)}
        ${sug.factors.reactive !== 1 ? factorRow('Modello Reattivo (Budget vs Strategia)', sug.factors.reactive) : ''}
      </div>

      ${sug.warnings.map(w=>`<div class="warning">${esc(w)}</div>`).join('')}

      <div class="assign-form">
        <h3 style="margin-bottom:10px;">Assegna giocatore</h3>
        <div class="row">
          <label class="field"><span class="lbl">Squadra aggiudicataria</span>
            <select id="assignTeamSel">
              ${state.teams.map(t=>`<option value="${t.id}" ${myTeam && t.id===myTeam.id?'selected':''}>${esc(t.name)} — res. ${fmt(state.budget-t.spent)}cr</option>`).join('')}
            </select>
          </label>
          <label class="field"><span class="lbl">Prezzo pagato</span>
            <input type="number" id="assignPrice" min="1" value="${sug.suggested}">
          </label>
          <button class="btn btn-primary" id="confirmAssignBtn">Conferma assegnazione</button>
          <button class="btn btn-outline" id="skipPlayerBtn">Salta (non assegnare ora)</button>
        </div>
      </div>
    </div>
  `;

  card.querySelector('#assignTeamSel').onchange = ()=> refreshSuggestionForTeam();
  function refreshSuggestionForTeam(){
    const tid = card.querySelector('#assignTeamSel').value;
    const s2 = suggestPrice(player.id, tid);
    card.querySelector('#assignPrice').value = s2.suggested;
  }

  card.querySelector('#confirmAssignBtn').onclick = ()=>{
    const teamId = card.querySelector('#assignTeamSel').value;
    const price = parseInt(card.querySelector('#assignPrice').value)||1;
    const team = getTeam(teamId);
    if(!team) return;
    if(team.roster[player.ruolo].length >= state.slots[player.ruolo]){
      if(!confirm('Il ruolo per questa squadra è già completo. Assegnare comunque?')) return;
    }
    if(price > (state.budget-team.spent)){
      if(!confirm('Il prezzo supera il budget residuo della squadra. Confermi comunque?')) return;
    }
    player.assignedTeam = teamId;
    player.price = price;
    state.saleSeq = (state.saleSeq||0) + 1;
    player.saleSeq = state.saleSeq;
    team.spent += price;
    team.roster[player.ruolo].push(player.id);
    state.activeCallPlayerId = null;
    
    const quickSearchInput = document.getElementById('quickSearch');
    if (quickSearchInput) quickSearchInput.value = '';
    
    saveState();
    render();
    showToast(`Giocatore ${player.nome} assegnato a ${team.name} per ${price}cr.`, 'success');
  };

  card.querySelector('#skipPlayerBtn').onclick = ()=>{
    state.activeCallPlayerId = null;
    saveState();
    render();
  };
}

function factorRow(label, value, badgeHtml){
  const pct = clamp((value-0.6)/(1.6-0.6),0,1)*100;
  const barWidth = Math.abs(value-1)*50;
  const positive = value>=1;
  return `<div class="factor">
    <div class="flbl">${esc(label)}${badgeHtml ? ' '+badgeHtml : ''}</div>
    <div class="fbar"><div class="fill" style="width:${barWidth}%; ${positive?'left:50%;':'right:50%;left:auto;'}"></div></div>
    <div class="fval">${value.toFixed(2)}×</div>
  </div>`;
}

function undoAssignment(playerId){
  const player = state.players.find(p=>p.id===playerId);
  if(!player || !player.assignedTeam) return;
  if(!confirm('Annullare l\u2019assegnazione di ' + player.nome + '? Il prezzo pagato verrà restituito alla squadra.')) return;
  const team = getTeam(player.assignedTeam);
  if(team){
    team.spent -= (player.price||0);
    team.roster[player.ruolo] = team.roster[player.ruolo].filter(id=>id!==player.id);
  }
  player.assignedTeam = null;
  player.price = null;
  player.saleSeq = null;
  saveState();
  render();
  showToast(`Assegnazione di ${player.nome} annullata.`, 'info');
}

/* =========================================================
   VIEW: SQUADRE
========================================================= */
function renderSquadre(c){
  c.innerHTML = `
    <h1 class="view-title">Squadre</h1>
    <p class="view-sub">Budget residuo e rosa di ogni partecipante alla lega. Espandi una squadra per vedere i giocatori acquistati o correggere un'assegnazione.</p>
  `;
  state.teams.forEach(team=>{
    const spentPct = clamp(team.spent/state.budget,0,1.3)*100;
    const barClass = spentPct>95 ? 'danger' : (spentPct>75 ? 'warn' : '');
    const card = document.createElement('details');
    card.className = 'team-card';
    card.open = team.id===state.myTeamId;
    const roleCounts = ROLES.map(r=>`${r}: <b style="color:var(--chalk)">${team.roster[r].length}/${state.slots[r]}</b>`).join(' &nbsp; ');
    card.innerHTML = `
      <summary>
        <span class="tc-name">${esc(team.name)} ${team.id===state.myTeamId ? '<span class="pill free" style="margin-left:8px;">Tu</span>' : ''}</span>
        <span class="tc-stats">
          <span>Speso: <b>${fmt(team.spent)}</b> / ${fmt(state.budget)}</span>
          <span>${roleCounts}</span>
        </span>
      </summary>
      <div class="budget-bar"><div class="fill ${barClass}" style="width:${Math.min(spentPct,100)}%"></div></div>
      <div id="roster_${team.id}" style="margin-top:14px;"></div>
    `;
    c.appendChild(card);
    setTimeout(()=>{
      const rw = card.querySelector('#roster_'+team.id);
      let html = '';
      ROLES.forEach(r=>{
        const ids = team.roster[r];
        html += `<div class="roster-role-block"><h4><span class="role-tag role-${r}" style="width:18px;height:18px;font-size:11px;">${r}</span> ${ROLE_LABEL[r]} (${ids.length}/${state.slots[r]})</h4>`;
        if(ids.length===0){ html += `<div style="color:var(--chalk-dim);font-size:12.5px;">Nessun giocatore ancora.</div>`; }
        else{
          html += '<table><tbody>';
          ids.forEach(id=>{
            const p = state.players.find(pl=>pl.id===id);
            if(!p) return;
            html += `<tr><td>${esc(p.nome)}</td><td style="color:var(--chalk-dim)">${esc(p.squadra||'')}</td><td class="num">${fmt(p.price)}cr</td><td><button class="btn btn-danger btn-sm" data-undo2="${p.id}">Annulla</button></td></tr>`;
          });
          html += '</tbody></table>';
        }
        html += '</div>';
      });
      rw.innerHTML = html;
      rw.querySelectorAll('[data-undo2]').forEach(btn=>{
        btn.onclick = (e)=>{ e.preventDefault(); undoAssignment(btn.dataset.undo2); };
      });
    },0);
  });

  const note = document.createElement('footer');
  note.className = 'note';
  note.innerHTML = `Suggerimento: se correggi un'assegnazione sbagliata usa "Annulla" — il prezzo pagato torna disponibile nel budget della squadra e il giocatore ritorna libero nel listone.`;
  c.appendChild(note);
}

/* =========================================================
   INIT
========================================================= */
render();
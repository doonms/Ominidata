// js/simulador/state-admin.js
// Estado para a tela administrativa (Base de Fatores) + sincronização com o banco usado pelo simulador.

const ADMIN_STORAGE_KEY = 'base_fatores_v2';
const SIM_STORAGE_KEY   = 'sim_base_fatores_v2';

const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
const genId = (prefix='id') => hasCrypto ? crypto.randomUUID() : `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export const state = {
  bancos: [],
  editingId: null,
  activeBankIdx: 0,
  activeCategoria: 'inss'
};

export function todayStr(){
  return new Date().toISOString().slice(0,10);
}

export const $  = (sel, root=document)=> root.querySelector(sel);
export const esc = (value)=> String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[ch]));

function ensurePrazo(entry){
  return {
    prazo: Number(entry?.prazo ?? 0) || 0,
    fator: String(entry?.fator ?? ''),
    fatorCartao: String(entry?.fatorCartao ?? '')
  };
}

function ensurePack(entry){
  return {
    data: entry?.data || todayStr(),
    lista: Array.isArray(entry?.lista) ? entry.lista.map(ensurePrazo) : []
  };
}

function ensureConv(conv){
  return {
    id: conv?.id || genId('conv'),
    nome: String(conv?.nome ?? 'Convenio'),
    datas: Array.isArray(conv?.datas) ? conv.datas.map(ensurePack) : []
  };
}

export function ensureDataIntegrity(bank){
  if(!bank || typeof bank !== 'object') bank = {};

  bank.id = bank.id || genId('bank');
  bank.nome = String(bank.nome ?? '');
  bank.logo = String(bank.logo ?? '');
  bank.fazCartao = !!bank.fazCartao;

  const fatores = bank.fatores && typeof bank.fatores === 'object' ? bank.fatores : {};
  fatores.inss = Array.isArray(fatores.inss) ? fatores.inss.map(ensurePack) : [];
  fatores.siape = Array.isArray(fatores.siape) ? fatores.siape.map(ensurePack) : [];
  fatores.governo = Array.isArray(fatores.governo) ? fatores.governo.map(ensureConv) : [];
  fatores.prefeitura = Array.isArray(fatores.prefeitura) ? fatores.prefeitura.map(ensureConv) : [];
  bank.fatores = fatores;

  bank.seguros = Array.isArray(bank.seguros)
    ? bank.seguros.map(s => ({
        id: s?.id || genId('seg'),
        nome: String(s?.nome ?? ''),
        tipo: s?.tipo === 'percentual' ? 'percentual' : 'fixo',
        valor: Number(s?.valor ?? 0)
      }))
    : [];

  return bank;
}

export function loadDB(){
  try{
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if(Array.isArray(parsed) && parsed.length){
      state.bancos = parsed.map(ensureDataIntegrity);
    }else{
      state.bancos = [];
      migrateFromSimulator();
    }
  }catch{
    state.bancos = [];
    migrateFromSimulator();
  }

  syncSimulatorStorage();
  return state.bancos;
}

export function saveDB(){
  state.bancos = state.bancos.map(ensureDataIntegrity);
  try{
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(state.bancos));
  }catch(err){
    console.warn('Falha ao salvar base_fatores_v2', err);
  }
  syncSimulatorStorage();
}
export function newBank(){
  return ensureDataIntegrity({
    id: genId('bank'),
    nome: '',
    logo: '',
    fazCartao: false,
    fatores: { inss: [], siape: [], governo: [], prefeitura: [] },
    seguros: []
  });
}

export function addBank(bank){
  state.bancos.push(ensureDataIntegrity(bank));
  saveDB();
  return state.bancos.length - 1;
}

export function removeBank(idx){
  if(idx < 0 || idx >= state.bancos.length) return;
  state.bancos.splice(idx, 1);
  if(state.activeBankIdx >= state.bancos.length){
    state.activeBankIdx = Math.max(0, state.bancos.length - 1);
  }
  saveDB();
}

export function currentBank(){
  return state.bancos[state.activeBankIdx] || null;
}

export function setActiveBank(idx){
  if(idx >= 0 && idx < state.bancos.length){
    state.activeBankIdx = idx;
  }
}

export function setCategoria(cat){
  state.activeCategoria = cat;
}

export function updateCurrentBank(data){
  const bank = currentBank();
  if(!bank) return;
  Object.assign(bank, data);
  saveDB();
}

export function exportarBase(){
  try{
    const blob = new Blob([JSON.stringify(state.bancos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'base-fatores.json';
    a.click();
    URL.revokeObjectURL(url);
  }catch(err){
    alert('N?o foi poss?vel exportar o JSON.');
    console.warn(err);
  }
}

export function importarBase(arquivo, callback){
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const data = JSON.parse(e.target.result);
      if(Array.isArray(data)){
        state.bancos = data.map(ensureDataIntegrity);
        saveDB();
        if(typeof callback === 'function') callback();
      }else{
        alert('JSON inv?lido.');
      }
    }catch(err){
      alert('Erro ao importar arquivo JSON.');
      console.warn(err);
    }
  };
  reader.readAsText(arquivo);
}


/* ===================== Migração / Sincronização ===================== */
function migrateFromSimulator(){
  try{
    const raw = localStorage.getItem(SIM_STORAGE_KEY);
    if(!raw) return;
    const simBanks = JSON.parse(raw);
    if(!Array.isArray(simBanks)) return;
    state.bancos = simBanks.map(convertSimToAdminBank);
    saveDB();
  }catch(err){
    console.warn('Falha ao migrar sim_base_fatores_v2', err);
  }
}

function syncSimulatorStorage(){
  try{
    const data = state.bancos.map(convertAdminToSimBank);
    localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(data));
  }catch(err){
    console.warn('Falha ao sincronizar sim_base_fatores_v2', err);
  }
}

function normalizePrazoSim(entry){
  return {
    parcelas: Number(entry?.parcelas ?? entry?.prazo ?? 0) || 0,
    fator: String(entry?.fator ?? ''),
    ativo: entry?.ativo === undefined ? true : !!entry.ativo,
    fatorCartao: String(entry?.fatorCartao ?? ''),
    ativoCartao: entry?.ativoCartao === undefined ? true : !!entry.ativoCartao
  };
}

function convertAdminToSimBank(bank){
  const dates = new Set();
  const addDate = d => { if(d) dates.add(d); };

  bank.fatores.inss.forEach(entry => addDate(entry?.data));
  bank.fatores.siape.forEach(entry => addDate(entry?.data));
  bank.fatores.governo.forEach(conv => (conv?.datas || []).forEach(d => addDate(d?.data)));
  bank.fatores.prefeitura.forEach(conv => (conv?.datas || []).forEach(d => addDate(d?.data)));

  if(!dates.size) dates.add(todayStr());

  const baseSeguros = (bank.seguros || []).map(s => ({
    id: s.id || genId('seg'),
    nome: s.nome || '',
    tipo: s.tipo === 'percentual' ? 'percentual' : 'valor',
    valor: Number(s.valor ?? 0)
  }));

  const datas = {};
  dates.forEach(date => {
    const pack = {
      inss: { prazos: [], seguros: baseSeguros.map(seg => ({ ...seg })) },
      siape:{ prazos: [], seguros: baseSeguros.map(seg => ({ ...seg })) },
      governo: [],
      prefeitura: [],
      governoSeguros: [],
      prefeituraSeguros: [],
      fatoresCartao: [],
      segurosCartao: []
    };

    const inssEntry = bank.fatores.inss.find(item => item?.data === date);
    const siapeEntry= bank.fatores.siape.find(item => item?.data === date);
    if(inssEntry) pack.inss.prazos = (inssEntry.lista || []).map(p => normalizePrazoSim({ parcelas: p.prazo, ...p }));
    if(siapeEntry) pack.siape.prazos = (siapeEntry.lista || []).map(p => normalizePrazoSim({ parcelas: p.prazo, ...p }));

    const pushConv = (arr, target)=>{
      (arr || []).forEach(conv => {
        const convPack = (conv?.datas || []).find(d => d?.data === date);
        if(!convPack) return;
        target.push({
          id: conv.id || genId('conv'),
          nome: conv.nome || 'Convenio',
          prazos: (convPack.lista || []).map(p => normalizePrazoSim({ parcelas: p.prazo, ...p }))
        });
      });
    };
    pushConv(bank.fatores.governo, pack.governo);
    pushConv(bank.fatores.prefeitura, pack.prefeitura);

    datas[date] = pack;
  });

  return {
    id: bank.id || genId('bank'),
    nome: bank.nome || '',
    logo: bank.logo || '',
    fazCartao: !!bank.fazCartao,
    datas
  };
}

function convertSimToAdminBank(simBank){
  const adminBank = ensureDataIntegrity({
    id: simBank?.id || genId('bank'),
    nome: String(simBank?.nome ?? ''),
    logo: String(simBank?.logo ?? ''),
    fazCartao: !!simBank?.fazCartao,
    fatores: { inss: [], siape: [], governo: [], prefeitura: [] },
    seguros: []
  });

  const datas = simBank?.datas && typeof simBank.datas === 'object' ? simBank.datas : {};
  const dateKeys = Object.keys(datas);

  const segurosSet = new Map();
  const makeLista = prazos => (Array.isArray(prazos) ? prazos : []).map(p => ({
    prazo: Number(p?.parcelas ?? 0) || 0,
    fator: String(p?.fator ?? ''),
    fatorCartao: String(p?.fatorCartao ?? '')
  }));

  dateKeys.forEach(date => {
    const pack = datas[date] || {};
    adminBank.fatores.inss.push({ data: date, lista: makeLista(pack.inss?.prazos) });
    adminBank.fatores.siape.push({ data: date, lista: makeLista(pack.siape?.prazos) });

    const addConv = (arr, targetKey) => {
      (Array.isArray(arr) ? arr : []).forEach(conv => {
        const target = targetKey === 'governo' ? adminBank.fatores.governo : adminBank.fatores.prefeitura;
        let dest = target.find(c => c.id === conv.id);
        if(!dest){
          dest = { id: conv.id || genId('conv'), nome: conv.nome || 'Convenio', datas: [] };
          target.push(dest);
        }
        dest.datas.push({ data: date, lista: makeLista(conv.prazos) });
      });
    };
    addConv(pack.governo, 'governo');
    addConv(pack.prefeitura, 'prefeitura');

    const addSeguros = segList => {
      (Array.isArray(segList) ? segList : []).forEach(seg => {
        const key = seg.id || `${seg.nome}_${seg.valor}_${seg.tipo}`;
        if(!segurosSet.has(key)){
          segurosSet.set(key, {
            id: seg.id || genId('seg'),
            nome: seg.nome || '',
            tipo: seg.tipo === 'percentual' ? 'percentual' : 'fixo',
            valor: Number(seg.valor ?? 0)
          });
        }
      });
    };
    addSeguros(pack.inss?.seguros);
    addSeguros(pack.siape?.seguros);
  });

  adminBank.seguros = Array.from(segurosSet.values());
  return ensureDataIntegrity(adminBank);
}

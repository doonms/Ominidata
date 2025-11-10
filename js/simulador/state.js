// js/simulador/state.js
// Estado compartilhado pelo simulador (usa estrutura por data/packs).

const SIM_STORAGE_KEY = 'sim_base_fatores_v2';
const ADMIN_STORAGE_KEY = 'base_fatores_v2';

const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
function genId(prefix='id'){
  if(hasCrypto) return crypto.randomUUID();
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function todayStr(){
  return new Date().toISOString().slice(0,10);
}

function normalizeSeguro(entry){
  return {
    id: entry?.id || genId('seg'),
    nome: String(entry?.nome ?? ''),
    tipo: entry?.tipo === 'percentual' ? 'percentual' : 'valor',
    valor: Number(entry?.valor ?? 0)
  };
}

function normalizePrazo(entry){
  return {
    parcelas: Number(entry?.parcelas ?? entry?.prazo ?? 0) || 0,
    fator: String(entry?.fator ?? ''),
    ativo: entry?.ativo === undefined ? true : !!entry.ativo,
    fatorCartao: String(entry?.fatorCartao ?? ''),
    ativoCartao: entry?.ativoCartao === undefined ? true : !!entry.ativoCartao
  };
}

function normalizeConvenio(entry){
  return {
    id: entry?.id || genId('conv'),
    nome: String(entry?.nome ?? ''),
    prazos: Array.isArray(entry?.prazos) ? entry.prazos.map(normalizePrazo) : []
  };
}

function defaultPack(){
  return {
    inss: { prazos: [], seguros: [] },
    siape:{ prazos: [], seguros: [] },
    governo: [],
    prefeitura: [],
    governoSeguros: [],
    prefeituraSeguros: [],
    fatoresCartao: [],
    segurosCartao: []
  };
}

function normalizePack(pack){
  const base = defaultPack();
  if(!pack || typeof pack !== 'object') return base;
  base.inss = {
    prazos: Array.isArray(pack.inss?.prazos) ? pack.inss.prazos.map(normalizePrazo) : [],
    seguros: Array.isArray(pack.inss?.seguros) ? pack.inss.seguros.map(normalizeSeguro) : []
  };
  base.siape = {
    prazos: Array.isArray(pack.siape?.prazos) ? pack.siape.prazos.map(normalizePrazo) : [],
    seguros: Array.isArray(pack.siape?.seguros) ? pack.siape.seguros.map(normalizeSeguro) : []
  };
  base.governo = Array.isArray(pack.governo) ? pack.governo.map(normalizeConvenio) : [];
  base.prefeitura = Array.isArray(pack.prefeitura) ? pack.prefeitura.map(normalizeConvenio) : [];
  base.governoSeguros = Array.isArray(pack.governoSeguros) ? pack.governoSeguros.map(normalizeSeguro) : [];
  base.prefeituraSeguros = Array.isArray(pack.prefeituraSeguros) ? pack.prefeituraSeguros.map(normalizeSeguro) : [];
  base.fatoresCartao = Array.isArray(pack.fatoresCartao) ? pack.fatoresCartao.map(normalizePrazo) : [];
  base.segurosCartao = Array.isArray(pack.segurosCartao) ? pack.segurosCartao.map(normalizeSeguro) : [];
  return base;
}

function normalizeBank(bank){
  const datas = {};
  if (bank && typeof bank.datas === 'object') {
    for (const [date, pack] of Object.entries(bank.datas)) {
      datas[date] = normalizePack(pack);
    }
  }
  return {
    id: bank?.id || genId('bank'),
    nome: String(bank?.nome ?? ''),
    logo: String(bank?.logo ?? ''),
    fazCartao: !!bank?.fazCartao,
    datas
  };
}

function loadAdminAndConvert(){
  try{
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    if(!raw) return null;
    const adminBanks = JSON.parse(raw);
    if(!Array.isArray(adminBanks)) return null;
    const stateAdmin = adminBanks.map(b=>{
      const id = b?.id || genId('bank');
      const datas = {};
      const addFromList = (arr, tab)=>{
        (arr||[]).forEach(entry=>{
          const date = entry?.data || todayStr();
          datas[date] = datas[date] || defaultPack();
          const target = tab === 'inss' ? datas[date].inss : datas[date].siape;
          target.prazos = (entry?.lista||[]).map(item=>normalizePrazo({ parcelas:item?.prazo, ...item }));
        });
      };
      addFromList(b?.fatores?.inss, 'inss');
      addFromList(b?.fatores?.siape, 'siape');

      const convBuilder = (arr, key)=>{
        (arr||[]).forEach(conv=>{
          (conv?.datas||[]).forEach(d=>{
            const date = d?.data || todayStr();
            datas[date] = datas[date] || defaultPack();
            const list = key === 'governo' ? datas[date].governo : datas[date].prefeitura;
            list.push({
              id: conv?.id || genId('conv'),
              nome: conv?.nome || 'Convênio',
              prazos: (d?.lista||[]).map(item=>normalizePrazo({ parcelas:item?.prazo, ...item }))
            });
          });
        });
      };
      convBuilder(b?.fatores?.governo, 'governo');
      convBuilder(b?.fatores?.prefeitura, 'prefeitura');

      const seguros = Array.isArray(b?.seguros) ? b.seguros.map(s=>normalizeSeguro(s)) : [];

      return normalizeBank({
        id,
        nome: b?.nome,
        logo: b?.logo,
        fazCartao: b?.fazCartao,
        datas: Object.fromEntries(Object.entries(datas).map(([date, pack])=>{
          pack.inss.seguros = [...seguros];
          pack.siape.seguros = [...seguros];
          return [date, pack];
        }))
      });
    });
    localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(stateAdmin));
    return stateAdmin;
  }catch(err){
    console.warn('Falha ao converter base_fatores_v2 -> sim_base_fatores_v2', err);
    return null;
  }
}

export function loadDB(){
  let bancos = [];
  try{
    const raw = localStorage.getItem(SIM_STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed)) bancos = parsed;
    }else{
      const migrated = loadAdminAndConvert();
      if(Array.isArray(migrated)) bancos = migrated;
    }
  }catch(err){
    console.warn('Erro ao carregar sim_base_fatores_v2', err);
  }
  return bancos.map(normalizeBank);
}

export function saveDB(bancos){
  try{
    localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(bancos ?? []));
  }catch(err){
    console.warn('Falha ao salvar sim_base_fatores_v2', err);
  }
}

/* ====================== Packs Helpers ======================= */
export function ensureDatePack(bank, date = todayStr()){
  if(!bank) return null;
  bank.datas = bank.datas || {};
  if(!bank.datas[date]) bank.datas[date] = defaultPack();
  bank.datas[date] = normalizePack(bank.datas[date]);
  return bank.datas[date];
}

export function replaceDatePack(bank, date, pack){
  if(!bank) return;
  bank.datas = bank.datas || {};
  bank.datas[date] = normalizePack(pack);
}

export function cloneFromNearestDate(bank, date = todayStr()){
  if(!bank || !bank.datas) return defaultPack();
  const keys = Object.keys(bank.datas).sort();
  const previous = keys.filter(value => value <= date).pop();
  const toClone = previous ? bank.datas[previous] : bank.datas[keys.pop()];
  return normalizePack(JSON.parse(JSON.stringify(toClone || defaultPack())));
}

export function cloneDateInto(bank, date){
  if(!bank) return;
  convertIfNeeded(bank);
  bank.datas[date] = cloneFromNearestDate(bank, date);
}

export function setDate(bank, date){
  ensureDatePack(bank, date);
}

function convertIfNeeded(bank){
  bank.datas = bank.datas || {};
}

export function addConvenio(bank, date, tipo, nome){
  if(!bank) return;
  const pack = ensureDatePack(bank, date);
  const list = tipo === 'governo' ? (pack.governo ||= []) : (pack.prefeitura ||= []);
  const conv = {
    id: genId('conv'),
    nome: String(nome || 'Convênio'),
    prazos: []
  };
  list.push(conv);
  return conv.id;
}

export function renameConvenio(bank, date, tipo, id, nome){
  if(!bank) return;
  const pack = ensureDatePack(bank, date);
  const list = tipo === 'governo' ? pack.governo : pack.prefeitura;
  const conv = (list||[]).find(c=>c.id===id);
  if(conv) conv.nome = String(nome || '');
}

export function removeConvenio(bank, date, tipo, id){
  if(!bank) return;
  const pack = ensureDatePack(bank, date);
  const key = tipo === 'governo' ? 'governo' : 'prefeitura';
  pack[key] = (pack[key]||[]).filter(c=>c.id!==id);
}

export function upsertPrazo(list, parcelas, data){
  if(!Array.isArray(list)) return;
  const idx = list.findIndex(item=>Number(item?.parcelas)===Number(parcelas));
  const patch = normalizePrazo({ parcelas, ...data });
  if(idx>=0){
    list[idx] = { ...list[idx], ...patch };
  }else{
    list.push(patch);
  }
}

export function removePrazo(list, parcelas){
  if(!Array.isArray(list)) return;
  const idx = list.findIndex(item=>Number(item?.parcelas)===Number(parcelas));
  if(idx>=0) list.splice(idx,1);
}

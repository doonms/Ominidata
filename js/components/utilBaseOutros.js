import { BASE_OUTROS_KEY, BASE_OUTROS_FALLBACKS, BASE_OUTROS_MIRRORS, readFromStorage, writeToStorage } from '../config/storageKeys.js';

export const KEY = BASE_OUTROS_KEY;

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function parseRange(text) {
  if (!text) return null;
  const normalized = String(text)
    .trim()
    .replace(/–/g, '-')
    .replace(/\s+a\s+/i, '-')
    .replace(/\s+/g, '');

  if (normalized.includes('-')) {
    const [a, b] = normalized.split('-').map((n) => parseInt(n, 10));
    if (!Number.isNaN(a) && !Number.isNaN(b)) return { min: a, max: b };
    return null;
  }

  const single = parseInt(normalized, 10);
  if (!Number.isNaN(single)) return { min: single, max: single };
  return null;
}

export function lerStorage(key = KEY) {
  const fallbacks = key === KEY ? BASE_OUTROS_FALLBACKS : [];
  const data = readFromStorage(key, fallbacks);
  return Array.isArray(data) ? data : [];
}

export function salvarStorage(key, data) {
  const mirrors = key === KEY ? BASE_OUTROS_MIRRORS : [];
  writeToStorage(key, Array.isArray(data) ? data : [], mirrors);
}

const PRAZO_PADRAO = { idade: '', parcelas: '', obs: '' };
const CONVENIO_TYPES = ['prefeitura', 'governo', 'siape'];

const OPERACIONAL_DEFAULTS = {
  statusSuspenso: false,
  fazMargem: false,
  fazCartao: false,
  fazRefin: false,
  fazSaqueComplementar: false,
  fazPortabilidade: false,
  aceitaClienteNaoAssina: false,
  aceitaLoas: false,
  aceitaInvalidez: false,
  aceitaClientePensao: false,
  rogo: [],
  rogoOutros: '',
  documentos: [],
  outrosDocs: '',
  precisaVideo: true,
  precisaVideoObs: '',
  fazLigacaoCliente: true,
  fazLigacaoClienteObs: '',
  clienteLigaBanco: false,
  clienteLigaBancoObs: '',
  precisaGravarVideo: false,
  gravarVideoObs: '',
  precisaEnviarContratoBanco: false,
  contrato60: false,
  contrato60_estados: '',
  contrato60_enviarFisico: false,
  contrato60_enviarEmail: false,
  contrato60_precisaGravarVideo: false,
  contrato60_gravarVideoObs: '',
  naoAssina_precisaEnviarFisico: false,
  naoAssina_precisaVideo: true,
  naoAssina_precisaVideoObs: '',
  naoAssina_fazLigacao: true,
  naoAssina_fazLigacaoObs: '',
  naoAssina_clienteLigaBanco: false,
  naoAssina_clienteLigaBancoObs: '',
  naoAssina_precisaEnviarEmail: false,
  naoAssina_precisaGravarVideo: false,
  naoAssina_gravarVideoObs: '',
  minimoLiberado: '',
  tipoMinimo: 'valor liberado',
  parcela: '',
  prazosCartao: [PRAZO_PADRAO],
  observacoes: ''
};

function cloneOperacionalDefaults() {
  return JSON.parse(JSON.stringify(OPERACIONAL_DEFAULTS));
}

function nextConvenioId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `cv-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
}

function normalizePrazoList(list) {
  if (!Array.isArray(list) || !list.length) return [{ ...PRAZO_PADRAO }];
  return list.map((item) => ({
    idade: item?.idade || '',
    parcelas: item?.parcelas || '',
    obs: item?.obs || ''
  }));
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeLinks(list) {
  if (Array.isArray(list) && list.length) {
    return list.map((value) => String(value ?? ''));
  }
  return [''];
}

function normalizeEmails(list) {
  if (Array.isArray(list) && list.length) {
    return list.map((value) => String(value ?? ''));
  }
  return [''];
}

function normalizeContatos(list) {
  if (Array.isArray(list) && list.length) {
    return list.map((item) => ({
      numero: item?.numero || '',
      obs: item?.obs || ''
    }));
  }
  return [{ numero: '', obs: '' }];
}

function normalizeConvenio(raw = {}) {
  const defaults = cloneOperacionalDefaults();
  const id = raw.id || nextConvenioId();
  const tipo = (raw.tipo || raw.tipoConvenio || 'prefeitura').toString().toLowerCase();
  const statusFlag = raw.statusSuspenso ?? raw.suspensoConvenio ?? raw.suspenso ?? false;

  const conveniosCampos = {
    ...defaults,
    ...raw,
    id,
    tipo: CONVENIO_TYPES.includes(tipo) ? tipo : 'prefeitura',
    nome: raw.nome ?? raw.nomeConvenio ?? '',
    statusSuspenso: !!statusFlag,
    rogo: normalizeTextList(raw.rogo),
    documentos: normalizeTextList(raw.documentos),
    prazosCartao: normalizePrazoList(raw.prazosCartao),
    minimoLiberado: raw.minimoLiberado ?? '',
    parcela: raw.parcela ?? '',
    tipoMinimo: raw.tipoMinimo === 'parcela' ? 'parcela' : 'valor liberado',
    observacoes: raw.observacoes ?? ''
  };

  return conveniosCampos;
}

function legacyBancoParaConvenio(banco) {
  const scoped = {};
  Object.keys(OPERACIONAL_DEFAULTS).forEach((key) => {
    if (banco[key] !== undefined) scoped[key] = banco[key];
  });
  return {
    ...scoped,
    id: nextConvenioId(),
    tipo: banco?.tipoConvenio || banco?.tipo || 'prefeitura',
    nome: banco?.nomeConvenio || banco?.nome || ''
  };
}

export function normalize(banco) {
  const safe = banco && typeof banco === 'object' ? banco : {};

  const result = {
    nome: safe.nome ?? '',
    suspenso: !!safe.suspenso,
    bancosAceitos: normalizeTextList(safe.bancosAceitos),
    bancosNaoAceitos: normalizeTextList(safe.bancosNaoAceitos),
    outrosCollapsed: safe.outrosCollapsed !== undefined ? !!safe.outrosCollapsed : true,
    links: normalizeLinks(safe.links),
    emails: normalizeEmails(safe.emails),
    contatos: normalizeContatos(safe.contatos)
  };

  let convenios = Array.isArray(safe.convenios) ? safe.convenios : [];
  if (!convenios.length) {
    convenios = [legacyBancoParaConvenio(safe)];
  }

  result.convenios = convenios.map(normalizeConvenio);
  return result;
}

export function novoConvenioPadrao(tipo = 'prefeitura') {
  return normalizeConvenio({
    ...OPERACIONAL_DEFAULTS,
    id: nextConvenioId(),
    tipo,
    nome: ''
  });
}

export function novoBancoPadrao() {
  return {
    nome: '',
    suspenso: false,
    bancosAceitos: [],
    bancosNaoAceitos: [],
    outrosCollapsed: true,
    links: [''],
    emails: [''],
    contatos: [{ numero: '', obs: '' }],
    convenios: [novoConvenioPadrao()]
  };
}

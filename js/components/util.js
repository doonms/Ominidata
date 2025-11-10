import { BASE_INSS_KEY, BASE_INSS_FALLBACKS, BASE_INSS_MIRRORS, readFromStorage, writeToStorage } from '../config/storageKeys.js';
export const KEY = BASE_INSS_KEY;


export function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export function parseRange(s){
  if(!s) return null;
  const t = String(s).trim().replace(/–/g,'-').replace(/\s+a\s+/i,'-').replace(/\s+/g,'');
  if(t.includes('-')){ const [a,b]=t.split('-').map(n=>parseInt(n,10)); if(!isNaN(a)&&!isNaN(b)) return {min:a,max:b}; return null; }
  const n=parseInt(t,10); if(!isNaN(n)) return {min:n,max:n}; return null;
}

export function lerStorage(key = KEY){
  const fallbacks = key === KEY ? BASE_INSS_FALLBACKS : [];
  const data = readFromStorage(key, fallbacks);
  return Array.isArray(data) ? data : [];
}
export function salvarStorage(key, data){
  const mirrors = key === KEY ? BASE_INSS_MIRRORS : [];
  writeToStorage(key, Array.isArray(data) ? data : [], mirrors);
}

export function normalize(b){
  // prazos
  b.prazos = Array.isArray(b.prazos)? b.prazos.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [{idade:'',parcelas:'',obs:''}];
  b.prazosCartao = Array.isArray(b.prazosCartao)? b.prazosCartao.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [{idade:'',parcelas:'',obs:''}];
  b.prazosPortabilidade = Array.isArray(b.prazosPortabilidade)? b.prazosPortabilidade.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [{idade:'',parcelas:'',obs:''}];

  b.prazosPensao = Array.isArray(b.prazosPensao)? b.prazosPensao.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [{idade:'',parcelas:'',obs:''}];
  b.prazosPensaoCartao = Array.isArray(b.prazosPensaoCartao)? b.prazosPensaoCartao.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.prazosPensaoRefin = Array.isArray(b.prazosPensaoRefin)? b.prazosPensaoRefin.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.prazosPensaoPort = Array.isArray(b.prazosPensaoPort)? b.prazosPensaoPort.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];

  // invalidez
  b.invalidezPrazos = Array.isArray(b.invalidezPrazos)? b.invalidezPrazos.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [{idade:'',parcelas:'',obs:''}];
  b.invalidezCartao = Array.isArray(b.invalidezCartao)? b.invalidezCartao.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.invalidezRefin = Array.isArray(b.invalidezRefin)? b.invalidezRefin.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.invalidezPort = Array.isArray(b.invalidezPort)? b.invalidezPort.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];

  // loas
  b.loas87Ranges = Array.isArray(b.loas87Ranges)? b.loas87Ranges.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.loas88Ranges = Array.isArray(b.loas88Ranges)? b.loas88Ranges.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.loas87Cartao = Array.isArray(b.loas87Cartao)? b.loas87Cartao.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.loas88Cartao = Array.isArray(b.loas88Cartao)? b.loas88Cartao.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.loas87Refin = Array.isArray(b.loas87Refin)? b.loas87Refin.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.loas88Refin = Array.isArray(b.loas88Refin)? b.loas88Refin.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.loas87Port = Array.isArray(b.loas87Port)? b.loas87Port.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];
  b.loas88Port = Array.isArray(b.loas88Port)? b.loas88Port.map(p=>({idade:p.idade||'',parcelas:p.parcelas||'',obs:p.obs||''})) : [];

  // docs/rogo/bancos lista
  b.documentos = Array.isArray(b.documentos)?b.documentos:[]; 
  b.outrosDocs = b.outrosDocs||'';
  b.rogo = Array.isArray(b.rogo)?b.rogo:[]; 
  b.rogoOutros = b.rogoOutros||'';
  b.bancosAceitos = Array.isArray(b.bancosAceitos)?b.bancosAceitos:[]; 
  b.bancosNaoAceitos = Array.isArray(b.bancosNaoAceitos)?b.bancosNaoAceitos:[];

  // outras informações
  b.links = Array.isArray(b.links)? b.links : [''];
  b.emails = Array.isArray(b.emails)? b.emails : [''];
  b.contatos = Array.isArray(b.contatos)? b.contatos.map(c=>({numero:c.numero||'',obs:c.obs||''})) : [{numero:'',obs:''}];

  // booleans
  b.aceitaClienteNaoAssina = !!b.aceitaClienteNaoAssina;
  b.aceitaLoas = !!b.aceitaLoas;
  b.aceitaInvalidez = !!b.aceitaInvalidez;

  if (b.hasOwnProperty('aceitaClientePensao')) {
    b.aceitaClientePensao = !!b.aceitaClientePensao;
  } else if (b.hasOwnProperty('fazPensao')) {
    b.aceitaClientePensao = !!b.fazPensao;
  } else {
    b.aceitaClientePensao = !!b.aceitaClientePensao;
  }
  b.fazPensao = !!b.fazPensao;

  b.fazMargem = !!b.fazMargem;
  b.fazCartao = !!b.fazCartao;
  b.fazRefin = !!b.fazRefin;
  b.fazPortabilidade = !!b.fazPortabilidade;
  b.fazSaqueComplementar = !!b.fazSaqueComplementar;

  b.teimosinha = b.teimosinha||'';
  b.tipoMinimo = b.tipoMinimo || 'valor liberado';
  b.minimoLiberado = b.minimoLiberado || '';

  // Procedimentos
  b.precisaVideo = (b.precisaVideo===undefined)? true : !!b.precisaVideo;
  b.precisaVideoObs = b.precisaVideoObs||'';
  b.fazLigacaoCliente = (b.fazLigacaoCliente===undefined)? true : !!b.fazLigacaoCliente;
  b.fazLigacaoClienteObs = b.fazLigacaoClienteObs||'';
  b.clienteLigaBanco = !!b.clienteLigaBanco;
  b.clienteLigaBancoObs = b.clienteLigaBancoObs||'';
  b.precisaGravarVideo = !!b.precisaGravarVideo;
  b.gravarVideoObs = b.gravarVideoObs||'';
  b.precisaEnviarContratoBanco = !!b.precisaEnviarContratoBanco;

  // Não assinante
  b.naoAssina_precisaEnviarFisico = !!b.naoAssina_precisaEnviarFisico;
  b.naoAssina_precisaVideo = (b.naoAssina_precisaVideo===undefined)? true : !!b.naoAssina_precisaVideo;
  b.naoAssina_precisaVideoObs = b.naoAssina_precisaVideoObs||'';
  b.naoAssina_fazLigacao = (b.naoAssina_fazLigacao===undefined)? true : !!b.naoAssina_fazLigacao;
  b.naoAssina_fazLigacaoObs = b.naoAssina_fazLigacaoObs||'';
  b.naoAssina_clienteLigaBanco = !!b.naoAssina_clienteLigaBanco;
  b.naoAssina_clienteLigaBancoObs = b.naoAssina_clienteLigaBancoObs||'';
  b.naoAssina_precisaEnviarEmail = !!b.naoAssina_precisaEnviarEmail;
  b.naoAssina_precisaGravarVideo = !!b.naoAssina_precisaGravarVideo;
  b.naoAssina_gravarVideoObs = b.naoAssina_gravarVideoObs||'';

  // contrato 60+
  b.contrato60 = !!b.contrato60;
  b.contrato60_estados = b.contrato60_estados || '';
  b.contrato60_enviarFisico = !!b.contrato60_enviarFisico;
  b.contrato60_enviarEmail = !!b.contrato60_enviarEmail;
  b.contrato60_precisaGravarVideo = !!b.contrato60_precisaGravarVideo;
  b.contrato60_gravarVideoObs = b.contrato60_gravarVideoObs||'';

  // invalidez toggles
  b.invalidezFazMargem = !!b.invalidezFazMargem;
  b.invalidezFazCartao = !!b.invalidezFazCartao;
  b.invalidezFazRefin = !!b.invalidezFazRefin;
  b.invalidezFazPortabilidade = !!b.invalidezFazPortabilidade;

  // loas toggles
  b.loasFazMargem = !!b.loasFazMargem;
  b.loasFazCartao = !!b.loasFazCartao;
  b.loasFazRefin = !!b.loasFazRefin;
  b.loasFazPortabilidade = !!b.loasFazPortabilidade;
  b.loasAceitaNaoAssina = !!b.loasAceitaNaoAssina;

  // pensão toggles
  b.pensaoFazMargem = !!b.pensaoFazMargem;
  b.pensaoFazCartao = !!b.pensaoFazCartao;
  b.pensaoFazRefin = !!b.pensaoFazRefin;
  b.pensaoFazPortabilidade = !!b.pensaoFazPortabilidade;
  b.pensaoAceitaNaoAssina = !!b.pensaoAceitaNaoAssina;

  // status
  b.suspenso = !!b.suspenso;

  return b;
}

export function novoBancoPadrao(){
  return {
    nome:'', teimosinha:'', tipoMinimo:'valor liberado', minimoLiberado:'',
    prazos:[{idade:'',parcelas:'',obs:''}],
    prazosCartao:[{idade:'',parcelas:'',obs:''}],
    prazosPortabilidade:[{idade:'',parcelas:'',obs:''}],
    prazosPensao:[{idade:'',parcelas:'',obs:''}],
    prazosPensaoCartao:[],
    prazosPensaoRefin:[],
    prazosPensaoPort:[],
    invalidezPrazos:[{idade:'',parcelas:'',obs:''}], invalidezCartao:[], invalidezRefin:[], invalidezPort:[],
    loas87Ranges:[], loas88Ranges:[], loas87Cartao:[], loas88Cartao:[], loas87Refin:[], loas88Refin:[], loas87Port:[], loas88Port:[],
    documentos:[], outrosDocs:'', rogo:[], rogoOutros:'',
    aceitaClienteNaoAssina:false, aceitaLoas:false, aceitaInvalidez:false,
    fazMargem:false, fazCartao:false, fazRefin:false, fazPortabilidade:false, fazPensao:false,
    aceitaClientePensao:false,
    fazSaqueComplementar:false,
    precisaVideo:true, precisaVideoObs:'', fazLigacaoCliente:true, fazLigacaoClienteObs:'', clienteLigaBanco:false, clienteLigaBancoObs:'',
    precisaGravarVideo:false, gravarVideoObs:'', precisaEnviarContratoBanco:false,
    naoAssina_precisaEnviarFisico:false, naoAssina_precisaVideo:true, naoAssina_precisaVideoObs:'', naoAssina_fazLigacao:true, naoAssina_fazLigacaoObs:'', naoAssina_clienteLigaBanco:false, naoAssina_clienteLigaBancoObs:'', naoAssina_precisaEnviarEmail:false, naoAssina_precisaGravarVideo:false, naoAssina_gravarVideoObs:'',
    contrato60:false, contrato60_estados:'', contrato60_enviarFisico:false, contrato60_enviarEmail:false, contrato60_precisaGravarVideo:false, contrato60_gravarVideoObs:'',
    invalidezFazMargem:true, invalidezFazCartao:false, invalidezFazRefin:false, invalidezFazPortabilidade:false,
    loasFazMargem:true, loasFazCartao:false, loasFazRefin:false, loasFazPortabilidade:false, loasAceitaNaoAssina:false,
    pensaoFazMargem:false, pensaoFazCartao:false, pensaoFazRefin:false, pensaoFazPortabilidade:false, pensaoAceitaNaoAssina:false,
    bancosAceitos:[], bancosNaoAceitos:[],
    links:[''], emails:[''], contatos:[{numero:'',obs:''}],
    suspenso:false
  };
}




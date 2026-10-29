import { criarBancoCard } from './components/bancoCard.js';
import { renderPrazosInline, renderInvalidezInline, renderLoasInline, renderOutrasInfos } from './components/renderers.js';
import { KEY, esc, parseRange, normalize, lerStorage, salvarStorage, novoBancoPadrao } from './components/util.js';
import { supabase } from './supa/supabaseClient.js';
import { getLogoSrc, getLogoFallbackAttr } from './utils/logo.js';
import { enviarBaseInss, mensagemErroInss } from './api/baseInssApi.js';

let listEl;
let addBtn;
let file;
let saveBtn;
let uploadBaseBtn;
let uploadBaseFile;

const rawBancos = lerStorage(KEY).filter(b => b && typeof b === 'object');
let bancos = rawBancos.map((b) => normalize(b));
let openState = {};
let activeTab = bancos.reduce((acc, _, i) => (acc[i] = 'geral', acc), {});

async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

let envioInssEmAndamento = false;
async function uploadBaseInss(file) {
  if (envioInssEmAndamento) return;
  const botao = uploadBaseBtn;
  try {
    if (!file) {
      alert('Selecione um arquivo JSON para enviar.');
      return;
    }

    envioInssEmAndamento = true;
    if (botao) botao.disabled = true;
    const json = await readJsonFile(file);
    const resultado = await enviarBaseInss(json, { baseLocal: bancos,
      antesDeEnviar: ({ quantidade, removidos }) => confirm(`Publicar ${quantidade} bancos na Base INSS? ${removidos} bancos ausentes no arquivo serão removidos depois da gravação. Um backup será guardado neste navegador.`)
    });
    if (!resultado) return;
    alert(`✅ ${resultado.quantidade} bancos confirmados na Base INSS. ${resultado.removidos} bancos antigos removidos.`);
    if (listEl?.isConnected && uploadBaseBtn === botao) await carregarBaseInssRemota();
  } catch (err) {
    console.error('Erro ao enviar base INSS:', err);
    alert(`❌ Não foi possível confirmar o envio da Base INSS. ${mensagemErroInss(err)}`);
  } finally {
    envioInssEmAndamento = false;
    if (botao) botao.disabled = false;
  }
}

async function carregarBaseInssRemota() {
  try {
    const { data, error } = await supabase
      .from('base_inss')
      .select('*')
      .order('nome', { ascending: true });

    if (error) {
      console.error('Erro ao carregar base INSS do Supabase:', error);
      return;
    }

    const lista = (data || []).map(row => {
      const dados = row?.dados && typeof row.dados === 'object' ? row.dados : {};
      return normalize({
        ...dados,
        banco_id: row?.banco_id ?? dados.banco_id,
        nome: dados.nome ?? row?.nome ?? '',
        suspenso: row?.suspenso ?? dados.suspenso ?? dados.status_suspenso ?? false,
        status_suspenso: dados.status_suspenso ?? row?.suspenso ?? false
      });
    });

    bancos = lista;
    openState = {};
    activeTab = bancos.reduce((acc, _, i) => (acc[i] = 'geral', acc), {});
    salvarStorage(KEY, bancos);
    render();
  } catch (err) {
    console.error('Erro inesperado ao carregar base INSS do Supabase:', err);
  }
}

function render(){
  if(!listEl) return;
  listEl.innerHTML = '';
  const arr = bancos.slice().sort((a,b)=>((a.nome||'').toLowerCase()).localeCompare((b.nome||'').toLowerCase()));
  arr.forEach(b=>{
    const idx = bancos.indexOf(b);
    const card = criarBancoCard(b, idx, activeTab[idx] || 'geral');
    const nomeBanco = b.nome || 'Novo Banco';
    const head = card.querySelector('.card-head > div');
    if (head) {
      head.classList.add('logo-label');
      head.innerHTML = `
        <img src="${getLogoSrc(nomeBanco)}" alt="Logo ${esc(nomeBanco)}" class="logo-label-img" onerror="${getLogoFallbackAttr()}">
        <strong style="font-size:15px;color:#dff3ff">${esc(nomeBanco)}</strong>
      `;
    }
    listEl.appendChild(card);

    // inline sections
    renderPrazosInline(bancos, idx);
    renderPrazosInline(bancos, idx, 'cartao');
    renderPrazosInline(bancos, idx, 'port');
    renderPrazosInline(bancos, idx, 'pensao');
    renderPrazosInline(bancos, idx, 'pensao-cartao');
    renderPrazosInline(bancos, idx, 'pensao-refin');
    renderPrazosInline(bancos, idx, 'pensao-port');

    renderInvalidezInline(bancos, idx);
    renderInvalidezInline(bancos, idx, 'cartao');
    renderInvalidezInline(bancos, idx, 'refin');
    renderInvalidezInline(bancos, idx, 'port');

    renderLoasInline(bancos, idx, 'loas87');
    renderLoasInline(bancos, idx, 'loas87-cartao');
    renderLoasInline(bancos, idx, 'loas87-refin');
    renderLoasInline(bancos, idx, 'loas87-port');
    renderLoasInline(bancos, idx, 'loas88');
    renderLoasInline(bancos, idx, 'loas88-cartao');
    renderLoasInline(bancos, idx, 'loas88-refin');
    renderLoasInline(bancos, idx, 'loas88-port');

    renderOutrasInfos(bancos, idx);

    const aberto = !!openState[idx];
    const body = card.querySelector('.card-body');
    body.id = `inss-banco-${idx}`;
    if(aberto) body.style.display = 'block';
    const toggle = card.querySelector('button[data-open]');
    toggle.textContent = aberto ? 'Recolher' : 'Expandir';
    toggle.setAttribute('aria-expanded', String(aberto));
    toggle.setAttribute('aria-controls', body.id);
  });
  salvarStorage(KEY, bancos);
}

function handleAddBanco(){
  bancos.push(normalize(novoBancoPadrao()));
  const idx = bancos.length - 1;
  openState[idx] = true;
  activeTab[idx] = 'geral';
  salvarStorage(KEY, bancos);
  render();
}

function handleFileChange(e){
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result) || [];
      const arr = Array.isArray(parsed) ? parsed.filter(b => b && typeof b === "object") : [];
      bancos = arr.map(b => normalize(b));
      openState = {};
      salvarStorage(KEY, bancos);
      render();
      alert('Arquivo carregado e salvo no localStorage');
    } catch {
      alert('JSON inválido');
    }
  };
  r.readAsText(f);
  e.target.value = '';
}

function handleSaveClick(){
  const blob = new Blob([JSON.stringify(bancos,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `regras-bancos-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function captureElements(){
  listEl = document.getElementById('list');
  addBtn  = document.getElementById('add');
  file    = document.getElementById('file');
  saveBtn = document.getElementById('save');
  uploadBaseBtn = document.getElementById('uploadBaseInssBtn');
  uploadBaseFile = document.getElementById('uploadBaseInssFile');
}

function bindStaticHandlers(){
  if(addBtn) addBtn.onclick = handleAddBanco;
  if(file) file.onchange = handleFileChange;
  if(saveBtn) saveBtn.onclick = handleSaveClick;
  if (uploadBaseBtn && uploadBaseFile) {
    uploadBaseBtn.onclick = () => uploadBaseFile.click();
    uploadBaseFile.onchange = async (e) => {
      const selected = e.target.files?.[0];
      if (!selected) return;
      await uploadBaseInss(selected);
      e.target.value = '';
    };
  }
}

// exposto para o SPA re-renderizar a base quando necessário
export function initBase(){
  captureElements();
  bindStaticHandlers();
  render();
  carregarBaseInssRemota();
}

/* ================== Delegation ================== */
document.addEventListener('click', e=>{
  const t = e.target;
  if (!listEl?.isConnected || !listEl.contains(t)) return;

  // Abrir/Remover card
  if(t.matches('button[data-open]')){ const idx = t.getAttribute('data-open'); openState[idx] = !openState[idx]; render(); return; }
  if(t.matches('button[data-rem]')){ const i = Number(t.getAttribute('data-rem')); if(confirm('Remover banco?')){ bancos.splice(i,1); salvarStorage(KEY, bancos); render(); } }

  // Head click toggle
  if(t.closest('.card-head') && t.closest('.card')){
    const card = t.closest('.card');
    const idx = Number(card.dataset.idx);
    openState[idx] = !openState[idx];
    render();
    return;
  }

  // Tabs
  if(t.matches('.tabbtn')){ const [idx,tab] = t.getAttribute('data-tab').split(':'); activeTab[idx]=tab; render(); }

  /* prazos base */
  if(t.matches('button[data-add-prazo]')){ const i = Number(t.getAttribute('data-add-prazo')); bancos[i].prazos.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-p]')){ const [i,j] = t.getAttribute('data-rem-p').split(':').map(Number); bancos[i].prazos.splice(j,1); salvarStorage(KEY, bancos); render(); }

  if(t.matches('button[data-add-prazo-cartao]')){ const i = Number(t.getAttribute('data-add-prazo-cartao')); bancos[i].prazosCartao.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-p-cartao]')){ const [i,j] = t.getAttribute('data-rem-p-cartao').split(':').map(Number); bancos[i].prazosCartao.splice(j,1); salvarStorage(KEY, bancos); render(); }

  if(t.matches('button[data-add-prazo-port]')){ const i = Number(t.getAttribute('data-add-prazo-port')); bancos[i].prazosPortabilidade.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-p-port]')){ const [i,j] = t.getAttribute('data-rem-p-port').split(':').map(Number); bancos[i].prazosPortabilidade.splice(j,1); salvarStorage(KEY, bancos); render(); }

  /* pensão */
  if(t.matches('button[data-add-prazo-pensao]')){ const i = Number(t.getAttribute('data-add-prazo-pensao')); bancos[i].prazosPensao.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-p-pensao]')){ const [i,j] = t.getAttribute('data-rem-p-pensao').split(':').map(Number); bancos[i].prazosPensao.splice(j,1); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-prazo-pensao-cartao]')){ const i = Number(t.getAttribute('data-add-prazo-pensao-cartao')); bancos[i].prazosPensaoCartao.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-p-pensao-cartao]')){ const [i,j] = t.getAttribute('data-rem-p-pensao-cartao').split(':').map(Number); bancos[i].prazosPensaoCartao.splice(j,1); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-prazo-pensao-refin]')){ const i = Number(t.getAttribute('data-add-prazo-pensao-refin')); bancos[i].prazosPensaoRefin.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-p-pensao-refin]')){ const [i,j] = t.getAttribute('data-rem-p-pensao-refin').split(':').map(Number); bancos[i].prazosPensaoRefin.splice(j,1); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-prazo-pensao-port]')){ const i = Number(t.getAttribute('data-add-prazo-pensao-port')); bancos[i].prazosPensaoPort.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-p-pensao-port]')){ const [i,j] = t.getAttribute('data-rem-p-pensao-port').split(':').map(Number); bancos[i].prazosPensaoPort.splice(j,1); salvarStorage(KEY, bancos); render(); }

  /* invalidez */
  if(t.matches('button[data-add-invalidez]')){ const i = Number(t.getAttribute('data-add-invalidez')); bancos[i].invalidezPrazos.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-inv]')){ const [i,j] = t.getAttribute('data-rem-inv').split(':').map(Number); bancos[i].invalidezPrazos.splice(j,1); salvarStorage(KEY, bancos); render(); }

  if(t.matches('button[data-add-invalidez-cartao]')){ const i = Number(t.getAttribute('data-add-invalidez-cartao')); bancos[i].invalidezCartao.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-inv-cartao]')){ const [i,j] = t.getAttribute('data-rem-inv-cartao').split(':').map(Number); bancos[i].invalidezCartao.splice(j,1); salvarStorage(KEY, bancos); render(); }

  if(t.matches('button[data-add-invalidez-refin]')){ const i = Number(t.getAttribute('data-add-invalidez-refin')); bancos[i].invalidezRefin.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-inv-refin]')){ const [i,j] = t.getAttribute('data-rem-inv-refin').split(':').map(Number); bancos[i].invalidezRefin.splice(j,1); salvarStorage(KEY, bancos); render(); }

  if(t.matches('button[data-add-invalidez-port]')){ const i = Number(t.getAttribute('data-add-invalidez-port')); bancos[i].invalidezPort.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-inv-port]')){ const [i,j] = t.getAttribute('data-rem-inv-port').split(':').map(Number); bancos[i].invalidezPort.splice(j,1); salvarStorage(KEY, bancos); render(); }

  /* loas add/rem (FIX) */
  if(t.matches('button[data-add-loas87]')){ const i = Number(t.getAttribute('data-add-loas87')); bancos[i].loas87Ranges.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-loas88]')){ const i = Number(t.getAttribute('data-add-loas88')); bancos[i].loas88Ranges.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-loas87-cartao]')){ const i = Number(t.getAttribute('data-add-loas87-cartao')); bancos[i].loas87Cartao.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-loas88-cartao]')){ const i = Number(t.getAttribute('data-add-loas88-cartao')); bancos[i].loas88Cartao.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-loas87-refin]')){ const i = Number(t.getAttribute('data-add-loas87-refin')); bancos[i].loas87Refin.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-loas88-refin]')){ const i = Number(t.getAttribute('data-add-loas88-refin')); bancos[i].loas88Refin.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-loas87-port]')){ const i = Number(t.getAttribute('data-add-loas87-port')); bancos[i].loas87Port.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-add-loas88-port]')){ const i = Number(t.getAttribute('data-add-loas88-port')); bancos[i].loas88Port.push({idade:'',parcelas:'',obs:''}); salvarStorage(KEY, bancos); render(); }

  if(t.matches('button[data-rem-loas]')){
    const [key,i,j] = t.getAttribute('data-rem-loas').split(':');
    bancos[Number(i)][key].splice(Number(j),1);
    salvarStorage(KEY, bancos);
    render();
  }

  /* outras informações */
  if(t.matches('button[data-add-link]')){ const i = Number(t.getAttribute('data-add-link')); bancos[i].links.push(''); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-link]')){ const [i,j] = t.getAttribute('data-rem-link').split(':').map(Number); bancos[i].links.splice(j,1); salvarStorage(KEY, bancos); render(); }

  if(t.matches('button[data-add-email]')){ const i = Number(t.getAttribute('data-add-email')); bancos[i].emails.push(''); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-email]')){ const [i,j] = t.getAttribute('data-rem-email').split(':').map(Number); bancos[i].emails.splice(j,1); salvarStorage(KEY, bancos); render(); }

  if(t.matches('button[data-add-contato]')){ const i = Number(t.getAttribute('data-add-contato')); bancos[i].contatos.push({numero:'',obs:''}); salvarStorage(KEY, bancos); render(); }
  if(t.matches('button[data-rem-contato]')){ const [i,j] = t.getAttribute('data-rem-contato').split(':').map(Number); bancos[i].contatos.splice(j,1); salvarStorage(KEY, bancos); render(); }
});

document.addEventListener('input', e=>{
  const el = e.target;

  /* prazos base */
  if(el.hasAttribute('data-p')){
    const [i,j,k] = el.getAttribute('data-p').split(':');
    if(k==='idade'){ bancos[i].prazos[j].idade = el.value; const p = parseRange(el.value); if(p){ bancos[i].prazos[j].min=p.min; bancos[i].prazos[j].max=p.max; } }
    else if(k==='parcelas') bancos[i].prazos[j].parcelas = el.value;
    else bancos[i].prazos[j].obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-p-cartao')){
    const [i,j,k] = el.getAttribute('data-p-cartao').split(':');
    if(k==='idade'){ bancos[i].prazosCartao[j].idade = el.value; const p = parseRange(el.value); if(p){ bancos[i].prazosCartao[j].min=p.min; bancos[i].prazosCartao[j].max=p.max; } }
    else if(k==='parcelas') bancos[i].prazosCartao[j].parcelas = el.value; else bancos[i].prazosCartao[j].obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-p-port')){
    const [i,j,k] = el.getAttribute('data-p-port').split(':');
    if(k==='idade'){ bancos[i].prazosPortabilidade[j].idade = el.value; const p = parseRange(el.value); if(p){ bancos[i].prazosPortabilidade[j].min=p.min; bancos[i].prazosPortabilidade[j].max=p.max; } }
    else if(k==='parcelas') bancos[i].prazosPortabilidade[j].parcelas = el.value; else bancos[i].prazosPortabilidade[j].obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-p-pensao')){
    const [i,j,k] = el.getAttribute('data-p-pensao').split(':');
    if(k==='idade'){ bancos[i].prazosPensao[j].idade = el.value; const p = parseRange(el.value); if(p){ bancos[i].prazosPensao[j].min=p.min; bancos[i].prazosPensao[j].max=p.max; } }
    else if(k==='parcelas') bancos[i].prazosPensao[j].parcelas = el.value; else bancos[i].prazosPensao[j].obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-p-pensao-cartao')){
    const [i,j,k] = el.getAttribute('data-p-pensao-cartao').split(':');
    if(k==='idade'){ bancos[i].prazosPensaoCartao[j].idade = el.value; const p = parseRange(el.value); if(p){ bancos[i].prazosPensaoCartao[j].min=p.min; bancos[i].prazosPensaoCartao[j].max=p.max; } }
    else if(k==='parcelas') bancos[i].prazosPensaoCartao[j].parcelas = el.value; else bancos[i].prazosPensaoCartao[j].obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-p-pensao-refin')){
    const [i,j,k] = el.getAttribute('data-p-pensao-refin').split(':');
    if(k==='idade'){ bancos[i].prazosPensaoRefin[j].idade = el.value; const p = parseRange(el.value); if(p){ bancos[i].prazosPensaoRefin[j].min=p.min; bancos[i].prazosPensaoRefin[j].max=p.max; } }
    else if(k==='parcelas') bancos[i].prazosPensaoRefin[j].parcelas = el.value; else bancos[i].prazosPensaoRefin[j].obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-p-pensao-port')){
    const [i,j,k] = el.getAttribute('data-p-pensao-port').split(':');
    if(k==='idade'){ bancos[i].prazosPensaoPort[j].idade = el.value; const p = parseRange(el.value); if(p){ bancos[i].prazosPensaoPort[j].min=p.min; bancos[i].prazosPensaoPort[j].max=p.max; } }
    else if(k==='parcelas') bancos[i].prazosPensaoPort[j].parcelas = el.value; else bancos[i].prazosPensaoPort[j].obs = el.value;
    salvarStorage(KEY, bancos); return;
  }

  /* invalidez */
  if(el.hasAttribute('data-inv')){
    const [i,j,k] = el.getAttribute('data-inv').split(':');
    const r = bancos[i].invalidezPrazos[j];
    if(k==='idade'){ r.idade = el.value; const p = parseRange(el.value); r.min = p? p.min : ''; r.max = p? p.max : ''; }
    else if(k==='parcelas') r.parcelas = el.value; else r.obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-inv-cartao')){
    const [i,j,k] = el.getAttribute('data-inv-cartao').split(':');
    const r = bancos[i].invalidezCartao[j];
    if(k==='idade'){ r.idade = el.value; const p = parseRange(el.value); r.min = p? p.min : ''; r.max = p? p.max : ''; }
    else if(k==='parcelas') r.parcelas = el.value; else r.obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-inv-refin')){
    const [i,j,k] = el.getAttribute('data-inv-refin').split(':');
    const r = bancos[i].invalidezRefin[j];
    if(k==='idade'){ r.idade = el.value; const p = parseRange(el.value); r.min = p? p.min : ''; r.max = p? p.max : ''; }
    else if(k==='parcelas') r.parcelas = el.value; else r.obs = el.value;
    salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-inv-port')){
    const [i,j,k] = el.getAttribute('data-inv-port').split(':');
    const r = bancos[i].invalidezPort[j];
    if(k==='idade'){ r.idade = el.value; const p = parseRange(el.value); r.min = p? p.min : ''; r.max = p? p.max : ''; }
    else if(k==='parcelas') r.parcelas = el.value; else r.obs = el.value;
    salvarStorage(KEY, bancos); return;
  }

  /* loas genérico */
  if(el.hasAttribute('data-loas')){
    const [key,idx,j,k] = el.getAttribute('data-loas').split(':');
    const r = bancos[idx][key][j];
    if(k==='idade'){ r.idade = el.value; const p = parseRange(el.value); r.min = p? p.min : ''; r.max = p? p.max : ''; }
    else if(k==='parcelas') r.parcelas = el.value; else r.obs = el.value;
    salvarStorage(KEY, bancos); return;
  }

  /* outras informações */
  if(el.hasAttribute('data-link')){
    const [i,j] = el.getAttribute('data-link').split(':').map(Number);
    bancos[i].links[j] = el.value; salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-email')){
    const [i,j] = el.getAttribute('data-email').split(':').map(Number);
    bancos[i].emails[j] = el.value; salvarStorage(KEY, bancos); return;
  }
  if(el.hasAttribute('data-contato')){
    const [i,j,key] = el.getAttribute('data-contato').split(':');
    bancos[i].contatos[j][key] = el.value; salvarStorage(KEY, bancos); return;
  }
});

document.addEventListener('change', e=>{
  const el = e.target;
  if(el.matches('[data-put]')){
    const [i,key] = el.getAttribute('data-put').split(':');
    const I = Number(i);
    let val = (el.type==='checkbox') ? el.checked : el.value;

    if(key==='bancosAceitos' || key==='bancosNaoAceitos'){
      bancos[I][key] = String(val).split(',').map(s=>s.trim()).filter(Boolean);
    }else{
      bancos[I][key] = val;
    }

    salvarStorage(KEY, bancos);
    render();

    // pós-render: mantém rogo visível quando muda "aceitaClienteNaoAssina"
    const rogoWrap = document.getElementById(`rogoWrap-${I}`);
    if(rogoWrap && key==='aceitaClienteNaoAssina'){ rogoWrap.style.display = val ? 'block':'none'; }
    return;
  }

  if(el.matches('input[data-doc]')){
    const [i,doc] = el.getAttribute('data-doc').split(':'); const I = Number(i);
    if(el.checked){ if(!bancos[I].documentos.includes(doc)) bancos[I].documentos.push(doc);}
    else bancos[I].documentos = bancos[I].documentos.filter(d=>d!==doc);
    salvarStorage(KEY, bancos); return;
  }

  if(el.matches('input[data-rogo]')){
    const [i,val] = el.getAttribute('data-rogo').split(':'); const I = Number(i);
    if(el.checked){ if(!bancos[I].rogo.includes(val)) bancos[I].rogo.push(val);}
    else bancos[I].rogo = bancos[I].rogo.filter(r=>r!==val);
    salvarStorage(KEY, bancos); return;
  }
});

/* start */
render();


import { KEY, esc, normalize, lerStorage, salvarStorage, novoBancoPadrao, novoConvenioPadrao, parseRange, OPERACOES_CONVENIO, PERFIS_CONVENIO, FAIXAS_CONVENIO, TIPO_PADRAO_BANCO } from './components/utilBaseOutros.js';
import { carregarBaseOutros, enviarBaseOutros, prepararBaseOutros, mesclarBaseOutros, mensagemErroOutros } from './api/baseOutrosConveniosApi.js';
import { getLogoSrc, getLogoFallbackAttr } from './utils/logo.js';

let listEl;
let addBtn;
let fileInput;
let saveBtn;
let uploadBaseBtn;
let uploadBaseFile;
let statusEl;
let reloadBtn;
let uploadJsonBtn;
let publicando = false;
let consultaAtual = 0;
const ULTIMA_LEITURA = KEY + '_publicada';
const BACKUP = KEY + '_backup';

const rawBancos = lerStorage(KEY).filter((item) => item && typeof item === 'object');
let bancos = rawBancos.map((banco) => normalize(banco));
let bancoOpenState = {};
let convenioOpenState = {};
let convenioFilters = {};

const novoPrazo = () => ({ idade: '', parcelas: '', obs: '' });

export function initBase() {
  bancos = lerStorage(KEY).filter(item => item && typeof item === 'object').map(normalize);
  captureElements();
  bindStaticHandlers();
  syncStates();
  render();
  if (!publicando) carregarBaseOutrosRemota();
}

function captureElements() {
  listEl = document.getElementById('list');
  addBtn = document.getElementById('add');
  fileInput = document.getElementById('file');
  saveBtn = document.getElementById('save');
  uploadBaseBtn = document.getElementById('uploadBaseOutrosBtn');
  uploadBaseFile = document.getElementById('uploadBaseOutrosFile');
  statusEl = document.getElementById('baseOutrosStatus');
  reloadBtn = document.getElementById('reloadBaseOutrosBtn');
  uploadJsonBtn = document.getElementById('uploadBaseOutrosJsonBtn');
}

function bindStaticHandlers() {
  if (addBtn) addBtn.onclick = handleAddBanco;
  if (fileInput) fileInput.onchange = handleFileChange;
  if (saveBtn) saveBtn.onclick = handleSaveClick;
  if (reloadBtn) reloadBtn.onclick = () => carregarBaseOutrosRemota();
  if (uploadBaseBtn) uploadBaseBtn.onclick = () => uploadBaseOutros();
  if (uploadJsonBtn && uploadBaseFile) {
    uploadJsonBtn.onclick = () => uploadBaseFile.click();
    uploadBaseFile.onchange = async (e) => {
      const selected = e.target.files?.[0];
      if (!selected) return;
      try { await uploadBaseOutros(selected); }
      finally { e.target.value = ''; }
    };
  }

  if (listEl && !listEl.dataset.bound) {
    listEl.addEventListener('click', handleClick);
    listEl.addEventListener('input', handleInput);
    listEl.addEventListener('change', handleChange);
    listEl.dataset.bound = '1';
  }
}

function syncStates() {
  const nextBancoOpen = {};
  const nextFilters = {};
  const nextConvenioOpen = {};
  bancos.forEach((banco, idx) => {
    nextBancoOpen[idx] = bancoOpenState[idx] ?? false;
    nextFilters[idx] = convenioFilters[idx] ?? '';
    nextConvenioOpen[idx] = {};
    (banco.convenios || []).forEach((conv) => {
      const prev = convenioOpenState[idx]?.[conv.id];
      nextConvenioOpen[idx][conv.id] = prev ?? false;
    });
  });
  bancoOpenState = nextBancoOpen;
  convenioFilters = nextFilters;
  convenioOpenState = nextConvenioOpen;
}

function render() {
  if (!listEl) return;
  listEl.innerHTML = '';
  const ordered = bancos.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));

  ordered.forEach((banco) => {
    const idx = bancos.indexOf(banco);
    const card = document.createElement('div');
    card.className = 'card banco-outros-card';
    card.innerHTML = renderBancoCard(banco, idx);
    listEl.appendChild(card);
  });
}

function renderBancoCard(banco, idx) {
  const isOpen = bancoOpenState[idx] ?? false;
  const filterValue = convenioFilters[idx] || '';
  const normalizedFilter = filterValue.trim().toLowerCase();
  const convenios = (Array.isArray(banco.convenios) ? banco.convenios : []).slice()
    .sort((a, b) => Number(b.tipo === TIPO_PADRAO_BANCO) - Number(a.tipo === TIPO_PADRAO_BANCO));
  const temPadrao = convenios.some(conv => conv.tipo === TIPO_PADRAO_BANCO);
  const filteredConvenios = normalizedFilter
    ? convenios.filter(
        (conv) =>
          conv.nome?.toLowerCase().includes(normalizedFilter) ||
          conv.tipo?.toLowerCase().includes(normalizedFilter)
      )
    : convenios;

  const conveniosHtml = filteredConvenios.length
    ? filteredConvenios.map((conv) => renderConvenioCard(conv, idx)).join('')
    : `<p class="muted">Nenhum convênio encontrado ${normalizedFilter ? `para "${esc(filterValue)}"` : ''}.</p>`;

  return `
    <div class="card-head" data-banco-header="${idx}">
      <button type="button" class="od-bank-title od-card-toggle" data-toggle-banco="${idx}" aria-expanded="${isOpen}" aria-controls="outros-banco-${idx}">
        <img class="logo-label-img" src="${getLogoSrc(banco.nome || '')}" alt="Logo do banco" onerror="${getLogoFallbackAttr()}">
        <span class="od-card-copy"><strong>${esc(banco.nome || 'Novo Banco')}</strong><small>${convenios.length} convênio${convenios.length === 1 ? '' : 's'} cadastrado${convenios.length === 1 ? '' : 's'}</small></span>
        <span class="od-card-chevron" aria-hidden="true">›</span>
      </button>
      <div class="card-head-actions">
        <label class="inline-checkbox">
          <input type="checkbox" data-bank-field="${idx}:suspenso" ${banco.suspenso ? 'checked' : ''}/>
          Banco suspenso
        </label>
        <button type="button" class="btn-danger" data-remove-banco="${idx}" aria-label="Remover banco">&#128465;</button>
      </div>
    </div>
    <div class="card-body" id="outros-banco-${idx}" style="display:${isOpen ? 'block' : 'none'}">
      <div class="row">
        <div class="col">
          <label>Nome do banco</label>
          <input data-bank-field="${idx}:nome" value="${esc(banco.nome || '')}" placeholder="Informe o nome do banco"/>
        </div>
      </div>

      <div class="row">
        <div class="col">
          <label>Buscar convênio</label>
          <input data-convenio-search="${idx}" value="${esc(filterValue)}" placeholder="Digite o nome ou tipo do convênio"/>
        </div>
        <div class="col">
          <label>Adicionar convênio</label>
          <div class="convenio-type-buttons">
            <button type="button" class="small" data-add-convenio="${idx}" data-type="${TIPO_PADRAO_BANCO}">${temPadrao ? 'Editar padrão banco' : '+ Padrão banco'}</button>
            <button type="button" class="small" data-add-convenio="${idx}" data-type="prefeitura">+ Prefeitura</button>
            <button type="button" class="small" data-add-convenio="${idx}" data-type="governo">+ Governo</button>
            <button type="button" class="small" data-add-convenio="${idx}" data-type="siape">+ SIAPE</button>
          </div>
        </div>
      </div>

      <p class="od-description">${temPadrao
        ? 'Novos convênios copiam o Padrão banco uma única vez. Depois, cada um é salvo de forma independente.'
        : 'Adicione o Padrão banco para usá-lo como modelo dos próximos convênios. Os já cadastrados não serão alterados.'}</p>
      <div class="convenios-wrapper">
        ${conveniosHtml}
      </div>

      ${renderOutrasInformacoes(banco, idx)}
    </div>
  `;
}

function renderOutrasInformacoes(banco, idx) {
  const collapsed = banco.outrosCollapsed ?? true;
  const chevron = collapsed ? '&#9656;' : '&#9662;';
  const bancosAceitos = (banco.bancosAceitos || []).join(', ');
  const bancosNaoAceitos = (banco.bancosNaoAceitos || []).join(', ');
  const links = Array.isArray(banco.links) && banco.links.length ? banco.links : [''];
  const emails = Array.isArray(banco.emails) && banco.emails.length ? banco.emails : [''];
  const contatos = Array.isArray(banco.contatos) && banco.contatos.length ? banco.contatos : [{ numero: '', obs: '' }];

  return `
    <div class="collapsible ${collapsed ? '' : 'open'}">
      <button type="button" class="collapsible-header" data-toggle-outros="${idx}">
        <span>Outras informações</span>
        <span class="chevron">${chevron}</span>
      </button>
      <div class="collapsible-body" style="display:${collapsed ? 'none' : 'block'}">
        <div class="row">
          <div class="col">
            <label>Bancos aceitos</label>
            <input data-bank-field="${idx}:bancosAceitos" value="${esc(bancosAceitos)}" placeholder="Itaú, Bradesco, ..."/>
          </div>
          <div class="col">
            <label>Bancos não aceitos</label>
            <input data-bank-field="${idx}:bancosNaoAceitos" value="${esc(bancosNaoAceitos)}" placeholder="Separe por vírgula"/>
          </div>
        </div>

        <div class="other-info">
          <label style="margin-top:12px">Links do banco</label>
          <div class="other-list">
            ${links
              .map(
                (value, linkIdx) => `
                  <div class="other-item">
                    <input data-link="${idx}:${linkIdx}" value="${esc(value || '')}" placeholder="https://..."/>
                    <button type="button" class="btn-danger" data-remove-link="${idx}:${linkIdx}">&#128465;</button>
                  </div>
                `
              )
              .join('')}
          </div>
          <button type="button" class="small" data-add-link="${idx}" style="margin-top:6px">+ Adicionar link</button>

          <label style="margin-top:12px">Emails do banco</label>
          <div class="other-list">
            ${emails
              .map(
                (value, emailIdx) => `
                  <div class="other-item">
                    <input data-email="${idx}:${emailIdx}" value="${esc(value || '')}" placeholder="atendimento@exemplo.com"/>
                    <button type="button" class="btn-danger" data-remove-email="${idx}:${emailIdx}">&#128465;</button>
                  </div>
                `
              )
              .join('')}
          </div>
          <button type="button" class="small" data-add-email="${idx}" style="margin-top:6px">+ Adicionar email</button>

          <label style="margin-top:12px">Contatos (telefone + OBS)</label>
          <div class="other-list">
            ${contatos
              .map(
                (contato, contatoIdx) => `
                  <div class="other-item contato-item">
                    <input data-contato="${idx}:${contatoIdx}:numero" value="${esc(contato?.numero || '')}" placeholder="Telefone"/>
                    <input data-contato="${idx}:${contatoIdx}:obs" value="${esc(contato?.obs || '')}" placeholder="Observação"/>
                    <button type="button" class="btn-danger" data-remove-contato="${idx}:${contatoIdx}">&#128465;</button>
                  </div>
                `
              )
              .join('')}
          </div>
          <button type="button" class="small" data-add-contato="${idx}" style="margin-top:6px">+ Adicionar contato</button>
        </div>
      </div>
    </div>
  `;
}

function renderConvenioCard(conv, bancoIdx) {
  const tipoLabel = formatTipoLabel(conv.tipo);
  const baseKey = `${bancoIdx}:${conv.id}`;
  const isOpen = convenioOpenState[bancoIdx]?.[conv.id] ?? false;
  const showContrato60 = conv.contrato60;
  const showNaoAssina = conv.aceitaClienteNaoAssina;
  const isPadrao = conv.tipo === TIPO_PADRAO_BANCO;

  return `
    <div class="convenio-card" data-convenio="${conv.id}">
      <div class="convenio-head" data-convenio-header="${baseKey}">
        <button type="button" class="od-card-toggle" data-toggle-convenio="${baseKey}" aria-expanded="${isOpen}" aria-controls="outros-convenio-${esc(baseKey)}">
          <span class="od-card-copy">
          <span class="convenio-tag">${tipoLabel}</span>
          <strong>${esc(conv.nome || 'Convênio sem nome')}</strong>
          </span>
          <span class="od-card-chevron" aria-hidden="true">›</span>
        </button>
        <div class="convenio-head-actions">
          <button type="button" class="btn-danger" data-remove-convenio="${baseKey}" aria-label="Remover convênio">&#128465;</button>
        </div>
      </div>

      <div class="convenio-body" id="outros-convenio-${esc(baseKey)}" style="display:${isOpen ? 'block' : 'none'}">
        ${isPadrao ? '<p class="od-description">Modelo deste banco. Suas condições são copiadas somente ao criar um novo convênio; alterações aqui não modificam os convênios já cadastrados.</p>' : ''}
        <div class="row">
          <div class="col">
            <label>Tipo</label>
            <select data-conv-field="${baseKey}:tipo" ${isPadrao ? 'disabled' : ''}>
              ${isPadrao ? renderTipoOption(TIPO_PADRAO_BANCO, conv.tipo) : ''}
              ${renderTipoOption('prefeitura', conv.tipo)}
              ${renderTipoOption('governo', conv.tipo)}
              ${renderTipoOption('siape', conv.tipo)}
            </select>
          </div>
          <div class="col">
            <label>Nome do convênio</label>
            <input data-conv-field="${baseKey}:nome" value="${esc(conv.nome || '')}" ${isPadrao ? 'readonly' : ''} placeholder="Ex: Prefeitura de Belo Horizonte"/>
          </div>
        </div>

        <div class="subpanel">
          <h3>Status</h3>
          <label class="inline-checkbox">
            <input type="checkbox" data-conv-field="${baseKey}:statusSuspenso" ${conv.statusSuspenso ? 'checked' : ''}/>
            Convênio suspenso
          </label>
        </div>

        <div class="subpanel">
          <h3>Operações</h3>
          <div class="checkbox-grid">
            ${checkbox('Margem', `${baseKey}:fazMargem`, conv.fazMargem)}
            ${checkbox('Cartão', `${baseKey}:fazCartao`, conv.fazCartao)}
            ${checkbox('Refin', `${baseKey}:fazRefin`, conv.fazRefin)}
            ${checkbox('Saque complementar', `${baseKey}:fazSaqueComplementar`, conv.fazSaqueComplementar)}
            ${checkbox('Portabilidade', `${baseKey}:fazPortabilidade`, conv.fazPortabilidade)}
          </div>
        </div>

        ${renderFaixasCondicionais(conv, bancoIdx)}

        <div class="subpanel" data-conv-section="perfis">
          <h3>Perfis aceitos</h3>
          <div class="checkbox-grid">
            ${checkbox('Celetista', `${baseKey}:aceitaCeletista`, conv.aceitaCeletista)}
            ${checkbox('Temporário', `${baseKey}:aceitaTemporario`, conv.aceitaTemporario)}
          </div>
          <label for="outros-perfis-${esc(baseKey)}">Outros perfis</label>
          <input id="outros-perfis-${esc(baseKey)}" data-conv-field="${baseKey}:perfisOutros" value="${esc(conv.perfisOutros || '')}" placeholder="Informe outros perfis aceitos"/>
        </div>
        ${renderFaixasCondicionais(conv, bancoIdx, PERFIS_CONVENIO, true)}

        <div class="subpanel">
          <h3>Documentos aceitos</h3>
          <div class="checkbox-grid">
            ${documentoCheckbox(baseKey, conv, 'rg', 'RG')}
            ${documentoCheckbox(baseKey, conv, 'cnh', 'CNH')}
            ${documentoCheckbox(baseKey, conv, 'ctps', 'CTPS')}
          </div>
          <input data-conv-field="${baseKey}:outrosDocs" value="${esc(conv.outrosDocs || '')}" placeholder="Outros documentos"/>
        </div>

        <div class="subpanel">
          <h3>Procedimentos</h3>
          <div class="checkbox-grid">
            ${checkbox('Vídeo chamada', `${baseKey}:precisaVideo`, conv.precisaVideo)}
            ${checkbox('Ligação para o cliente', `${baseKey}:fazLigacaoCliente`, conv.fazLigacaoCliente)}
            ${checkbox('Cliente liga no banco', `${baseKey}:clienteLigaBanco`, conv.clienteLigaBanco)}
            ${checkbox('Gravar vídeo', `${baseKey}:precisaGravarVideo`, conv.precisaGravarVideo)}
            ${checkbox('Enviar contrato ao banco', `${baseKey}:precisaEnviarContratoBanco`, conv.precisaEnviarContratoBanco)}
          </div>
          ${conditionalTextarea(conv.precisaVideo, `${baseKey}:precisaVideoObs`, conv.precisaVideoObs, 'Detalhes da vídeo chamada')}
          ${conditionalTextarea(conv.fazLigacaoCliente, `${baseKey}:fazLigacaoClienteObs`, conv.fazLigacaoClienteObs, 'Detalhes da ligação')}
          ${conditionalTextarea(conv.clienteLigaBanco, `${baseKey}:clienteLigaBancoObs`, conv.clienteLigaBancoObs, 'Quando o cliente precisa ligar')}
          ${conditionalTextarea(conv.precisaGravarVideo, `${baseKey}:gravarVideoObs`, conv.gravarVideoObs, 'Como gravar o vídeo')}

          <label class="inline-checkbox" style="margin-top:8px">
            <input type="checkbox" data-conv-field="${baseKey}:contrato60" ${conv.contrato60 ? 'checked' : ''}/>
            Faz contrato 60+?
          </label>
          <div class="cond-box" style="display:${showContrato60 ? 'block' : 'none'}">
            <input data-conv-field="${baseKey}:contrato60_estados" value="${esc(conv.contrato60_estados || '')}" placeholder="Estados (ex: SP, RJ, MG)"/>
            <div class="checkbox-grid" style="margin-top:6px">
              ${checkbox('Enviar físico', `${baseKey}:contrato60_enviarFisico`, conv.contrato60_enviarFisico)}
              ${checkbox('Enviar por email', `${baseKey}:contrato60_enviarEmail`, conv.contrato60_enviarEmail)}
              ${checkbox('Gravar vídeo', `${baseKey}:contrato60_precisaGravarVideo`, conv.contrato60_precisaGravarVideo)}
            </div>
            ${conditionalTextarea(conv.contrato60_precisaGravarVideo, `${baseKey}:contrato60_gravarVideoObs`, conv.contrato60_gravarVideoObs, 'Detalhes da gravação')}
          </div>

          <div class="nao-assinante-rules" style="display:${showNaoAssina ? 'block' : 'none'}">
            <h5>Regras para cliente não assinante</h5>
            <div class="checkbox-grid">
              ${checkbox('Enviar físico', `${baseKey}:naoAssina_precisaEnviarFisico`, conv.naoAssina_precisaEnviarFisico)}
              ${checkbox('Precisa de vídeo', `${baseKey}:naoAssina_precisaVideo`, conv.naoAssina_precisaVideo)}
              ${checkbox('Ligação para o cliente', `${baseKey}:naoAssina_fazLigacao`, conv.naoAssina_fazLigacao)}
              ${checkbox('Cliente liga no banco', `${baseKey}:naoAssina_clienteLigaBanco`, conv.naoAssina_clienteLigaBanco)}
              ${checkbox('Enviar por email', `${baseKey}:naoAssina_precisaEnviarEmail`, conv.naoAssina_precisaEnviarEmail)}
              ${checkbox('Gravar vídeo', `${baseKey}:naoAssina_precisaGravarVideo`, conv.naoAssina_precisaGravarVideo)}
            </div>
            ${conditionalTextarea(conv.naoAssina_precisaVideo, `${baseKey}:naoAssina_precisaVideoObs`, conv.naoAssina_precisaVideoObs, 'Detalhes da vídeo chamada')}
            ${conditionalTextarea(conv.naoAssina_fazLigacao, `${baseKey}:naoAssina_fazLigacaoObs`, conv.naoAssina_fazLigacaoObs, 'Detalhes da ligação')}
            ${conditionalTextarea(conv.naoAssina_clienteLigaBanco, `${baseKey}:naoAssina_clienteLigaBancoObs`, conv.naoAssina_clienteLigaBancoObs, 'Quando o cliente liga')}
            ${conditionalTextarea(conv.naoAssina_precisaGravarVideo, `${baseKey}:naoAssina_gravarVideoObs`, conv.naoAssina_gravarVideoObs, 'Detalhes da gravação')}
          </div>
        </div>

        <div class="subpanel">
          <h3>Financeiro</h3>
          <div class="row">
            <div class="col">
              <label>Mínimo liberado</label>
              <input type="number" min="0" data-conv-field="${baseKey}:minimoLiberado" value="${esc(conv.minimoLiberado || '')}" placeholder="0,00"/>
            </div>
            <div class="col">
              <label>Tipo de mínimo</label>
              <select data-conv-field="${baseKey}:tipoMinimo">
                <option value="valor liberado" ${conv.tipoMinimo === 'valor liberado' ? 'selected' : ''}>Valor liberado</option>
                <option value="parcela" ${conv.tipoMinimo === 'parcela' ? 'selected' : ''}>Parcela</option>
              </select>
            </div>
            <div class="col">
              <label>Parcela</label>
              <input data-conv-field="${baseKey}:parcela" value="${esc(conv.parcela || '')}" placeholder="Opcional"/>
            </div>
          </div>
        </div>

        <div class="subpanel">
          <h3>Observações gerais</h3>
          <textarea data-conv-field="${baseKey}:observacoes" rows="3" placeholder="Anote aqui qualquer detalhe adicional">${esc(conv.observacoes || '')}</textarea>
        </div>
      </div>
    </div>
  `;
}

function renderTipoOption(value, current) {
  const label = formatTipoLabel(value);
  return `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
}

function formatTipoLabel(tipo = '') {
  const map = { [TIPO_PADRAO_BANCO]: 'Padrão banco', prefeitura: 'Prefeitura', governo: 'Governo', siape: 'SIAPE' };
  return map[tipo] || 'Convênio';
}

function checkbox(label, dataKey, checked) {
  return `<label><input type="checkbox" data-conv-field="${dataKey}" ${checked ? 'checked' : ''}/> ${label}</label>`;
}

function documentoCheckbox(baseKey, conv, value, label) {
  const checked = (conv.documentos || []).includes(value);
  return `<label><input type="checkbox" data-conv-array="${baseKey}:documentos" data-value="${value}" ${checked ? 'checked' : ''}/> ${label}</label>`;
}

function conditionalTextarea(show, dataKey, value, placeholder) {
  if (!show) return '';
  return `<textarea class="small-row-text" data-conv-field="${dataKey}" rows="1" placeholder="${placeholder}">${esc(value || '')}</textarea>`;
}

function renderFaixasCondicionais(conv, bancoIdx, grupos = OPERACOES_CONVENIO, perfil = false) {
  const selecionadas = grupos.filter(op => conv[op.campo]);
  if (!selecionadas.length) return perfil ? '' : '<p class="od-description">Selecione uma operação para cadastrar suas faixas de idade e prazos.</p>';
  return selecionadas.map(op => `
    <section class="subpanel od-operation-ranges" ${perfil ? 'data-conv-perfil' : 'data-conv-operacao'}="${op.prazos}">
      <h3>${op.titulo} — Faixas de idade e prazos</h3>
      <p class="od-description">Condições exclusivas ${perfil ? 'deste perfil' : 'desta operação'} neste convênio.</p>
      <div class="prazo-list">${renderPrazosOperacao(conv, bancoIdx, op)}</div>
      <button type="button" class="small" data-conv-add-prazo="${bancoIdx}:${conv.id}:${op.prazos}">+ Adicionar faixa de idade</button>
    </section>
  `).join('');
}

function renderPrazosOperacao(conv, bancoIdx, op) {
  const list = Array.isArray(conv[op.prazos]) && conv[op.prazos].length ? conv[op.prazos] : [novoPrazo()];
  return list
    .map((prazo, prazoIdx) => {
      const path = `${bancoIdx}:${conv.id}:${op.prazos}:${prazoIdx}`;
      return `
        <div class="prazo-row">
          <input data-conv-prazo="${path}:idade" aria-label="Faixa de idade de ${op.titulo}" placeholder="Idade (ex: 60-75)" value="${esc(prazo.idade ?? '')}"/>
          <input data-conv-prazo="${path}:parcelas" type="number" min="0" max="999" aria-label="Prazo de ${op.titulo}" placeholder="Parcelas" value="${esc(prazo.parcelas ?? '')}"/>
          <input data-conv-prazo="${path}:obs" aria-label="Observações de ${op.titulo}" placeholder="Observações" value="${esc(prazo.obs ?? '')}"/>
          <button type="button" class="icon danger" data-conv-remove-prazo="${path}" aria-label="Remover faixa de idade de ${op.titulo}">&#128465;</button>
        </div>
      `;
    })
    .join('');
}

function handleAddBanco() {
  bancos.push(novoBancoPadrao());
  syncStates();
  salvarStorage(KEY, bancos);
  render();
}

function handleFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result || '[]');
      const arr = prepararBaseOutros(parsed);
      guardarBackup();
      bancos = arr;
      syncStates();
      salvarStorage(KEY, bancos);
      render();
      alert('Arquivo carregado e salvo.');
    } catch {
      alert('JSON inválido. Confira os nomes dos bancos e use um arquivo exportado desta página. Os dados anteriores foram preservados.');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function handleSaveClick() {
  const blob = new Blob([JSON.stringify(bancos, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `base-outros-convenios-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function handleClick(event) {
  const header = event.target.closest('[data-banco-header], [data-convenio-header]');
  if (header && !event.target.closest('button, input, select, textarea, label, a, .card-head-actions, .convenio-head-actions')) {
    header.querySelector('[data-toggle-banco], [data-toggle-convenio]')?.click();
    return;
  }
  const toggleBancoBtn = event.target.closest('[data-toggle-banco]');
  if (toggleBancoBtn) {
    const idx = Number(toggleBancoBtn.dataset.toggleBanco);
    bancoOpenState[idx] = !bancoOpenState[idx];
    render();
    listEl.querySelector(`[data-toggle-banco="${idx}"]`)?.focus({ preventScroll: true });
    return;
  }

  const toggleConvenioBtn = event.target.closest('[data-toggle-convenio]');
  if (toggleConvenioBtn) {
    const [idxStr, convId] = toggleConvenioBtn.dataset.toggleConvenio.split(':');
    const idx = Number(idxStr);
    convenioOpenState[idx] = convenioOpenState[idx] || {};
    convenioOpenState[idx][convId] = !convenioOpenState[idx][convId];
    render();
    listEl.querySelector(`[data-toggle-convenio="${CSS.escape(toggleConvenioBtn.dataset.toggleConvenio)}"]`)?.focus({ preventScroll: true });
    return;
  }

  const removeBancoBtn = event.target.closest('[data-remove-banco]');
  if (removeBancoBtn) {
    const idx = Number(removeBancoBtn.dataset.removeBanco);
    if (Number.isNaN(idx)) return;
    if (confirm('Remover este banco e todos os convênios?')) {
      bancos.splice(idx, 1);
      syncStates();
      salvarStorage(KEY, bancos);
      render();
    }
    return;
  }

  const addLinkBtn = event.target.closest('[data-add-link]');
  if (addLinkBtn) {
    const idx = Number(addLinkBtn.dataset.addLink);
    const banco = bancos[idx];
    if (!banco) return;
    banco.links = Array.isArray(banco.links) && banco.links.length ? banco.links : [''];
    banco.links.push('');
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const removeLinkBtn = event.target.closest('[data-remove-link]');
  if (removeLinkBtn) {
    const [idxStr, linkIdxStr] = removeLinkBtn.dataset.removeLink.split(':');
    const idx = Number(idxStr);
    const linkIdx = Number(linkIdxStr);
    const banco = bancos[idx];
    if (!banco || Number.isNaN(linkIdx)) return;
    banco.links.splice(linkIdx, 1);
    if (!banco.links.length) banco.links.push('');
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const addEmailBtn = event.target.closest('[data-add-email]');
  if (addEmailBtn) {
    const idx = Number(addEmailBtn.dataset.addEmail);
    const banco = bancos[idx];
    if (!banco) return;
    banco.emails = Array.isArray(banco.emails) && banco.emails.length ? banco.emails : [''];
    banco.emails.push('');
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const removeEmailBtn = event.target.closest('[data-remove-email]');
  if (removeEmailBtn) {
    const [idxStr, emailIdxStr] = removeEmailBtn.dataset.removeEmail.split(':');
    const idx = Number(idxStr);
    const emailIdx = Number(emailIdxStr);
    const banco = bancos[idx];
    if (!banco || Number.isNaN(emailIdx)) return;
    banco.emails.splice(emailIdx, 1);
    if (!banco.emails.length) banco.emails.push('');
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const addContatoBtn = event.target.closest('[data-add-contato]');
  if (addContatoBtn) {
    const idx = Number(addContatoBtn.dataset.addContato);
    const banco = bancos[idx];
    if (!banco) return;
    banco.contatos = Array.isArray(banco.contatos) && banco.contatos.length ? banco.contatos : [{ numero: '', obs: '' }];
    banco.contatos.push({ numero: '', obs: '' });
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const removeContatoBtn = event.target.closest('[data-remove-contato]');
  if (removeContatoBtn) {
    const [idxStr, contatoIdxStr] = removeContatoBtn.dataset.removeContato.split(':');
    const idx = Number(idxStr);
    const contatoIdx = Number(contatoIdxStr);
    const banco = bancos[idx];
    if (!banco || Number.isNaN(contatoIdx)) return;
    banco.contatos.splice(contatoIdx, 1);
    if (!banco.contatos.length) banco.contatos.push({ numero: '', obs: '' });
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const addConvenioBtn = event.target.closest('[data-add-convenio]');
  if (addConvenioBtn) {
    const idx = Number(addConvenioBtn.dataset.addConvenio);
    const tipo = addConvenioBtn.dataset.type || 'prefeitura';
    const banco = bancos[idx];
    if (!banco) return;
    banco.convenios = banco.convenios || [];
    const modelo = banco.convenios.find(conv => conv.tipo === TIPO_PADRAO_BANCO);
    const convenio = tipo === TIPO_PADRAO_BANCO && modelo ? modelo : novoConvenioPadrao(tipo, modelo);
    if (!banco.convenios.includes(convenio)) banco.convenios.push(convenio);
    syncStates();
    bancoOpenState[idx] = true;
    convenioFilters[idx] = '';
    convenioOpenState[idx][convenio.id] = true;
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const removeConvenioBtn = event.target.closest('[data-remove-convenio]');
  if (removeConvenioBtn) {
    const [idxStr, convId] = removeConvenioBtn.dataset.removeConvenio.split(':');
    const idx = Number(idxStr);
    const banco = bancos[idx];
    if (!banco) return;
    const convenio = (banco.convenios || []).find(conv => conv.id === convId);
    const mensagem = convenio?.tipo === TIPO_PADRAO_BANCO
      ? 'Remover o Padrão banco? Os convênios já criados continuarão com seus dados, sem alterações.'
      : 'Remover este convênio?';
    if (confirm(mensagem)) {
      banco.convenios = (banco.convenios || []).filter((conv) => conv.id !== convId);
      syncStates();
      salvarStorage(KEY, bancos);
      render();
    }
    return;
  }

  const addPrazoBtn = event.target.closest('[data-conv-add-prazo]');
  if (addPrazoBtn) {
    const [idxStr, convId, operacao] = addPrazoBtn.dataset.convAddPrazo.split(':');
    const meta = resolveConvenio(idxStr, convId);
    if (!meta?.convenio || !FAIXAS_CONVENIO.some(op => op.prazos === operacao)) return;
    meta.convenio[operacao] = meta.convenio[operacao] || [];
    meta.convenio[operacao].push(novoPrazo());
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const removePrazoBtn = event.target.closest('[data-conv-remove-prazo]');
  if (removePrazoBtn) {
    const [idxStr, convId, operacao, prazoIdxStr] = removePrazoBtn.dataset.convRemovePrazo.split(':');
    const meta = resolveConvenio(idxStr, convId);
    if (!meta?.convenio || !FAIXAS_CONVENIO.some(op => op.prazos === operacao)) return;
    const prazoIdx = Number(prazoIdxStr);
    if (!Number.isSafeInteger(prazoIdx) || prazoIdx < 0 || !meta.convenio[operacao]?.[prazoIdx]) return;
    meta.convenio[operacao].splice(prazoIdx, 1);
    if (!meta.convenio[operacao].length) {
      meta.convenio[operacao].push(novoPrazo());
    }
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const toggleOutros = event.target.closest('[data-toggle-outros]');
  if (toggleOutros) {
    const idx = Number(toggleOutros.dataset.toggleOutros);
    const banco = bancos[idx];
    if (!banco) return;
    banco.outrosCollapsed = !banco.outrosCollapsed;
    salvarStorage(KEY, bancos);
    render();
  }
}

function handleInput(event) {
  const el = event.target;
  if (el.matches('[data-bank-field]:not([type=checkbox])')) {
    updateBancoField(el);
    return;
  }
  if (el.matches('[data-conv-field]:not([type=checkbox])')) {
    updateConvenioField(el);
    return;
  }
  if (el.matches('[data-link]')) {
    const [idxStr, linkIdxStr] = (el.dataset.link || '').split(':');
    const idx = Number(idxStr);
    const linkIdx = Number(linkIdxStr);
    const banco = bancos[idx];
    if (!banco || Number.isNaN(linkIdx)) return;
    banco.links = Array.isArray(banco.links) && banco.links.length ? banco.links : [''];
    banco.links[linkIdx] = el.value;
    salvarStorage(KEY, bancos);
    return;
  }

  if (el.matches('[data-email]')) {
    const [idxStr, emailIdxStr] = (el.dataset.email || '').split(':');
    const idx = Number(idxStr);
    const emailIdx = Number(emailIdxStr);
    const banco = bancos[idx];
    if (!banco || Number.isNaN(emailIdx)) return;
    banco.emails = Array.isArray(banco.emails) && banco.emails.length ? banco.emails : [''];
    banco.emails[emailIdx] = el.value;
    salvarStorage(KEY, bancos);
    return;
  }

  if (el.matches('[data-contato]')) {
    const [idxStr, contatoIdxStr, field] = (el.dataset.contato || '').split(':');
    const idx = Number(idxStr);
    const contatoIdx = Number(contatoIdxStr);
    const banco = bancos[idx];
    if (!banco || Number.isNaN(contatoIdx) || !field) return;
    banco.contatos = Array.isArray(banco.contatos) && banco.contatos.length ? banco.contatos : [{ numero: '', obs: '' }];
    banco.contatos[contatoIdx][field] = el.value;
    salvarStorage(KEY, bancos);
    return;
  }

  if (el.matches('[data-convenio-search]')) {
    const idx = Number(el.dataset.convenioSearch);
    const posicao = el.selectionStart;
    convenioFilters[idx] = el.value;
    render();
    const campo = listEl.querySelector(`[data-convenio-search="${idx}"]`);
    campo?.focus({ preventScroll: true });
    if (campo && posicao != null) campo.setSelectionRange(posicao, posicao);
    return;
  }

  if (el.matches('[data-conv-prazo]')) {
    updatePrazo(el);
  }
}

function handleChange(event) {
  const el = event.target;
  if (el.matches('[data-bank-field]')) {
    updateBancoField(el);
    if (el.type === 'checkbox') render();
    return;
  }

  if (el.matches('[data-conv-field]')) {
    updateConvenioField(el);
    // Campos de texto já são salvos durante a digitação. Recriar o formulário
    // ao perder o foco descartaria o clique no próximo botão.
    if (el.type === 'checkbox' || el.tagName === 'SELECT') render();
    return;
  }

  if (el.matches('[data-conv-array]')) {
    updateConvenioArray(el);
    render();
  }
}

function updateBancoField(el) {
  const [idxStr, field] = (el.dataset.bankField || '').split(':');
  const idx = Number(idxStr);
  const banco = bancos[idx];
  if (!banco || !field) return;

  if (field === 'bancosAceitos' || field === 'bancosNaoAceitos') {
    banco[field] = String(el.value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (el.type === 'checkbox') {
    banco[field] = el.checked;
  } else {
    banco[field] = el.value;
  }
  if (field === 'nome') {
    const titulo = el.closest('.banco-outros-card')?.querySelector('.card-head .od-card-copy strong');
    if (titulo) titulo.textContent = banco.nome || 'Novo Banco';
  }

  salvarStorage(KEY, bancos);
}

function updateConvenioField(el) {
  const meta = parseConvPath(el.dataset.convField);
  if (!meta) return;
  const { convenio, field } = meta;
  if (convenio.tipo === TIPO_PADRAO_BANCO && ['tipo', 'nome'].includes(field)) return;
  if (field === 'tipo' && !['prefeitura', 'governo', 'siape'].includes(el.value)) return;
  if (el.type === 'checkbox') {
    convenio[field] = el.checked;
  } else {
    convenio[field] = el.value;
  }
  if (field === 'nome') {
    const titulo = el.closest('.convenio-card')?.querySelector('.convenio-head .od-card-copy strong');
    if (titulo) titulo.textContent = convenio.nome || 'Convênio sem nome';
  }
  salvarStorage(KEY, bancos);
}

function updateConvenioArray(el) {
  const meta = parseConvArrayPath(el.dataset.convArray);
  if (!meta) return;
  const { convenio, field } = meta;
  const value = el.dataset.value;
  if (!value) return;
  convenio[field] = Array.isArray(convenio[field]) ? convenio[field] : [];
  if (el.checked) {
    if (!convenio[field].includes(value)) convenio[field].push(value);
  } else {
    convenio[field] = convenio[field].filter((item) => item !== value);
  }
  salvarStorage(KEY, bancos);
}

function updatePrazo(el) {
  const attr = el.dataset.convPrazo;
  if (!attr) return;
  const [idxStr, convId, operacao, prazoIdxStr, field] = attr.split(':');
  const meta = resolveConvenio(idxStr, convId);
  if (!meta?.convenio || !FAIXAS_CONVENIO.some(op => op.prazos === operacao) ||
      !['idade', 'parcelas', 'obs'].includes(field)) return;
  const prazoIdx = Number(prazoIdxStr);
  if (!Number.isSafeInteger(prazoIdx) || prazoIdx < 0) return;
  const target = meta.convenio[operacao]?.[prazoIdx];
  if (!target) return;

  target[field] = el.value;
  if (field === 'idade') {
    const range = parseRange(el.value);
    if (range) {
      target.min = range.min;
      target.max = range.max;
    } else {
      delete target.min;
      delete target.max;
    }
  }
  salvarStorage(KEY, bancos);
}

function parseConvPath(attr) {
  if (!attr) return null;
  const [idxStr, convId, field] = attr.split(':');
  const resolved = resolveConvenio(idxStr, convId);
  if (!resolved || !field) return null;
  return { ...resolved, field };
}

function parseConvArrayPath(attr) {
  if (!attr) return null;
  const [idxStr, convId, field] = attr.split(':');
  const resolved = resolveConvenio(idxStr, convId);
  if (!resolved || !field) return null;
  return { ...resolved, field };
}

function resolveConvenio(idxStr, convId) {
  const idx = Number(idxStr);
  if (Number.isNaN(idx) || !convId) return null;
  const banco = bancos[idx];
  if (!banco) return null;
  const convenio = (banco.convenios || []).find((item) => item.id === convId);
  if (!convenio) return null;
  return { banco, convenio, idx };
}

function informar(mensagem) {
  if (statusEl?.isConnected) statusEl.textContent = mensagem;
}

function bloquearEnvio(bloquear) {
  [uploadBaseBtn, uploadJsonBtn, reloadBtn].forEach(btn => { if (btn?.isConnected) btn.disabled = bloquear; });
}

function ultimaLeitura() {
  try {
    const dados = JSON.parse(localStorage.getItem(ULTIMA_LEITURA) || '[]');
    return Array.isArray(dados) ? dados.map(normalize) : [];
  } catch { return []; }
}

function guardarBackup() {
  // Backup deve existir antes de qualquer substituição dos dados deste navegador.
  localStorage.setItem(BACKUP, JSON.stringify({ data: new Date().toISOString(), bancos }));
}

async function uploadBaseOutros(file) {
  if (publicando) return;
  const listaAlvo = listEl;
  const estadoInicial = JSON.stringify(bancos);
  try {
    const json = file ? JSON.parse(await file.text()) : JSON.parse(estadoInicial);
    if (publicando) return;
    const preparados = prepararBaseOutros(json);
    if (!confirm('Enviar ' + preparados.length + ' banco(s) para base_outros_convenios? Os bancos enviados serão atualizados; bancos ausentes não serão excluídos.')) return;
    publicando = true;
    consultaAtual++; // Uma leitura antiga não pode sobrescrever este envio.
    bloquearEnvio(true);
    guardarBackup();
    informar('Enviando para base_outros_convenios…');
    const confirmados = await enviarBaseOutros(preparados);
    const publicada = mesclarBaseOutros(ultimaLeitura(), confirmados, [], true).bancos;
    localStorage.setItem(ULTIMA_LEITURA, JSON.stringify(publicada));
    if (listaAlvo !== listEl || !listaAlvo?.isConnected) return;
    const editouDuranteEnvio = JSON.stringify(bancos) !== estadoInicial;
    if (!editouDuranteEnvio) {
      bancos = mesclarBaseOutros(bancos, confirmados, [], true).bancos;
      salvarStorage(KEY, bancos);
      syncStates();
      render();
    }
    const mensagem = confirmados.length + ' banco(s) com envio confirmado em base_outros_convenios.' +
      (editouDuranteEnvio ? ' As alterações feitas durante o envio continuam locais; envie novamente para publicá-las.' : '');
    informar(mensagem);
    alert(mensagem);
  } catch (err) {
    console.error('Erro no envio da Base Outros Convênios:', err);
    if (listaAlvo !== listEl || !listaAlvo?.isConnected) return;
    const mensagem = 'Não foi possível confirmar o envio. ' + mensagemErroOutros(err) +
      ' Os dados locais foram preservados. Esta operação não exclui bancos remotos.';
    informar(mensagem);
    alert(mensagem);
  } finally {
    publicando = false;
    bloquearEnvio(false);
  }
}

async function carregarBaseOutrosRemota() {
  if (publicando) return;
  const consulta = ++consultaAtual;
  const listaAlvo = listEl;
  const estadoInicial = JSON.stringify(bancos);
  bloquearEnvio(true);
  informar('Consultando base_outros_convenios no Supabase…');
  try {
    const remotos = await carregarBaseOutros();
    if (consulta !== consultaAtual || listaAlvo !== listEl || !listaAlvo?.isConnected) return;
    if (JSON.stringify(bancos) !== estadoInicial) {
      informar('Leitura concluída. A edição iniciada durante a consulta foi preservada. Use Atualizar do Supabase quando terminar.');
      return;
    }
    if (!remotos.length) {
      informar('O Supabase não retornou bancos. Os dados deste navegador foram mantidos; envie a edição para publicá-los.');
      return;
    }
    const resultado = mesclarBaseOutros(bancos, remotos, ultimaLeitura());
    guardarBackup();
    salvarStorage(KEY, resultado.bancos);
    localStorage.setItem(ULTIMA_LEITURA, JSON.stringify(remotos));
    bancos = resultado.bancos;
    syncStates();
    render();
    informar(remotos.length + ' banco(s) lidos de base_outros_convenios.' +
      (resultado.preservados ? ' Rascunhos locais diferentes foram preservados; enviar a edição publica esses rascunhos.' : ' Edições só serão publicadas ao enviar.'));
  } catch (err) {
    console.error('Erro na leitura da Base Outros Convênios:', err);
    if (consulta === consultaAtual && listaAlvo === listEl && listaAlvo?.isConnected) {
      informar('Não foi possível carregar o Supabase. ' + mensagemErroOutros(err) + ' Os dados deste navegador foram mantidos.');
    }
  } finally {
    if (consulta === consultaAtual && listaAlvo === listEl && !publicando) bloquearEnvio(false);
  }
}

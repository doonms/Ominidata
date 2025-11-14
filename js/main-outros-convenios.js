import { KEY, esc, normalize, lerStorage, salvarStorage, novoBancoPadrao, novoConvenioPadrao, parseRange } from './components/utilBaseOutros.js';
import { supabase } from './supa/supabaseClient.js';

let listEl;
let addBtn;
let fileInput;
let saveBtn;
let uploadBaseBtn;
let uploadBaseFile;

const rawBancos = lerStorage(KEY).filter((item) => item && typeof item === 'object');
let bancos = rawBancos.map((banco) => normalize(banco));
let bancoOpenState = {};
let convenioOpenState = {};
let convenioFilters = {};

const novoPrazo = () => ({ idade: '', parcelas: '', obs: '' });

export function initBase() {
  captureElements();
  bindStaticHandlers();
  syncStates();
  render();
}

function captureElements() {
  listEl = document.getElementById('list');
  addBtn = document.getElementById('add');
  fileInput = document.getElementById('file');
  saveBtn = document.getElementById('save');
  uploadBaseBtn = document.getElementById('uploadBaseOutrosBtn');
  uploadBaseFile = document.getElementById('uploadBaseOutrosFile');
}

function bindStaticHandlers() {
  if (addBtn) addBtn.onclick = handleAddBanco;
  if (fileInput) fileInput.onchange = handleFileChange;
  if (saveBtn) saveBtn.onclick = handleSaveClick;
  if (uploadBaseBtn && uploadBaseFile) {
    uploadBaseBtn.onclick = () => uploadBaseFile.click();
    uploadBaseFile.onchange = async (e) => {
      const selected = e.target.files?.[0];
      if (!selected) return;
      await uploadBaseOutros(selected);
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
  const convenios = Array.isArray(banco.convenios) ? banco.convenios : [];
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
    <div class="card-head">
      <div>
        <strong style="font-size:15px;color:#dff3ff">${esc(banco.nome || 'Novo Banco')}</strong>
      </div>
      <div class="card-head-actions">
        <label class="inline-checkbox">
          <input type="checkbox" data-bank-field="${idx}:suspenso" ${banco.suspenso ? 'checked' : ''}/>
          Banco suspenso
        </label>
        <button type="button" class="small" data-toggle-banco="${idx}">${isOpen ? 'Fechar' : 'Abrir'}</button>
        <button type="button" class="btn-danger" data-remove-banco="${idx}">&#128465;</button>
      </div>
    </div>
    <div class="card-body" style="display:${isOpen ? 'block' : 'none'}">
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
            <button type="button" class="small" data-add-convenio="${idx}" data-type="prefeitura">+ Prefeitura</button>
            <button type="button" class="small" data-add-convenio="${idx}" data-type="governo">+ Governo</button>
            <button type="button" class="small" data-add-convenio="${idx}" data-type="siape">+ SIAPE</button>
          </div>
        </div>
      </div>

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
  const showRogo = conv.aceitaClienteNaoAssina;
  const showContrato60 = conv.contrato60;
  const showNaoAssina = conv.aceitaClienteNaoAssina;

  return `
    <div class="convenio-card" data-convenio="${conv.id}">
      <div class="convenio-head">
        <div>
          <span class="convenio-tag">${tipoLabel}</span>
          <strong>${esc(conv.nome || 'Convênio sem nome')}</strong>
        </div>
        <div class="convenio-head-actions">
          <button type="button" class="small" data-toggle-convenio="${baseKey}">${isOpen ? 'Fechar' : 'Abrir'}</button>
          <button type="button" class="btn-danger" data-remove-convenio="${baseKey}">&#128465;</button>
        </div>
      </div>

      <div class="convenio-body" style="display:${isOpen ? 'block' : 'none'}">
        <div class="row">
          <div class="col">
            <label>Tipo</label>
            <select data-conv-field="${baseKey}:tipo">
              ${renderTipoOption('prefeitura', conv.tipo)}
              ${renderTipoOption('governo', conv.tipo)}
              ${renderTipoOption('siape', conv.tipo)}
            </select>
          </div>
          <div class="col">
            <label>Nome do convênio</label>
            <input data-conv-field="${baseKey}:nome" value="${esc(conv.nome || '')}" placeholder="Ex: Prefeitura de Belo Horizonte"/>
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

        <div class="subpanel">
          <h3>Perfis aceitos</h3>
          <div class="checkbox-grid">
            ${checkbox('Cliente não assinante', `${baseKey}:aceitaClienteNaoAssina`, conv.aceitaClienteNaoAssina)}
            ${checkbox('Cliente LOAS', `${baseKey}:aceitaLoas`, conv.aceitaLoas)}
            ${checkbox('Cliente Invalidez', `${baseKey}:aceitaInvalidez`, conv.aceitaInvalidez)}
            ${checkbox('Cliente Pensão', `${baseKey}:aceitaClientePensao`, conv.aceitaClientePensao)}
          </div>
          <div class="rogo-wrap" style="display:${showRogo ? 'block' : 'none'}">
            <label>Tipos de rogo aceitos</label>
            <div class="checkbox-grid">
              ${rogoCheckbox(baseKey, conv, 'pai', 'Pai')}
              ${rogoCheckbox(baseKey, conv, 'mae', 'Mãe')}
              ${rogoCheckbox(baseKey, conv, 'irmao', 'Irmão')}
              ${rogoCheckbox(baseKey, conv, 'conjuge', 'Cônjuge')}
              ${rogoCheckbox(baseKey, conv, 'filhos', 'Filhos')}
              ${rogoCheckbox(baseKey, conv, 'netos', 'Netos')}
              ${rogoCheckbox(baseKey, conv, 'avos', 'Avós')}
            </div>
            <input data-conv-field="${baseKey}:rogoOutros" value="${esc(conv.rogoOutros || '')}" placeholder="Outros tipos de rogo"/>
          </div>
        </div>

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
          <h3>Geral — Prazos por idade (Cartão)</h3>
          <div class="prazo-list">
            ${renderPrazosCartao(conv, bancoIdx)}
          </div>
          <button type="button" class="small" data-conv-add-prazo="${baseKey}">+ Adicionar prazo</button>
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
  const map = { prefeitura: 'Prefeitura', governo: 'Governo', siape: 'SIAPE' };
  return map[tipo] || 'Convênio';
}

function checkbox(label, dataKey, checked) {
  return `<label><input type="checkbox" data-conv-field="${dataKey}" ${checked ? 'checked' : ''}/> ${label}</label>`;
}

function rogoCheckbox(baseKey, conv, value, label) {
  const checked = (conv.rogo || []).includes(value);
  return `<label><input type="checkbox" data-conv-array="${baseKey}:rogo" data-value="${value}" ${checked ? 'checked' : ''}/> ${label}</label>`;
}

function documentoCheckbox(baseKey, conv, value, label) {
  const checked = (conv.documentos || []).includes(value);
  return `<label><input type="checkbox" data-conv-array="${baseKey}:documentos" data-value="${value}" ${checked ? 'checked' : ''}/> ${label}</label>`;
}

function conditionalTextarea(show, dataKey, value, placeholder) {
  if (!show) return '';
  return `<textarea class="small-row-text" data-conv-field="${dataKey}" rows="1" placeholder="${placeholder}">${esc(value || '')}</textarea>`;
}

function renderPrazosCartao(conv, bancoIdx) {
  const list = Array.isArray(conv.prazosCartao) && conv.prazosCartao.length ? conv.prazosCartao : [novoPrazo()];
  return list
    .map((prazo, prazoIdx) => {
      const path = `${bancoIdx}:${conv.id}:${prazoIdx}`;
      return `
        <div class="prazo-row">
          <input data-conv-prazo="${path}:idade" placeholder="Idade (ex: 60-75)" value="${esc(prazo.idade || '')}"/>
          <input data-conv-prazo="${path}:parcelas" type="number" min="0" max="999" placeholder="Parcelas" value="${esc(prazo.parcelas || '')}"/>
          <input data-conv-prazo="${path}:obs" placeholder="Observações" value="${esc(prazo.obs || '')}"/>
          <button type="button" class="icon danger" data-conv-remove-prazo="${path}">&#128465;</button>
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
      const arr = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
      bancos = arr.map((item) => normalize(item));
      syncStates();
      salvarStorage(KEY, bancos);
      render();
      alert('Arquivo carregado e salvo.');
    } catch {
      alert('JSON inválido.');
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
  const toggleBancoBtn = event.target.closest('[data-toggle-banco]');
  if (toggleBancoBtn) {
    const idx = Number(toggleBancoBtn.dataset.toggleBanco);
    bancoOpenState[idx] = !bancoOpenState[idx];
    render();
    return;
  }

  const toggleConvenioBtn = event.target.closest('[data-toggle-convenio]');
  if (toggleConvenioBtn) {
    const [idxStr, convId] = toggleConvenioBtn.dataset.toggleConvenio.split(':');
    const idx = Number(idxStr);
    convenioOpenState[idx] = convenioOpenState[idx] || {};
    convenioOpenState[idx][convId] = !convenioOpenState[idx][convId];
    render();
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
    banco.convenios.push(novoConvenioPadrao(tipo));
    syncStates();
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
    if (confirm('Remover este convênio?')) {
      banco.convenios = (banco.convenios || []).filter((conv) => conv.id !== convId);
      syncStates();
      salvarStorage(KEY, bancos);
      render();
    }
    return;
  }

  const addPrazoBtn = event.target.closest('[data-conv-add-prazo]');
  if (addPrazoBtn) {
    const [idxStr, convId] = addPrazoBtn.dataset.convAddPrazo.split(':');
    const meta = resolveConvenio(idxStr, convId);
    if (!meta?.convenio) return;
    meta.convenio.prazosCartao = meta.convenio.prazosCartao || [];
    meta.convenio.prazosCartao.push(novoPrazo());
    salvarStorage(KEY, bancos);
    render();
    return;
  }

  const removePrazoBtn = event.target.closest('[data-conv-remove-prazo]');
  if (removePrazoBtn) {
    const [idxStr, convId, prazoIdxStr] = removePrazoBtn.dataset.convRemovePrazo.split(':');
    const meta = resolveConvenio(idxStr, convId);
    if (!meta?.convenio) return;
    const prazoIdx = Number(prazoIdxStr);
    if (Number.isNaN(prazoIdx)) return;
    meta.convenio.prazosCartao.splice(prazoIdx, 1);
    if (!meta.convenio.prazosCartao.length) {
      meta.convenio.prazosCartao.push(novoPrazo());
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
    convenioFilters[idx] = el.value;
    render();
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
    render();
    return;
  }

  if (el.matches('[data-conv-field]')) {
    updateConvenioField(el);
    render();
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

  salvarStorage(KEY, bancos);
}

function updateConvenioField(el) {
  const meta = parseConvPath(el.dataset.convField);
  if (!meta) return;
  const { convenio, field } = meta;
  if (el.type === 'checkbox') {
    convenio[field] = el.checked;
  } else {
    convenio[field] = el.value;
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
  const [idxStr, convId, prazoIdxStr, field] = attr.split(':');
  const meta = resolveConvenio(idxStr, convId);
  if (!meta?.convenio) return;
  const prazoIdx = Number(prazoIdxStr);
  if (Number.isNaN(prazoIdx)) return;
  meta.convenio.prazosCartao = meta.convenio.prazosCartao || [];
  const target = meta.convenio.prazosCartao[prazoIdx];
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

async function uploadBaseOutros(file) {
  try {
    if (!file) {
      alert('Selecione um arquivo JSON para enviar.');
      return;
    }

    const text = await file.text();
    const json = JSON.parse(text);
    const registros = Object.entries(json || {}).map(([nomeBanco, dadosBanco]) => ({
      banco_id: gerarBancoId(nomeBanco),
      nome: nomeBanco,
      suspenso: dadosBanco?.status_suspenso ?? false,
      dados: dadosBanco
    }));

    if (!registros.length) {
      alert('Arquivo vazio ou inválido.');
      return;
    }

    await supabase.from('base_outros_convenios').delete().neq('banco_id', '');
    const { error } = await supabase.from('base_outros_convenios').upsert(registros, { onConflict: 'banco_id' });
    if (error) throw error;

    alert('✅ Base Outros Convênios enviada com sucesso!');
    await carregarBaseOutrosRemota();
  } catch (err) {
    console.error('Erro ao enviar base Outros Convenios:', err);
    alert('❌ Erro ao enviar base Outros Convenios.');
  }
}

async function carregarBaseOutrosRemota() {
  try {
    const { data, error } = await supabase.from('base_outros_convenios').select('*').order('nome', { ascending: true });
    if (error) {
      console.error('Erro ao carregar base Outros Convenios do Supabase:', error);
      return;
    }

    const lista = (data || []).map((row) => {
      const dados = row?.dados && typeof row.dados === 'object' ? row.dados : {};
      return normalize({
        ...dados,
        nome: dados.nome ?? row?.nome ?? '',
        status_suspenso: dados.status_suspenso ?? row?.suspenso ?? false
      });
    });

    bancos = lista;
    syncStates();
    salvarStorage(KEY, bancos);
    render();
  } catch (err) {
    console.error('Erro inesperado ao carregar base Outros Convenios do Supabase:', err);
  }
}

function gerarBancoId(nome) {
  if (!nome) return '';
  const primeira = nome.toString().trim().split(/\s+/)[0];
  const normalizado = primeira
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
  return normalizado.length <= 3 ? normalizado : normalizado.slice(0, 3);
}

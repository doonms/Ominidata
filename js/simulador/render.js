// ===============================
// 🎨 RENDER.JS — Base de Fatores
// ===============================
import { state, currentBank, setActiveBank, setCategoria, ensureDataIntegrity, saveDB } from './state-admin.js';
import { renderSegurosForTab } from './base-fatores-seguros.js';

// === ELEMENTOS ===
const elTabs = () => document.querySelector('#dbBankTabs');
const elNome = () => document.querySelector('#dbNome');
const elFazCartao = () => document.querySelector('#dbFazCartao');
const elFatores = () => document.querySelector('#dbFatores');
const elSeguros = () => document.querySelector('#dbSeguros');

// === 🧱 RENDERIZAÇÃO PRINCIPAL ===
export function renderAll() {
  renderTabs();
  renderEditor();
  renderList();
}

// === 🏦 ABA DE BANCOS ===
export function renderTabs() {
  const cont = elTabs();
  if (!cont) return;

  cont.innerHTML = '';

  state.bancos.forEach((b, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (idx === state.activeBankIdx ? ' active' : '');
    btn.textContent = b.nome || `Banco ${idx + 1}`;
    btn.addEventListener('click', () => {
      setActiveBank(idx);
      renderAll();
    });
    cont.appendChild(btn);
  });
}

// === 🧩 EDITOR DE BANCO ===
function renderEditor() {
  const b = currentBank();
  if (!b) return;

  ensureDataIntegrity(b);
  elNome().value = b.nome || '';
  elFazCartao().checked = !!b.fazCartao;

  renderCategoriaBotoes();
  renderFatores();
  renderSegurosForTab(b, state.activeCategoria);
}

// === 📑 BOTÕES DE CATEGORIAS (INSS / SIAPE / GOVERNO / PREFEITURA) ===
function renderCategoriaBotoes() {
  const wrap = document.querySelector('#dbFatores');
  if (!wrap) return;

  const area = document.createElement('div');
  area.className = 'section-title';
  area.style.marginBottom = '8px';

  const botoes = ['inss', 'siape', 'governo', 'prefeitura'];
  area.innerHTML = `
    <strong>Categorias</strong>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
      ${botoes
        .map(
          cat => `
        <button class="small ${state.activeCategoria === cat ? 'active' : ''}" data-cat="${cat}">
          ${cat.toUpperCase()}
        </button>`
        )
        .join('')}
    </div>
  `;

  wrap.innerHTML = '';
  wrap.appendChild(area);

  wrap.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      setCategoria(btn.dataset.cat);
      renderAll();
    });
  });
}

// === ⚙️ FATORES DA CATEGORIA ATUAL ===
function renderFatores() {
  const b = currentBank();
  const cat = state.activeCategoria;
  if (!b || !cat) return;

  const cont = elFatores();
  cont.innerHTML = '';

  const lista = b.fatores?.[cat] || [];
  const table = document.createElement('table');
  table.className = 'table small';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Prazo</th>
        <th>Fator</th>
        <th>Convênio</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${lista
        .map(
          (f, i) => `
        <tr>
          <td><input data-prazo="${i}" value="${f.prazo ?? ''}" /></td>
          <td><input data-fator="${i}" value="${f.fator ?? ''}" /></td>
          <td><input data-convenio="${i}" value="${f.convenio ?? ''}" /></td>
          <td><button class="small ghost" data-del="${i}">🗑</button></td>
        </tr>`
        )
        .join('')}
    </tbody>
  `;

  const btnAdd = document.createElement('button');
  btnAdd.className = 'small';
  btnAdd.textContent = '+ Adicionar fator';
  btnAdd.addEventListener('click', () => {
    b.fatores[cat].push({ prazo: '', fator: '', convenio: '' });
    saveDB();
    renderAll();
  });

  cont.appendChild(table);
  cont.appendChild(btnAdd);

  cont.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.del, 10);
      b.fatores[cat].splice(idx, 1);
      saveDB();
      renderAll();
    });
  });

  cont.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const { prazo, fator, convenio } = e.target.dataset;
      const i = prazo ?? fator ?? convenio;
      if (!isNaN(i)) {
        b.fatores[cat][i][e.target.dataset.prazo ? 'prazo' : e.target.dataset.fator ? 'fator' : 'convenio'] =
          e.target.value;
        saveDB();
      }
    });
  });
}

// === 📋 LISTA DE BANCOS CADASTRADOS ===
function renderList() {
  const tbody = document.querySelector('#tbl tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  state.bancos.forEach((b, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${b.nome || '-'}</td>
      <td>${b.fazCartao ? 'Sim' : 'Não'}</td>
      <td>${Object.values(b.fatores).reduce((a, c) => a + c.length, 0)}</td>
      <td>${b.seguros?.length || 0}</td>
      <td>
        <button class="small" data-edit="${idx}">✏️</button>
        <button class="small ghost" data-del="${idx}">🗑</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveBank(parseInt(btn.dataset.edit, 10));
      renderAll();
    });
  });

  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.del, 10);
      if (confirm('Remover este banco?')) {
        state.bancos.splice(idx, 1);
        saveDB();
        renderAll();
      }
    });
  });
}

// ===============================
// 🎛️ HANDLERS.JS — Base de Fatores
// ===============================
import {
  state,
  newBank,
  addBank,
  currentBank,
  saveDB,
  exportarBase,
  importarBase,
  ensureDataIntegrity,
} from './state-admin.js';
import { renderAll } from './render.js';

// === 🧩 EVENTOS GLOBAIS ===
export function bindTopEvents() {
  const btnNovo = document.querySelector('#dbNovo');
  const btnSalvar = document.querySelector('#dbSalvar');
  const btnExport = document.querySelector('#btnExport');
  const btnImport = document.querySelector('#btnImport');
  const fileImport = document.querySelector('#fileImport');

  if (btnNovo) btnNovo.addEventListener('click', onNovoBanco);
  if (btnSalvar) btnSalvar.addEventListener('click', onSalvarBanco);
  if (btnExport) btnExport.addEventListener('click', onExportar);
  if (btnImport && fileImport) {
    btnImport.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', e => {
      if (e.target.files.length) importarBase(e.target.files[0], renderAll);
    });
  }
}

// === 🖱️ DELEGAÇÕES ===
export function bindDelegations() {
  const nome = document.querySelector('#dbNome');
  const fazCartao = document.querySelector('#dbFazCartao');

  if (nome) {
    nome.addEventListener('input', () => {
      const b = currentBank();
      if (!b) return;
      b.nome = nome.value.trim();
      saveDB();
      renderAll();
    });
  }

  if (fazCartao) {
    fazCartao.addEventListener('change', () => {
      const b = currentBank();
      if (!b) return;
      b.fazCartao = fazCartao.checked;
      saveDB();
      renderAll();
    });
  }
}

// === 🆕 NOVO BANCO ===
function onNovoBanco() {
  const novo = ensureDataIntegrity(newBank());
  addBank(novo);
  state.activeBankIdx = state.bancos.length - 1;
  renderAll();
}

// === 💾 SALVAR BANCO ===
function onSalvarBanco() {
  const b = currentBank();
  if (!b) return alert('Nenhum banco selecionado.');
  ensureDataIntegrity(b);
  saveDB();
  alert('Banco salvo com sucesso!');
  renderAll();
}

// === 📤 EXPORTAR BASE ===
function onExportar() {
  exportarBase();
}

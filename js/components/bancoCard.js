import { getAbaGeralHTML } from './tabs/abaGeral.js';
import { getAbaInvalidezHTML } from './tabs/abaInvalidez.js';
import { getAbaLoasHTML } from './tabs/abaLoas.js';
import { getAbaPensaoHTML } from './tabs/abaPensao.js';
import { esc } from './util.js';
import { VELOCIDADES_BANCO, normalizarVelocidadeBanco } from '../utils/velocidade-banco.js';

export function criarBancoCard(banco, idx, active='geral'){
  const invalTab = banco.aceitaInvalidez ? `<button class="tabbtn ${active==='invalidez'?'active':''}" data-tab="${idx}:invalidez">Invalidez</button>` : '';
  const loasTab   = banco.aceitaLoas ? `<button class="tabbtn ${active==='loas'?'active':''}" data-tab="${idx}:loas">LOAS</button>` : '';
  const pensaoTab = banco.aceitaClientePensao ? `<button class="tabbtn ${active==='pensao'?'active':''}" data-tab="${idx}:pensao">Pensão</button>` : '';

  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.idx = idx;

  card.innerHTML = `
    <div class="card-head">
      <div><strong style="font-size:15px;color:#dff3ff">${esc(banco.nome||'Novo Banco')}</strong></div>
      <div style="display:flex;gap:8px">
        <button class="small" data-open="${idx}">Abrir</button>
        <button class="btn-danger" data-rem="${idx}">🗑️</button>
      </div>
    </div>

    <div class="card-body">
      <div class="row inss-bank-identity">
        <div class="col">
          <label for="inss-bank-name-${idx}">Nome do banco</label>
          <input id="inss-bank-name-${idx}" data-put="${idx}:nome" value="${esc(banco.nome||'')}" />
        </div>
        <div class="col inss-bank-speed-field">
          <label for="inss-bank-speed-${idx}">Velocidade do banco</label>
          <select id="inss-bank-speed-${idx}" data-put="${idx}:velocidadePagamento" aria-describedby="inss-bank-speed-help-${idx}">
            <option value="">Não informado</option>
            ${Object.entries(VELOCIDADES_BANCO).map(([codigo, info]) => `<option value="${codigo}" ${normalizarVelocidadeBanco(banco.velocidadePagamento) === codigo ? 'selected' : ''}>${info.nome}${codigo === 'manual' ? ' (processo mais lento)' : ''}</option>`).join('')}
          </select>
          <small id="inss-bank-speed-help-${idx}" class="muted">Exibida no simulador como símbolo e cor. Não representa garantia de prazo.</small>
        </div>
      </div>

      <div class="tabs">
        <button class="tabbtn ${active==='geral'?'active':''}" data-tab="${idx}:geral">Geral</button>
        ${invalTab}
        ${loasTab}
        ${pensaoTab}
      </div>

      ${getAbaGeralHTML(banco, idx, active==='geral')}
      ${getAbaInvalidezHTML(banco, idx, active==='invalidez')}
      ${getAbaLoasHTML(banco, idx, active==='loas')}
      ${getAbaPensaoHTML(banco, idx, active==='pensao')}
    </div>
  `;
  return card;
}

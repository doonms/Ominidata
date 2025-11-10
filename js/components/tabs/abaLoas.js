// js/abaLoas.js
export function getAbaLoasHTML(b, idx, show) {
  return `
  <div data-panel="${idx}:loas" style="display:${show ? 'block' : 'none'}">
    <div class="checkbox-grid">
      <label><input type="checkbox" data-put="${idx}:loasFazMargem" ${b.loasFazMargem ? 'checked' : ''}/> faz margem loas?</label>
      <label><input type="checkbox" data-put="${idx}:loasFazCartao" ${b.loasFazCartao ? 'checked' : ''}/> faz cartão loas?</label>
      <label><input type="checkbox" data-put="${idx}:loasFazRefin" ${b.loasFazRefin ? 'checked' : ''}/> faz refin loas?</label>
      <label><input type="checkbox" data-put="${idx}:loasFazPortabilidade" ${b.loasFazPortabilidade ? 'checked' : ''}/> faz portabilidade loas?</label>
      <label><input type="checkbox" data-put="${idx}:loasAceitaNaoAssina" ${b.loasAceitaNaoAssina ? 'checked' : ''}/> aceita loas não assinante?</label>
    </div>

    ${
      b.loasFazCartao
        ? `
        <div class="subpanel" style="margin-top:8px;">
          <h3>Tipo de cartão LOAS</h3>
          <div class="checkbox-grid">
            <label><input type="checkbox" data-put="${idx}:loasRMC" ${b.loasRMC ? 'checked' : ''}/> RMC</label>
            <label><input type="checkbox" data-put="${idx}:loasRCC" ${b.loasRCC ? 'checked' : ''}/> RCC</label>
          </div>
        </div>
      `
        : ''
    }

    <div class="loas-wrap">
      <div class="loas-col">
        <h4>LOAS 87</h4>
        ${
          b.loasFazMargem
            ? `<div><label>LOAS 87 — Margem</label><div class="prazo-line" data-loas87="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-loas87="${idx}">+ Adicionar LOAS 87</button></div></div>`
            : ''
        }
        ${
          b.loasFazCartao
            ? `<div style="margin-top:8px"><label>LOAS 87 — Cartão</label><div class="prazo-line" data-loas87-cartao="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-loas87-cartao="${idx}">+ Adicionar (Cartão)</button></div></div>`
            : ''
        }
        ${
          b.loasFazRefin
            ? `<div style="margin-top:8px"><label>LOAS 87 — Refin</label><div class="prazo-line" data-loas87-refin="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-loas87-refin="${idx}">+ Adicionar (Refin)</button></div></div>`
            : ''
        }
        ${
          b.loasFazPortabilidade
            ? `<div style="margin-top:8px"><label>LOAS 87 — Portabilidade</label><div class="prazo-line" data-loas87-port="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-loas87-port="${idx}">+ Adicionar (Port)</button></div></div>`
            : ''
        }
      </div>

      <div class="loas-col">
        <h4>LOAS 88</h4>
        ${
          b.loasFazMargem
            ? `<div><label>LOAS 88 — Margem</label><div class="prazo-line" data-loas88="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-loas88="${idx}">+ Adicionar LOAS 88</button></div></div>`
            : ''
        }
        ${
          b.loasFazCartao
            ? `<div style="margin-top:8px"><label>LOAS 88 — Cartão</label><div class="prazo-line" data-loas88-cartao="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-loas88-cartao="${idx}">+ Adicionar (Cartão)</button></div></div>`
            : ''
        }
        ${
          b.loasFazRefin
            ? `<div style="margin-top:8px"><label>LOAS 88 — Refin</label><div class="prazo-line" data-loas88-refin="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-loas88-refin="${idx}">+ Adicionar (Refin)</button></div></div>`
            : ''
        }
        ${
          b.loasFazPortabilidade
            ? `<div style="margin-top:8px"><label>LOAS 88 — Portabilidade</label><div class="prazo-line" data-loas88-port="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-loas88-port="${idx}">+ Adicionar (Port)</button></div></div>`
            : ''
        }
      </div>
    </div>
  </div>
  `;
}

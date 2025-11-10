export function getAbaInvalidezHTML(b, idx, show){
  return `
  <div data-panel="${idx}:invalidez" style="display:${show?'block':'none'}">
    <div class="checkbox-grid" style="margin-bottom:8px">
      <label><input type="checkbox" data-put="${idx}:invalidezFazMargem" ${b.invalidezFazMargem?'checked':''}/> Invalidez — Margem</label>
      <label><input type="checkbox" data-put="${idx}:invalidezFazCartao" ${b.invalidezFazCartao?'checked':''}/> Invalidez — Cartão</label>
      <label><input type="checkbox" data-put="${idx}:invalidezFazRefin" ${b.invalidezFazRefin?'checked':''}/> Invalidez — Refin</label>
      <label><input type="checkbox" data-put="${idx}:invalidezFazPortabilidade" ${b.invalidezFazPortabilidade?'checked':''}/> Invalidez — Portabilidade</label>
    </div>

    ${ b.invalidezFazMargem ? `<div style="margin-top:8px"><label>Invalidez — Prazos por idade (Margem)</label><div class="prazo-line" data-invalidez="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-invalidez="${idx}">+ Adicionar prazo</button></div></div>` : '' }
    ${ b.invalidezFazCartao ? `<div style="margin-top:12px"><label>Invalidez — Prazos por idade (Cartão)</label><div class="prazo-line" data-invalidez-cartao="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-invalidez-cartao="${idx}">+ Adicionar prazo (Cartão)</button></div></div>` : '' }
    ${ b.invalidezFazRefin ? `<div style="margin-top:12px"><label>Invalidez — Prazos por idade (Refin)</label><div class="prazo-line" data-invalidez-refin="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-invalidez-refin="${idx}">+ Adicionar prazo (Refin)</button></div></div>` : '' }
    ${ b.invalidezFazPortabilidade ? `<div style="margin-top:12px"><label>Invalidez — Prazos por idade (Portabilidade)</label><div class="prazo-line" data-invalidez-port="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-invalidez-port="${idx}">+ Adicionar prazo (Port)</button></div></div>` : '' }
  </div>
  `;
}

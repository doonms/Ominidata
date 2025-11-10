export function getAbaPensaoHTML(b, idx, show){
  return `
  <div data-panel="${idx}:pensao" style="display:${show?'block':'none'}">
    <div class="checkbox-grid" style="margin-bottom:8px">
      <label><input type="checkbox" data-put="${idx}:pensaoFazMargem" ${b.pensaoFazMargem?'checked':''}/> faz margem (pensão)?</label>
      <label><input type="checkbox" data-put="${idx}:pensaoFazCartao" ${b.pensaoFazCartao?'checked':''}/> faz cartão (pensão)?</label>
      <label><input type="checkbox" data-put="${idx}:pensaoFazRefin" ${b.pensaoFazRefin?'checked':''}/> faz refin (pensão)?</label>
      <label><input type="checkbox" data-put="${idx}:pensaoFazPortabilidade" ${b.pensaoFazPortabilidade?'checked':''}/> faz portabilidade (pensão)?</label>
      <label><input type="checkbox" data-put="${idx}:pensaoAceitaNaoAssina" ${b.pensaoAceitaNaoAssina?'checked':''}/> aceita não assinante (pensão)?</label>
    </div>

    ${ b.pensaoFazMargem ? `<div style="margin-top:8px"><label>Pensão — Prazos (Margem)</label><div class="prazo-line" data-prazos-pensao="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-prazo-pensao="${idx}">+ Adicionar prazo (Pensão Margem)</button></div></div>` : '' }
    ${ b.pensaoFazCartao ? `<div style="margin-top:12px"><label>Pensão — Prazos (Cartão)</label><div class="prazo-line" data-prazos-pensao-cartao="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-prazo-pensao-cartao="${idx}">+ Adicionar prazo (Pensão Cartão)</button></div></div>` : '' }
    ${ b.pensaoFazRefin ? `<div style="margin-top:12px"><label>Pensão — Prazos (Refin)</label><div class="prazo-line" data-prazos-pensao-refin="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-prazo-pensao-refin="${idx}">+ Adicionar prazo (Pensão Refin)</button></div></div>` : '' }
    ${ b.pensaoFazPortabilidade ? `<div style="margin-top:12px"><label>Pensão — Prazos (Portabilidade)</label><div class="prazo-line" data-prazos-pensao-port="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-prazo-pensao-port="${idx}">+ Adicionar prazo (Pensão Port)</button></div></div>` : '' }
  </div>
  `;
}

import { esc } from './util.js';

/* ===== Prazos comuns / pensão ===== */
export function renderPrazosInline(bancos, idx, type){
  let sel, arr;
  if(!type){ sel = document.querySelector(`[data-prazos="${idx}"]`); arr = bancos[idx].prazos || []; }
  else if(type==='cartao'){ sel = document.querySelector(`[data-prazos-cartao="${idx}"]`); arr = bancos[idx].prazosCartao || []; }
  else if(type==='port'){ sel = document.querySelector(`[data-prazos-portabilidade="${idx}"]`); arr = bancos[idx].prazosPortabilidade || []; }
  else if(type==='pensao'){ sel = document.querySelector(`[data-prazos-pensao="${idx}"]`); arr = bancos[idx].prazosPensao || []; }
  else if(type==='pensao-cartao'){ sel = document.querySelector(`[data-prazos-pensao-cartao="${idx}"]`); arr = bancos[idx].prazosPensaoCartao || []; }
  else if(type==='pensao-refin'){ sel = document.querySelector(`[data-prazos-pensao-refin="${idx}"]`); arr = bancos[idx].prazosPensaoRefin || []; }
  else if(type==='pensao-port'){ sel = document.querySelector(`[data-prazos-pensao-port="${idx}"]`); arr = bancos[idx].prazosPensaoPort || []; }
  if(!sel) return; sel.innerHTML = '';
  arr.forEach((p,i)=>{
    const row = document.createElement('div'); row.className='prazo-row';
    const base = !type ? 'data-p' : `data-p-${type}`;
    const remAttr = !type ? `data-rem-p="${idx}:${i}"` : `data-rem-p-${type}="${idx}:${i}"`;
    row.innerHTML = `
      <input class="idade-input" placeholder="Idade (ex: 21-73 ou 75)" value="${esc(p.idade||'')}" ${base}="${idx}:${i}:idade"/>
      <input class="parcelas-input" placeholder="Parcelas" type="number" min="0" max="999" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,3)" value="${esc(p.parcelas||'')}" ${base}="${idx}:${i}:parcelas"/>
      <input class="obs-input" placeholder="Observação" value="${esc(p.obs||'')}" ${base}="${idx}:${i}:obs"/>
      <button class="btn-danger" ${remAttr}>x</button>`;
    sel.appendChild(row);
  });
}

/* ===== Invalidez ===== */
export function renderInvalidezInline(bancos, idx, which){
  let sel, arr;
  if(!which){ sel = document.querySelector(`[data-invalidez="${idx}"]`); arr = bancos[idx].invalidezPrazos || []; }
  else if(which==='cartao'){ sel = document.querySelector(`[data-invalidez-cartao="${idx}"]`); arr = bancos[idx].invalidezCartao || []; }
  else if(which==='refin'){ sel = document.querySelector(`[data-invalidez-refin="${idx}"]`); arr = bancos[idx].invalidezRefin || []; }
  else if(which==='port'){ sel = document.querySelector(`[data-invalidez-port="${idx}"]`); arr = bancos[idx].invalidezPort || []; }
  if(!sel) return; sel.innerHTML = '';
  arr.forEach((r,i)=>{
    const row = document.createElement('div'); row.className='prazo-row';
    const base = which?`data-inv-${which}`:`data-inv`;
    const rem = which? `data-rem-inv-${which}="${idx}:${i}"` : `data-rem-inv="${idx}:${i}"`;
    row.innerHTML = `
      <input class="idade-input" placeholder="Idade (ex: 21-73 ou 75)" value="${esc(r.idade||'')}" ${base}="${idx}:${i}:idade"/>
      <input class="parcelas-input" placeholder="Parcelas" type="number" min="0" max="999" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,3)" value="${esc(r.parcelas||'')}" ${base}="${idx}:${i}:parcelas"/>
      <input class="obs-input" placeholder="Observação" value="${esc(r.obs||'')}" ${base}="${idx}:${i}:obs"/>
      <button class="btn-danger" ${rem}>x</button>`;
    sel.appendChild(row);
  });
}

/* ===== LOAS (com botão remover funcionando) ===== */
export function renderLoasInline(bancos, idx, which){
  let sel, arr, key;
  switch(which){
    case 'loas87': sel = document.querySelector(`[data-loas87="${idx}"]`); arr = bancos[idx].loas87Ranges || []; key='loas87Ranges'; break;
    case 'loas87-cartao': sel = document.querySelector(`[data-loas87-cartao="${idx}"]`); arr = bancos[idx].loas87Cartao || []; key='loas87Cartao'; break;
    case 'loas87-refin': sel = document.querySelector(`[data-loas87-refin="${idx}"]`); arr = bancos[idx].loas87Refin || []; key='loas87Refin'; break;
    case 'loas87-port': sel = document.querySelector(`[data-loas87-port="${idx}"]`); arr = bancos[idx].loas87Port || []; key='loas87Port'; break;
    case 'loas88': sel = document.querySelector(`[data-loas88="${idx}"]`); arr = bancos[idx].loas88Ranges || []; key='loas88Ranges'; break;
    case 'loas88-cartao': sel = document.querySelector(`[data-loas88-cartao="${idx}"]`); arr = bancos[idx].loas88Cartao || []; key='loas88Cartao'; break;
    case 'loas88-refin': sel = document.querySelector(`[data-loas88-refin="${idx}"]`); arr = bancos[idx].loas88Refin || []; key='loas88Refin'; break;
    case 'loas88-port': sel = document.querySelector(`[data-loas88-port="${idx}"]`); arr = bancos[idx].loas88Port || []; key='loas88Port'; break;
    default: return;
  }
  if(!sel) return; sel.innerHTML = '';
  arr.forEach((r,i)=>{
    const row = document.createElement('div'); row.className='prazo-row';
    const data = `data-loas="${key}:${idx}:${i}:idade"`;
    const dataPar = `data-loas="${key}:${idx}:${i}:parcelas"`;
    const dataObs = `data-loas="${key}:${idx}:${i}:obs"`;
    const rem = `data-rem-loas="${key}:${idx}:${i}"`;
    row.innerHTML = `
      <input class="idade-input" placeholder="Idade (ex: 21-73 ou 75)" value="${esc(r.idade||'')}" ${data}/>
      <input class="parcelas-input" placeholder="Parcelas" type="number" min="0" max="999" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,3)" value="${esc(r.parcelas||'')}" ${dataPar}/>
      <input class="obs-input" placeholder="Observação" value="${esc(r.obs||'')}" ${dataObs}/>
      <button class="btn-danger" ${rem}>x</button>`;
    sel.appendChild(row);
  });
}

/* ===== Outras Informações ===== */
export function renderOutrasInfos(bancos, idx){
  const linkBox = document.getElementById(`links-${idx}`);
  const emailBox = document.getElementById(`emails-${idx}`);
  const contatoBox = document.getElementById(`contatos-${idx}`);
  if(linkBox){ linkBox.innerHTML=''; (bancos[idx].links||[]).forEach((val,i)=>{
    const el = document.createElement('div'); el.className='other-item';
    el.innerHTML = `<input type="text" placeholder="https://..." value="${esc(val)}" data-link="${idx}:${i}"/>
      <button class="btn-danger" data-rem-link="${idx}:${i}">x</button>`;
    linkBox.appendChild(el);
  });}
  if(emailBox){ emailBox.innerHTML=''; (bancos[idx].emails||[]).forEach((val,i)=>{
    const el = document.createElement('div'); el.className='other-item';
    el.innerHTML = `<input type="text" placeholder="email@dominio.com" value="${esc(val)}" data-email="${idx}:${i}"/>
      <button class="btn-danger" data-rem-email="${idx}:${i}">x</button>`;
    emailBox.appendChild(el);
  });}
  if(contatoBox){ contatoBox.innerHTML=''; (bancos[idx].contatos||[]).forEach((c,i)=>{
    const el = document.createElement('div'); el.className='other-item';
    el.innerHTML = `
      <input type="text" placeholder="Número" value="${esc(c.numero||'')}" data-contato="${idx}:${i}:numero"/>
      <input type="text" placeholder="OBS" value="${esc(c.obs||'')}" data-contato="${idx}:${i}:obs"/>
      <button class="btn-danger" data-rem-contato="${idx}:${i}">x</button>`;
    contatoBox.appendChild(el);
  });}
}

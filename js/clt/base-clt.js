import { getCurrentUser, isAdmin } from '../auth/accessControl.js';
import { getLogoSrc } from '../utils/logo.js';
import { carregarEstadoClt, enviarBaseClt, mensagemErroClt, lerCacheCltPublicado,
  salvarCacheCltPublicado, conteudoClt } from '../api/baseCltApi.js';
import { BASE_CLT_KEY, BACKUP_CLT_KEY, CAMPOS_NUMERICOS, OPCOES_SEGURO, DOCUMENTOS_CLT,
  arquivoBaseClt, novoBancoClt, normalizarNomeClt, prepararBaseClt } from './modelo.js';

export async function initBaseClt() {
  const root = document.querySelector('#clt-editor');
  if (!root || root.dataset.inicializado) return;
  // A proteção também vale para chamadas diretas ao inicializador.
  const user = await getCurrentUser();
  if (!root.isConnected || root.dataset.inicializado || !isAdmin(user)) return;
  root.dataset.inicializado = 'true';
  const el = id => root.querySelector(`#${id}`);
  const lista = el('clt-lista');
  const busca = el('clt-busca');
  let bancos = [];
  let falhaLeitura = false;
  let ocupado = false;
  let estadoRemoto = null;
  let versaoLocal = 0;
  let tinhaLocal = false;
  const ultimaPublicada = lerCacheCltPublicado();
  const remotoStatus = el('clt-remoto-status');

  function avisar(texto, erro = false) {
    el('clt-status').textContent = texto;
    el('clt-status').classList.toggle('is-error', erro);
  }
  try {
    const raw = localStorage.getItem(BASE_CLT_KEY);
    tinhaLocal = raw !== null;
    if (raw) bancos = prepararBaseClt(JSON.parse(raw), { rascunho: true });
    avisar(raw ? 'Cadastro recuperado deste navegador.' : 'Adicione um banco para começar.');
  } catch {
    falhaLeitura = true;
    avisar('Não foi possível ler o cadastro salvo. O original foi preservado: exporte uma cópia e importe um JSON válido da Base CLT para continuar.', true);
  }

  function salvar() {
    versaoLocal++;
    try {
      localStorage.setItem(BASE_CLT_KEY, JSON.stringify(arquivoBaseClt(bancos)));
      avisar('Alterações salvas neste navegador. Ainda não publicadas no Supabase.');
      return true;
    } catch {
      avisar('Não foi possível salvar no navegador. Não feche esta tela: exporte um JSON para preservar as alterações.', true);
      return false;
    }
  }

  function atualizarBotoes() {
    for (const id of ['clt-adicionar', 'clt-adicionar-fim']) el(id).disabled = falhaLeitura || ocupado;
    el('clt-importar').disabled = ocupado;
    el('clt-exportar').disabled = ocupado;
    el('clt-sincronizar').disabled = ocupado;
    el('clt-enviar').disabled = ocupado || falhaLeitura;
    lista.inert = ocupado;
  }

  function filtrar() {
    const termo = normalizarNomeClt(busca.value);
    let visiveis = 0;
    [...lista.children].forEach((card, i) => {
      card.hidden = !normalizarNomeClt(bancos[i].nome).includes(termo);
      if (!card.hidden) visiveis++;
    });
    el('clt-contagem').textContent = termo ? `${visiveis} de ${bancos.length} bancos` : `${bancos.length} banco${bancos.length === 1 ? '' : 's'}`;
    el('clt-vazio').hidden = bancos.length > 0 || falhaLeitura;
    el('clt-sem-resultados').hidden = !bancos.length || visiveis > 0;
  }

  function renderBanco(b, index, aberto) {
    const card = document.createElement('details');
    card.className = 'clt-bank';
    card.open = aberto;
    const input = (campo, label, note = '') => `<label for="clt-${index}-${campo}">${label}<input id="clt-${index}-${campo}" data-field="${campo}" type="number" min="0" ${campo.startsWith('idade') ? 'max="120"' : 'max="9007199254740991"'} step="1" inputmode="numeric" placeholder="Não informado">${note ? `<small class="clt-field-note">${note}</small>` : ''}</label>`;
    // Somente texto estático compõe o HTML. Dados do cadastro entram por value/textContent.
    card.innerHTML = `
      <summary><img class="clt-bank-logo" alt=""><span class="clt-bank-copy"><strong class="clt-bank-name"></strong><span class="clt-bank-resumo"></span></span></summary>
      <div class="clt-bank-body">
        <label for="clt-${index}-nome">Nome do banco<input id="clt-${index}-nome" data-field="nome" type="text" placeholder="Ex.: Agil" required autocomplete="off"></label>
        <section class="clt-section"><h3>Requisitos do cliente</h3><div class="clt-grid">
          ${input('tempoEmpresaMeses', 'Tempo mínimo de empresa (meses)', 'Tempo de vínculo do cliente no emprego atual. Ex.: 12 meses = 1 ano.')}
        </div>
          <div class="clt-age-heading"><h4>Faixas de idade</h4><button type="button" class="od-secondary clt-add-range">+ Adicionar faixa de idade</button></div>
          <p class="clt-hint">Cadastre uma ou mais faixas aceitas por este banco.</p>
          <div class="clt-age-ranges"></div>
        </section>
        <section class="clt-section"><h3>Requisitos da empresa</h3><div class="clt-grid">
          ${input('minimoFuncionarios', 'Mínimo de funcionários')}
          ${input('tempoCnpjMeses', 'Tempo mínimo de CNPJ ativo (meses)', 'Há quanto tempo o CNPJ da empresa deve estar ativo.')}
        </div></section>
        <section class="clt-section"><h3>Documentos</h3>
          <p class="clt-hint">Marque os documentos solicitados pelo banco.</p>
          <div class="clt-documents">${DOCUMENTOS_CLT.map(doc => `<label class="inline-checkbox"><input type="checkbox" data-documento="${doc}">${doc === 'OUTROS' ? 'Outros' : doc}</label>`).join('')}</div>
          <div class="clt-other-documents" hidden><label for="clt-${index}-outrosDocumentos">Quais outros documentos?<textarea id="clt-${index}-outrosDocumentos" data-field="outrosDocumentos" rows="2" placeholder="Descreva os outros documentos solicitados."></textarea></label></div>
        </section>
        <section class="clt-section"><h3>Seguro</h3>
          <label for="clt-${index}-seguro">O banco trabalha com seguro?<select id="clt-${index}-seguro" data-field="seguro">${Object.entries(OPCOES_SEGURO).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
          <div class="clt-insurance-description" hidden><label for="clt-${index}-seguroDescricao">Como funciona o seguro?<textarea id="clt-${index}-seguroDescricao" data-field="seguroDescricao" rows="3" placeholder="Explique a cobrança, a cobertura e as condições informadas pelo banco."></textarea></label></div>
        </section>
        <label for="clt-${index}-observacoes">Observações gerais<textarea id="clt-${index}-observacoes" data-field="observacoes" rows="3" placeholder="Outras regras ou orientações deste banco."></textarea></label>
        <footer class="clt-bank-footer"><label class="inline-checkbox"><input type="checkbox" data-field="suspenso">Banco suspenso</label><button type="button" class="btn-danger clt-remover">Excluir banco</button></footer>
      </div>`;
    const fields = Object.fromEntries([...card.querySelectorAll('[data-field]')].map(field => [field.dataset.field, field]));
    for (const [campo, field] of Object.entries(fields)) {
      if (field.type === 'checkbox') field.checked = b[campo];
      else field.value = b[campo] ?? '';
    }
    card.querySelectorAll('[data-documento]').forEach(field => { field.checked = b.documentos.includes(field.dataset.documento); });
    const logo = card.querySelector('.clt-bank-logo');
    function atualizar() {
      card.querySelector('.clt-bank-name').textContent = b.nome.trim() || 'Novo banco';
      const partes = [];
      if (b.tempoEmpresaMeses !== null) partes.push(`Empresa: ${b.tempoEmpresaMeses} meses`);
      const idades = b.faixasIdade.filter(f => f.idadeMinima !== null || f.idadeMaxima !== null).map(f =>
        f.idadeMinima !== null && f.idadeMaxima !== null ? `${f.idadeMinima}–${f.idadeMaxima} anos`
          : f.idadeMinima !== null ? `A partir de ${f.idadeMinima} anos` : `Até ${f.idadeMaxima} anos`);
      if (idades.length) partes.push(idades.join(' / '));
      if (b.minimoFuncionarios !== null) partes.push(`Mín. ${b.minimoFuncionarios} funcionários`);
      if (b.seguro) partes.push(OPCOES_SEGURO[b.seguro]);
      if (b.suspenso) partes.push('Suspenso');
      card.querySelector('.clt-bank-resumo').textContent = partes.join(' · ') || 'Abra para preencher os requisitos';
      card.classList.toggle('is-suspended', b.suspenso);
      const temSeguro = ['opcional', 'obrigatorio'].includes(b.seguro);
      card.querySelector('.clt-insurance-description').hidden = !temSeguro;
      fields.seguroDescricao.required = temSeguro;
      fields.seguroDescricao.disabled = !temSeguro;
      const outrosDocs = b.documentos.includes('OUTROS');
      card.querySelector('.clt-other-documents').hidden = !outrosDocs;
      fields.outrosDocumentos.required = outrosDocs;
      fields.outrosDocumentos.disabled = !outrosDocs;
    }
    const faixasContainer = card.querySelector('.clt-age-ranges');
    function espelharPrimeiraFaixa() {
      b.idadeMinima = b.faixasIdade[0]?.idadeMinima ?? null;
      b.idadeMaxima = b.faixasIdade[0]?.idadeMaxima ?? null;
    }
    function renderFaixas(focar = -1) {
      if (!b.faixasIdade.length) b.faixasIdade.push({ idadeMinima: null, idadeMaxima: null });
      faixasContainer.replaceChildren(...b.faixasIdade.map((faixa, i) => {
        const row = document.createElement('div');
        row.className = 'clt-age-row';
        row.innerHTML = `<span class="clt-age-title">Faixa ${i + 1}</span><div class="clt-grid">
          ${['idadeMinima', 'idadeMaxima'].map(campo => `<label for="clt-${index}-faixa-${i}-${campo}">Idade ${campo === 'idadeMinima' ? 'mínima' : 'máxima'} (anos)<input id="clt-${index}-faixa-${i}-${campo}" data-field="${campo}" type="number" min="0" max="120" step="1" inputmode="numeric" placeholder="Não informado"></label>`).join('')}
        </div><button type="button" class="od-secondary clt-remove-range" aria-label="${b.faixasIdade.length > 1 ? 'Remover' : 'Limpar'} faixa de idade ${i + 1}">${b.faixasIdade.length > 1 ? 'Remover faixa' : 'Limpar faixa'}</button>`;
        const min = row.querySelector('[data-field=idadeMinima]');
        const max = row.querySelector('[data-field=idadeMaxima]');
        min.value = faixa.idadeMinima ?? ''; max.value = faixa.idadeMaxima ?? '';
        const validar = () => max.setCustomValidity(faixa.idadeMinima !== null && faixa.idadeMaxima !== null && Number(faixa.idadeMinima) > Number(faixa.idadeMaxima) ? 'A idade máxima não pode ser menor que a mínima.' : '');
        validar();
        row.oninput = event => {
          const campo = event.target.dataset.field;
          if (!['idadeMinima', 'idadeMaxima'].includes(campo)) return;
          faixa[campo] = event.target.value === '' ? null : event.target.value;
          validar(); espelharPrimeiraFaixa(); atualizar(); salvar();
        };
        row.querySelector('.clt-remove-range').onclick = () => {
          if (b.faixasIdade.length > 1) b.faixasIdade.splice(i, 1);
          else { faixa.idadeMinima = null; faixa.idadeMaxima = null; }
          espelharPrimeiraFaixa(); renderFaixas(Math.min(i, b.faixasIdade.length - 1)); atualizar(); salvar();
        };
        return row;
      }));
      faixasContainer.children[focar]?.querySelector('input')?.focus();
    }
    card.querySelector('.clt-add-range').onclick = () => {
      b.faixasIdade.push({ idadeMinima: null, idadeMaxima: null });
      renderFaixas(b.faixasIdade.length - 1); atualizar(); salvar();
    };
    function atualizarLogo() {
      logo.onerror = () => { logo.onerror = null; logo.src = getLogoSrc(''); };
      logo.src = getLogoSrc(b.nome);
    }
    renderFaixas(); atualizar(); atualizarLogo();
    card.addEventListener('input', event => {
      if (event.target.dataset.documento) {
        b.documentos = [...card.querySelectorAll('[data-documento]:checked')].map(field => field.dataset.documento);
        atualizar(); salvar();
        return;
      }
      const campo = event.target.dataset.field;
      if (!Object.hasOwn(fields, campo)) return;
      b[campo] = event.target.type === 'checkbox' ? event.target.checked
        : Object.hasOwn(CAMPOS_NUMERICOS, campo) && event.target.value === '' ? null : event.target.value;
      atualizar(); salvar();
    });
    card.addEventListener('change', event => {
      if (event.target.dataset.field === 'nome') atualizarLogo();
    });
    card.querySelector('.clt-remover').onclick = () => {
      if (!confirm(`Excluir ${b.nome.trim() || 'este banco'} da Base CLT deste navegador?`)) return;
      bancos = bancos.filter(item => item !== b);
      salvar(); render();
    };
    return card;
  }

  function render(abrirId = '') {
    lista.replaceChildren(...bancos.map((b, i) => renderBanco(b, i, b.banco_id === abrirId)));
    filtrar(); atualizarBotoes();
  }

  function adicionar() {
    if (falhaLeitura || ocupado) return;
    const b = novoBancoClt();
    bancos.push(b); busca.value = '';
    salvar(); render(b.banco_id);
    lista.lastElementChild.querySelector('[data-field=nome]').focus();
  }

  function baixar(texto, nome) {
    const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = nome;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  el('clt-exportar').onclick = () => {
    try {
      if (falhaLeitura) {
        baixar(localStorage.getItem(BASE_CLT_KEY) || '', 'base-clt-recuperacao.json');
        return;
      }
      const invalid = root.querySelector('input:invalid, textarea:invalid');
      if (invalid) {
        invalid.closest('details').open = true;
        invalid.closest('details').hidden = false;
        invalid.focus(); invalid.reportValidity();
        avisar('Confira o campo destacado antes de exportar a base.', true);
        return;
      }
      const exportados = prepararBaseClt(arquivoBaseClt(bancos));
      baixar(JSON.stringify(arquivoBaseClt(exportados), null, 2), 'base-clt.json');
      avisar('JSON da Base CLT gerado. Guarde o arquivo como cópia de segurança.');
    } catch (error) { avisar(error.message, true); }
  };

  el('clt-importar').onchange = async event => {
    const arquivo = event.target.files[0];
    if (!arquivo || ocupado) return;
    ocupado = true; atualizarBotoes();
    try {
      const novos = prepararBaseClt(JSON.parse(await arquivo.text()));
      if (!root.isConnected) return;
      if (!confirm(`Importar ${novos.length} banco(s) e substituir a Base CLT deste navegador? A base anterior será guardada como cópia local. Nenhuma outra base será alterada.`)) return;
      const anterior = localStorage.getItem(BASE_CLT_KEY);
      if (anterior !== null) localStorage.setItem(BACKUP_CLT_KEY, anterior);
      // Só troca a tela depois de confirmar a gravação completa.
      localStorage.setItem(BASE_CLT_KEY, JSON.stringify(arquivoBaseClt(novos)));
      bancos = novos; falhaLeitura = false; busca.value = '';
      render(); avisar('Base CLT importada e salva neste navegador. Os bancos estão recolhidos.');
    } catch (error) {
      avisar(`Não foi possível importar: ${error.message}. O cadastro anterior foi mantido.`, true);
    } finally {
      ocupado = false; event.target.value = ''; atualizarBotoes();
    }
  };
  el('clt-adicionar').onclick = adicionar;
  el('clt-adicionar-fim').onclick = adicionar;
  busca.oninput = filtrar;
  function canonicos(lista) {
    try { return conteudoClt(prepararBaseClt(arquivoBaseClt(lista))); }
    catch { return null; }
  }
  function aplicarRemoto(estado) {
    const anterior = localStorage.getItem(BASE_CLT_KEY);
    if (anterior !== null) localStorage.setItem(BACKUP_CLT_KEY, anterior);
    localStorage.setItem(BASE_CLT_KEY, JSON.stringify(arquivoBaseClt(estado.bancos)));
    bancos = prepararBaseClt(arquivoBaseClt(estado.bancos), { rascunho: true });
    falhaLeitura = false; versaoLocal++; busca.value = '';
    salvarCacheCltPublicado(estado.bancos);
    render();
  }
  el('clt-sincronizar').onclick = async () => {
    if (ocupado) return;
    ocupado = true; atualizarBotoes();
    remotoStatus.textContent = 'Consultando o Supabase…';
    try {
      const estado = await carregarEstadoClt();
      if (!root.isConnected) return;
      if ((falhaLeitura || canonicos(bancos) !== canonicos(estado.bancos)) &&
          !confirm(`Carregar ${estado.bancos.length} banco(s) do Supabase e substituir o rascunho CLT deste navegador? Uma cópia do rascunho será preservada localmente. Para publicá-lo, cancele e use Enviar base.`)) {
        remotoStatus.textContent = 'Sincronização cancelada. O rascunho não foi alterado.'; return;
      }
      aplicarRemoto(estado); estadoRemoto = estado;
      remotoStatus.textContent = `${estado.bancos.length} banco(s) carregado(s) do Supabase.`;
      avisar('Base CLT sincronizada. Nenhuma outra base foi alterada.');
    } catch (error) { remotoStatus.textContent = 'Não foi possível sincronizar. ' + mensagemErroClt(error); }
    finally { ocupado = false; atualizarBotoes(); }
  };
  el('clt-enviar').onclick = async () => {
    if (ocupado || falhaLeitura) return;
    const invalid = root.querySelector('input:invalid, textarea:invalid');
    if (invalid) {
      invalid.closest('details').open = true; invalid.closest('details').hidden = false;
      invalid.focus(); invalid.reportValidity();
      avisar('Confira o campo destacado antes de enviar a base.', true); return;
    }
    let preparados;
    try { preparados = prepararBaseClt(arquivoBaseClt(bancos)); }
    catch (error) { avisar(error.message, true); return; }
    ocupado = true; atualizarBotoes();
    try {
      if (!estadoRemoto) estadoRemoto = await carregarEstadoClt();
      if (!root.isConnected) return;
      const removidos = estadoRemoto.registros.filter(r => !preparados.some(b => b.banco_id === r.banco_id)).length;
      if (!confirm(preparados.length
        ? `Publicar ${preparados.length} banco(s) CLT? A base remota será substituída por este cadastro, removendo ${removidos} banco(s) ausente(s). Haverá backup no servidor. As outras bases não serão alteradas.`
        : 'ATENÇÃO: o cadastro está vazio. Apagar TODOS os bancos publicados da Base CLT? Haverá backup no servidor.')) return;
      remotoStatus.textContent = 'Enviando e conferindo a Base CLT…';
      const estado = await enviarBaseClt(preparados, { anteriores: estadoRemoto.registros, confirmarVazia: !preparados.length });
      estadoRemoto = estado;
      if (!root.isConnected) return;
      // A publicação já foi confirmada; erro de cache local não pode ser relatado como falha remota.
      salvarCacheCltPublicado(estado.bancos);
      try { aplicarRemoto(estado); avisar('Base CLT publicada e conferida no Supabase.'); }
      catch { avisar('Publicação confirmada no Supabase. Não foi possível atualizar o cache local; exporte uma cópia e sincronize antes de continuar.', true); }
      remotoStatus.textContent = `${estado.bancos.length} banco(s) publicado(s); ${estado.removidos} removido(s). O simulador lê esta versão.`;
    } catch (error) { remotoStatus.textContent = 'Não foi possível confirmar o envio. ' + mensagemErroClt(error) + ' O rascunho local foi preservado. Confira o servidor antes de reenviar.'; }
    finally { ocupado = false; atualizarBotoes(); }
  };
  render();
  // Não bloqueia o formulário nem substitui rascunhos/remoções pendentes ao abrir a página.
  const versaoInicial = versaoLocal;
  carregarEstadoClt().then(estado => {
    if (!root.isConnected || ocupado) return;
    estadoRemoto = estado;
    const semEdicoes = versaoLocal === versaoInicial;
    const limpo = ultimaPublicada !== null && canonicos(bancos) !== null && canonicos(bancos) === canonicos(ultimaPublicada);
    salvarCacheCltPublicado(estado.bancos);
    if (!falhaLeitura && semEdicoes && (!tinhaLocal || limpo)) {
      try { aplicarRemoto(estado); avisar('Base CLT carregada do Supabase.'); }
      catch { avisar('A base foi consultada, mas não foi possível atualizar o armazenamento local. O rascunho foi preservado.', true); }
    }
    remotoStatus.textContent = `${estado.bancos.length} banco(s) no Supabase.` + (tinhaLocal && !limpo ? ' Seu rascunho foi mantido. Envie para publicar ou sincronize para carregar a versão remota.' : '');
  }).catch(error => {
    if (root.isConnected && !ocupado) remotoStatus.textContent = 'Não foi possível atualizar a versão publicada. ' + mensagemErroClt(error) + ' O cadastro local continua disponível.';
  });
}

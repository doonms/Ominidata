// Um grupo nomeado e o vínculo de fatores são o mesmo conceito.
// Cada prazo recebe uma chave própria para que somente prazos iguais sincronizem.
const PREFIXO = 'grupo-nomeado|';

export function normalizarNomeGrupo(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || !valor.trim() || valor.trim().length > 80 || /[\x00-\x1f\x7f]/.test(valor)) {
    throw new Error('Informe um nome de grupo de 1 a 80 caracteres, sem quebras de linha.');
  }
  return valor.trim();
}

export function criarChaveGrupoFator(nome, prazo) {
  nome = normalizarNomeGrupo(nome);
  prazo = Number(prazo);
  if (!nome || !Number.isSafeInteger(prazo) || prazo <= 0) throw new Error('Grupo ou prazo inválido.');
  return `${PREFIXO}${prazo}|${nome}`;
}

export function nomeGrupoDaLinha(linha) {
  const valor = linha?.grupo_fator;
  if (typeof valor !== 'string' || !valor.startsWith(PREFIXO)) return null;
  const separador = valor.indexOf('|', PREFIXO.length);
  if (separador < 0 || Number(valor.slice(PREFIXO.length, separador)) !== Number(linha.prazo)) return null;
  try { return normalizarNomeGrupo(valor.slice(separador + 1)); }
  catch { return null; }
}

export function nomeGrupoDaTabela(tabela) {
  const nomes = new Set((tabela?.prazos || []).map(nomeGrupoDaLinha).filter(Boolean));
  return nomes.size === 1 ? [...nomes][0] : null;
}

export function listarGruposFatores(tabelas) {
  const grupos = new Map();
  tabelas.forEach(tabela => {
    const nome = nomeGrupoDaTabela(tabela);
    if (!nome) return;
    if (!grupos.has(nome)) grupos.set(nome, []);
    grupos.get(nome).push(tabela);
  });
  return grupos;
}

export function prepararGrupoFatores(tabelas, selecionadas, nome, referencia) {
  nome = normalizarNomeGrupo(nome);
  const membros = [...new Set(selecionadas)];
  if (!nome || !membros.length || membros.some(t => !tabelas.includes(t))) {
    return { erro: 'Selecione as tabelas e informe o nome do grupo.' };
  }
  if (membros.some(t => !t.prazos?.length)) {
    return { erro: 'Adicione pelo menos um prazo em cada tabela antes de criar o grupo.' };
  }
  if (membros.some(t => t.prazos.some(linha => !Number.isSafeInteger(Number(linha.prazo)) || Number(linha.prazo) <= 0))) {
    return { erro: 'Corrija os prazos pendentes antes de criar o grupo.' };
  }
  if (!membros.includes(referencia)) referencia = membros[0];
  const porPrazo = new Map();
  membros.forEach(tabela => tabela.prazos.forEach(linha => {
    const prazo = Number(linha.prazo);
    if (!Number.isSafeInteger(prazo) || prazo <= 0) return;
    if (!porPrazo.has(prazo)) porPrazo.set(prazo, []);
    porPrazo.get(prazo).push({ tabela, linha });
  }));
  const operacoes = [];
  let diferentes = false;
  porPrazo.forEach((itens, prazo) => {
    const origem = itens.find(item => item.tabela === referencia)?.linha || itens[0].linha;
    itens.forEach(({ linha }) => {
      if (String(linha.fator ?? '') !== String(origem.fator ?? '') || String(linha.taxa ?? '') !== String(origem.taxa ?? '')) diferentes = true;
      operacoes.push({ linha, prazo, origem });
    });
  });
  return { nome, membros, referencia, operacoes, diferentes };
}

export function aplicarGrupoFatores(tabelas, plano) {
  if (plano?.erro || !plano?.nome) throw new Error(plano?.erro || 'Grupo inválido.');
  const membros = new Set(plano.membros);
  // Retira do grupo os antigos membros que não fazem mais parte da seleção.
  tabelas.forEach(tabela => {
    tabela.prazos.forEach(linha => {
      const grupoAtual = nomeGrupoDaLinha(linha);
      if ((grupoAtual === plano.nome && !membros.has(tabela)) || (membros.has(tabela) && grupoAtual && grupoAtual !== plano.nome)) {
        linha.grupo_fator = null;
      }
    });
  });
  plano.operacoes.forEach(({ linha, prazo, origem }) => {
    linha.fator = origem.fator ?? '';
    linha.taxa = origem.taxa ?? '';
    linha.grupo_fator = criarChaveGrupoFator(plano.nome, prazo);
  });
}

export function desfazerGrupoFatores(tabelas, nome) {
  nome = normalizarNomeGrupo(nome);
  tabelas.forEach(tabela => tabela.prazos.forEach(linha => {
    if (nomeGrupoDaLinha(linha) === nome) linha.grupo_fator = null;
  }));
}

export function criarFerramentasGrupos({ tabelas, selecao, referencia, grupoAtual, aoEscolher, aoSelecionar, aoSalvar, avisar }) {
  const grupos = listarGruposFatores(tabelas);
  const box = document.createElement('div');
  box.className = 'bf-group-tools';
  const label = document.createElement('label');
  label.textContent = 'Grupo de fatores';
  const select = document.createElement('select');
  select.className = 'bf-group-select';
  select.add(new Option('Escolha um grupo', ''));
  [...grupos.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(nome => {
    select.add(new Option(`${nome} · ${grupos.get(nome).length} tabela(s)`, nome));
  });
  select.value = grupos.has(grupoAtual) ? grupoAtual : '';
  select.addEventListener('change', () => aoEscolher(select.value));
  const botao = (texto, classe, acao, disabled) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `secondary small ${classe}`; b.textContent = texto; b.disabled = disabled;
    b.addEventListener('click', acao); return b;
  };
  label.appendChild(select);
  box.append(label,
    botao('Selecionar grupo', 'bf-group-apply', () => aoSelecionar(grupos.get(select.value) || []), !select.value),
    botao('Salvar e sincronizar grupo', 'bf-group-save', () => {
      const resposta = prompt('Nome do grupo de fatores (até 80 caracteres).', select.value);
      if (resposta === null) return;
      try {
        const nome = normalizarNomeGrupo(resposta);
        if (!nome) throw new Error('Informe o nome do grupo.');
        const plano = prepararGrupoFatores(tabelas, [...selecao], nome, referencia);
        if (plano.erro) throw new Error(plano.erro);
        const anterior = grupos.get(nome) || [];
        const movidas = [...selecao].filter(t => nomeGrupoDaTabela(t) && nomeGrupoDaTabela(t) !== nome);
        if ((anterior.length || movidas.length || plano.diferentes) && !confirm(`Salvar o grupo "${nome}" com as ${selecao.size} tabelas selecionadas?\nFatores e taxas de prazos iguais serão sincronizados usando a tabela de referência. Tabelas que saírem do grupo manterão os valores atuais.`)) return;
        aplicarGrupoFatores(tabelas, plano);
        aoSalvar(nome);
        avisar(`Grupo "${nome}" salvo e sincronizado. Alterar um fator ou taxa atualizará o mesmo prazo nas demais tabelas do grupo.`);
      } catch (error) { avisar(error.message, true); }
    }, !selecao.size),
    botao('Desfazer grupo', 'bf-group-remove', () => {
      const nome = select.value;
      if (!nome || !confirm(`Desfazer o grupo "${nome}"? Os fatores e taxas atuais serão mantidos, mas deixarão de sincronizar.`)) return;
      desfazerGrupoFatores(tabelas, nome);
      aoSalvar(''); avisar(`Grupo "${nome}" desfeito. Os valores foram mantidos e não serão mais sincronizados.`);
    }, !select.value));
  const help = document.createElement('p');
  help.className = 'bf-link-help';
  help.textContent = 'Marque as tabelas, escolha a referencia e salve o grupo. Fatores e taxas de prazos iguais passam a ser atualizados juntos. Selecionar o grupo marca todos os seus membros.';
  box.appendChild(help);
  return box;
}

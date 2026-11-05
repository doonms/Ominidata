import { PRAZOS_PADRAO } from './cadastro-tabelas-fatores.js';
import { calcularFator, parseNumeroCalculo, formatarFatorCalculo } from './calculadora-fator.js';
import { prepararInjecaoFator, injetarFatorTabelas } from './vinculos-fatores.js';

// Usa a mesma seleção do editor; nenhuma alteração ocorre só por marcar uma tabela.
export function initInjecaoFatores({ root, getSelecao, salvar, renderizar, avisar }) {
  const el = id => root.querySelector(`#bf-injecao-${id}`);
  const tipo = el('tipo'), prazo = el('prazo'), personalizado = el('personalizado');
  const taxa = el('taxa'), resumo = el('resumo'), status = el('status'), aplicar = el('aplicar');
  if (!tipo || !aplicar) return null;
  let calculoValido = false;
  let contextoTaxa = '';
  let taxaEditada = false;
  let sucesso = '';
  const campos = {
    parcela: root.querySelector('#bf-calcParcela'),
    valor: root.querySelector('#bf-calcValor')
  };
  function valores() {
    const parcela = parseNumeroCalculo(campos.parcela?.value);
    const valor = parseNumeroCalculo(campos.valor?.value);
    const fator = calculoValido && parcela > 0 && valor > 0 ? calcularFator(parcela, valor) : NaN;
    const meses = Number(prazo.value === 'outro' ? personalizado.value : prazo.value);
    return { fator, meses };
  }
  function atualizar() {
    const { tabelas, selecionadas, referencia } = getSelecao(tipo.value);
    const anterior = prazo.value;
    const prazos = [...new Set([...PRAZOS_PADRAO, ...selecionadas.flatMap(t => t.prazos.map(p => Number(p.prazo)))])]
      .filter(p => Number.isSafeInteger(p) && p > 0).sort((a, b) => a - b);
    prazo.replaceChildren(new Option('Escolha o prazo', ''), ...prazos.map(p => new Option(`${p} meses`, String(p))), new Option('Prazo personalizado…', 'outro'));
    prazo.value = [...prazo.options].some(o => o.value === anterior) ? anterior : '';
    personalizado.closest('label').hidden = prazo.value !== 'outro';
    const { fator, meses } = valores();
    const chave = `${tipo.value}:${meses}:${tabelas.indexOf(referencia)}`;
    if (chave !== contextoTaxa) { contextoTaxa = chave; taxaEditada = false; }
    if (!taxaEditada) {
      const origem = referencia?.prazos.find(p => Number(p.prazo) === meses);
      taxa.value = typeof origem?.taxa === 'number'
        ? origem.taxa.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 8 }) : origem?.taxa ?? '';
    }
    resumo.textContent = selecionadas.length
      ? `${selecionadas.length} tabela(s) selecionada(s): ${selecionadas.map(t => t.nome || 'Sem nome').join(' · ')}`
      : 'Marque “Selecionar tabela” nas tabelas abaixo. Você pode selecionar várias sem expandi-las.';
    const plano = prepararInjecaoFator(tabelas, selecionadas, meses, fator, taxa.value);
    aplicar.disabled = Boolean(plano.erro);
    status.classList.toggle('is-success', Boolean(sucesso));
    status.textContent = sucesso || plano.erro || `Fator ${formatarFatorCalculo(fator)} e ${taxa.value ? `taxa ${taxa.value}%` : 'sem taxa'} → ${meses}x em ${selecionadas.length} tabela(s).${plano.novos ? ` O prazo será adicionado em ${plano.novos} tabela(s).` : ''}`;
  }
  tipo.addEventListener('change', () => { limparPrazo(); atualizar(); });
  prazo.addEventListener('change', () => { sucesso = ''; atualizar(); });
  personalizado.addEventListener('input', () => { sucesso = ''; atualizar(); });
  taxa.addEventListener('input', () => { taxaEditada = true; sucesso = ''; atualizar(); });
  aplicar.addEventListener('click', () => {
    const { tabelas, selecionadas } = getSelecao(tipo.value);
    const { fator, meses } = valores();
    const plano = prepararInjecaoFator(tabelas, selecionadas, meses, fator, taxa.value);
    if (plano.erro) { avisar(plano.erro, true); return; }
    const nomes = selecionadas.map(t => `• ${t.nome || 'Sem nome'}`).join('\n');
    if (!confirm(`Injetar fator ${formatarFatorCalculo(fator)} e ${taxa.value ? `taxa ${taxa.value}%` : 'sem taxa'} no prazo ${meses}x?\n\n${nomes}\n\n${plano.novos ? `O prazo será criado em ${plano.novos} tabela(s). ` : ''}Os valores atuais desse prazo serão substituídos. Fator e taxa ficarão vinculados somente entre estas tabelas nesse prazo. Nomes, público e outros prazos serão mantidos.`)) return;
    const resultado = injetarFatorTabelas(tabelas, selecionadas, meses, fator, taxa.value);
    if (resultado.erro) { avisar(resultado.erro, true); return; }
    salvar();
    sucesso = `Fator e taxa aplicados em ${selecionadas.length} tabela(s), prazo ${meses}x. Salvo neste navegador. Use “Enviar base atual” para publicar no Supabase.`;
    renderizar(); avisar(sucesso);
  });
  function limparPrazo() {
    prazo.value = ''; personalizado.value = ''; contextoTaxa = ''; taxaEditada = false; taxa.value = ''; sucesso = '';
  }
  return {
    atualizar,
    atualizarCalculo(valido) { calculoValido = valido; sucesso = ''; atualizar(); },
    selecionarTipo(valor) {
      if (tipo.value !== valor) { tipo.value = valor; limparPrazo(); }
      sucesso = ''; atualizar();
    },
    abrir(valor) {
      this.selecionarTipo(valor);
      tipo.closest('.bf-calculator-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      prazo.focus({ preventScroll: true });
    },
    limpar() { limparPrazo(); atualizar(); }
  };
}

"""Validação local do fluxo do simulador, com dados controlados e sem chamadas externas.

Requer playwright e Google Chrome. Execute: python tests/simulador-fluxo.py
"""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
REGRAS = [
    dict(nomeBanco='Banco do Brasil', nome='Banco do Brasil', fazMargem=True,
         fazCartao=True, fazRefin=True, fazPortabilidade=True, fazSaqueComplementar=True,
         aceitaClienteNaoAssina=True,
         observacoes='Conferir documentação.\nConfirmar condições do banco.',
         prazos=[dict(idade='18-59', parcelas='84', obs='Margem: condição para menores de 60.\n' + 'Conferir as condições específicas desta linha antes de continuar. ' * 6),
                 dict(idade='60-80', parcelas='84', obs='Margem: condição a partir de 60 anos.')],
         prazosCartao=[dict(idade='18-60', parcelas='96', obs='Cartão: conferir <documento> & assinatura.'),
                       dict(idade='18-60', parcelas='96', obs='Cartão: conferir <documento> & assinatura.')],
         prazosPortabilidade=[dict(idade='18-80', parcelas='84', obs='Portabilidade: confirmar saldo devedor.')]),
    dict(nomeBanco='Banco Jovem', nome='Banco Jovem', fazMargem=True,
         observacoes='Observação geral que não deve aparecer.',
         prazos=[dict(idade='18-59', parcelas='72'),
                 dict(idade='18-59', parcelas='60', obs='Não usar a observação do segundo prazo.')]),
    dict(nomeBanco='Banco Livre', nome='Banco Livre', fazMargem=True,
         fazPortabilidade=True, prazos=[dict(idade='18-85', parcelas='84')]),
    dict(nomeBanco='Banco LOAS', nome='Banco LOAS', aceitaLoas=True, loasFazCartao=True,
         loas87Cartao=[dict(idade='18-80', parcelas='96', obs='Observação exclusiva LOAS 87.')],
         loas88Cartao=[dict(idade='18-80', parcelas='96', obs='Observação exclusiva LOAS 88.')]),
    dict(nomeBanco='Banco Suspenso', nome='Banco Suspenso', suspenso=True, fazMargem=True,
         prazos=[dict(idade='18-99', parcelas='84')]),
]
FATORES = {
    'BancodoBrasil': dict(fatores={'2026-10-16': dict(
        margem=[dict(prazo=84, fator=0.02, taxa='1,70%', plano='Tabela A'),
                dict(prazo=84, fator=0.03, taxa='1,90%', plano='Tabela B')],
        cartao=[dict(prazo=96, fator=22.5, taxa='2,15%', plano='Cartão')])},
        seguros=[dict(nome='Seguro teste', tipo='fixo', valor=25)])
}
STUB = """
export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id:'00000000-0000-0000-0000-000000000001', email: 'dominicplf@gmail.com' } } }) },
  from(table) {
    if (table === 'perfis_usuarios') {
      const q = {select(){return q;},eq(){return q;},
        maybeSingle:async()=>({data:{perfil:'master'},error:null})};
      return q;
    }
    const q = {
      select() { return q; }, order() { return q; }, eq() { return q; }, range() { return q; },
      then(resolve, reject) {
        if (window.__qaFalhar) return Promise.reject(new Error('Offline no teste')).then(resolve,reject);
        const rows = table === 'base_inss' && !window.__qaVazio
          ? window.__qaRegras.map(b => ({nomeBanco:b.nomeBanco,nome:b.nome,dados:b,suspenso:!!b.suspenso}))
          : [];
        return Promise.resolve({data:rows,error:null}).then(resolve,reject);
      }
    };
    return q;
  }
};
"""


class QuietHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/Ominidata/'):
            path = path[len('/Ominidata'):]
        return super().translate_path(path)

    def log_message(self, *args):
        pass

    def do_GET(self):
        try:
            super().do_GET()
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    with sync_playwright() as p, TemporaryDirectory(prefix='ominidata-sim-qa-') as temp:
        browser = p.chromium.launch(channel='chrome', headless=True)
        context = browser.new_context(viewport={'width': 1366, 'height': 768}, service_workers='block')
        context.route('**/js/supa/supabaseClient.js', lambda route: route.fulfill(content_type='application/javascript', body=STUB))
        context.route('https://**/*', lambda route: route.abort())
        context.add_init_script(
            'window.__qaRegras = ' + json.dumps(REGRAS) + ';'
            "sessionStorage.setItem('ominidata_user', JSON.stringify({email:'dominicplf@gmail.com'}));"
            "localStorage.setItem('ominidata_base_inss_v1', JSON.stringify(window.__qaRegras));"
            "localStorage.setItem('ominidata_base_fatores_v1', " + json.dumps(json.dumps(FATORES)) + ');'
        )
        page = context.new_page()
        errors = []
        asset_errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('response', lambda r: asset_errors.append(r.url) if r.status >= 400 and any(s in r.url for s in ['.css', '.js']) else None)
        page.goto(base + '/pages/simulador.html')
        expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')

        def verificar_tamanho_cards():
            dimensoes = page.locator('.sim-bank-card').evaluate_all('els => els.map(el => { const r = el.getBoundingClientRect(); return {width:r.width, height:r.height}; })')
            if dimensoes:
                for eixo in ['width', 'height']:
                    medidas = [d[eixo] for d in dimensoes]
                    assert max(medidas) - min(medidas) < 1, dimensoes
                assert max(d['height'] for d in dimensoes) <= 242, dimensoes
            assert page.locator('.sim-bank-option img').first.evaluate('(e)=>e.getBoundingClientRect().height') >= 40
            assert page.locator('.sim-bank-detail-value').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 14
            assert page.locator('.sim-bank-card').evaluate_all('els=>els.every(e=>e.scrollHeight <= e.clientHeight+1)'), 'Conteúdo ultrapassando o cartão'

        verificar_tamanho_cards()
        banco_obs = page.locator('.sim-bank-card').filter(has=page.get_by_role('button', name='Simular com Banco do Brasil', exact=True))
        expect(banco_obs.locator('.sim-bank-observations')).to_be_visible()
        expect(banco_obs).not_to_contain_text('Conferir documentação.')
        expect(banco_obs).to_contain_text('Margem: condição para menores de 60.')
        expect(banco_obs).not_to_contain_text('Margem: condição a partir de 60 anos.')
        expect(banco_obs).not_to_contain_text('Cartão:')
        expect(banco_obs).not_to_contain_text('Portabilidade:')
        expect(banco_obs.locator('.sim-bank-detail-value')).to_have_text(['—', '84x'])
        expect(banco_obs.locator('.sim-bank-observation-text')).to_have_count(1)
        assert banco_obs.locator('documento').count() == 0
        assert banco_obs.locator('.sim-bank-observation-text').evaluate('(e)=>getComputedStyle(e).whiteSpace') == 'pre-line'
        jovem = page.locator('.sim-bank-card').filter(has=page.get_by_role('button', name='Simular com Banco Jovem', exact=True))
        expect(jovem.locator('.sim-bank-observations')).to_have_count(0)
        expect(jovem.locator('.sim-bank-detail-value')).to_have_text(['—', '72x'])
        expect(jovem).not_to_contain_text('Observação geral')
        expect(jovem).not_to_contain_text('Não usar a observação')
        expandir = banco_obs.locator('.sim-bank-expand')
        expect(expandir).to_be_visible()
        alturaFechada = banco_obs.bounding_box()['height']
        expandir.click()
        expect(expandir).to_have_attribute('aria-expanded', 'true')
        expect(page.locator('#slBanco')).to_have_value('')
        assert banco_obs.bounding_box()['height'] > alturaFechada
        assert jovem.bounding_box()['height'] == alturaFechada
        texto = banco_obs.locator('.sim-bank-observation-text')
        assert texto.evaluate('(e)=>e.scrollHeight <= e.clientHeight + 1')
        expandir.click()
        expect(expandir).to_have_attribute('aria-expanded', 'false')
        verificar_tamanho_cards()
        page.evaluate('window.scrollTo(0, 0)')
        print('PASS: somente a observação do primeiro prazo correspondente; sem gerais/outras regras; expandir não simula nem aumenta outros cards')
        expect(page.locator('#slOrigemFator')).to_have_value('manual')
        expect(page.locator('#modoLiberado')).to_be_checked()
        expect(page.locator('#modoParcela')).not_to_be_checked()
        expect(page.locator('#inpValorMargem')).to_be_visible()
        expect(page.locator('#grpValorDesejado')).to_be_hidden()
        expect(page.locator('#sim-result')).to_be_hidden()
        expect(page.locator('#sim-condicoes')).not_to_have_attribute('open', '')
        layout = page.evaluate("""() => ({
          height: document.querySelector('.sim-controls').getBoundingClientRect().height,
          search: document.querySelector('.sim-search-panel').getBoundingClientRect().top,
          searchBottom: document.querySelector('.sim-search-panel').getBoundingClientRect().bottom,
          calculator: document.querySelector('#sim-operacao').getBoundingClientRect().top
        })""")
        assert layout['height'] < 400, layout
        assert layout['search'] < 520, layout
        assert layout['searchBottom'] < layout['calculator'], layout
        assert page.locator('.sim-step').all_text_contents() == ['1', '2']
        initial_desktop = Path(os.environ.get('TEMP', temp)) / 'ominidata-simulador-inicial-desktop.png'
        page.screenshot(path=str(initial_desktop), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        layout_mobile = page.evaluate("""() => ({
          height: document.querySelector('.sim-controls').getBoundingClientRect().height,
          search: document.querySelector('.sim-search-panel').getBoundingClientRect().top,
          searchBottom: document.querySelector('.sim-search-panel').getBoundingClientRect().bottom,
          calculator: document.querySelector('#sim-operacao').getBoundingClientRect().top
        })""")
        assert layout_mobile['height'] < 650, layout_mobile
        assert layout_mobile['search'] < 900, layout_mobile
        assert layout_mobile['searchBottom'] < layout_mobile['calculator'], layout_mobile
        verificar_tamanho_cards()
        initial_mobile = Path(os.environ.get('TEMP', temp)) / 'ominidata-simulador-inicial-mobile.png'
        page.screenshot(path=str(initial_mobile), full_page=True)
        for width in [320, 768, 960, 1920]:
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow em {width}px'
            assert page.locator('.sim-controls').bounding_box()['height'] < 650
            verificar_tamanho_cards()
        page.set_viewport_size({'width': 1366, 'height': 768})
        print('PASS: cartões compactos e iguais no desktop/mobile; observações longas disponíveis ao expandir')
        print('PASS: calculadora compacta, pesquisa acessível e resultado inicialmente oculto', layout, layout_mobile)
        page.locator('#inpValorMargem').fill('100')
        page.locator('#inpFatorManual').fill('0,02')
        expect(page.locator('#resValor')).to_contain_text('5.000,00')
        print('PASS: valor liberado é o modo inicial e calcula corretamente a partir da parcela')
        page.locator('label:has(#modoParcela)').click()
        page.locator('#inpValorDesejado').fill('5.000,00')
        page.locator('#inpFatorManual').fill('0,02')
        expect(page.locator('#resParcela')).to_contain_text('100,00')
        expect(page.locator('#sim-result')).to_be_visible()
        page.locator('label:has(#modoLiberado)').click()
        page.locator('#inpValorMargem').fill('100')
        expect(page.locator('#resValor')).to_contain_text('5.000,00')
        page.locator('#inpFatorManual').fill('0')
        expect(page.locator('#resValor')).to_have_text('-')
        expect(page.locator('#sim-result')).to_be_hidden()
        page.locator('#inpFatorManual').fill('0,02')
        expect(page.locator('#resValor')).to_contain_text('5.000,00')
        print('PASS: cálculo manual nos dois sentidos, vírgula/ponto e fator zero')

        expect(page.locator('#grpDetalhesManuais')).to_be_visible()
        expect(page.locator('#resPlanoItem')).to_be_hidden()
        expect(page.locator('#resTaxaItem')).to_be_hidden()
        page.locator('#inpTabelaManual').fill('Tabela especial <cliente>')
        expect(page.locator('#resPlano')).to_have_text('Tabela especial <cliente>')
        expect(page.locator('#resPlanoItem')).to_be_visible()
        assert page.locator('#resPlano cliente').count() == 0
        page.locator('#inpTaxaManual').fill('1,70')
        expect(page.locator('#resTaxa')).to_have_text('1,70%')
        expect(page.locator('#resTaxaItem')).to_be_visible()
        expect(page.locator('#resValor')).to_contain_text('5.000,00')
        expect(page.locator('#resParcela')).to_contain_text('100,00')
        expect(page.locator('.sim-result-footer')).to_have_text('Simulado em Ominidata')
        portrait = page.locator('#sim-result').bounding_box()
        assert portrait['width'] <= 520 and portrait['height'] > portrait['width'], portrait
        manual_desktop = Path(os.environ.get('TEMP', temp)) / 'ominidata-simulacao-manual-vertical.png'
        page.locator('#sim-result').screenshot(path=str(manual_desktop))
        page.set_viewport_size({'width': 390, 'height': 844})
        manual_mobile = Path(os.environ.get('TEMP', temp)) / 'ominidata-simulacao-manual-mobile.png'
        page.locator('#sim-result').screenshot(path=str(manual_mobile))
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.set_viewport_size({'width': 1366, 'height': 768})
        page.locator('#inpTaxaManual').fill('0')
        expect(page.locator('#resTaxa')).to_have_text('0,00%')
        for taxa in ['-1', 'abc', '1,2,3']:
            page.locator('#inpTaxaManual').fill(taxa)
            expect(page.locator('#sim-result')).to_be_hidden()
            expect(page.locator('#sim-status')).to_contain_text('taxa válida')
        page.locator('#inpTaxaManual').fill('1.95%')
        expect(page.locator('#resTaxa')).to_have_text('1,95%')
        page.locator('#inpTabelaManual').fill('   ')
        expect(page.locator('#resPlanoItem')).to_be_hidden()
        page.locator('#inpTaxaManual').fill('   ')
        expect(page.locator('#resTaxaItem')).to_be_hidden()
        expect(page.locator('#sim-result')).to_be_visible()
        page.locator('#inpTabelaManual').fill('Tabela manual preservada')
        page.locator('#inpTaxaManual').fill('2,15')
        print('PASS: nome/taxa manuais opcionais, campos vazios ocultos, taxa zero/válida e resultado vertical com assinatura')

        page.locator('label:has(#modoParcela)').click()
        page.locator('#slBanco').select_option('BancodoBrasil')
        page.locator('#slOrigemFator').select_option('tabela')
        expect(page.locator('#slPrazo option')).to_have_count(1)
        expect(page.locator('#slTabela option')).to_have_count(2)
        page.locator('#slTabela').select_option('1')
        expect(page.locator('#resPlano')).to_have_text('Tabela B')
        expect(page.locator('#resTaxa')).to_have_text('1,90%')
        expect(page.locator('#grpDetalhesManuais')).to_be_hidden()
        expect(page.locator('#inpTaxaManual')).to_be_disabled()
        expect(page.locator('#resParcela')).to_contain_text('150,00')
        page.locator('#slOrigemFator').select_option('manual')
        expect(page.locator('#inpTabelaManual')).to_have_value('Tabela manual preservada')
        expect(page.locator('#resPlano')).to_have_text('Tabela manual preservada')
        expect(page.locator('#resTaxa')).to_have_text('2,15%')
        page.locator('#slOrigemFator').select_option('tabela')
        expect(page.locator('#resPlano')).to_have_text('Tabela B')
        expect(page.locator('#resSeguroItem')).to_be_hidden()
        page.locator('#slSeguro').select_option('0')
        expect(page.locator('#resSeguroItem')).to_be_visible()
        expect(page.locator('#resParcela')).to_contain_text('150,75')
        page.locator('#slSeguro').select_option('')
        expect(page.locator('#resSeguroItem')).to_be_hidden()
        print('PASS: banco com nome normalizado, tabelas repetidas e seguro opcional')

        page.locator('#sim-idade').fill('65')
        page.locator('#sim-assina').select_option('nao')
        page.locator('#sim-p-margem').check()
        expect(page.locator('.sim-bank-option')).to_have_count(1)
        expect(banco_obs.locator('.sim-bank-detail-value')).to_have_text(['65 anos', '84x'])
        expect(banco_obs).not_to_contain_text('60-80')
        expect(banco_obs.locator('.sim-bank-expand')).to_be_hidden()
        expect(banco_obs).to_contain_text('Margem: condição a partir de 60 anos.')
        expect(banco_obs).not_to_contain_text('Margem: condição para menores de 60.')
        expect(banco_obs).not_to_contain_text('Cartão:')
        expect(banco_obs).not_to_contain_text('Portabilidade:')
        print('PASS: observações seguem idade e produtos dos filtros, usando as mesmas regras da Pesquisa Rápida')
        page.locator('.sim-bank-option img').click()
        expect(page.locator('#slBanco')).to_have_value('BancodoBrasil')
        expect(page.locator('#slOrigemFator')).to_have_value('tabela')
        expect(page.locator('#resValor')).to_contain_text('5.000,00')
        print('PASS: idade/assinatura/produto e clique na logo carregando a simulação')
        page.locator('#sim-p-cartao').check()
        expect(page.locator('.sim-bank-option')).to_have_count(0)
        print('PASS: idade precisa atender a todos os produtos selecionados')

        page.locator('#sim-search-form button[type=reset]').click()
        expect(page.locator('.sim-bank-option')).to_have_count(4)
        expect(banco_obs.locator('.sim-bank-detail-value')).to_have_text(['—', '84x'])
        verificar_tamanho_cards()
        for produto, quantidade in [('margem', 3), ('cartao', 1), ('refin', 1), ('port', 2), ('saque', 1)]:
            page.locator('#sim-p-' + produto).check()
            expect(page.locator('.sim-bank-option')).to_have_count(quantidade)
            page.locator('#sim-search-form button[type=reset]').click()
            expect(page.locator('.sim-bank-option')).to_have_count(4)
        page.locator('#sim-p-margem').check()
        page.locator('#sim-p-cartao').check()
        expect(page.locator('.sim-bank-option')).to_have_count(1)
        print('PASS: cinco produtos, combinação de produtos e exclusão de suspensos')

        page.locator('#sim-search-form button[type=reset]').click()
        page.locator('#sim-especie').select_option('loas')
        page.locator('#sim-p-cartao').check()
        expect(page.locator('.sim-bank-option')).to_have_count(1)
        expect(page.locator('.sim-bank-card')).to_contain_text('Observação exclusiva LOAS 87.')
        expect(page.locator('.sim-bank-card')).not_to_contain_text('Observação exclusiva LOAS 88.')
        page.locator('.sim-bank-option').click()
        expect(page.locator('#slBanco')).to_have_value('Banco LOAS')
        expect(page.locator('#slOrigemFator')).to_have_value('manual')
        expect(page.locator('#inpPrazoManual')).to_have_value('96')
        page.locator('#inpFatorManual').fill('0,025')
        expect(page.locator('#resParcela')).to_contain_text('125,00')
        expect(page.locator('#resPrazo')).to_have_text('96x')
        print('PASS: espécie e banco sem fatores usam o cálculo manual')
        page.locator('#sim-p-saque').check()
        expect(page.locator('.sim-bank-option')).to_have_count(0)
        print('PASS: produto sem suporte na espécie não gera falsa compatibilidade')

        page.locator('#sim-search-form button[type=reset]').click()
        page.locator('#sim-nome').fill('inexistente')
        page.locator('#sim-search-form button[type=submit]').click()
        expect(page.locator('.sim-bank-option')).to_have_count(0)
        expect(page.locator('#sim-search-status')).to_contain_text('Nenhum banco atende')
        page.locator('#sim-search-form button[type=reset]').click()
        expect(page.locator('.sim-bank-option')).to_have_count(4)
        page.locator('#sim-p-cartao').check()
        page.locator('.sim-bank-option').click()
        expect(page.locator('#slOperacao')).to_have_value('cartao')
        expect(page.locator('#modoLiberado')).to_be_checked()
        page.locator('#inpValorMargem').fill('200')
        expect(page.locator('#resValor')).to_contain_text('3.150,00')
        print('PASS: estado vazio, limpeza e regra de cartão cadastrada')

        desktop = Path(os.environ.get('TEMP', temp)) / 'ominidata-simulador-desktop.png'
        mobile = Path(os.environ.get('TEMP', temp)) / 'ominidata-simulador-mobile.png'
        page.screenshot(path=str(desktop), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(mobile), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Overflow horizontal mobile'
        print('PASS: layout mobile sem overflow horizontal')

        # A calculadora original segue usando o mesmo módulo compartilhado.
        page.goto(base + '/pages/base-fatores.html')
        page.wait_for_function("!document.querySelector('.wrap').inert")
        page.locator('#bf-calcParcela').fill('100')
        page.locator('#bf-calcFator').fill('0,02')
        expect(page.locator('#bf-calcValor')).to_have_value('5.000,00')
        print('PASS: calculadora da Base de Fatores preservada')

        page.set_viewport_size({'width': 1440, 'height': 1100})
        page.goto(base + '/Ominidata/index.html')
        page.locator('#menuBtn').click()
        page.locator('#sidebar a[data-nav=pesquisa]').click()
        expect(page.locator('#btn-search')).to_be_visible()
        page.locator('#menuBtn').click()
        page.locator('#sidebar a[data-nav=simulador]').click()
        expect(page.locator('body')).to_have_class('simulador-page')
        expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
        expect(page.locator('#modoLiberado')).to_be_checked()
        page.locator('label:has(#modoParcela)').click()
        page.locator('#inpValorDesejado').fill('5000')
        page.locator('#inpFatorManual').fill('0,02')
        expect(page.locator('#resParcela')).to_contain_text('100,00')
        print('PASS: entrada no simulador pelo menu SPA')
        page.locator('#menuBtn').click()
        page.locator('#sidebar a[data-nav=base_fatores]').click()
        expect(page.locator('#bf-calcParcela')).to_be_visible()
        page.locator('#menuBtn').click()
        page.locator('#sidebar a[data-nav=simulador]').click()
        expect(page.locator('#sim-result')).to_be_hidden()
        assert page.locator('.sim-controls').bounding_box()['height'] < 400
        assert not asset_errors, asset_errors
        print('PASS: navegação Pesquisa / Base de Fatores / Simulador sem conflito de estilos ou 404 em subpasta')

        for flag in ['__qaFalhar', '__qaVazio']:
            extra = browser.new_context(service_workers='block')
            extra.route('**/js/supa/supabaseClient.js', lambda route: route.fulfill(content_type='application/javascript', body=STUB))
            extra.add_init_script(
                f'window.{flag} = true; window.__qaRegras = ' + json.dumps(REGRAS) + ';'
                "sessionStorage.setItem('ominidata_user', JSON.stringify({email:'test@local'}));"
                "localStorage.setItem('ominidata_base_inss_v1', JSON.stringify(window.__qaRegras));"
                "localStorage.setItem('ominidata_base_fatores_v1', " + json.dumps(json.dumps(FATORES)) + ');'
            )
            check = extra.new_page()
            check.goto(base + '/pages/simulador.html')
            expect(check.locator('#sim-bank-count')).to_have_text('4 bancos')
            expect(check.locator('#modoLiberado')).to_be_checked()
            check.locator('label:has(#modoParcela)').click()
            check.locator('#inpValorDesejado').fill('5000')
            check.locator('#inpFatorManual').fill('0,02')
            expect(check.locator('#resParcela')).to_contain_text('100,00')
            assert check.evaluate("JSON.parse(localStorage.getItem('ominidata_base_inss_v1')).length") == 5
            extra.close()
        print('PASS: cache preservado e simulador funcional com API vazia ou indisponível')

        # O prazo e a observação do cartão devem permanecer ligados à mesma condição ao simular.
        regras_prazo = json.loads(json.dumps(REGRAS))
        regras_prazo[0]['prazos'] = [dict(idade='18-80', parcelas='72', obs='Somente observação do prazo 72.'),
                                     dict(idade='18-80', parcelas='84', obs='Não mostrar observação do prazo 84.')]
        for tem_prazo in [True, False]:
            fatores_prazo = json.loads(json.dumps(FATORES))
            if tem_prazo:
                fatores_prazo['BancodoBrasil']['fatores']['2026-10-16']['margem'].append(
                    dict(prazo=72, fator=0.04, taxa=1.7, plano='Tabela 72'))
            extra = browser.new_context(service_workers='block')
            extra.route('**/js/supa/supabaseClient.js', lambda route: route.fulfill(content_type='application/javascript', body=STUB))
            extra.route('https://**/*', lambda route: route.abort())
            extra.add_init_script('window.__qaRegras=' + json.dumps(regras_prazo) + ';'
                "sessionStorage.setItem('ominidata_user',JSON.stringify({email:'test@local'}));"
                "localStorage.setItem('ominidata_base_inss_v1',JSON.stringify(window.__qaRegras));"
                "localStorage.setItem('ominidata_base_fatores_v1'," + json.dumps(json.dumps(fatores_prazo)) + ');')
            check = extra.new_page()
            check.goto(base + '/pages/simulador.html')
            expect(check.locator('#sim-bank-count')).to_have_text('4 bancos')
            check.locator('label:has(#modoParcela)').click()
            check.locator('#inpValorDesejado').fill('5000')
            check.locator('#inpFatorManual').fill('0,02')
            check.locator('#slBanco').select_option('BancodoBrasil')
            check.locator('#slOrigemFator').select_option('tabela')
            check.locator('#slPrazo').select_option('84')
            check.locator('#sim-idade').fill('65')
            check.locator('#sim-p-margem').check()
            card_prazo = check.locator('.sim-bank-card').filter(has=check.get_by_role('button', name='Simular com Banco do Brasil', exact=True))
            expect(card_prazo.locator('.sim-bank-detail-value')).to_have_text(['65 anos', '72x'])
            expect(card_prazo).to_contain_text('Somente observação do prazo 72.')
            expect(card_prazo).not_to_contain_text('Não mostrar observação do prazo 84.')
            card_prazo.locator('.sim-bank-simulate').click()
            expect(check.locator('#slOrigemFator')).to_have_value('tabela' if tem_prazo else 'manual')
            if tem_prazo:
                expect(check.locator('#slPrazo')).to_have_value('72')
                expect(check.locator('#resPlano')).to_have_text('Tabela 72')
            else:
                expect(check.locator('#inpPrazoManual')).to_have_value('72')
            expect(check.locator('#resPrazo')).to_have_text('72x')
            extra.close()
        print('PASS: clique usa exatamente o prazo exibido no cartão; se não houver fator nesse prazo, usa manual sem escolher outro prazo')
        assert not errors, errors
        print('PASS: nenhuma exceção de JavaScript')
        print('DESKTOP:', desktop)
        print('MOBILE:', mobile)
        print('INITIAL DESKTOP:', initial_desktop)
        print('INITIAL MOBILE:', initial_mobile)
        browser.close()
    server.shutdown()


if __name__ == '__main__':
    main()

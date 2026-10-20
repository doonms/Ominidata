"""Comparação de prazos/tabelas e opções manuais sem chamadas ao Supabase real."""
import json
import os
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
FATORES = json.loads(json.dumps(QA['FATORES']))
FATORES['BancodoBrasil']['fatores']['2026-10-16']['margem'] += [
    dict(prazo=72, fator=.025, taxa='1,75%', plano='Tabela A'),
    dict(prazo=60, fator=.04, taxa='', plano='')]
FATORES['BancodoBrasil']['fatores']['2026-10-16']['cartao'].append(
    dict(prazo=84, fator=20, taxa='', plano='Cartão alternativo'))
FATORES['BancodoBrasil']['seguros'].append(dict(nome='Percentual', tipo='percentual', valor=10))


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context(viewport={'width': 1366, 'height': 900}, service_workers='block')
            context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=QA['STUB']))
            context.route('https://**/*', lambda r: r.abort())
            context.add_init_script('window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';'
                'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));'
                'localStorage.setItem("ominidata_base_fatores_v1",' + json.dumps(json.dumps(FATORES)) + ');')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 and any(k in r.url for k in ['.css', '.js']) else None)
            for prefix in ['', '/Ominidata']:
                base = f'http://127.0.0.1:{server.server_port}' + prefix
                page.goto(base + '/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                panel = page.locator('#sim-multiplas')
                expect(panel).not_to_have_attribute('open', '')
                page.locator('#inpValorMargem').fill('100')
                page.locator('#slBanco').select_option('BancodoBrasil')
                page.locator('#slOrigemFator').select_option('tabela')
                panel.locator(':scope > summary').click()
                checks = page.locator('#sim-multi-opcoes input')
                expect(checks).to_have_count(4)
                expect(page.locator('#sim-multi-gerar')).to_be_disabled()
                page.locator('#sim-multi-todas').click()
                page.locator('#sim-multi-gerar').click()
                cards = page.locator('.sim-multi-card')
                expect(cards).to_have_count(4)
                expect(page.locator('#sim-result')).to_be_hidden()
                expect(page.locator('#sim-multi-quantidade')).to_have_text('4 simulações')

                def textos(campo):
                    return cards.locator(f'[data-field={campo}]').all_text_contents()

                assert textos('resPrazo') == ['84x', '84x', '72x', '60x']
                assert [v.replace('\u00a0', ' ') for v in textos('resValor')] == ['R$ 5.000,00', 'R$ 3.333,33', 'R$ 4.000,00', 'R$ 2.500,00']
                assert textos('resPlano') == ['Tabela A', 'Tabela B', 'Tabela A', '']
                expect(cards.nth(3).locator('[data-field=resPlanoItem]')).to_be_hidden()
                expect(cards.nth(3).locator('[data-field=resTaxaItem]')).to_be_hidden()
                expect(cards.locator('[data-field=resSeguroItem]:visible')).to_have_count(0)
                expect(cards).not_to_contain_text(['Sem seguro'] * 4)
                assert page.evaluate('new Set([...document.querySelectorAll("[id]")].map(e=>e.id)).size === document.querySelectorAll("[id]").length')
                checks.nth(2).uncheck()
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                checks.nth(3).uncheck()
                page.locator('#sim-multi-gerar').click()
                expect(cards).to_have_count(2)
                assert textos('resPlano') == ['Tabela A', 'Tabela B']
                panel.locator(':scope > summary').click()
                expect(page.locator('#sim-multi-results')).to_be_visible()
                panel.locator(':scope > summary').click()
                print(f'PASS: vários prazos, mesmo prazo com tabelas distintas, seleção parcial, campos opcionais e IDs únicos ({prefix or "/"})')

                page.locator('#slSeguro').select_option('0')
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                page.locator('#sim-multi-gerar').click()
                assert [v.replace('\u00a0', ' ') for v in textos('resValor')] == ['R$ 4.975,00', 'R$ 3.308,33']
                expect(cards.locator('[data-field=resSeguroItem]:visible')).to_have_count(2)
                page.locator('label:has(#modoParcela)').click()
                page.locator('#inpValorDesejado').fill('1000')
                page.locator('#sim-multi-gerar').click()
                assert [v.replace('\u00a0', ' ') for v in textos('resParcela')] == ['R$ 20,50', 'R$ 30,75']
                page.locator('#slSeguro').select_option('1')
                page.locator('#sim-multi-gerar').click()
                assert [v.replace('\u00a0', ' ') for v in textos('resParcela')] == ['R$ 22,22', 'R$ 33,33']
                page.locator('label:has(#modoLiberado)').click()
                page.locator('#sim-multi-gerar').click()
                assert [v.replace('\u00a0', ' ') for v in textos('resValor')] == ['R$ 4.500,00', 'R$ 3.000,00']
                page.locator('#slSeguro').select_option('')
                page.locator('#sim-multi-gerar').click()
                for width in [320, 390, 768, 1366, 1920]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow {width}px'
                    if width in [390, 1366]:
                        nome = 'mobile' if width == 390 else 'desktop'
                        page.locator('#sim-operation-body').screenshot(path=str(Path(os.environ['TEMP']) / f'ominidata-multiplas-{nome}.png'))
                page.set_viewport_size({'width': 1366, 'height': 900})
                print('PASS: valor/parcela, seguros fixo/percentual, ausência de seguro e comparação sem overflow de 320 a 1920px')

                page.locator('#slOperacao').select_option('cartao')
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                expect(page.locator('#modoParcela')).to_be_disabled()
                expect(checks).to_have_count(2)
                expect(page.locator('#sim-multi-opcoes input:checked')).to_have_count(0)
                page.locator('#sim-multi-todas').click()
                page.locator('#sim-multi-gerar').click()
                assert [v.replace('\u00a0', ' ') for v in textos('resValor')] == ['R$ 1.575,00', 'R$ 1.400,00']
                expect(cards.locator('[data-field=resParcelaLabel]')).to_have_text(['Margem do cartão'] * 2)
                page.locator('#sim-multi-limpar').click()
                expect(page.locator('#sim-multi-gerar')).to_be_disabled()
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                page.locator('#slOperacao').select_option('margem')
                page.locator('#sim-idade').fill('65')
                page.locator('#sim-nome').fill('Banco do Brasil')
                page.locator('#sim-p-margem').check()
                page.locator('#sim-search-form button[type=submit]').click()
                expect(page.locator('.sim-bank-card')).to_have_count(1)
                page.locator('.sim-bank-simulate').click()
                expect(checks).to_have_count(2)
                expect(page.locator('#sim-multi-opcoes')).not_to_contain_text('72x')
                expect(page.locator('#sim-multi-opcoes')).not_to_contain_text('60x')
                print('PASS: cartão preserva regra cadastrada; mudança de operação limpa seleção; idade restringe prazos da comparação')

                panel.evaluate('(e)=>e.open=false')
                page.locator('#slOrigemFator').select_option('manual')
                page.locator('#inpFatorManual').fill('0,02')
                page.locator('#inpTabelaManual').fill('Manual A')
                page.locator('#inpTaxaManual').fill('')
                page.locator('#inpPrazoManual').fill('84')
                panel.locator(':scope > summary').click()
                rows = page.locator('.sim-multi-manual-row')
                expect(rows).to_have_count(1)
                expect(rows.first.locator('[data-campo=fator]')).to_have_value('0,02')
                page.locator('#sim-multi-adicionar').click()
                rows.nth(1).locator('[data-campo=fator]').fill('0,03')
                rows.nth(1).locator('[data-campo=plano]').fill('Manual "B" <especial>')
                rows.nth(1).locator('[data-campo=prazo]').fill('72')
                rows.nth(1).locator('[data-campo=taxa]').fill('1,80')
                page.locator('#sim-multi-gerar').click()
                expect(cards).to_have_count(2)
                assert textos('resPrazo') == ['84x', '72x']
                assert [v.replace('\u00a0', ' ') for v in textos('resValor')] == ['R$ 5.000,00', 'R$ 3.333,33']
                assert textos('resPlano') == ['Manual A', 'Manual "B" <especial>']
                expect(cards.first.locator('[data-field=resTaxaItem]')).to_be_hidden()
                assert page.locator('especial').count() == 0
                expect(page.locator('#inpFatorManual')).to_have_value('0,02')
                page.locator('label:has(#modoParcela)').click()
                page.locator('#inpValorDesejado').fill('1000')
                page.locator('#sim-multi-gerar').click()
                assert [v.replace('\u00a0', ' ') for v in textos('resParcela')] == ['R$ 20,00', 'R$ 30,00']
                page.locator('label:has(#modoLiberado)').click()
                page.locator('#sim-multi-gerar').click()
                page.locator('#btnSimular').click()
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                expect(page.locator('#sim-result')).to_be_visible()
                page.locator('#sim-multi-adicionar').click()
                rows.nth(2).locator('[data-campo=fator]').fill('0')
                page.locator('#sim-multi-gerar').click()
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                expect(page.locator('#sim-multi-status')).to_contain_text('opção 3')
                rows.nth(2).locator('button').click()
                page.locator('#inpValorMargem').fill('0')
                page.locator('#sim-multi-gerar').click()
                expect(page.locator('#sim-multi-status')).to_contain_text('maior que zero')
                page.locator('#inpValorMargem').fill('100')
                rows.first.locator('[data-campo=taxa]').fill('inválida')
                page.locator('#sim-multi-gerar').click()
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                rows.first.locator('[data-campo=taxa]').fill('')
                rows.first.locator('[data-campo=plano]').fill('')
                rows.first.locator('[data-campo=prazo]').fill('')
                page.locator('#sim-multi-gerar').click()
                expect(cards.first.locator('[data-field=resPlanoItem]')).to_be_hidden()
                expect(cards.first.locator('[data-field=resPrazo]')).to_have_text('Não informado')
                page.locator('#sim-multi-limpar-resultados').click()
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                page.locator('#slBanco').select_option('Banco Livre')
                page.locator('#slOrigemFator').select_option('tabela')
                expect(page.locator('#sim-multi-vazio')).to_be_visible()
                expect(page.locator('#sim-multi-gerar')).to_be_disabled()
                print('PASS: opções manuais independentes, nomes especiais, campos opcionais, validação sem resultados parciais e banco sem tabelas')

                page.goto(base + '/index.html')
                for _ in range(2):
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=simulador]').click()
                    expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                    page.locator('#inpValorMargem').fill('100')
                    page.locator('#inpFatorManual').fill('0,02')
                    page.locator('#sim-multiplas > summary').click()
                    expect(page.locator('.sim-multi-manual-row')).to_have_count(1)
                    page.locator('#sim-multi-gerar').click()
                    expect(page.locator('.sim-multi-card')).to_have_count(1)
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=pesquisa]').click()
                    expect(page.locator('.pesquisa-wrap')).to_be_visible()
                print('PASS: navegação e reinicialização da comparação sem duplicar eventos')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

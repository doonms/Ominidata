"""Painéis retráteis: teclado, filtros, observações e simulação preservados."""
import json
import os
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))


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
                'localStorage.setItem("ominidata_base_fatores_v1",' + json.dumps(json.dumps(QA['FATORES'])) + ');')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            for prefix in ['', '/Ominidata']:
                base = f'http://127.0.0.1:{server.server_port}' + prefix
                page.goto(base + '/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                panel = page.locator('#sim-pesquisa-bancos')
                summary = panel.locator(':scope > summary')
                expect(panel).to_have_attribute('open', '')
                expect(summary.locator('.sim-search-collapse-label')).to_be_visible()
                page.locator('#sim-idade').fill('55')
                page.locator('#sim-p-margem').check()
                page.locator('#sim-nome').fill('Banco do Brasil')
                page.locator('#sim-search-form button[type=submit]').click()
                expect(page.locator('.sim-bank-card')).to_have_count(1)
                expandir = page.locator('.sim-bank-expand')
                expect(expandir).to_be_visible()
                expandir.click()
                expect(expandir).to_have_attribute('aria-expanded', 'true')
                page.locator('#inpValorMargem').fill('100')
                page.locator('#inpFatorManual').fill('0,02')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                summary.click()
                expect(panel).not_to_have_attribute('open', '')
                expect(summary.locator('.sim-search-expand-label')).to_be_visible()
                expect(page.locator('#sim-search-body')).to_be_hidden()
                page.locator('#inpFatorManual').fill('0,025')
                expect(page.locator('#resValor')).to_contain_text('4.000,00')
                summary.focus()
                page.keyboard.press('Enter')
                expect(page.locator('#sim-search-form')).to_be_visible()
                expect(page.locator('#sim-idade')).to_have_value('55')
                expect(page.locator('#sim-p-margem')).to_be_checked()
                expect(page.locator('#sim-nome')).to_have_value('Banco do Brasil')
                expect(page.locator('.sim-bank-card')).to_have_count(1)
                expect(expandir).to_have_attribute('aria-expanded', 'true')
                page.locator('label:has(#sim-modo-avancado)').click()
                page.locator('#sim-search-form button[type=submit]').click()
                details = page.locator('.sim-bank-advanced-details')
                details.locator('summary').click()
                expect(details).to_have_attribute('open', '')
                summary.click()
                summary.focus()
                page.keyboard.press('Space')
                expect(panel).to_have_attribute('open', '')
                expect(page.locator('#sim-modo-avancado')).to_be_checked()
                expect(details).to_have_attribute('open', '')
                expect(page.locator('#resValor')).to_contain_text('4.000,00')
                print(f'PASS: clique/Enter/Espaço preservam filtros, observações, regras avançadas e cálculo ({prefix or "/"})')

                workspace = page.locator('#sim-operacao')
                operation_summary = workspace.locator(':scope > summary')
                expect(workspace).to_have_attribute('open', '')
                page.locator('#inpTabelaManual').fill('Minha tabela')
                page.locator('#inpTaxaManual').fill('1,70')
                page.locator('#sim-calculadora-fator > summary').click()
                page.locator('#sim-calc-parcela').fill('100')
                page.locator('#sim-calc-valor').fill('5000')
                expect(page.locator('#sim-calc-fator')).to_have_value('0,0200')
                page.locator('#sim-condicoes > summary').click()
                page.locator('#inpPrazoManual').fill('84')
                operation_summary.click()
                expect(workspace).not_to_have_attribute('open', '')
                expect(page.locator('#sim-operation-body')).to_be_hidden()
                expect(page.locator('#sim-result')).to_be_hidden()
                expect(page.locator('#sim-search-form')).to_be_visible()
                operation_summary.focus()
                page.keyboard.press('Enter')
                expect(workspace).to_have_attribute('open', '')
                expect(page.locator('#inpValorMargem')).to_have_value('100,00')
                expect(page.locator('#inpFatorManual')).to_have_value('0,025')
                expect(page.locator('#inpTabelaManual')).to_have_value('Minha tabela')
                expect(page.locator('#inpTaxaManual')).to_have_value('1,70')
                expect(page.locator('#inpPrazoManual')).to_have_value('84')
                expect(page.locator('#sim-calculadora-fator')).to_have_attribute('open', '')
                expect(page.locator('#sim-calc-fator')).to_have_value('0,0200')
                expect(page.locator('#sim-condicoes')).to_have_attribute('open', '')
                expect(page.locator('#resValor')).to_contain_text('4.000,00')
                expect(page.locator('#resPrazo')).to_have_text('84x')
                operation_summary.focus()
                page.keyboard.press('Space')
                expect(workspace).not_to_have_attribute('open', '')
                page.locator('.sim-bank-simulate').click()
                expect(workspace).to_have_attribute('open', '')
                expect(page.locator('#slOrigemFator')).to_have_value('tabela')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                print('PASS: simulação retrátil preserva valores, resultado e expansões internas; banco reabre a simulação automaticamente')

                for width in [320, 390, 768, 1366, 1920]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    for aberto in [True, False]:
                        if panel.evaluate('(e)=>e.open') != aberto:
                            summary.click()
                        if workspace.evaluate('(e)=>e.open') != aberto:
                            operation_summary.click()
                        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow {width}px'
                        assert summary.evaluate('(e)=>e.scrollWidth <= e.clientWidth+1')
                        assert operation_summary.evaluate('(e)=>e.scrollWidth <= e.clientWidth+1')
                        if width in [390, 1366] and not aberto:
                            nome = 'mobile' if width == 390 else 'desktop'
                            page.screenshot(path=str(Path(os.environ['TEMP']) / f'ominidata-simulador-retratil-{nome}.png'), full_page=True)
                print('PASS: painel aberto/fechado sem overflow entre 320 e 1920px')
                page.set_viewport_size({'width': 1366, 'height': 900})
                page.goto(base + '/index.html')
                for _ in range(2):
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=simulador]').click()
                    expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                    expect(panel).to_have_attribute('open', '')
                    expect(workspace).to_have_attribute('open', '')
                    summary.click()
                    expect(page.locator('#sim-search-form')).to_be_hidden()
                    summary.click()
                    expect(page.locator('#sim-search-form')).to_be_visible()
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=pesquisa]').click()
                    expect(page.locator('.pesquisa-wrap')).to_be_visible()
                print('PASS: navegação entre páginas preservada')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

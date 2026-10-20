"""Calculadora expansível compartilhada, sem gravações nem chamadas reais ao Supabase."""
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
    base = f'http://127.0.0.1:{server.server_port}'
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
            page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 and any(k in r.url for k in ['.css', '.js']) else None)
            for prefix in ['', '/Ominidata']:
                page.goto(base + prefix + '/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                calc = page.locator('#sim-calculadora-fator')
                expect(calc).to_be_visible()
                expect(calc).not_to_have_attribute('open', '')
                expect(page.locator('#sim-calc-parcela')).to_be_hidden()
                calc.locator('summary').click()
                parcela = page.locator('#sim-calc-parcela')
                fator = page.locator('#sim-calc-fator')
                valor = page.locator('#sim-calc-valor')
                usar = page.locator('#sim-calc-usar')
                limpar = page.locator('#sim-calc-limpar')
                expect(usar).to_be_disabled()
                parcela.fill('100')
                fator.fill('0,02')
                expect(valor).to_have_value('5.000,00')
                expect(usar).to_be_enabled()
                expect(page.locator('#inpFatorManual')).to_have_value('')
                limpar.click()
                parcela.fill('100')
                valor.fill('4.000,00')
                expect(fator).to_have_value('0,0250')
                page.locator('#inpValorMargem').fill('100')
                page.locator('#inpTabelaManual').fill('Nome preservado')
                page.locator('#inpTaxaManual').fill('1,70')
                usar.click()
                expect(page.locator('#inpFatorManual')).to_have_value('0,0250')
                expect(page.locator('#resValor')).to_contain_text('4.000,00')
                expect(page.locator('#inpTabelaManual')).to_have_value('Nome preservado')
                expect(page.locator('#inpTaxaManual')).to_have_value('1,70')
                expect(page.locator('#slBanco')).to_have_value('')
                print(f'PASS: expansível fechada por padrão; cálculo de valor e fator; aplicação explícita sem alterar outros dados ({prefix or "/"})')

                limpar.click()
                expect(usar).to_be_disabled()
                expect(page.locator('#inpFatorManual')).to_have_value('0,0250')
                fator.fill('0.02')
                valor.fill('5.000,00')
                expect(parcela).to_have_value('100,00')
                page.locator('label:has(#modoParcela)').click()
                page.locator('#inpValorDesejado').fill('5.000,00')
                usar.click()
                expect(page.locator('#resParcela')).to_contain_text('100,00')
                limpar.click()
                parcela.fill('100')
                fator.fill('0')
                expect(page.locator('#sim-calc-status')).to_contain_text('maior que zero')
                expect(usar).to_be_disabled()
                fator.fill('-0,02')
                expect(usar).to_be_disabled()
                fator.fill('0,02')
                expect(usar).to_be_enabled()
                valor.fill('0')
                expect(usar).to_be_disabled()
                valor.fill('5000')
                expect(usar).to_be_enabled()
                print('PASS: cálculo de parcela, limpeza isolada e validação de zero/negativos')

                for width in [320, 390, 768, 1366, 1920]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow {width}px'
                    assert calc.evaluate('(e)=>e.scrollWidth <= e.clientWidth+1')
                    if width in [390, 1366]:
                        nome = 'mobile' if width == 390 else 'desktop'
                        page.locator('#sim-operacao').screenshot(path=str(Path(os.environ['TEMP']) / f'ominidata-simulador-calculadora-{nome}.png'))
                page.set_viewport_size({'width': 1366, 'height': 900})
                page.locator('#slBanco').select_option('BancodoBrasil')
                page.locator('#slOrigemFator').select_option('tabela')
                expect(calc).to_be_hidden()
                expect(calc).not_to_have_attribute('open', '')
                expect(page.locator('#inpFatorManual')).to_have_attribute('readonly', '')
                page.locator('#slOrigemFator').select_option('manual')
                expect(calc).to_be_visible()
                expect(calc).not_to_have_attribute('open', '')
                expect(page.locator('#inpFatorManual')).to_have_value('0,0200')
                print('PASS: layout sem overflow de 320 a 1920px; tabela cadastrada oculta e fecha a calculadora')

                page.goto(base + prefix + '/pages/base-fatores.html')
                bf_parcela = page.locator('#bf-calcParcela')
                bf_fator = page.locator('#bf-calcFator')
                bf_valor = page.locator('#bf-calcValor')
                bf_limpar = page.locator('#bf-calcLimpar')
                bf_parcela.fill('100')
                bf_fator.fill('0,02')
                expect(bf_valor).to_have_value('5.000,00')
                bf_limpar.click()
                bf_parcela.fill('100')
                bf_valor.fill('5000')
                expect(bf_fator).to_have_value('0,0200')
                bf_limpar.click()
                bf_fator.fill('0,02')
                bf_valor.fill('5000')
                expect(bf_parcela).to_have_value('100,00')
                print('PASS: Base de Fatores preserva os três cálculos com o mesmo componente')

                page.goto(base + prefix + '/index.html')
                for _ in range(2):
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=simulador]').click()
                    expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                    expect(page.locator('#sim-calculadora-fator')).to_be_visible()
                    page.locator('#sim-calculadora-fator > summary').click()
                    page.locator('#sim-calc-parcela').fill('100')
                    page.locator('#sim-calc-valor').fill('5000')
                    expect(page.locator('#sim-calc-fator')).to_have_value('0,0200')
                    page.locator('#sim-calc-usar').click()
                    expect(page.locator('#inpFatorManual')).to_have_value('0,0200')
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=pesquisa]').click()
                    expect(page.locator('.pesquisa-wrap')).to_be_visible()
                print('PASS: reinicialização pelo menu sem duplicar eventos')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

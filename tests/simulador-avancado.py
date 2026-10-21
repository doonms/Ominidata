"""Valida a Pesquisa Avançada no Simulador, com Supabase simulado e sem gravações reais."""
import json
import os
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
REGRAS = json.loads(json.dumps(QA['REGRAS']))
REGRAS[0].update(documentos=['RG', 'CNH'], outrosDocs='Comprovante "novo" <cliente>',
    precisaVideo=True, precisaVideoObs='Conferir "documento" <cliente> & assinatura.',
    naoAssina_precisaEnviarFisico=True, contrato60=True, contrato60_estados='SP, RJ',
    contrato60_enviarEmail=True, teimosinha='5 dias')


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
            context.add_init_script('window.__qaRegras=' + json.dumps(REGRAS) + ';'
                'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));'
                'localStorage.setItem("ominidata_base_fatores_v1",' + json.dumps(json.dumps(QA['FATORES'])) + ');')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 and any(k in r.url for k in ['.css', '.js']) else None)
            page.on('dialog', lambda d: (errors.append(d.message), d.dismiss()))
            for prefix in ['', '/Ominidata']:
                page.goto(base + prefix + '/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                expect(page.locator('#sim-modo-rapido')).to_be_checked()
                expect(page.locator('.sim-bank-advanced-details')).to_have_count(0)
                expect(page.locator('#modoLiberado')).to_be_checked()
                page.locator('#inpValorMargem').fill('100')
                page.locator('#inpFatorManual').fill('0,02')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                page.locator('#sim-idade').fill('65')
                page.locator('#sim-assina').select_option('nao')
                page.locator('#sim-p-margem').check()
                page.locator('#sim-nome').fill('Banco do Brasil')
                expect(page.locator('.sim-bank-card')).to_have_count(1)
                page.locator('label:has(#sim-modo-avancado)').click()
                expect(page.locator('#sim-bank-results')).to_have_class('sim-bank-results is-advanced')
                expect(page.locator('.sim-bank-card')).to_have_count(1)
                expect(page.locator('.sim-bank-detail-value')).to_have_text(['65 anos', '84x'])
                expect(page.locator('.sim-bank-advanced-body')).to_be_hidden()
                page.locator('.sim-bank-advanced-details > summary').click()
                body = page.locator('.sim-bank-advanced-body')
                expect(body).to_be_visible()
                for texto in ['Documentos aceitos', 'CNH', 'Procedimentos', 'Vídeo chamada',
                              'Perfis aceitos', 'Regras para cliente não assinante',
                              'Contrato 60+', 'SP, RJ', 'Teimosinha', 'Prazos por idade']:
                    expect(body).to_contain_text(texto)
                expect(body).to_contain_text('Margem: condição a partir de 60 anos.')
                expect(body).not_to_contain_text('Margem: condição para menores de 60.')
                expect(body).to_contain_text('Conferir "documento" <cliente> & assinatura.')
                assert body.locator('cliente').count() == 0
                assert body.locator('.chip[title]').filter(has_text='Vídeo chamada').get_attribute('title') == 'Conferir "documento" <cliente> & assinatura.'
                expect(page.locator('#inpFatorManual')).to_have_value('0,02')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                print(f'PASS: Avançado reutiliza seções da Pesquisa, respeita filtros e não altera o cálculo em {prefix or "/"}')

                for width in [320, 390, 768, 1366, 1920]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow {width}px'
                    if width in [390, 1366]:
                        nome = 'mobile' if width == 390 else 'desktop'
                        page.locator('#sim-pesquisa-bancos').screenshot(path=str(Path(os.environ['TEMP']) / f'ominidata-simulador-avancado-{nome}.png'))
                page.set_viewport_size({'width': 1366, 'height': 900})
                page.locator('label:has(#sim-modo-rapido)').click()
                expect(page.locator('.sim-bank-advanced-details')).to_have_count(0)
                expect(page.locator('#sim-idade')).to_have_value('65')
                expect(page.locator('#sim-assina')).to_have_value('nao')
                expect(page.locator('#sim-p-margem')).to_be_checked()
                expect(page.locator('#sim-nome')).to_have_value('Banco do Brasil')
                page.locator('label:has(#sim-modo-avancado)').click()
                page.locator('.sim-bank-simulate').click()
                expect(page.locator('#slBanco')).to_have_value('BancodoBrasil')
                expect(page.locator('#slOrigemFator')).to_have_value('tabela')
                expect(page.locator('#slPrazo')).to_have_value('84')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                print('PASS: alternância preserva filtros, layouts de 320 a 1920px e clique carrega a tabela/prazo corretos')

                page.locator('#sim-nome').fill('inexistente')
                expect(page.locator('.sim-bank-card')).to_have_count(0)
                expect(page.locator('#sim-search-status')).to_contain_text('Nenhum banco atende')
                page.locator('#sim-search-form button[type=reset]').click()
                expect(page.locator('#sim-modo-rapido')).to_be_checked()
                expect(page.locator('.sim-bank-card')).to_have_count(4)
                page.locator('#sim-idade').fill('65')
                page.locator('#sim-especie').select_option('loas')
                page.locator('#sim-p-cartao').check()
                page.locator('label:has(#sim-modo-avancado)').click()
                expect(page.locator('.sim-bank-card')).to_have_count(1)
                page.locator('.sim-bank-advanced-details > summary').click()
                expect(body).to_contain_text('LOAS 87')
                expect(body).to_contain_text('LOAS 88')
                page.locator('.sim-bank-option img').click()
                expect(page.locator('#slBanco')).to_have_value('Banco LOAS')
                expect(page.locator('#slOrigemFator')).to_have_value('manual')
                expect(page.locator('#inpPrazoManual')).to_have_value('96')
                page.locator('#sim-p-saque').check()
                expect(page.locator('.sim-bank-card')).to_have_count(0)
                page.locator('#sim-search-form button[type=reset]').click()
                page.locator('#sim-idade').fill('65')
                page.locator('#sim-p-margem').check()
                page.locator('#sim-p-cartao').check()
                page.locator('label:has(#sim-modo-avancado)').click()
                expect(page.locator('.sim-bank-card')).to_have_count(0)
                print('PASS: LOAS, banco sem fatores, produtos combinados, estado vazio e limpeza preservados')

                # O módulo compartilhado é importado primeiro no Simulador; depois a Pesquisa deve funcionar normalmente.
                page.goto(base + prefix + '/index.html')
                for _ in range(2):
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=simulador]').click()
                    expect(page.locator('#sim-modo-rapido')).to_be_checked()
                    page.locator('label:has(#sim-modo-avancado)').click()
                    expect(page.locator('.sim-bank-advanced-details')).to_have_count(4)
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=pesquisa]').click()
                    expect(page.locator('.pesquisa-wrap')).to_have_attribute('data-layout-inicializado', 'true')
                    page.locator('#f-idade').fill('65')
                    page.locator('#f-assina').select_option('nao')
                    page.locator('#p-margem').check()
                    page.locator('label:has([name=modoPesquisa][value=avancado])').click()
                    expect(page.locator('#results .f-card')).to_have_count(1)
                    page.locator('#results summary').click()
                    expect(page.locator('#results .f-body')).to_contain_text('Documentos aceitos')
                print('PASS: modos independentes e reinicialização correta ao alternar Simulador/Pesquisa pelo menu')
            assert not errors, errors
            print('PASS: nenhuma exceção JS, alerta de navegação ou erro CSS/JS')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

"""Cadastro CLT isolado: persistência, validação, seguro, JSON, SPA e layout."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
KEY = 'ominidata_base_clt_v1'


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='block', accept_downloads=True, viewport={'width': 1440, 'height': 1100})
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=QA['STUB']))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';'
                    'if(!localStorage.getItem("ominidata_base_inss_v1"))localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));')
                page = ctx.new_page()
                errors, writes = [], []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.on('response', lambda r:errors.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 and any(s in r.url for s in ['.js', '.css']) else None)
                page.on('request', lambda r:writes.append(r.url) if r.method not in ['GET', 'HEAD'] else None)
                accept = [True]
                page.on('dialog', lambda d:d.accept() if accept[0] else d.dismiss())
                base = f'http://127.0.0.1:{server.server_port}{prefix}'
                page.goto(base + '/pages/base-clt.html')
                expect(page.locator('#clt-vazio')).to_be_visible()
                initial_inss = page.evaluate('localStorage.getItem("ominidata_base_inss_v1")')
                page.locator('#clt-adicionar').click()
                card = page.locator('.clt-bank')
                expect(card).to_have_attribute('open', '')
                expect(card.locator('[data-field=nome]')).to_be_focused()
                card.locator('[data-field=nome]').fill('Ágil <teste>')
                for field, value in [('tempoEmpresaMeses', '12'), ('idadeMinima', '18'), ('idadeMaxima', '65'),
                                     ('minimoFuncionarios', '20'), ('tempoCnpjMeses', '24')]:
                    card.locator(f'[data-field={field}]').fill(value)
                expect(card.locator('.clt-bank-name')).to_have_text('Ágil <teste>')
                assert card.locator('teste').count() == 0
                expect(card.locator('.clt-insurance-description')).to_be_hidden()
                card.locator('[data-field=seguro]').select_option('opcional')
                expect(card.locator('.clt-insurance-description')).to_be_visible()
                page.locator('#clt-exportar').click()
                expect(page.locator('#clt-status')).to_contain_text('Confira o campo')
                card.locator('[data-field=seguroDescricao]').fill('Desconto de R$ 50,00; confirmar condições do banco.')
                card.locator('[data-field=observacoes]').fill('Regra CLT exclusiva <cliente>.')
                card.locator('[data-field=suspenso]').check()
                expect(card).to_have_class('clt-bank is-suspended')
                card.locator('[data-field=idadeMinima]').fill('70')
                page.locator('#clt-exportar').click()
                expect(page.locator('#clt-status')).to_contain_text('Confira o campo')
                card.locator('[data-field=idadeMinima]').fill('18')
                card.locator('[data-field=tempoEmpresaMeses]').fill('-1')
                page.locator('#clt-exportar').click()
                expect(page.locator('#clt-status')).to_contain_text('Confira o campo')
                card.locator('[data-field=tempoEmpresaMeses]').fill('12')
                with page.expect_download() as download:
                    page.locator('#clt-exportar').click()
                exported = json.loads(Path(download.value.path()).read_text(encoding='utf8'))
                assert exported['tipo'] == 'base_clt' and exported['bancos'][0]['tempoEmpresaMeses'] == 12
                assert exported['bancos'][0]['seguro'] == 'opcional'
                assert page.evaluate('localStorage.getItem("ominidata_base_inss_v1")') == initial_inss
                page.reload()
                expect(card).not_to_have_attribute('open', '')
                card.locator('summary').click()
                expect(card.locator('[data-field=tempoCnpjMeses]')).to_have_value('24')
                expect(card.locator('[data-field=seguroDescricao]')).to_have_value('Desconto de R$ 50,00; confirmar condições do banco.')
                card.locator('[data-field=seguro]').select_option('nao')
                expect(card.locator('.clt-insurance-description')).to_be_hidden()
                with page.expect_download() as download:
                    page.locator('#clt-exportar').click()
                no_insurance = json.loads(Path(download.value.path()).read_text(encoding='utf8'))
                assert no_insurance['bancos'][0]['seguroDescricao'] == ''
                card.locator('[data-field=seguro]').select_option('obrigatorio')
                expect(card.locator('[data-field=seguroDescricao]')).to_have_value('Desconto de R$ 50,00; confirmar condições do banco.')
                print('PASS: campos, seguro condicional, validação, persistência e exportação sem misturar INSS', prefix)

                page.locator('#clt-adicionar-fim').click()
                second = page.locator('.clt-bank').last
                second.locator('[data-field=nome]').fill('Banco Teste')
                second.locator('[data-field=minimoFuncionarios]').fill('0')
                page.locator('#clt-busca').fill('agil')
                expect(page.locator('.clt-bank:visible')).to_have_count(1)
                page.locator('#clt-busca').fill('inexistente')
                expect(page.locator('#clt-sem-resultados')).to_be_visible()
                page.locator('#clt-busca').fill('')
                second.locator('[data-field=nome]').fill('ÁGIL <TESTE>')
                page.locator('#clt-exportar').click()
                expect(page.locator('#clt-status')).to_contain_text('mesmo nome')
                second.locator('[data-field=nome]').fill('Banco Teste')
                before_import = page.evaluate(f'localStorage.getItem("{KEY}")')
                def upload(data):
                    page.locator('#clt-importar').set_input_files({'name': 'base.json', 'mimeType': 'application/json', 'buffer': json.dumps(data).encode()})
                upload(QA['REGRAS'])
                expect(page.locator('#clt-status')).to_contain_text('Não foi possível importar')
                assert page.evaluate(f'localStorage.getItem("{KEY}")') == before_import
                accept[0] = False
                upload(exported)
                expect(page.locator('#clt-importar')).to_have_value('')
                assert page.evaluate(f'localStorage.getItem("{KEY}")') == before_import
                accept[0] = True
                upload(exported)
                expect(page.locator('#clt-status')).to_contain_text('importada')
                expect(page.locator('.clt-bank')).to_have_count(1)
                expect(page.locator('.clt-bank')).not_to_have_attribute('open', '')
                assert page.evaluate('localStorage.getItem("ominidata_base_clt_antes_importacao_v1")') == before_import
                page.locator('.clt-bank summary').click()
                for width in [320, 390, 768, 1440]:
                    page.set_viewport_size({'width': width, 'height': 1100})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), width
                    if not prefix and width in [390, 1440]:
                        page.screenshot(path=str(Path(gettempdir()) / f'ominidata-base-clt-{width}.png'), full_page=True)
                page.set_viewport_size({'width': 1440, 'height': 1100})
                print('PASS: busca, duplicidades, cancelamento, importação isolada, backup e layout 320–1440px', prefix)

                page.goto(base + '/index.html')
                expect(page.locator('#sidebar a[data-nav=base_clt]')).to_have_attribute('href', './pages/base-clt.html')
                page.locator('#menuBtn').click()
                page.locator('#sidebar a[data-nav=base_clt]').click()
                expect(page.locator('.clt-bank')).to_have_count(1)
                expect(page.locator('body')).to_have_class('od-page')
                page.locator('.clt-bank summary').click()
                page.locator('.clt-remover').click()
                expect(page.locator('#clt-vazio')).to_be_visible()
                page.reload()
                expect(page.locator('#clt-vazio')).to_be_visible()
                assert page.evaluate('localStorage.getItem("ominidata_base_inss_v1")') == initial_inss
                # JSON quebrado não é sobrescrito por uma lista vazia silenciosamente.
                page.evaluate(f'localStorage.setItem("{KEY}","{{quebrado")')
                page.reload()
                expect(page.locator('#clt-status')).to_contain_text('original foi preservado')
                expect(page.locator('#clt-adicionar')).to_be_disabled()
                assert page.evaluate(f'localStorage.getItem("{KEY}")') == '{quebrado'
                upload({'tipo': 'base_clt', 'versao': 1, 'bancos': []})
                expect(page.locator('#clt-adicionar')).to_be_enabled()
                assert page.evaluate('localStorage.getItem("ominidata_base_clt_antes_importacao_v1")') == '{quebrado'
                assert not errors, errors
                assert not writes, writes
                print('PASS: navegação SPA, exclusão persistente, recuperação de JSON corrompido e nenhuma gravação remota', prefix)
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

"""Desktop com tabela/cálculo lado a lado, mobile empilhado e todos os controles preservados."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-multiplas.py')))


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QA']['QuietHandler'], directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='block', viewport={'width':1440, 'height':1000})
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=QA['STUB']))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps(QA['QA']['REGRAS']) + ';window.__qaFatoresRemotos=' + json.dumps(QA['REMOTOS']) + ';')
                page = ctx.new_page(); errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                page.get_by_role('button', name='Só simulação', exact=True).click()
                page.locator('#slBanco').select_option('BancodoBrasil')
                page.locator('#slOrigemFator').select_option('tabela')
                page.locator('#inpValorMargem').fill('100')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                expect(page.locator('#sim-tabela-busca')).to_be_visible()
                for width in [320,390,768,1024,1100,1366,1440,1920]:
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), width
                    layout = page.evaluate('''()=>{
                      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};};
                      return {left:rect('.sim-selection-pane'),right:rect('.sim-calculation-pane'),result:rect('#sim-result'),multi:rect('#sim-multiplas')};
                    }''')
                    if width >= 1100:
                        assert layout['right']['x'] >= layout['left']['right'] + 15, (width, layout)
                        assert abs(layout['left']['y'] - layout['right']['y']) < 1, (width, layout)
                        assert layout['result']['x'] >= layout['right']['x'], (width, layout)
                    else:
                        assert layout['right']['y'] >= layout['left']['bottom'] - 1, (width, layout)
                    assert layout['multi']['y'] >= max(layout['left']['bottom'],layout['right']['bottom']) - 1, (width, layout)
                    if not prefix and width in [390,1440]:
                        page.locator('#sim-operacao').screenshot(path=str(Path(gettempdir()) / f'ominidata-simulador-colunas-{width}.png'))
                ids = page.locator('[id]').evaluate_all('els=>els.map(e=>e.id)')
                assert len(ids) == len(set(ids)), 'IDs duplicados'
                assert page.locator('.sim-selection-pane #slTabela').count() == 1
                assert page.locator('.sim-calculation-pane #inpFatorManual').count() == 1
                assert page.locator('.sim-calculation-pane #sim-result').count() == 1
                page.locator('#sim-table-choices button').filter(has_text='Tabela B').click()
                expect(page.locator('#resValor')).to_contain_text('3.333,33')
                page.locator('#slOrigemFator').select_option('manual')
                page.locator('#inpFatorManual').fill('0,02')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                page.locator('#sim-calculadora-fator > summary').click()
                expect(page.locator('#sim-calc-parcela')).to_be_visible()
                page.locator('#sim-multiplas > summary').click()
                expect(page.locator('.sim-multi-manual-row').first).to_be_visible()
                anteriores = page.locator('.sim-multi-manual-row').count()
                page.locator('#sim-multi-adicionar').click()
                expect(page.locator('.sim-multi-manual-row')).to_have_count(anteriores + 1)
                page.locator('#sim-operacao > summary').click()
                expect(page.locator('.sim-selection-pane')).to_be_hidden()
                expect(page.locator('.sim-calculation-pane')).to_be_hidden()
                page.locator('#sim-operacao > summary').click()
                expect(page.locator('#inpValorMargem')).to_be_visible()
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                assert not errors, errors
                print('PASS: colunas 1100–1920px, empilhado 320–1024px, controles/cálculos/comparação/retrátil preservados', prefix)
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

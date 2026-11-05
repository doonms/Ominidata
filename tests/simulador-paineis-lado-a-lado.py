"""Pesquisa e simulação adaptáveis: dois painéis, foco em um, dados e origens preservados."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('clt-supabase-simulador.py')))
FLUXO = QA['QA']['QA']


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(FLUXO['QuietHandler'], directory=str(FLUXO['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='block', viewport={'width':1440, 'height':1000})
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=QA['STUB']))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps(FLUXO['REGRAS']) + ';window.__qaFatoresRemotos=' + json.dumps(QA['QA']['REMOTOS']) + ';'
                    'window.__qaOutros=' + json.dumps([dict(banco_id=b['banco_id'],nome=b['nome'],suspenso=b.get('suspenso',False),dados=b) for b in QA['QA']['BASE']]) + ';'
                    'localStorage.setItem("__qaCltServidor",' + json.dumps(json.dumps(QA['rows'](QA['BASE']))) + ');')
                page = ctx.new_page(); errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                layout = page.locator('#sim-panels-layout')
                workspace = page.locator('#sim-operacao')
                search = page.locator('#sim-pesquisa-bancos')
                expect(layout).to_have_attribute('data-view', 'both')
                page.locator('#slBanco').select_option('BancodoBrasil')
                page.locator('#slOrigemFator').select_option('tabela')
                page.locator('#inpValorMargem').fill('100')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                for width in [320,390,768,1024,1100,1366,1440,1920]:
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), width
                    rect = page.evaluate('''()=>{
                      const get=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};};
                      return {search:get('#sim-pesquisa-bancos'),simulation:get('#sim-operacao'),filters:get('.sim-search-fields'),selection:get('.sim-selection-pane'),calculation:get('.sim-calculation-pane')};
                    }''')
                    if width >= 1100:
                        assert rect['simulation']['x'] > rect['search']['right'], (width,rect)
                        assert abs(rect['simulation']['y']-rect['search']['y'])<1, (width,rect)
                        assert rect['calculation']['y'] >= rect['selection']['bottom']-1, (width,rect)
                        assert page.locator('.sim-search-fields').first.evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length') == 2
                    else:
                        assert rect['simulation']['y'] >= rect['search']['bottom']-1, (width,rect)
                    assert search.locator('.sim-bank-card').evaluate_all('els=>els.every(e=>e.scrollHeight<=e.clientHeight+1)'), width
                    if not prefix and width in [390,1440]:
                        page.screenshot(path=str(Path(gettempdir()) / f'ominidata-simulador-paineis-{width}.png'), full_page=True)
                page.set_viewport_size({'width':1440,'height':1000})
                saved = page.evaluate('Object.fromEntries(["slBanco","slPrazo","slTabela","inpFatorManual"].map(id=>[id,document.getElementById(id).value]))')
                page.get_by_role('button', name='Só simulação', exact=True).click()
                expect(layout).to_have_attribute('data-view', 'simulation')
                expect(page.locator('#sim-search-body')).to_be_hidden()
                expect(page.locator('#sim-operation-body')).to_be_visible()
                assert workspace.bounding_box()['width'] > 1300
                assert page.locator('.sim-calculation-pane').bounding_box()['x'] > page.locator('.sim-selection-pane').bounding_box()['x']
                page.get_by_role('button', name='Só encontrar banco', exact=True).click()
                expect(layout).to_have_attribute('data-view', 'search')
                expect(page.locator('#sim-operation-body')).to_be_hidden()
                expect(page.locator('#sim-search-body')).to_be_visible()
                assert search.bounding_box()['width'] > 1300
                page.get_by_role('button', name='Ver os dois', exact=True).click()
                expect(layout).to_have_attribute('data-view', 'both')
                assert page.evaluate('Object.fromEntries(["slBanco","slPrazo","slTabela","inpFatorManual"].map(id=>[id,document.getElementById(id).value]))') == saved
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                # Recolher pelo próprio título tem o mesmo efeito dos atalhos.
                search.locator(':scope > summary').click()
                expect(layout).to_have_attribute('data-view', 'simulation')
                expect(page.get_by_role('button', name='Só simulação', exact=True)).to_have_attribute('aria-pressed', 'true')
                workspace.locator(':scope > summary').click()
                expect(layout).to_have_attribute('data-view', 'none')
                expect(search.locator(':scope > summary')).to_be_visible()
                expect(workspace.locator(':scope > summary')).to_be_visible()
                page.get_by_role('button', name='Ver os dois', exact=True).click()
                page.locator('label:has(#sim-modo-avancado)').click()
                expect(page.locator('#sim-bank-results')).to_have_class('sim-bank-results is-advanced')
                assert page.locator('#sim-bank-results').evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length') == 1
                page.locator('.sim-bank-advanced-details > summary').first.click()
                expect(page.locator('.sim-bank-advanced-body').first).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                print('PASS: painéis lado a lado no desktop; foco em um ocupa largura inteira; recolher/reabrir conserva campos, resultado e modo avançado', prefix)

                page.locator('[name=simBaseConsulta][value=outros]').check()
                expect(page.locator('#sim-pesquisa-outros')).to_be_visible()
                expect(search).to_be_hidden()
                expect(layout).to_have_attribute('data-view', 'both')
                page.locator('[name=simBaseConsulta][value=clt]').check()
                expect(page.locator('#sim-pesquisa-clt')).to_be_visible()
                expect(page.locator('#sim-pesquisa-outros')).to_be_hidden()
                page.locator('#sim-clt-tempo-empresa').fill('12')
                expect(page.locator('#sim-clt-results .sim-bank-card')).to_have_count(3)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                page.get_by_role('button', name='Só encontrar banco', exact=True).click()
                expect(page.locator('#sim-operation-body')).to_be_hidden()
                assert page.locator('#sim-pesquisa-clt').bounding_box()['width'] > 1300
                page.get_by_role('button', name='Só simulação', exact=True).click()
                expect(page.locator('#sim-clt-body')).to_be_hidden()
                page.get_by_role('button', name='Ver os dois', exact=True).click()
                expect(page.locator('#sim-clt-tempo-empresa')).to_have_value('12')
                page.locator('[name=simBaseConsulta][value=inss]').check()
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                ids = page.locator('[id]').evaluate_all('els=>els.map(e=>e.id)')
                assert len(ids) == len(set(ids))
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/index.html')
                for view, expected in [('Só simulação','simulation'), ('Só encontrar banco','search')]:
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=simulador]').click()
                    expect(layout).to_have_attribute('data-view', 'both')
                    page.get_by_role('button', name=view, exact=True).click()
                    expect(layout).to_have_attribute('data-view', expected)
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=pesquisa]').click()
                    expect(page.locator('#btn-search')).to_be_visible()
                assert not errors, errors
                print('PASS: INSS/Outros/CLT seguem a mesma visualização; nenhum ID duplicado ou erro JS; mobile empilhado', prefix)
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

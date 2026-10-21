"""Layout das páginas antigas e fluxos de Outros Convênios, sem dados reais."""
import json
import math
import re
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
OUTROS = [dict(nome='Banco do Brasil', convenios=[
    dict(id='pref-1', tipo='prefeitura', nome='Prefeitura de Belo Horizonte', fazMargem=True,
         fazCartao=True, prazosCartao=[dict(idade='18-75', parcelas='96', obs='Regra de teste')]),
    dict(id='gov-1', tipo='governo', nome='Governo de Minas Gerais'),
    dict(id='siape-1', tipo='siape', nome='SIAPE Federal')]),
    dict(nome='Banco Livre', convenios=[dict(id='pref-2', tipo='prefeitura', nome='Prefeitura de Contagem')])]
KEY = 'ominidata_base_outros_convenios_v1'
STUB = QA['STUB'].replace('auth: { getUser:', """auth: {
  signInWithPassword: async credentials => {
    window.__qaLogin = credentials;
    return {data:null,error:{message:'Credenciais de teste inválidas'}};
  }, getUser:""")


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                context = browser.new_context(viewport={'width':1440, 'height':1000}, service_workers='block', accept_downloads=True)
                context.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=STUB))
                context.route('https://**/*', lambda r:r.abort())
                context.add_init_script(
                    'window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';'
                    'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));'
                    'if(!localStorage.getItem("' + KEY + '"))localStorage.setItem("' + KEY + '",' + json.dumps(json.dumps(OUTROS)) + ');'
                    'if(!localStorage.getItem("ominidata_base_fatores_v1"))localStorage.setItem("ominidata_base_fatores_v1",' + json.dumps(json.dumps(QA['FATORES'])) + ');')
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}')
                        if r.status >= 400 and any(s in r.url for s in ['.js','.css']) else None)
                page.on('dialog', lambda d:d.accept())
                base = f'http://127.0.0.1:{server.server_port}' + prefix

                routes = ['index.html', 'pages/base-outros-convenios.html', 'pages/base-inss.html',
                          'pages/contatos.html', 'pages/bancos.html', 'pages/base-credito-pessoal.html',
                          'pages/fatores-do-dia.html', 'pages/login.html', 'pages/importar-inss.html',
                          'pages/simulador-port.html']
                for route in routes:
                    page.goto(base + '/' + route)
                    expect(page.locator('h1')).to_be_visible()
                    if route.endswith('base-inss.html'):
                        expect(page.locator('#list .card').first).to_be_visible()
                    if route.endswith('contatos.html'):
                        expect(page.locator('#bankList .bank-card').first).to_be_visible()
                    for width in [320,390,768,1440]:
                        page.set_viewport_size({'width':width,'height':1000})
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow {route} {width}'
                        if width in [390,1440]:
                            name = route.split('/')[-1].replace('.html','')
                            page.screenshot(path=str(Path(gettempdir()) / f'ominidata-layout-{name}-{width}.png'), full_page=True)
                print(f'PASS: 10 páginas modernizadas, cabeçalhos, campos e layout 320–1440px ({prefix or "/"})')

                page.set_viewport_size({'width':1440,'height':1000})
                page.goto(base + '/pages/base-outros-convenios.html')
                expect(page.locator('#list > .card')).to_have_count(2)
                banco = page.locator('.banco-outros-card').filter(has=page.locator('[data-toggle-banco="0"]'))
                banco.locator('[data-toggle-banco]').click()
                expect(banco.locator('.card-body')).to_be_visible()
                expect(banco.locator('[data-toggle-banco]')).to_have_attribute('aria-expanded','true')
                for conv_id in ['pref-1','gov-1','siape-1']:
                    page.locator(f'[data-toggle-convenio="0:{conv_id}"]').click()
                    expect(page.locator(f'[data-convenio="{conv_id}"] .convenio-body')).to_be_visible()
                search = page.locator('[data-convenio-search="0"]')
                search.press_sequentially('SIAPE')
                expect(search).to_be_focused()
                expect(banco.locator('.convenio-card')).to_have_count(1)
                expect(banco.locator('.convenio-card')).to_contain_text('SIAPE Federal')
                search.fill('')
                expect(banco.locator('.convenio-card')).to_have_count(3)
                pref = page.locator('[data-convenio="pref-1"]')
                pref.locator('[data-conv-field$=":fazRefin"]').check()
                pref.locator('[data-conv-field$=":aceitaCeletista"]').check()
                pref.locator('[data-conv-field$=":aceitaTemporario"]').check()
                pref.locator('[data-conv-field$=":perfisOutros"]').fill('Comissionados')
                cartao = pref.locator('[data-conv-operacao="prazosCartao"]')
                cartao.locator('[data-conv-add-prazo]').click()
                expect(cartao.locator('.prazo-row')).to_have_count(2)
                cartao.locator('[data-conv-prazo$="1:idade"]').fill('60-70')
                cartao.locator('[data-conv-prazo$="1:parcelas"]').fill('84')
                cartao.locator('[data-conv-prazo$="1:obs"]').fill('Condição revisada')
                assert page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))[0].convenios[0].fazRefin')
                assert page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))[0].convenios[0].aceitaCeletista')
                assert page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))[0].convenios[0].perfisOutros') == 'Comissionados'
                for width in [320,390,768,1440]:
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow editor {width}'
                    if width in [390,1440]:
                        page.screenshot(path=str(Path(gettempdir()) / f'ominidata-layout-outros-aberto-{width}.png'), full_page=True)
                        page.evaluate('scrollTo(0,0)')
                        page.screenshot(path=str(Path(gettempdir()) / f'ominidata-layout-outros-topo-{width}.png'))
                with page.expect_download() as download:
                    page.locator('#save').click()
                exported = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
                assert exported[0]['convenios'][0]['prazosCartao'][1]['obs'] == 'Condição revisada'
                page.locator('#file').set_input_files(dict(name='local.json', mimeType='application/json', buffer=json.dumps(exported).encode()))
                expect(page.locator('#list > .card')).to_have_count(2)
                page.locator('#add').click()
                expect(page.locator('#list > .card')).to_have_count(3)
                print('PASS: Outros Convênios mantém bancos, tipos, busca contínua, perfis, operações, prazos, importação e exportação')

                page.goto(base + '/pages/base-inss.html')
                first = page.locator('#list > .card').first
                first.locator('button[data-open]').click()
                expect(first.locator('.card-body')).to_be_visible()
                page.set_viewport_size({'width':390,'height':1000})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Overflow INSS aberto'
                page.screenshot(path=str(Path(gettempdir()) / 'ominidata-layout-inss-aberto-390.png'))
                page.set_viewport_size({'width':1440,'height':1000})
                first.locator('button[data-open]').click()
                expect(first.locator('.card-body')).to_be_hidden()

                page.goto(base + '/pages/simulador-port.html')
                for campo,valor in [('parcela','401.93'),('parcelas','51'),('taxa','1.844'),('dataBase','2026-10-21'),('primeiroVencimento','2026-11-21')]:
                    page.locator('#'+campo).fill(valor)
                page.get_by_role('button',name='Calcular saldo',exact=True).click()
                expected = page.evaluate('calcularSaldo(401.93,51,1.844,new Date("2026-10-21"),new Date("2026-11-21"))')
                saldo = page.locator('#saldo').inner_text()
                liberado = page.locator('#valorLiberado').inner_text()
                parse = lambda value:float(re.sub(r'[^0-9,.-]','',value).replace('.','').replace(',','.'))
                assert math.isclose(parse(saldo),expected,abs_tol=.01)
                assert math.isclose(parse(liberado),expected*.308,abs_tol=.01)

                page.goto(base + '/pages/login.html')
                page.locator('#loginBtn').click()
                expect(page.locator('#msg')).to_have_text('Informe usuário ou e-mail e senha.')
                page.locator('#email').fill('teste@example.com')
                page.locator('#senha').fill('senha-apenas-do-teste')
                page.locator('#senha').press('Enter')
                expect(page.locator('#msg')).to_contain_text('Credenciais de teste inválidas')
                expect(page.locator('#loginBtn')).to_be_enabled()
                assert page.evaluate('window.__qaLogin.email') == 'teste@example.com'
                assert not errors, errors
                print('PASS: expandir INSS, cálculo de portabilidade e login/Enter intactos; nenhuma exceção ou 404 de CSS/JS')
                context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

"""Compara páginas abertas diretamente com páginas carregadas pelo menu.

Requer playwright e Google Chrome. Execute: python tests/navegacao-paginas.py
As consultas são simuladas; nenhum dado remoto é alterado.
"""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
ROUTES = {
    'home': ('index.html', '.home-header'),
    'pesquisa': ('pages/pesquisa.html', '#btn-search'),
    'simulador': ('pages/simulador.html', '#inpFatorManual'),
    'base_fatores': ('pages/base-fatores.html', '#bf-slBanco'),
    'fatores_do_dia': ('pages/fatores-do-dia.html', '#bf-slBanco'),
    'base_inss': ('pages/base-inss.html', '#list .card'),
    'contatos': ('pages/contatos.html', '#bankList .bank-card'),
    'bancos': ('pages/bancos.html', '#summaryPanel .summary-card'),
    'base_outros_convenios': ('pages/base-outros-convenios.html', '#uploadBaseOutrosBtn'),
    'base_credito': ('pages/base-credito-pessoal.html', '.panel'),
}
SNAPSHOT = """() => {
  const sample = selector => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const s = getComputedStyle(node);
    return {display:s.display, padding:s.padding, background:s.backgroundImage,
      border:s.border, fontSize:s.fontSize};
  };
  return {
    styles:[...document.querySelectorAll('link[rel=stylesheet]')]
      .filter(l=>!l.disabled).map(l=>new URL(l.href).pathname).sort(),
    body:document.body.className,
    card:sample('.card'), field:sample('.search-bar input'),
    switch:sample('.switch'), panel:sample('.panel'),
    table:sample('.sim-controls')
  };
}"""


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context(viewport={'width': 1366, 'height': 768}, service_workers='block')
            context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=QA['STUB']))
            context.route('https://**/*', lambda r: r.abort())
            context.add_init_script(
                'window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';'
                'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));'
                'localStorage.setItem("ominidata_base_fatores_v1",' + json.dumps(json.dumps(QA['FATORES'])) + ');'
            )
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 and any(k in r.url for k in ['.css', '.js']) else None)
            page.on('dialog', lambda d: (errors.append(d.message), d.dismiss()))
            for prefix in ['', '/Ominidata']:
                base = f'http://127.0.0.1:{server.server_port}' + prefix
                baselines = {}
                for name, (path, selector) in ROUTES.items():
                    page.goto(base + '/' + path)
                    expect(page.locator(selector).first).to_be_visible()
                    page.mouse.move(0, 0)
                    page.wait_for_timeout(250)
                    baselines[name] = page.evaluate(SNAPSHOT)
                print(f'PASS: abertura direta das {len(ROUTES)} páginas em {prefix or "/"}')

                page.goto(base + '/index.html')
                for name in ['simulador', 'base_fatores', 'base_inss', 'contatos', 'bancos',
                             'base_outros_convenios', 'pesquisa', 'base_credito', 'simulador',
                             'pesquisa', 'contatos', 'fatores_do_dia', 'base_fatores', 'base_inss', 'home']:
                    page.locator('#menuBtn').click()
                    page.locator(f'#sidebar a[data-nav={name}]').click()
                    expect(page).to_have_url(base + '/' + ROUTES[name][0])
                    expect(page.locator(ROUTES[name][1]).first).to_be_visible()
                    page.mouse.move(0, 0)
                    page.wait_for_timeout(250)
                    actual = page.evaluate(SNAPSHOT)
                    assert actual == baselines[name], json.dumps({'route': name, 'expected': baselines[name], 'actual': actual}, ensure_ascii=False)
                print(f'PASS: 15 trocas pelo menu sem estilos acumulados em {prefix or "/"}')

                page.go_back()
                expect(page.locator('#list .card').first).to_be_visible()
                assert page.evaluate(SNAPSHOT) == baselines['base_inss']
                page.go_forward()
                expect(page.locator('.home-header')).to_be_visible()
                assert page.evaluate(SNAPSHOT) == baselines['home']
                print('PASS: voltar e avançar restauram os estilos da página')
            assert not errors, errors
            print('PASS: nenhuma exceção de JavaScript, alerta de navegação ou erro CSS/JS')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

"""Confere transparência e dimensões dos logos, sem consultas reais."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context(service_workers='block')
            context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=QA['STUB']))
            context.route('https://**/*', lambda r: r.abort())
            context.add_init_script(
                'window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';'
                'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                'localStorage.setItem("ominidata_base_outros_convenios_v1",JSON.stringify([{nome:"Banco do Brasil",convenios:[{id:"pref-1",nome:"Prefeitura",tipo:"prefeitura"}]}]));')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            for prefix in ['', '/Ominidata']:
                for nome, classe, tamanho in [
                    ('base-inss', '.logo-label-img', 44),
                    ('base-outros-convenios', '.logo-label-img', 44),
                    ('bancos', '.bank-logo', 42),
                    ('contatos', '.bank-logo', 42)
                ]:
                    page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/{nome}.html')
                    expect(page.locator(classe).first).to_be_visible()
                    for largura in [390,1440]:
                        page.set_viewport_size({'width':largura,'height':900})
                        logos = page.locator(classe).evaluate_all("""nodes => nodes.map(img => ({
                            fundo:getComputedStyle(img).backgroundColor,
                            largura:img.getBoundingClientRect().width,
                            altura:img.getBoundingClientRect().height
                        }))""")
                        assert all(img['fundo'] == 'rgba(0, 0, 0, 0)' for img in logos), (nome,logos)
                        assert all(img['largura'] == tamanho and img['altura'] == tamanho for img in logos), (nome,logos)
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                        if nome == 'base-inss':
                            page.screenshot(path=str(Path(gettempdir()) / f'ominidata-logos-transparentes-{largura}.png'))
                print(f'PASS: logos transparentes em INSS, Outros Convênios, Bancos e Contatos; tamanhos preservados no celular/desktop ({prefix or "/"})')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

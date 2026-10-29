"""404, HTML inválido, CSS indisponível e cliques concorrentes não destroem a tela."""
import json
import runpy
import time
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))


class Handler(QA['QuietHandler']):
    failure = ''

    def do_GET(self):
        path = self.path.split('?')[0]
        if path.endswith('/pages/contatos.html') and self.failure in ['slow', '404', 'html']:
            if self.failure == 'slow':
                time.sleep(1)
            else:
                status = 404 if self.failure == '404' else 200
                self.send_response(status)
                self.send_header('Content-Type', 'text/html')
                self.end_headers()
                self.wfile.write(b'<html><body>Page not found</body></html>')
                return
        if path.endswith('/css/contatos.css') and self.failure == 'css':
            self.send_error(404)
            return
        super().do_GET()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='block')
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=QA['STUB']))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';')
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                base = f'http://127.0.0.1:{server.server_port}{prefix}'
                for failure in ['404', 'html', 'css']:
                    Handler.failure = ''
                    page.goto(base + '/index.html')
                    expect(page.locator('.wrap')).not_to_have_attribute('inert', '')
                    before = page.locator('.wrap').inner_html()
                    styles = page.locator('link[rel=stylesheet]').evaluate_all('els=>els.map(e=>e.href)')
                    if failure == 'css':
                        # A página existe; somente sua folha de estilos falha.
                        Handler.failure = 'css'
                    else:
                        Handler.failure = failure
                    page.evaluate("document.querySelector('#sidebar a[data-nav=contatos]').click()")
                    expect(page.locator('#spa-navigation-error')).to_be_visible()
                    expect(page).to_have_url(base + '/index.html')
                    assert page.locator('.wrap').inner_html() == before
                    assert page.locator('link[rel=stylesheet]').evaluate_all('els=>els.map(e=>e.href)') == styles
                    Handler.failure = ''
                    page.get_by_role('button', name='Tentar novamente', exact=True).click()
                    expect(page.locator('#bankList .bank-card').first).to_be_visible()
                    expect(page).to_have_url(base + '/pages/contatos.html')
                    expect(page.locator('#spa-navigation-error')).to_have_count(0)
                print('PASS: 404/HTML de erro/CSS ausente preservam tela e estilos; tentar novamente recupera', prefix)

                page.goto(base + '/index.html')
                expect(page.locator('.wrap')).not_to_have_attribute('inert', '')
                Handler.failure = 'slow'
                page.evaluate("document.querySelector('#sidebar a[data-nav=contatos]').click()")
                page.wait_for_timeout(150)
                page.evaluate("document.querySelector('#sidebar a[data-nav=simulador]').click()")
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                expect(page).to_have_url(base + '/pages/simulador.html')
                page.wait_for_timeout(1200)
                expect(page).to_have_url(base + '/pages/simulador.html')
                expect(page.locator('#bankList')).to_have_count(0)
                expect(page.locator('#spa-navigation-error')).to_have_count(0)
                Handler.failure = ''
                page.go_back()
                expect(page.locator('.home-header')).to_be_visible()
                page.go_forward()
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                assert not errors, errors
                print('PASS: último clique vence, retorno lento não sobrescreve outra página, voltar/avançar funcionam', prefix)
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

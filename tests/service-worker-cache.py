"""SW real: atualização online, fallback offline, 404 e escopo em subpasta."""
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))


class Handler(QA['QuietHandler']):
    version = 'v1'

    def do_GET(self):
        if self.path.endswith('/qa-sw.html'):
            html = b'<script type="module" src="./js/utils/registrar-sw.js"></script><p>QA</p>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(html)
            return
        if '/css/qa-cache.css' in self.path:
            self.send_response(404 if self.version == '404' else 200)
            self.send_header('Content-Type', 'text/css')
            self.end_headers()
            self.wfile.write(self.version.encode())
            return
        super().do_GET()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='allow')
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                base = f'http://127.0.0.1:{server.server_port}{prefix}'
                page.goto(base + '/qa-sw.html')
                page.wait_for_function('navigator.serviceWorker.controller !== null')
                scope = page.evaluate('async()=> (await navigator.serviceWorker.ready).scope')
                assert scope == base + '/', scope
                assert page.evaluate('async()=> (await navigator.serviceWorker.ready).updateViaCache') == 'none'
                fetch = 'async()=> {const r=await fetch("./css/qa-cache.css");return [r.status,await r.text()]}'
                Handler.version = 'v1'
                assert page.evaluate(fetch) == [200, 'v1']
                Handler.version = 'v2'
                assert page.evaluate(fetch) == [200, 'v2'], 'Não pode usar v1 do cache quando online'
                page.wait_for_function('''async()=>{
                    const r=await (await caches.open('ominidata-cache-v53')).match(new URL('./css/qa-cache.css',location.href));
                    return r && (await r.text())==='v2';
                }''')
                Handler.version = '404'
                assert page.evaluate(fetch) == [404, '404'], 'Não pode disfarçar 404 usando v2'
                ctx.set_offline(True)
                assert page.evaluate(fetch) == [200, 'v2'], 'Falha de rede pode usar último sucesso'
                ctx.set_offline(False)
                # O worker só remove caches de versões anteriores do próprio aplicativo.
                page.evaluate('''async()=>{
                    await caches.open('outro-aplicativo-cache');
                    await caches.open('ominidata-cache-v52');
                    const r=await navigator.serviceWorker.ready;
                    await r.unregister();
                    await navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'});
                }''')
                page.wait_for_function("async()=>!(await caches.keys()).includes('ominidata-cache-v52')")
                assert page.evaluate("async()=>(await caches.keys()).includes('outro-aplicativo-cache')")
                assert not errors, errors
                print('PASS: registro no escopo correto; rede primeiro, offline, HTTP 404 e limpeza seletiva', prefix)
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

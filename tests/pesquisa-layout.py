"""Testa o layout e os dois modos da Pesquisa sem usar o Supabase real."""
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
                'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 and any(k in r.url for k in ['.css', '.js']) else None)
            page.on('dialog', lambda d: (errors.append(d.message), d.dismiss()))
            for prefix in ['', '/Ominidata']:
                page.goto(base + prefix + '/pages/pesquisa.html')
                expect(page.locator('.pesquisa-wrap')).to_have_attribute('data-layout-inicializado', 'true')
                expect(page.locator('#pesquisa-result-count')).to_have_text('Aguardando pesquisa')
                page.locator('#f-idade').fill('65')
                page.locator('#f-assina').select_option('nao')
                page.locator('#p-margem').check()
                page.locator('#f-idade').press('Enter')
                expect(page.locator('.card-rapido')).to_have_count(1)
                expect(page.locator('#pesquisa-result-count')).to_have_text('1 resultado')
                expect(page.locator('.r-v').first).to_have_text('65 anos')
                expect(page.locator('.r-obs')).to_contain_text('a partir de 60')
                expect(page.locator('.r-obs')).not_to_contain_text('menores de 60')
                print(f'PASS: busca rápida com idade/assinatura/produto e Enter em {prefix or "/"}')

                page.locator('label:has([name=modoPesquisa][value=avancado])').click()
                expect(page.locator('#results .f-card')).to_have_count(1)
                expect(page.locator('#pesquisa-mode-description')).to_contain_text('Abra um banco')
                page.locator('#results .f-card summary').click()
                expect(page.locator('#results .f-body')).to_be_visible()
                expect(page.locator('#results .f-body')).to_contain_text('Prazos por idade')
                page.screenshot(path=str(Path(os.environ['TEMP']) / 'ominidata-pesquisa-avancado-desktop.png'), full_page=True)
                for width in [320, 390, 768, 1366]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow avançado {width}px'
                    if width == 390:
                        page.screenshot(path=str(Path(os.environ['TEMP']) / 'ominidata-pesquisa-avancado-mobile.png'), full_page=True)
                page.locator('#btn-clear').click()
                expect(page.locator('#pesquisa-result-count')).to_have_text('Aguardando pesquisa')
                page.locator('#btn-search').click()
                expect(page.locator('#results .f-card')).to_have_count(4)
                expect(page.locator('#results')).not_to_contain_text('Banco Suspenso')
                print('PASS: modo Avançado, expansão, limpar e nova consulta continuam funcionando')

                page.locator('label:has([name=modoPesquisa][value=rapido])').click()
                expect(page.locator('.card-rapido')).to_have_count(3)
                card = page.locator('.card-rapido').filter(has_text='Banco do Brasil')
                toggle = card.locator('.pesquisa-expand')
                expect(toggle).to_be_visible()
                closed = card.bounding_box()['height']
                toggle.click()
                expect(toggle).to_have_attribute('aria-expanded', 'true')
                assert card.bounding_box()['height'] > closed
                toggle.click()
                expect(toggle).to_have_attribute('aria-expanded', 'false')
                expect(page.locator('#pesquisa-result-count')).to_have_text('3 resultados')

                for width in [320, 390, 768, 960, 1366, 1920]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow {width}px'
                    sizes = page.locator('.card-rapido').evaluate_all('els=>els.map(e=>e.getBoundingClientRect().height)')
                    assert max(sizes) - min(sizes) < 1 and max(sizes) <= 241, sizes
                    assert page.locator('.card-rapido').evaluate_all('els=>els.every(e=>e.scrollHeight <= e.clientHeight+1)'), f'Conteúdo fora do cartão em {width}px'
                page.set_viewport_size({'width': 1366, 'height': 900})
                page.mouse.move(0, 0)
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=str(Path(os.environ['TEMP']) / 'ominidata-pesquisa-desktop.png'), full_page=True)
                page.set_viewport_size({'width': 390, 'height': 844})
                page.screenshot(path=str(Path(os.environ['TEMP']) / 'ominidata-pesquisa-mobile.png'), full_page=True)
                print('PASS: cartões uniformes, expansão de observação e layout entre 320 e 1920px')
                page.locator('#f-especie').select_option('loas')
                page.locator('#p-cartao').check()
                page.locator('#btn-search').click()
                expect(page.locator('.card-rapido')).to_have_count(2)
                expect(page.locator('#pesquisa-result-count')).to_have_text('2 resultados')
                page.locator('#f-nome').fill('inexistente')
                page.locator('#btn-search').click()
                expect(page.locator('.f-empty')).to_contain_text('Nenhum resultado')
                expect(page.locator('#pesquisa-result-count')).to_have_text('0 resultados')

                # Módulos já importados precisam ser reinicializados ao voltar pelo menu SPA.
                page.set_viewport_size({'width': 1366, 'height': 900})
                page.goto(base + prefix + '/index.html')
                for _ in range(2):
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=pesquisa]').click()
                    expect(page.locator('.pesquisa-wrap')).to_have_attribute('data-layout-inicializado', 'true')
                    expect(page.locator('body')).to_have_class('pesquisa-page')
                    page.locator('#f-idade').fill('65')
                    page.locator('#p-margem').check()
                    page.locator('#btn-search').click()
                    expect(page.locator('.card-rapido')).to_have_count(2)
                    page.locator('label:has([name=modoPesquisa][value=avancado])').click()
                    expect(page.locator('#results .f-card')).to_have_count(2)
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=simulador]').click()
                    expect(page.locator('.sim-page')).to_be_visible()
                    expect(page.locator('body')).to_have_class('simulador-page')
                print('PASS: ambos os modos continuam funcionando após visitas repetidas pelo menu')
            assert not errors, errors
            print('PASS: sem exceções JS, alertas de navegação ou arquivos CSS/JS ausentes')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

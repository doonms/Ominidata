"""O grupo nomeado usa o mesmo grupo_fator que sincroniza os valores."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('base-fatores-injecao.py')))
SYNC = runpy.run_path(str(Path(__file__).with_name('base-fatores-sincronizacao.py')))
KEY = QA['KEY']


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QA']['QuietHandler'], directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
                context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=SYNC['STUB']))
                context.route('https://**/*', lambda r: r.abort())
                context.add_init_script('window.__qaRows=[];window.__qaWrites=[];window.__qaRanges=[];window.__qaRpcs=[];'
                    'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    f'localStorage.setItem("{KEY}",' + json.dumps(json.dumps(QA['INICIAL'])) + ');')
                page = context.new_page()
                errors, prompts = [], ['Grupo 1']
                page.on('pageerror', lambda e: errors.append(str(e)))

                def dialog(d):
                    if d.type == 'prompt':
                        d.accept(prompts.pop(0))
                    else:
                        d.accept()
                page.on('dialog', dialog)
                base = f'http://127.0.0.1:{server.server_port}' + prefix
                page.goto(base + '/pages/base-fatores.html')
                top = page.locator('.bf-bulk-tools[data-tipo=margem]:not([data-posicao])')
                tables = page.locator('#bf-listaPrazosMargem > .bf-table-card')
                a, b, c = [tables.nth(i) for i in range(3)]
                state = lambda: page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')

                a.locator('.bf-table-check').check()
                b.locator('.bf-table-check').check()
                top.locator('.bf-group-save').click()
                margem = state()['BancodoBrasil']['tabelas']['margem']
                a60, a84 = margem[0]['prazos']
                b60 = margem[1]['prazos'][0]
                c84 = margem[2]['prazos'][0]
                assert a60['fator'] == b60['fator'] == .03
                assert a60['grupo_fator'] == b60['grupo_fator'] == 'grupo-nomeado|60|Grupo 1'
                assert a84['grupo_fator'] == 'grupo-nomeado|84|Grupo 1'
                assert c84['grupo_fator'] != a84['grupo_fator']
                expect(a.locator('.bf-table-group')).to_have_text('Grupo 1')
                expect(b.locator('.bf-table-group')).to_have_text('Grupo 1')

                top.locator('.bf-bulk-clear').click()
                top.locator('.bf-group-select').select_option('Grupo 1')
                top.locator('.bf-group-apply').click()
                expect(tables.locator('.bf-table-check:checked')).to_have_count(2)
                a.locator('.bf-table-toggle').click()
                a.locator('[data-prazo="60"] .fator').fill('0,05')
                margem = state()['BancodoBrasil']['tabelas']['margem']
                assert margem[0]['prazos'][0]['fator'] == margem[1]['prazos'][0]['fator'] == .05
                assert margem[2]['prazos'][0]['fator'] == .02

                top.locator('.bf-bulk-all').click()
                expect(tables.locator('.bf-table-check:checked')).to_have_count(3)
                top.locator('.bf-group-select').select_option('Grupo 1')
                top.locator('.bf-group-apply').click()
                page.locator('#bf-injecao-prazo').select_option('84')
                page.locator('#bf-calcParcela').fill('240')
                page.locator('#bf-calcValor').fill('10000')
                page.locator('#bf-injecao-aplicar').click()
                margem = state()['BancodoBrasil']['tabelas']['margem']
                b84 = next(x for x in margem[1]['prazos'] if x['prazo'] == 84)
                assert margem[0]['prazos'][1]['fator'] == b84['fator'] == .024
                assert b84['grupo_fator'] == 'grupo-nomeado|84|Grupo 1'
                assert margem[2]['prazos'][0]['fator'] == .02

                page.locator('#bf-enviarDireto').click()
                expect(page.locator('#bf-sync-status')).to_contain_text('fatores publicados')
                assert page.evaluate('window.__qaRpcs[0].name') == 'substituir_base_fatores'
                assert page.evaluate('window.__qaRows.some(r=>r.grupo_fator==="grupo-nomeado|84|Grupo 1")')
                assert not page.evaluate('window.__qaRows.some(r=>Object.hasOwn(r,"grupo_edicao"))')

                top.locator('.bf-group-select').select_option('Grupo 1')
                top.locator('.bf-group-remove').click()
                margem = state()['BancodoBrasil']['tabelas']['margem']
                assert all(not str(p.get('grupo_fator') or '').startswith('grupo-nomeado|')
                           for t in margem[:2] for p in t['prazos'])
                assert margem[0]['prazos'][0]['fator'] == margem[1]['prazos'][0]['fator'] == .05
                assert not errors, errors
                print(f'PASS: grupo nomeado seleciona membros, sincroniza por prazo, publica em grupo_fator e desfaz sem perder valores ({prefix or "/"})')
                context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

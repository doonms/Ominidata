"""Injeção de fator pela calculadora, seleção exata e taxa compartilhada. Supabase simulado."""
import json
import math
import os
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
SYNC = runpy.run_path(str(Path(__file__).with_name('base-fatores-sync.py')))
KEY = 'ominidata_base_fatores_v1'
GRUPO = '7a19ac4e-ef29-4ae6-bb2f-a72bd7f6fa56'


def tabela(nome, prazos):
    return dict(nome=nome, prazos=prazos)


def linha(prazo, fator=.02, taxa=1.7, grupo=None):
    return dict(prazo=prazo, fator=fator, taxa=taxa, grupo_fator=grupo)


INICIAL = {
    'BancodoBrasil': dict(fazMargem=True, fazCartao=True, seguros=[], tabelas=dict(
        margem=[tabela('A > 20k "Plus"', [linha(60, .03), linha(84, grupo=GRUPO)]),
                tabela('B especial', [linha(60, .04, 2.5)]),
                tabela('C não selecionada', [linha(84, grupo=GRUPO)])],
        cartao=[tabela('Cartão', [linha(84, .06, 3)])])),
    'Bradesco': dict(fazMargem=True, fazCartao=False, seguros=[], tabelas=dict(
        margem=[tabela('Outro banco', [linha(84, .08, 4)])], cartao=[]))
}
INICIAL['BancodoBrasil']['tabelas']['margem'][0]['publico'] = dict(assinatura='sim', invalidez='nao')
INICIAL['BancodoBrasil']['tabelas']['margem'][1]['publico'] = dict(assinatura='nao', invalidez='sim')


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block', accept_downloads=True)
                context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=SYNC['STUB']))
                context.route('https://**/*', lambda r: r.abort())
                context.add_init_script('window.__qaRows=JSON.parse(sessionStorage.getItem("__qaRemoteRows")||"[]");window.__qaWrites=[];window.__qaRanges=[];'
                    'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    f'if(!localStorage.getItem("{KEY}")) localStorage.setItem("{KEY}",' + json.dumps(json.dumps(INICIAL)) + ');')
                page = context.new_page()
                errors, dialogs, cancelar = [], [], [False]
                page.on('pageerror', lambda e: errors.append(str(e)))
                def dialog(d):
                    dialogs.append(d.message)
                    d.dismiss() if cancelar[0] and d.type == 'confirm' else d.accept()
                page.on('dialog', dialog)
                base = f'http://127.0.0.1:{server.server_port}' + prefix
                page.goto(base + '/pages/base-fatores.html')
                expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
                tables = page.locator('#bf-listaPrazosMargem > .bf-table-card')
                a, b, c = [tables.nth(i) for i in range(3)]
                aplicar = page.locator('#bf-injecao-aplicar')
                prazo = page.locator('#bf-injecao-prazo')
                taxa = page.locator('#bf-injecao-taxa')
                state = lambda: page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')
                inicial = state()
                expect(aplicar).to_be_disabled()
                a.locator('.bf-table-check').check()
                b.locator('.bf-table-check').check()
                assert state() == inicial, 'Selecionar não pode substituir valores'
                assert not page.locator('teste').count()
                expect(page.locator('#bf-injecao-resumo')).to_contain_text('2 tabela(s)')
                expect(a.locator('.bf-table-body')).to_be_hidden()
                page.locator('.bf-bulk-tools[data-tipo=margem]:not([data-posicao]) .bf-bulk-inject').click()
                expect(prazo).to_be_focused()
                prazo.select_option('84')
                expect(taxa).to_have_value('1,7')
                expect(aplicar).to_be_disabled()
                page.locator('#bf-calcParcela').fill('350')
                page.locator('#bf-calcValor').fill('15000')
                expect(page.locator('#bf-calcFator')).to_have_value('0,0233333333')
                expect(aplicar).to_be_enabled()
                expect(page.locator('#bf-injecao-status')).to_contain_text('adicionado em 1')
                taxa.fill('-1')
                expect(aplicar).to_be_disabled()
                taxa.fill('abc2')
                expect(aplicar).to_be_disabled()
                taxa.fill('9' * 400)
                expect(aplicar).to_be_disabled()
                taxa.fill('2,11')
                cancelar[0] = True
                aplicar.click()
                assert state() == inicial, 'Cancelar não pode alterar os dados'
                cancelar[0] = False
                aplicar.click()
                expect(page.locator('#bf-injecao-status')).to_contain_text('Salvo neste navegador')
                gravado = state()
                margem = gravado['BancodoBrasil']['tabelas']['margem']
                la, lb, lc = margem[0]['prazos'][1], margem[1]['prazos'][1], margem[2]['prazos'][0]
                assert math.isclose(la['fator'], 350/15000, abs_tol=1e-15)
                assert la['fator'] == lb['fator'] and la['taxa'] == lb['taxa'] == '2,11'
                assert la['grupo_fator'] == lb['grupo_fator'] and la['grupo_fator'] != GRUPO
                assert lc['fator'] == .02 and lc['taxa'] == 1.7
                assert margem[0]['prazos'][0] == inicial['BancodoBrasil']['tabelas']['margem'][0]['prazos'][0]
                assert margem[1]['prazos'][0] == inicial['BancodoBrasil']['tabelas']['margem'][1]['prazos'][0]
                assert gravado['BancodoBrasil']['tabelas']['cartao'] == inicial['BancodoBrasil']['tabelas']['cartao']
                assert gravado['Bradesco'] == inicial['Bradesco']
                assert [t['nome'] for t in margem] == [t['nome'] for t in inicial['BancodoBrasil']['tabelas']['margem']]
                assert [t.get('publico') for t in margem] == [t.get('publico') for t in inicial['BancodoBrasil']['tabelas']['margem']]
                assert not page.evaluate('window.__qaWrites.length'), 'Injetar não deve publicar automaticamente'
                print(f'PASS: injeção precisa em prazo existente/novo, confirmação, fator/taxa e nomes preservados; banco, cartão e tabela não selecionados intactos ({prefix or "/"})')

                a.locator('.bf-table-toggle').click()
                a.locator('[data-prazo="84"] .taxa').fill('2,20')
                b.locator('.bf-table-toggle').click()
                expect(b.locator('[data-prazo="84"] .taxa')).to_have_value('2,20')
                a.locator('[data-prazo="84"] .fator').fill('0,04')
                expect(b.locator('[data-prazo="84"] .fator')).to_have_value('0,0400')
                atual = state()['BancodoBrasil']['tabelas']['margem']
                assert atual[2]['prazos'][0]['fator'] == .02 and atual[2]['prazos'][0]['taxa'] == 1.7
                a.locator('[data-prazo="84"] .taxa').fill('')
                expect(b.locator('[data-prazo="84"] .taxa')).to_have_value('')
                prazo.select_option('outro')
                page.locator('#bf-injecao-personalizado').fill('90.5')
                expect(aplicar).to_be_disabled()
                page.locator('#bf-injecao-personalizado').fill('90')
                taxa.fill('0')
                aplicar.click()
                novo = state()['BancodoBrasil']['tabelas']['margem']
                assert novo[0]['prazos'][2]['prazo'] == novo[1]['prazos'][2]['prazo'] == 90
                assert novo[0]['prazos'][2]['taxa'] == novo[1]['prazos'][2]['taxa'] == '0'
                assert novo[0]['prazos'][1]['grupo_fator'] != novo[0]['prazos'][2]['grupo_fator']
                print('PASS: edição posterior sincroniza fator e taxa, taxa vazia/zero, prazo personalizado e isolamento dos vínculos anteriores')

                page.locator('#bf-calcLimpar').click()
                expect(aplicar).to_be_disabled()
                page.locator('#bf-calcParcela').fill('100')
                page.locator('#bf-calcValor').fill('0')
                expect(aplicar).to_be_disabled()
                page.locator('#bf-calcValor').fill('5000')
                expect(aplicar).to_be_enabled()
                page.locator('.bf-bulk-tools[data-tipo=margem]:not([data-posicao]) .bf-bulk-clear').click()
                expect(aplicar).to_be_disabled()
                a.locator('.bf-table-check').check()
                prazo.select_option('84')
                taxa.fill('1,99')
                aplicar.click()
                apos = state()['BancodoBrasil']['tabelas']['margem']
                assert apos[0]['prazos'][1]['fator'] == .02 and apos[0]['prazos'][1]['taxa'] == '1,99'
                assert apos[1]['prazos'][1]['fator'] == .04 and apos[1]['prazos'][1]['taxa'] == ''
                assert not apos[0]['prazos'][1]['grupo_fator'] and not apos[1]['prazos'][1]['grupo_fator']

                for width in [320, 390, 768, 1100, 1440, 1920]:
                    page.set_viewport_size({'width': width, 'height': 1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow {width}'
                    if width in [390, 1440]:
                        page.locator('.bf-calculator-card').screenshot(path=str(Path(os.environ['TEMP']) / f'ominidata-injecao-{width}.png'))
                page.set_viewport_size({'width': 1440, 'height': 1000})
                page.locator('#bf-slBanco').select_option('Bradesco')
                expect(prazo).to_have_value('')
                expect(taxa).to_have_value('')
                expect(aplicar).to_be_disabled()
                expect(page.locator('.bf-table-check:checked')).to_have_count(0)
                page.locator('#bf-slBanco').select_option('BancodoBrasil')
                expect(page.locator('.bf-table-check:checked')).to_have_count(0)
                print('PASS: uma tabela pode receber fator sem afetar ex-vínculo; seleção/valores inválidos bloqueados; troca de banco limpa alvos; layout 320–1920px')

                margem_antes = state()['BancodoBrasil']['tabelas']['margem']
                page.locator('#bf-listaPrazosCartao .bf-table-check').check()
                expect(page.locator('#bf-injecao-tipo')).to_have_value('cartao')
                prazo.select_option('84')
                expect(taxa).to_have_value('3')
                taxa.fill('3,35')
                aplicar.click()
                assert state()['BancodoBrasil']['tabelas']['margem'] == margem_antes
                assert state()['BancodoBrasil']['tabelas']['cartao'][0]['prazos'][0]['taxa'] == '3,35'
                print('PASS: seleção de cartão muda o alvo da calculadora e não interfere na margem; públicos independentes preservados')

                antes = state()
                with page.expect_download() as download:
                    page.locator('#bf-exportarBanco').click()
                assert json.loads(Path(download.value.path()).read_text(encoding='utf-8')) == antes
                page.reload()
                expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
                assert state() == antes
                expect(aplicar).to_be_disabled()
                page.locator('#uploadBaseFile').set_input_files(dict(name='fatores.json', mimeType='application/json', buffer=json.dumps(antes).encode()))
                expect(page.locator('#bf-sync-status')).to_contain_text('fatores confirmados')
                remotas = page.evaluate('window.__qaRows')
                noventa = [r for r in remotas if r['prazo'] == 90]
                assert len(noventa) == 2 and noventa[0]['grupo_fator'] == noventa[1]['grupo_fator']
                assert noventa[0]['taxa'] == noventa[1]['taxa'] == 0
                page.evaluate('sessionStorage.setItem("__qaRemoteRows",JSON.stringify(window.__qaRows))')
                page.locator('#menuBtn').click()
                page.locator('#sidebar a[data-nav=home]').click()
                expect(page.locator('.home-header')).to_be_visible()
                page.locator('#menuBtn').click()
                page.locator('#sidebar a[data-nav=base_fatores]').click()
                expect(page.locator('#bf-injecao-aplicar')).to_be_visible()
                page.locator('#bf-listaPrazosMargem .bf-table-check').first.check()
                prazo.select_option('84')
                page.locator('#bf-calcParcela').fill('200')
                page.locator('#bf-calcValor').fill('10000')
                expect(aplicar).to_be_enabled()
                assert page.evaluate("""async () => {
                    const { injetarFatorTabelas, vincularTabelasPorPrazo, prepararVinculoTabelas } = await import('../js/simulador/vinculos-fatores.js');
                    const tabelas = ['A', 'B', 'C', 'D'].map(nome => ({ nome, prazos: [{ prazo:84, fator:.02, taxa:1.7, grupo_fator:'antigo' }] }));
                    const antes = JSON.stringify(tabelas);
                    if (!injetarFatorTabelas(tabelas, [tabelas[0]], 84, NaN, 2).erro || JSON.stringify(tabelas) !== antes) return false;
                    if (!injetarFatorTabelas(tabelas, [tabelas[0]], 84, .03, -1).erro || JSON.stringify(tabelas) !== antes) return false;
                    tabelas[1].prazos[0].taxa = 2;
                    if (!prepararVinculoTabelas(tabelas, tabelas.slice(0,2), tabelas[0]).diferentes) return false;
                    vincularTabelasPorPrazo(tabelas, tabelas.slice(0,2), tabelas[0]);
                    return tabelas[0].prazos[0].grupo_fator === tabelas[1].prazos[0].grupo_fator &&
                        tabelas[1].prazos[0].taxa === 1.7 &&
                        tabelas[0].prazos[0].grupo_fator !== 'antigo' &&
                        tabelas[2].prazos[0].grupo_fator === 'antigo' && tabelas[3].prazos[0].grupo_fator === 'antigo';
                }""")
                assert not errors, errors
                print('PASS: persistência local, JSON, publicação simulada com taxa/grupo e reinicialização pelo menu funcionam')
                context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

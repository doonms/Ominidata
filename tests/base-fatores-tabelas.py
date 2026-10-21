"""Cadastro por tabela, prazos padrão/personalizados e vínculos somente em lote."""
import json
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
PADROES = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120]
NOME = '210436 Tkt > 20k -Plus-ML'
INICIAL = {'BancodoBrasil': dict(tabelas=dict(margem=[], cartao=[]), fazMargem=True, fazCartao=True,
    seguros=[dict(nome='Seguro', tipo='fixo', valor=25)])}


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)

            def fresh(prefix='', local=INICIAL, rows=None):
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block', accept_downloads=True)
                context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=SYNC['STUB']))
                context.route('https://**/*', lambda r: r.abort())
                context.add_init_script('window.__qaRows=JSON.parse(sessionStorage.getItem("__qaRemoteRows")||' + json.dumps(json.dumps(rows or [])) + ');window.__qaWrites=[];window.__qaRanges=[];'
                    'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    f'if(!localStorage.getItem("{KEY}")) localStorage.setItem("{KEY}",' + json.dumps(json.dumps(local)) + ');')
                page = context.new_page()
                errors, dialogs, cancel = [], [], [False]
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 and any(k in r.url for k in ['.css', '.js']) else None)
                def dialog(d):
                    dialogs.append(d.message)
                    d.dismiss() if cancel[0] and d.type == 'confirm' else d.accept()
                page.on('dialog', dialog)
                base = f'http://127.0.0.1:{server.server_port}' + prefix
                page.goto(base + '/pages/base-fatores.html')
                expect(page.locator('#bf-sync-status')).to_contain_text('consultados' if rows else 'não retornou fatores')
                return context, page, errors, dialogs, cancel, base

            for prefix in ['', '/Ominidata']:
                context, page, errors, dialogs, cancel, base = fresh(prefix)
                tables = page.locator('#bf-listaPrazosMargem > .bf-table-card')
                expect(tables).to_have_count(0)
                expect(page.locator('.bf-factor-link, .bf-link-target, #bf-data')).to_have_count(0)
                page.locator('#bf-addTabelaMargem').click()
                expect(tables).to_have_count(1)
                a = tables.nth(0)
                expect(a.locator('.bf-table-body')).to_be_visible()
                expect(a.locator('.bf-table-name')).to_be_focused()
                a.locator('.bf-table-name').fill(NOME)
                assert a.locator('.bf-term-preset').all_text_contents() == [f'{n}x' for n in PADROES]
                for prazo in [12, 24]:
                    a.get_by_role('button', name=f'Adicionar prazo {prazo} meses', exact=True).click()
                a.get_by_role('button', name='Remover prazo 12 meses', exact=True).click()
                expect(a.locator('[data-prazo="12"]')).to_have_count(0)
                expect(a.locator('[data-prazo-padrao="12"]')).to_have_attribute('aria-pressed', 'false')
                expect(a.locator('[data-prazo-padrao="12"]')).to_be_focused()
                a.locator('[data-prazo-padrao="12"]').press('Enter')
                expect(a.locator('[data-prazo-padrao="12"]')).to_have_attribute('aria-pressed', 'true')
                a.locator('.bf-custom-prazo').fill('90')
                a.locator('.bf-custom-add').click()
                expect(a.locator('[data-prazo="90"] .fator')).to_be_focused()
                for prazo, fator, taxa in [(12,'0,10','1,70'), (24,'0,05','1,80'), (90,'0,02','1,90')]:
                    a.locator(f'[data-prazo="{prazo}"] .fator').fill(fator)
                    a.locator(f'[data-prazo="{prazo}"] .taxa').fill(taxa)
                expect(a.locator('.bf-term-row')).to_have_count(3)
                cancel[0] = True
                a.get_by_role('button', name='Remover prazo 12 meses', exact=True).click()
                expect(a.locator('[data-prazo="12"] .fator')).to_have_value('0,10')
                cancel[0] = False
                a.get_by_role('button', name='Remover prazo 12 meses', exact=True).click()
                page.reload()
                expect(a.locator('.bf-table-body')).to_be_hidden()
                expect(a.locator('.bf-table-toggle')).to_have_attribute('aria-expanded', 'false')
                a.locator('.bf-table-toggle').click()
                expect(a.locator('[data-prazo="12"]')).to_have_count(0)
                expect(a.locator('[data-prazo-padrao="12"]')).to_have_attribute('aria-pressed', 'false')
                a.get_by_role('button', name='Adicionar prazo 12 meses', exact=True).click()
                a.locator('[data-prazo="12"] .fator').fill('0,10')
                a.locator('[data-prazo="12"] .taxa').fill('1,70')
                print('PASS: segundo clique remove, teclado alterna, cancelamento preserva valores e remoção persiste ao recarregar')
                a.locator('.bf-custom-prazo').fill('90')
                a.locator('.bf-custom-add').click()
                expect(page.locator('#bf-vinculos-status')).to_contain_text('já existe')
                expect(a.locator('.bf-term-row')).to_have_count(3)
                for invalido in ['0', '-1', '12.5']:
                    a.locator('.bf-custom-prazo').fill(invalido)
                    a.locator('.bf-custom-add').click()
                    expect(page.locator('#bf-vinculos-status')).to_contain_text('inteiro maior que zero')
                page.locator('#bf-blocoMargem > .bf-factor-footer button').click()
                b = tables.nth(1)
                b.locator('.bf-table-name').fill('210437 Especial "B" <teste>')
                for prazo, fator, taxa in [(12,'0,20','2,10'), (24,'0,07','2,20'), (60,'0,03','2,30')]:
                    b.get_by_role('button', name=f'Adicionar prazo {prazo} meses', exact=True).click()
                    b.locator(f'[data-prazo="{prazo}"] .fator').fill(fator)
                    b.locator(f'[data-prazo="{prazo}"] .taxa').fill(taxa)
                assert page.locator('teste').count() == 0
                print(f'PASS: tabela com nome único, dez prazos padrão e prazo personalizado; duplicatas/valores inválidos bloqueados ({prefix or "/"})')

                antes_recolher = page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')
                a.locator('.bf-table-toggle').click()
                expect(a.locator('.bf-table-toggle')).to_have_attribute('aria-expanded', 'false')
                expect(a.locator('.bf-table-body')).to_be_hidden()
                expect(a.locator('.bf-table-name')).to_be_visible()
                expect(a.locator('.bf-table-check')).to_be_visible()
                expect(b.locator('.bf-table-body')).to_be_visible()
                assert page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))') == antes_recolher
                assert not page.evaluate('window.__qaWrites.length')
                a.locator('.bf-table-toggle').press('Space')
                expect(a.locator('.bf-table-body')).to_be_visible()
                a.locator('.bf-table-toggle').press('Enter')
                expect(a.locator('.bf-table-body')).to_be_hidden()
                b.get_by_role('button', name='Adicionar prazo 36 meses', exact=True).click()
                expect(a.locator('.bf-table-body')).to_be_hidden()
                b.get_by_role('button', name='Remover prazo 36 meses', exact=True).click()
                expect(a.locator('.bf-table-body')).to_be_hidden()
                for width in [320, 390, 1440]:
                    page.set_viewport_size({'width': width, 'height': 1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                    if width == 390:
                        a.screenshot(path=str(Path(os.environ['TEMP']) / 'ominidata-tabela-retratil-mobile.png'))
                page.set_viewport_size({'width': 1440, 'height': 1000})
                a.screenshot(path=str(Path(os.environ['TEMP']) / 'ominidata-tabela-retratil-desktop.png'))

                a.locator('.bf-table-check').check()
                b.locator('.bf-table-check').check()
                top = page.locator('.bf-bulk-tools[data-tipo=margem]:not([data-posicao])')
                bottom = page.locator('.bf-bulk-tools[data-tipo=margem][data-posicao=fim]')
                top.locator('.bf-bulk-reference').select_option('0')
                cancel[0] = True
                bottom.locator('.bf-bulk-link').click()
                expect(b.locator('[data-prazo="12"] .fator')).to_have_value('0,2000')
                cancel[0] = False
                n = len(dialogs)
                bottom.locator('.bf-bulk-link').click()
                assert len(dialogs) == n + 1
                expect(a.locator('.bf-table-body')).to_be_hidden()
                a.locator('.bf-table-toggle').click()
                expect(a.locator('.bf-table-body')).to_be_visible()
                expect(a.locator('.bf-table-count')).to_have_text('3 prazos')
                print('PASS: tabelas retráteis independentes, teclado, nome e seleção visíveis; recolhimento preservado em edições e vínculo em lote, sem alterar dados')
                expect(b.locator('[data-prazo="12"] .fator')).to_have_value('0,1000')
                expect(b.locator('[data-prazo="24"] .fator')).to_have_value('0,0500')
                expect(b.locator('[data-prazo="60"] .fator')).to_have_value('0,0300')
                expect(b.locator('[data-prazo="12"] .taxa')).to_have_value('2,10')
                a.locator('[data-prazo="12"] .fator').fill('0,12')
                expect(b.locator('[data-prazo="12"] .fator')).to_have_value('0,1200')
                expect(b.locator('[data-prazo="24"] .fator')).to_have_value('0,0500')
                a.locator('[data-prazo="24"] .fator').fill('0,06')
                expect(b.locator('[data-prazo="24"] .fator')).to_have_value('0,0600')
                expect(a.locator('[data-prazo="90"] .fator')).to_have_value('0,0200')
                expect(a.locator('[data-prazo="12"] .bf-term-linked')).to_contain_text('2 tabelas')
                top.locator('.bf-bulk-unlink').click()
                a.locator('[data-prazo="12"] .fator').fill('0,13')
                expect(b.locator('[data-prazo="12"] .fator')).to_have_value('0,1200')
                bottom.locator('.bf-bulk-link').click()
                a.locator('[data-prazo="12"] .fator').fill('0,12')
                b.get_by_role('button', name='Remover prazo 12 meses', exact=True).click()
                expect(b.locator('[data-prazo="12"]')).to_have_count(0)
                expect(a.locator('[data-prazo="12"] .fator')).to_have_value('0,1200')
                expect(a.locator('[data-prazo="12"] .bf-term-linked')).to_have_count(0)
                b.get_by_role('button', name='Adicionar prazo 12 meses', exact=True).click()
                b.locator('[data-prazo="12"] .fator').fill('0,12')
                b.locator('[data-prazo="12"] .taxa').fill('2,10')
                bottom.locator('.bf-bulk-link').click()
                print('PASS: remover prazo vinculado mantém o prazo e fator da outra tabela')
                print('PASS: só o vínculo em lote existe; 12x vincula a 12x, 24x a 24x; taxas, nomes e prazos exclusivos preservados; confirmação/cancelamento/desvincular corretos')

                a.locator('.bf-all-terms').click()
                expect(a.locator('.bf-term-row')).to_have_count(11)
                a.locator('.bf-all-terms').click()
                expect(a.locator('.bf-term-row')).to_have_count(11)
                expect(a.locator('.bf-term-preset[aria-pressed="true"]')).to_have_count(10)
                assert a.locator('.bf-term-value').all_text_contents() == [f'{n}x' for n in sorted(PADROES + [90])]
                for row in a.locator('.bf-term-row').all():
                    if not row.locator('.fator').input_value():
                        row.locator('.fator').fill('0,02')
                page.locator('.bf-page-footer [data-bf-add-tabela=cartao]').click()
                cartao = page.locator('#bf-listaPrazosCartao > .bf-table-card')
                cartao.locator('.bf-table-name').fill('Cartão')
                cartao.get_by_role('button', name='Adicionar prazo 96 meses', exact=True).click()
                cartao.locator('.fator').fill('22,5')
                cartao.locator('.taxa').fill('2,15')
                page.locator('.bf-page-footer [data-bf-add-tabela=margem]').click()
                tables.nth(2).locator('.bf-table-name').fill('Rascunho')
                page.reload()
                expect(tables).to_have_count(3)
                expect(tables.locator('.bf-table-toggle[aria-expanded="false"]')).to_have_count(3)
                expect(tables.nth(2).locator('.bf-term-row')).to_have_count(0)
                with page.expect_download() as pending:
                    page.locator('#bf-exportarBanco').click()
                cadastro = json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))
                assert 'fatores' not in cadastro['BancodoBrasil']
                assert cadastro['BancodoBrasil']['tabelas']['margem'][0]['nome'] == NOME
                assert len(cadastro['BancodoBrasil']['tabelas']['margem'][0]['prazos']) == 11
                assert all('plano' not in row for row in cadastro['BancodoBrasil']['tabelas']['margem'][0]['prazos'])
                assert cadastro['BancodoBrasil']['tabelas']['margem'][2]['prazos'] == []
                tables.nth(2).locator('.bf-table-remove').click()
                expect(tables).to_have_count(2)
                print('PASS: adicionar todos sem duplicar, ordenação, rodapés, cartão independente, rascunho preservado e JSON novo com nome e lista de prazos')

                for width in [320, 390, 768, 1440, 1920]:
                    page.set_viewport_size({'width': width, 'height': 1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow {width}px'
                    if width in [390, 1440]:
                        nome = 'mobile' if width == 390 else 'desktop'
                        page.locator('#bf-blocoMargem').screenshot(path=str(Path(os.environ['TEMP']) / f'ominidata-tabelas-{nome}.png'))
                page.set_viewport_size({'width': 1440, 'height': 1000})
                cadastro = page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')
                page.locator('#uploadBaseFile').set_input_files(dict(name='tabelas.json', mimeType='application/json', buffer=json.dumps(cadastro).encode()))
                expect(page.locator('#bf-sync-status')).to_contain_text('15 fatores confirmados')
                remote = page.evaluate('window.__qaRows')
                assert len(remote) == 15
                assert page.evaluate("window.__qaWrites.every(w=>w.rows.every(r=>!Object.hasOwn(r,'id')))")
                page.evaluate('sessionStorage.setItem("__qaRemoteRows",JSON.stringify(window.__qaRows))')
                page.goto(base + '/pages/simulador.html')
                expect(page.locator('#sim-base-status')).to_contain_text('consultados no Supabase')
                page.locator('#slBanco').select_option('BancodoBrasil')
                page.locator('#slOrigemFator').select_option('tabela')
                page.locator('#slPrazo').select_option('12')
                expect(page.locator('#slTabela option')).to_have_count(2)
                page.locator('#inpValorMargem').fill('100')
                expect(page.locator('#resValor')).to_contain_text('833,33')
                expect(page.locator('#resPlano')).to_have_text(NOME)
                page.locator('#slTabela').select_option(label='210437 Especial "B" <teste> · 0.12')
                expect(page.locator('#resTaxa')).to_have_text('2,10%')
                page.locator('#sim-multiplas > summary').click()
                page.locator('#sim-multi-todas').click()
                page.locator('#sim-multi-gerar').click()
                expect(page.locator('.sim-multi-card')).to_have_count(14)
                assert not errors, errors
                context.close()
                print('PASS: layout 320–1920px; upload preserva nomes e fatores; simulador individual e múltiplo leem todos os prazos corretamente')

                ctx2, page2, errs2, _, _, _ = fresh(prefix, local={}, rows=remote)
                expect(page2.locator('#bf-listaPrazosMargem > .bf-table-card')).to_have_count(2)
                expect(page2.locator('#bf-listaPrazosMargem .bf-table-toggle[aria-expanded="false"]')).to_have_count(2)
                expect(page2.locator('#bf-listaPrazosMargem .bf-table-name').first).to_have_value(NOME)
                expect(page2.locator('#bf-listaPrazosMargem .bf-term-row')).to_have_count(14)
                validacoes = page2.evaluate("""async () => {
                    const { prepararFatores } = await import('../js/api/baseFatoresApi.js');
                    const { prepararVinculoTabelas } = await import('../js/simulador/vinculos-fatores.js');
                    const base = { Banco: { tabelas: { margem: [{ nome: 'Tabela', prazos: [{ prazo: 12, fator: .1, taxa: 1.7 }] }], cartao: [] } } };
                    const casos = [
                        b => b.Banco.tabelas.margem[0].nome = '',
                        b => b.Banco.tabelas.margem[0].nome = 123,
                        b => b.Banco.tabelas.margem[0].prazos = [],
                        b => b.Banco.tabelas.margem.push(structuredClone(b.Banco.tabelas.margem[0])),
                        b => b.Banco.tabelas.margem[0].prazos.push({ prazo:12, fator:.2 }),
                        b => b.Banco.tabelas.margem[0].prazos[0] = null,
                        b => b.Banco.tabelas.margem[0].prazos[0].prazo = -1,
                        b => b.Banco.tabelas.margem[0].prazos[0].fator = '',
                        b => b.Banco.tabelas.margem[0].prazos[0].taxa = -1,
                        b => b.Banco.tabelas.outra = [],
                        b => {
                            b.Banco.tabelas.margem[0].prazos[0].grupo_fator = 'grupo';
                            b.Banco.tabelas.margem[0].prazos.push({ prazo:24, fator:.1, grupo_fator:'grupo' });
                        }
                    ];
                    const rejeitados = casos.every(mudar => {
                        const b = structuredClone(base); mudar(b);
                        try { prepararFatores(b); return false; } catch { return true; }
                    });
                    const tabelas = [
                        { nome:'A', prazos:[{ prazo:12, fator:.1 }] },
                        { nome:'B', prazos:[{ prazo:24, fator:.2 }] }
                    ];
                    return rejeitados && prepararFatores(base).length === 1 &&
                        !!prepararVinculoTabelas(tabelas, tabelas, tabelas[0]).erro &&
                        tabelas[1].prazos[0].fator === .2;
                }""")
                assert validacoes, 'Cadastro inválido ou vínculo sem prazos em comum não foi bloqueado'
                parcial = {'BancodoBrasil': {'tabelas': {'margem': [
                    {'nome': 'Importada', 'prazos': [{'prazo': 30, 'fator': .2, 'taxa': 2}]},
                    {'nome': 'Rascunho importado', 'prazos': []}]}}}
                with page2.expect_file_chooser() as chooser:
                    page2.locator('#bf-importarBanco').click()
                chooser.value.set_files(dict(name='parcial.json', mimeType='application/json', buffer=json.dumps(parcial).encode()))
                expect(page2.locator('#bf-sync-status')).to_contain_text('JSON importado')
                expect(page2.locator('#bf-listaPrazosMargem > .bf-table-card')).to_have_count(4)
                expect(page2.locator('#bf-listaPrazosMargem .bf-term-row')).to_have_count(15)
                page2.reload()
                expect(page2.locator('#bf-listaPrazosMargem > .bf-table-card')).to_have_count(4)
                assert not errs2, errs2
                ctx2.close()
                print('PASS: outro navegador reconstitui o cadastro; importação parcial preserva tabelas e rascunhos; publicação rejeita cadastros inválidos e vínculos entre prazos diferentes')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

"""Cabeçalhos retráteis, perfis e faixas independentes por operação/convênio."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
KEY = 'ominidata_base_outros_convenios_v1'
OPS = [('fazMargem','prazos'), ('fazCartao','prazosCartao'), ('fazRefin','prazosRefin'),
       ('fazSaqueComplementar','prazosSaqueComplementar'), ('fazPortabilidade','prazosPortabilidade')]
PERFIS = [('aceitaCeletista','prazosCeletista'), ('aceitaTemporario','prazosTemporario')]
INITIAL = [dict(nome='Banco do Brasil', convenios=[
    dict(id='pref-1',tipo='prefeitura',nome='Prefeitura "Principal"',fazCartao=True,
         aceitaClienteNaoAssina=True,rogo=['pai'],
         prazosCartao=[dict(idade='18-75',parcelas='96',obs='Cartão original')]),
    dict(id='gov-1',tipo='governo',nome='Governo',fazMargem=False),
    dict(id='siape-1',tipo='siape',nome='SIAPE',fazMargem=True,
         prazos=[dict(idade='21-80',parcelas='108',obs='SIAPE original')])]),
    dict(nome='Outro Banco',convenios=[dict(id='outro-1',tipo='governo',nome='Outro governo')])]


def main():
    server = ThreadingHTTPServer(('127.0.0.1',0), partial(QA['QuietHandler'],directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome',headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(viewport={'width':1440,'height':1000}, service_workers='block', accept_downloads=True)
                ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=QA['STUB']))
                ctx.route('https://**/*',lambda r:r.abort())
                ctx.add_init_script(
                    'window.__qaRegras=[];sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    f'if(!localStorage.getItem("{KEY}"))localStorage.setItem("{KEY}",' + json.dumps(json.dumps(INITIAL)) + ');')
                page = ctx.new_page()
                errors, dialogs = [], []
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('response',lambda r:errors.append(f'HTTP {r.status}: {r.url}') if r.status>=400 and any(k in r.url for k in ['.js','.css']) else None)
                page.on('dialog',lambda d:(dialogs.append(d.message),d.dismiss() if d.type=='confirm' else d.accept()))
                url = f'http://127.0.0.1:{server.server_port}{prefix}/pages/base-outros-convenios.html'
                page.goto(url)
                bank = page.locator('.banco-outros-card').filter(has=page.locator('[data-toggle-banco="0"]'))
                expect(bank).to_be_visible()
                expect(page.get_by_role('button',name='Expandir',exact=True)).to_have_count(0)
                expect(page.get_by_role('button',name='Recolher',exact=True)).to_have_count(0)
                bank.locator('.od-card-copy').first.click()
                expect(bank.locator('.card-body')).to_be_visible()
                bank.locator('[data-toggle-banco]').press('Space')
                expect(bank.locator('.card-body')).to_be_hidden()
                bank.locator('[data-toggle-banco]').press('Enter')
                expect(bank.locator('.card-body')).to_be_visible()
                bank.locator('[data-bank-field$=":suspenso"]').check()
                expect(bank.locator('.card-body')).to_be_visible()
                bank.locator('[data-bank-field$=":suspenso"]').uncheck()
                expect(bank.locator('.card-body')).to_be_visible()

                pref = page.locator('[data-convenio="pref-1"]')
                pref.locator('.convenio-tag').click()
                expect(pref.locator('.convenio-body')).to_be_visible()
                pref.locator('[data-toggle-convenio]').press('Enter')
                expect(pref.locator('.convenio-body')).to_be_hidden()
                pref.locator('[data-toggle-convenio]').press('Space')
                expect(pref.locator('.convenio-body')).to_be_visible()
                pref.locator('[data-remove-convenio]').click()
                expect(pref).to_be_visible()
                expect(pref.locator('.convenio-body')).to_be_visible()
                expect(bank.locator('.card-body')).to_be_visible()
                print(f'PASS: clique no cabeçalho e teclado abrem/recolhem sem botões extras; suspender e cancelar exclusão não recolhem ({prefix or "/"})')

                perfil = pref.locator('[data-conv-section=perfis]')
                expect(pref.locator('[data-conv-perfil]')).to_have_count(0)
                expect(perfil.get_by_text('Celetista',exact=True)).to_be_visible()
                expect(perfil.get_by_text('Temporário',exact=True)).to_be_visible()
                expect(perfil.locator('[data-conv-field$=":aceitaClienteNaoAssina"],[data-conv-field$=":aceitaLoas"],[data-conv-field$=":aceitaInvalidez"],[data-conv-field$=":aceitaClientePensao"]')).to_have_count(0)
                perfil.locator('[data-conv-field$=":aceitaCeletista"]').check()
                perfil.locator('[data-conv-field$=":aceitaTemporario"]').check()
                outros = 'Efetivos "A" & comissionados <sem HTML>'
                perfil.locator('[data-conv-field$=":perfisOutros"]').fill(outros)
                cartao = pref.locator('[data-conv-operacao=prazosCartao]')
                cartao.locator('[data-conv-add-prazo]').click()
                expect(cartao.locator('.prazo-row')).to_have_count(2)
                cartao.locator('.prazo-row').nth(1).locator('[data-conv-remove-prazo]').click()
                expect(cartao.locator('.prazo-row')).to_have_count(1)
                pref.locator('[data-conv-field$=":nome"]').fill('Prefeitura revisada')
                expect(pref.locator('.convenio-head .od-card-copy strong')).to_have_text('Prefeitura revisada')
                pref.locator('[data-toggle-convenio]').click()
                expect(pref.locator('.convenio-body')).to_be_hidden()
                pref.locator('[data-toggle-convenio]').click()
                expect(pref.locator('.convenio-body')).to_be_visible()

                def saved():
                    return page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')

                financeiro = pref.locator('[data-conv-section=financeiro]')
                margem_maxima = financeiro.get_by_label('Margem máxima do convênio')
                margem_banco = financeiro.get_by_label('Margem que o banco utiliza')
                expect(margem_maxima).to_have_value('')
                expect(margem_banco).to_have_value('')
                margem_maxima.fill('0')
                margem_banco.fill('0')
                pref.locator('[data-toggle-convenio]').click()
                pref.locator('[data-toggle-convenio]').click()
                expect(margem_maxima).to_have_value('0')
                expect(margem_banco).to_have_value('0')
                margem_banco.fill('')
                assert saved()[0]['convenios'][0]['margemUtilizadaBanco'] == ''
                margem_maxima.fill('35,5%')
                margem_banco.fill('30%')
                assert saved()[0]['convenios'][0]['margemMaximaConvenio'] == '35,5%'
                assert saved()[0]['convenios'][0]['margemUtilizadaBanco'] == '30%'
                assert saved()[0]['convenios'][1]['margemMaximaConvenio'] == ''
                assert saved()[1]['convenios'][0]['margemUtilizadaBanco'] == ''
                print('PASS: margens do convênio e do banco independentes, opcionais, preservam zero/vírgula/% e não afetam outros convênios')

                docs = pref.locator('[data-conv-section=documentos]')
                documentos_texto = 'RG "frente e verso" & CPF\nComprovante de residência <atualizado>'
                interruptor = docs.get_by_role('switch', name='Documentos necessários')
                campo_docs = docs.get_by_label('Quais documentos são necessários?')
                expect(interruptor).not_to_be_checked()
                expect(campo_docs).to_be_hidden()
                interruptor.check()
                expect(interruptor).to_have_attribute('aria-expanded','true')
                expect(campo_docs).to_be_visible()
                campo_docs.fill(documentos_texto)
                interruptor.uncheck()
                expect(campo_docs).to_be_hidden()
                assert saved()[0]['convenios'][0]['documentosNecessarios'] == documentos_texto
                assert not saved()[0]['convenios'][0]['exigeDocumentos']
                interruptor.press('Space')
                expect(campo_docs).to_have_value(documentos_texto)
                assert saved()[0]['convenios'][0]['exigeDocumentos']
                assert not saved()[0]['convenios'][1]['exigeDocumentos']
                assert saved()[1]['convenios'][0]['documentosNecessarios'] == ''
                print('PASS: documentos necessários no mesmo bloco; interruptor/teclado, texto multilinha e caracteres especiais, ocultar sem apagar e dados isolados por convênio')

                expect(pref.locator('[data-conv-perfil]')).to_have_count(2)
                for indice,(flag,lista) in enumerate(PERFIS):
                    bloco = pref.locator(f'[data-conv-perfil="{lista}"]')
                    expect(bloco).to_be_visible()
                    bloco.locator('[data-conv-prazo$=":idade"]').fill(f'{18+indice}-{65+indice}')
                    bloco.locator('[data-conv-prazo$=":parcelas"]').fill(str(72+indice*12))
                    bloco.locator('[data-conv-prazo$=":obs"]').fill('Perfil ' + lista)
                    bloco.locator('[data-conv-add-prazo]').click()
                    expect(bloco.locator('.prazo-row')).to_have_count(2)
                    bloco.locator('.prazo-row').nth(1).locator('[data-conv-prazo$=":obs"]').fill('Segunda faixa ' + lista)
                    snapshot = saved()[0]['convenios'][0][lista]
                    assert (snapshot[0]['min'],snapshot[0]['max']) == (18+indice,65+indice)
                    perfil.locator(f'[data-conv-field$=":{flag}"]').uncheck()
                    expect(bloco).to_have_count(0)
                    assert saved()[0]['convenios'][0][lista] == snapshot
                    perfil.locator(f'[data-conv-field$=":{flag}"]').check()
                    expect(bloco.locator('.prazo-row')).to_have_count(2)
                    bloco.locator('.prazo-row').nth(1).locator('[data-conv-remove-prazo]').click()
                    expect(bloco.locator('.prazo-row')).to_have_count(1)
                for indice,(_,lista) in enumerate(PERFIS):
                    assert saved()[0]['convenios'][0][lista][0]['obs'] == 'Perfil ' + lista
                    assert saved()[0]['convenios'][1][lista][0]['obs'] == ''
                    assert saved()[1]['convenios'][0][lista][0]['obs'] == ''
                print('PASS: Celetista e Temporário exibem faixas/prazos/observações próprios; adicionar/remover, ocultar e reabrir sem perda nem mistura entre perfis ou convênios')

                expect(pref.locator('[data-conv-operacao]')).to_have_count(1)
                expect(pref.locator('[data-conv-operacao=prazosCartao]')).to_be_visible()
                for indice,(flag,lista) in enumerate(OPS):
                    pref.locator(f'[data-conv-field$=":{flag}"]').check()
                    bloco = pref.locator(f'[data-conv-operacao="{lista}"]')
                    expect(bloco).to_be_visible()
                    bloco.locator('[data-conv-add-prazo]').click()
                    expect(bloco.locator('.prazo-row')).to_have_count(2)
                    row = bloco.locator('.prazo-row').nth(1)
                    row.locator('[data-conv-prazo$=":idade"]').fill(f'{20+indice}-{70+indice}')
                    row.locator('[data-conv-prazo$=":parcelas"]').fill(str(60+indice*12))
                    row.locator('[data-conv-prazo$=":obs"]').fill('Exclusiva ' + lista)
                state = saved()[0]['convenios'][0]
                assert state['aceitaCeletista'] and state['aceitaTemporario']
                assert state['perfisOutros'] == outros
                assert state['rogo'] == ['pai'], 'Dados antigos não devem ser apagados ao trocar os perfis da tela'
                for indice,(_,lista) in enumerate(OPS):
                    row = state[lista][1]
                    assert (row['min'],row['max']) == (20+indice,70+indice)
                    assert row['obs'] == 'Exclusiva ' + lista
                assert state['prazosCartao'][0]['obs'] == 'Cartão original'
                assert saved()[0]['convenios'][1]['prazosCartao'][0]['idade'] == ''
                assert saved()[0]['convenios'][2]['prazos'][0]['obs'] == 'SIAPE original'
                assert saved()[1]['convenios'][0]['prazos'][0]['idade'] == ''
                print('PASS: novos perfis e texto livre; cinco listas independentes por operação, convênio e banco; Cartão antigo e faixas min/max preservados')

                for flag,lista in OPS:
                    snapshot = saved()[0]['convenios'][0][lista]
                    pref.locator(f'[data-conv-field$=":{flag}"]').uncheck()
                    expect(pref.locator(f'[data-conv-operacao="{lista}"]')).to_have_count(0)
                    assert saved()[0]['convenios'][0][lista] == snapshot
                    pref.locator(f'[data-conv-field$=":{flag}"]').check()
                    expect(pref.locator(f'[data-conv-operacao="{lista}"] .prazo-row')).to_have_count(2)
                pref.locator('[data-conv-operacao=prazosRefin] .prazo-row').nth(1).locator('[data-conv-remove-prazo]').click()
                expect(pref.locator('[data-conv-operacao=prazosRefin] .prazo-row')).to_have_count(1)
                expect(pref.locator('[data-conv-operacao=prazosCartao] .prazo-row')).to_have_count(2)
                for largura in [320,390,768,1440]:
                    page.set_viewport_size({'width':largura,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), largura
                    if largura in [390,1440]:
                        perfil.screenshot(path=str(Path(gettempdir()) / f'ominidata-outros-perfis-{largura}.png'))
                        docs.screenshot(path=str(Path(gettempdir()) / f'ominidata-outros-documentos-{largura}.png'))
                        financeiro.screenshot(path=str(Path(gettempdir()) / f'ominidata-outros-financeiro-{largura}.png'))
                        pref.locator('[data-conv-operacao=prazosCartao]').screenshot(path=str(Path(gettempdir()) / f'ominidata-outros-faixas-{largura}.png'))
                        pref.locator('[data-conv-perfil=prazosCeletista]').screenshot(path=str(Path(gettempdir()) / f'ominidata-outros-celetista-{largura}.png'))
                        pref.locator('[data-conv-perfil=prazosTemporario]').screenshot(path=str(Path(gettempdir()) / f'ominidata-outros-temporario-{largura}.png'))
                        bank.locator('.card-head').screenshot(path=str(Path(gettempdir()) / f'ominidata-outros-cabecalho-{largura}.png'))
                before = saved()
                with page.expect_download() as pending:
                    page.locator('#save').click()
                exported = json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))
                assert exported == before
                page.reload()
                page.locator('[data-toggle-banco="0"]').click()
                page.locator('[data-toggle-convenio="0:pref-1"]').click()
                expect(perfil.locator('[data-conv-field$=":perfisOutros"]')).to_have_value(outros)
                expect(interruptor).to_be_checked()
                expect(campo_docs).to_have_value(documentos_texto)
                expect(margem_maxima).to_have_value('35,5%')
                expect(margem_banco).to_have_value('30%')
                expect(pref.locator('[data-conv-operacao]')).to_have_count(5)
                expect(pref.locator('[data-conv-perfil]')).to_have_count(2)
                assert saved() == before
                page.locator('#file').set_input_files(dict(name='convenios.json',mimeType='application/json',buffer=json.dumps(exported).encode()))
                expect(page.locator('.banco-outros-card')).to_have_count(2)
                assert saved() == before
                assert not errors, errors
                print('PASS: desligar operação não apaga faixas, exclusão é isolada; JSON/reload preservam dados; 320–1440px sem overflow e sem erros JS')
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

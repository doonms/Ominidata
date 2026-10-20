"""Base única: migração local, JSONs antigos, Supabase antigo/novo e simulador."""
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
BACKUP = 'ominidata_base_fatores_antes_unificar_datas_v1'
ANTIGO = {'BancodoBrasil': dict(logo='banco.png', seguros=[dict(nome='Seguro', tipo='fixo', valor=25)],
    fatores={
        '2026-10-19': dict(margem=[
            dict(prazo=84, plano='A', fator=.02, taxa=1.7, grupo_fator='grupo'),
            dict(prazo=84, plano='B', fator=.02, taxa=1.8, grupo_fator='grupo')], cartao=[]),
        '2026-09-01': dict(margem=[
            dict(prazo=84, plano='A', fator=.01, taxa=1.6, grupo_fator='grupo'),
            dict(prazo=84, plano='B', fator=.01, taxa=1.7, grupo_fator='grupo'),
            dict(prazo=72, plano='Só no antigo', fator=.03, taxa='')], cartao=[
            dict(prazo=96, plano='Cartão', fator=22.5, taxa=2.1)])
    })}


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)

            def fresh(local=ANTIGO, rows=None, **flags):
                context = browser.new_context(viewport={'width': 1366, 'height': 900}, service_workers='block')
                context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=SYNC['STUB']))
                context.route('https://**/*', lambda r: r.abort())
                context.add_init_script('window.__qaRows=' + json.dumps(rows or []) + ';'
                    'window.__qaWrites=[];window.__qaRanges=[];'
                    'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    f'if (!localStorage.getItem("{KEY}")) localStorage.setItem("{KEY}",' + json.dumps(json.dumps(local)) + ');' +
                    ''.join('window.' + k + '=' + json.dumps(v) + ';' for k, v in flags.items()) +
                    f'if(window.__qaFalhaBackup){{const salvar=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){{if(k==="{BACKUP}")throw new DOMException("Sem espaço","QuotaExceededError");return salvar.call(this,k,v);}};}}')
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('dialog', lambda d: d.accept())
                page.goto(f'http://127.0.0.1:{server.server_port}/pages/base-fatores.html')
                expect(page.locator('#bf-sync-status')).to_contain_text('Não foi possível converter' if flags.get('__qaFalhaBackup') else 'consultados' if rows else 'não retornou fatores')
                return context, page, errors

            context, page, errors = fresh()
            for selector in ['#bf-data', '#bf-infoData', '#bf-limparAntigos']:
                expect(page.locator(selector)).to_have_count(0)
            margem = page.locator('#bf-listaPrazosMargem .factor-row')
            expect(margem).to_have_count(3)
            expect(page.locator('#bf-listaPrazosCartao .factor-row')).to_have_count(1)
            dados = page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')
            assert set(dados['BancodoBrasil']['fatores']) == {'margem', 'cartao'}
            linhas = dados['BancodoBrasil']['fatores']['margem']
            assert {r['plano']: r['fator'] for r in linhas} == {'A':.02, 'B':.02, 'Só no antigo':.03}
            backup = page.evaluate(f'JSON.parse(localStorage.getItem("{BACKUP}")).bancos')
            assert backup == ANTIGO
            expect(page.locator('.bf-factor-link.is-linked')).to_have_count(2)
            margem.nth(0).locator('.fator').fill('0.025')
            expect(margem.nth(1).locator('.fator')).to_have_value('0.025')
            with page.expect_download() as pending:
                page.locator('#bf-exportarBanco').click()
            assert pending.value.suggested_filename == 'base-fatores.json'
            atual = json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))
            assert set(atual['BancodoBrasil']['fatores']) == {'margem', 'cartao'}
            assert atual['BancodoBrasil']['seguros'] == ANTIGO['BancodoBrasil']['seguros']
            page.reload()
            expect(margem.nth(0).locator('.fator')).to_have_value('0.025')
            assert page.evaluate(f'JSON.parse(localStorage.getItem("{BACKUP}")).bancos') == ANTIGO
            for width in [320, 390, 768, 1366]:
                page.set_viewport_size({'width': width, 'height': 900})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                if width in [390, 1366]:
                    nome = 'mobile' if width == 390 else 'desktop'
                    page.screenshot(path=str(Path(os.environ['TEMP']) / f'ominidata-base-sem-datas-{nome}.png'), full_page=True)
            assert not errors, errors
            context.close()
            print('PASS: base única sem calendário/limpeza; valor mais recente por tabela; tabelas antigas distintas, cartão, vínculos, seguros e backup original preservados')

            context, page, errors = fresh(local={})
            with page.expect_file_chooser() as pending:
                page.locator('#bf-importarBanco').click()
            pending.value.set_files(dict(name='legado.json', mimeType='application/json', buffer=json.dumps(ANTIGO).encode()))
            expect(page.locator('#bf-listaPrazosMargem .factor-row')).to_have_count(3)
            result = page.evaluate("""async ({antigo,atual}) => {
                const api=await import('../js/api/baseFatoresApi.js');
                const antigoRows=api.prepararFatores(antigo);
                const atualRows=api.prepararFatores(atual);
                const semDatas=atualRows.every(row=>!Object.hasOwn(row,'data'));
                const anterior=structuredClone(atual);
                const parcial={BancodoBrasil:{fatores:{margem:[{prazo:60,plano:'Nova',fator:.04}]}}};
                const merge=api.mesclarArquivoFatores(parcial,atual);
                return {antigoRows,semDatas,merge,inalterado:JSON.stringify(anterior)===JSON.stringify(atual)};
            }""", dict(antigo=ANTIGO, atual=atual))
            assert len(result['antigoRows']) == 4 and result['semDatas'] and result['inalterado']
            assert len(result['merge']['BancodoBrasil']['fatores']['margem']) == 4
            assert not errors, errors
            context.close()
            print('PASS: importação de JSON antigo e atual; validação/exportação sem datas; importação parcial preserva tabelas existentes')

            rows = [
                dict(id=2,banco='BancodoBrasil',convenio='INSS',data='2026-10-19',tipo='margem',prazo=84,plano='A',fator=.02,taxa=1.7),
                dict(id=1,banco='BancodoBrasil',convenio='INSS',data='2026-09-01',tipo='margem',prazo=84,plano='A',fator=.01,taxa=1.6),
                dict(id=3,banco='BancodoBrasil',convenio='INSS',data='2026-09-01',tipo='margem',prazo=72,plano='Antiga',fator=.03,taxa=None)]
            context, page, errors = fresh(local={}, rows=rows, __qaExigirData=True)
            expect(page.locator('#bf-listaPrazosMargem .factor-row')).to_have_count(2)
            result = page.evaluate("""async () => {
                const api=await import('../js/api/baseFatoresApi.js');
                const base={BancodoBrasil:{fatores:{margem:[
                    {prazo:84,plano:'A',fator:.05,taxa:1.7},
                    {prazo:60,plano:'Nova',fator:.04}
                ],cartao:[]}}};
                const primeiro=await api.enviarFatoresRemotos(base);
                const segundo=await api.enviarFatoresRemotos(base);
                return {primeiro,segundo,rows:window.__qaRows,writes:window.__qaWrites,
                    base:api.mesclarFatoresRemotos(window.__qaRows)};
            }""")
            assert result['primeiro']['atualizados'] == 1 and result['primeiro']['inseridos'] == 1
            assert result['segundo']['mantidos'] == 2
            assert [w['method'] for w in result['writes']] == ['update', 'insert']
            assert result['writes'][0]['filters'] == [['id', 2]]
            assert next(r for r in result['rows'] if r['id'] == 1)['fator'] == .01
            assert result['writes'][1]['rows'][0]['data'] == '1970-01-01'
            assert all('id' not in r for w in result['writes'] for r in w['rows'])
            assert len(result['base']['BancodoBrasil']['fatores']['margem']) == 3
            assert not errors, errors
            context.close()
            print('PASS: versões remotas consolidadas; UPDATE usa ID mais recente; histórico físico preservado; INSERT compatível com data NOT NULL e reenvio sem duplicatas')

            context, page, errors = fresh(local={}, __qaSemData=True)
            result = page.evaluate("""async base => {
                const api=await import('../js/api/baseFatoresApi.js');
                const retorno=await api.enviarFatoresRemotos(base);
                return {retorno,writes:window.__qaWrites};
            }""", atual)
            assert result['retorno']['quantidade'] == 4
            assert all('data' not in r for w in result['writes'] for r in w['rows'])
            page.goto(f'http://127.0.0.1:{server.server_port}/pages/fatores-do-dia.html')
            expect(page.locator('#bf-data')).to_have_count(0)
            expect(page.locator('#bf-limparAntigos')).to_have_count(0)
            assert not errors, errors
            context.close()
            print('PASS: Supabase sem coluna data recebe JSON atual; tela legada também fica sem calendário ou limpeza por data')

            context, page, errors = fresh(__qaFalhaBackup=True)
            assert page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))') == ANTIGO
            expect(page.locator('#bf-salvarBanco')).to_be_disabled()
            expect(page.locator('#uploadBaseBtn')).to_be_disabled()
            with page.expect_download() as pending:
                page.locator('#bf-exportarBanco').click()
            assert json.loads(Path(pending.value.path()).read_text(encoding='utf-8')) == ANTIGO
            page.goto(f'http://127.0.0.1:{server.server_port}/pages/simulador.html')
            page.locator('#slBanco').select_option('BancodoBrasil')
            page.locator('#slOrigemFator').select_option('tabela')
            page.locator('#inpValorMargem').fill('100')
            expect(page.locator('#resValor')).to_contain_text('5.000,00')
            assert page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))') == ANTIGO
            assert not errors, errors
            context.close()
            print('PASS: falta de espaço para backup não sobrescreve o original; exportação de resgate e simulação continuam disponíveis')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

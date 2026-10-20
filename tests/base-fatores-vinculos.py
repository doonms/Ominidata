"""Valida vínculos, JSON e sincronização sem acessar ou gravar no Supabase real."""
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
DATA = '2026-10-20'
FATORES = {
    'Banco Teste': dict(fatores={DATA: dict(
        margem=[dict(prazo=84, fator=.02, taxa='1,70', plano='Tabela "A" <especial>'),
                dict(prazo=84, fator=.02, taxa='1,80', plano='Tabela B'),
                dict(prazo=72, fator=.03, taxa='1,90', plano='Tabela C'),
                dict(prazo=60, fator=.04, taxa='2,00', plano='Tabela D')],
        cartao=[dict(prazo=96, fator=22.5, taxa='2,15', plano='Cartão')])},
        seguros=[dict(nome='Seguro teste', tipo='fixo', valor=25)]),
    'Outro Banco': dict(fatores={DATA: dict(margem=[dict(prazo=84, fator=.02, plano='Outra')], cartao=[])})
}


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)

            def fresh(local=FATORES, rows=None, **flags):
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block', accept_downloads=True)
                context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=SYNC['STUB']))
                context.route('https://**/*', lambda r: r.abort())
                context.add_init_script('window.__qaRows=' + json.dumps(rows or []) + ';'
                    'window.__qaWrites=[];window.__qaRanges=[];'
                    'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    f'if (!localStorage.getItem("{KEY}")) localStorage.setItem("{KEY}",' + json.dumps(json.dumps(local)) + ');' +
                    ''.join('window.' + k + '=' + json.dumps(v) + ';' for k, v in flags.items()))
                page = context.new_page()
                errors, dialogs = [], []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
                page.goto(base + '/pages/base-fatores.html')
                expect(page.locator('#bf-sync-status')).to_contain_text('consultados' if rows else 'não retornou fatores')
                return context, page, errors, dialogs

            def tabela(page, nome):
                return page.locator('#bf-listaPrazosMargem .factor-row').nth(nome)

            def vincular(page, indice, referencia):
                row = tabela(page, indice)
                row.locator('.bf-factor-link > summary').click()
                row.locator('.bf-link-target').select_option(str(referencia))
                row.locator('.bf-link-apply').click()

            def cache(page):
                return page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')

            def upload(page, value):
                page.locator('#uploadBaseFile').set_input_files(dict(
                    name='vinculos.json', mimeType='application/json', buffer=json.dumps(value).encode()))
                expect(page.locator('#uploadBaseBtn')).to_be_enabled()

            context, page, errors, dialogs = fresh()
            result = page.evaluate("""async () => {
                const api=await import('../js/simulador/vinculos-fatores.js');
                const lista=Array.from({length:5},(_,i)=>({plano:String(i),fator:i<3?.02:.04}));
                api.vincularFator(lista,lista[1],lista[0]);
                api.vincularFator(lista,lista[2],lista[0]);
                api.vincularFator(lista,lista[4],lista[3]);
                api.vincularFator(lista,lista[1],lista[3]);
                api.atualizarFatorVinculado(lista,lista[0],.03);
                const fatores=lista.map(i=>i.fator);
                const outraData=structuredClone(lista);
                api.atualizarFatorVinculado(lista,lista[3],.05);
                api.desvincularFator(lista,lista[0]);
                const invalid=api.atualizarFatorVinculado(lista,lista[3],0);
                return {fatores,outraData,lista,invalid};
            }""")
            assert result['fatores'] == [.03,.04,.03,.04,.04]
            assert [r['fator'] for r in result['outraData']] == result['fatores']
            assert [r['fator'] for r in result['lista']] == [.03,.05,.03,.05,.05]
            assert result['lista'][0]['grupo_fator'] is None and result['lista'][2]['grupo_fator'] is None
            assert result['invalid'] is False
            print('PASS: mover uma tabela entre grupos não arrasta as demais; grupos, datas e fatores inválidos isolados')
            expect(tabela(page, 0).locator('.plano')).to_have_value('Tabela "A" <especial>')
            assert page.locator('especial').count() == 0
            vincular(page, 1, 0)
            expect(page.locator('.bf-factor-link.is-linked')).to_have_count(2)
            tabela(page, 1).locator('.fator').fill('0.025')
            expect(tabela(page, 0).locator('.fator')).to_have_value('0.025')
            expect(tabela(page, 2).locator('.fator')).to_have_value('0.03')
            expect(tabela(page, 1).locator('.taxa')).to_have_value('1,80')
            vincular(page, 2, 0)
            assert 'passará a usar o fator' in dialogs[-1]
            expect(page.locator('.bf-factor-link.is-linked')).to_have_count(3)
            tabela(page, 0).locator('.fator').fill('0.03')
            assert page.locator('#bf-listaPrazosMargem .fator').evaluate_all('els=>els.map(e=>e.value)') == ['0.03', '0.03', '0.03', '0.04']
            original = FATORES['Banco Teste']['fatores'][DATA]
            actual = cache(page)['Banco Teste']['fatores']
            assert [i['plano'] for i in actual['margem']] == [i['plano'] for i in original['margem']]
            assert [i['prazo'] for i in actual['margem']] == [i['prazo'] for i in original['margem']]
            assert [i['taxa'] for i in actual['margem']] == [i['taxa'] for i in original['margem']]
            assert actual['cartao'] == original['cartao']
            assert cache(page)['Outro Banco']['fatores']['margem'] == FATORES['Outro Banco']['fatores'][DATA]['margem']
            tabela(page, 1).locator('.fator').fill('')
            expect(page.locator('#bf-vinculos-status')).to_contain_text('foram mantidos')
            tabela(page, 1).locator('.plano').click()
            expect(tabela(page, 1).locator('.fator')).to_have_value('0.03')
            assert cache(page)['Banco Teste']['fatores']['margem'][1]['fator'] == .03
            print('PASS: vínculos em qualquer direção propagam só fatores válidos; nomes especiais, prazos, taxas, cartão e outro banco preservados')

            page.reload()
            expect(page.locator('.bf-factor-link.is-linked')).to_have_count(3)
            tabela(page, 0).locator('.bf-factor-link > summary').click()
            expect(tabela(page, 0).locator('.bf-factor-link-body')).to_contain_text('Tabela B')
            for width in [320, 390, 768, 1440, 1920]:
                page.set_viewport_size({'width': width, 'height': 1000})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow {width}px'
                if width in [390, 1440]:
                    nome = 'mobile' if width == 390 else 'desktop'
                    page.locator('#bf-blocoMargem').screenshot(path=str(Path(os.environ['TEMP']) / f'ominidata-vinculos-{nome}.png'))
            page.set_viewport_size({'width': 1440, 'height': 1000})
            with page.expect_download() as pending:
                page.locator('#bf-exportarBanco').click()
            linked = json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))
            assert len({i['grupo_fator'] for i in linked['Banco Teste']['fatores']['margem'][:3]}) == 1
            expect(page.locator('#bf-data')).to_have_count(0)
            assert set(linked['Banco Teste']['fatores']) == {'margem', 'cartao'}
            tabela(page, 2).locator('.bf-factor-link > summary').click()
            tabela(page, 2).locator('.bf-link-remove').click()
            tabela(page, 2).locator('.fator').fill('0.05')
            expect(tabela(page, 0).locator('.fator')).to_have_value('0.03')
            tabela(page, 1).locator('button.danger').click()
            expect(page.locator('.bf-factor-link.is-linked')).to_have_count(0)
            assert cache(page)['Banco Teste']['fatores']['margem'][0]['grupo_fator'] is None
            assert not errors, errors
            context.close()
            print('PASS: recarregar/exportar sem datas preserva vínculos; desvincular/remover não apaga fatores nem deixa vínculos órfãos; layout 320–1920px')

            context, page, errors, dialogs = fresh(local={})
            with page.expect_file_chooser() as pending:
                page.locator('#bf-importarBanco').click()
            pending.value.set_files(dict(name='vinculos.json', mimeType='application/json', buffer=json.dumps(linked).encode()))
            expect(page.locator('.bf-factor-link.is-linked')).to_have_count(3)
            tabela(page, 1).locator('.fator').fill('0.035')
            expect(tabela(page, 0).locator('.fator')).to_have_value('0.035')
            assert not errors, errors
            context.close()
            print('PASS: importação do JSON em outro navegador restaura vínculos e nomes')

            context, page, errors, dialogs = fresh(local=linked, __qaSemVinculos=True)
            upload(page, linked)
            expect(page.locator('#bf-sync-status')).to_contain_text('coluna "grupo_fator"')
            assert '20261020_base_fatores_vinculos.sql' in dialogs[-1]
            assert page.evaluate('window.__qaWrites.length') == 0
            expect(page.locator('.bf-factor-link.is-linked')).to_have_count(3)
            assert not errors, errors
            context.close()
            print('PASS: schema antigo não perde os vínculos nem grava parcialmente; informa migração necessária')

            context, page, errors, dialogs = fresh(local=linked)
            upload(page, linked)
            expect(page.locator('#bf-sync-status')).to_contain_text('6 fatores confirmados')
            remote = page.evaluate('window.__qaRows')
            assert len(remote) == 6
            group = linked['Banco Teste']['fatores']['margem'][0]['grupo_fator']
            assert len([r for r in remote if r.get('grupo_fator') == group]) == 3
            assert page.evaluate("window.__qaWrites.every(w=>w.rows.every(r=>!Object.hasOwn(r,'id')))")
            result = page.evaluate("""async linked => {
                const api = await import('../js/api/baseFatoresApi.js');
                window.__qaWrites = [];
                const legado = structuredClone(linked);
                for (const b of Object.values(legado))
                    for (const rows of Object.values(b.fatores)) for (const row of rows) delete row.grupo_fator;
                await api.enviarFatoresRemotos(legado);
                const legacyWrites = window.__qaWrites.length;
                const parcial = {'Banco Teste': {fatores: {'2026-10-20': {margem: [
                    {...legado['Banco Teste'].fatores.margem[0], fator:.04}
                ]}}}};
                let erroParcial='';
                try { await api.enviarFatoresRemotos(parcial); } catch(e) { erroParcial=e.message; }
                const partialWrites=window.__qaWrites.length;
                for (const row of linked['Banco Teste'].fatores.margem) row.grupo_fator=null;
                await api.enviarFatoresRemotos(linked);
                return {legacyWrites, erroParcial, partialWrites, writes:window.__qaWrites, rows:window.__qaRows};
            }""", linked)
            assert result['legacyWrites'] == 0
            assert 'mesmo fator' in result['erroParcial'] and result['partialWrites'] == 0
            assert len(result['writes']) == 3 and all(w['method'] == 'update' for w in result['writes'])
            assert all('id' not in r for w in result['writes'] for r in w['rows'])
            assert all(not r.get('grupo_fator') for r in result['rows'])
            assert not errors, errors
            context.close()
            print('PASS: Supabase recebe IDs de vínculo sem enviar IDs identity; legado não desfaz vínculos; arquivo parcial conflitante bloqueado; desvincular é publicado por UPDATE')

            context, page, errors, dialogs = fresh(local={}, rows=remote)
            expect(page.locator('.bf-factor-link.is-linked')).to_have_count(3)
            tabela(page, 2).locator('.fator').fill('0.045')
            expect(tabela(page, 0).locator('.fator')).to_have_value('0.045')
            expect(tabela(page, 1).locator('.plano')).to_have_value('Tabela B')
            page.goto(base + '/pages/simulador.html')
            expect(page.locator('#sim-bank-count')).to_have_text('0 bancos')
            page.locator('#slBanco').select_option('Banco Teste')
            page.locator('#slOrigemFator').select_option('tabela')
            expect(page.locator('#slTabela option')).to_have_count(2)
            assert not errors, errors
            context.close()
            print('PASS: outro navegador carrega os vínculos do Supabase e o Simulador continua distinguindo nomes de tabelas')

            context, page, errors, dialogs = fresh()
            invalid = json.loads(json.dumps(linked))
            invalid['Banco Teste']['fatores']['margem'][0]['fator'] = .08
            upload(page, invalid)
            expect(page.locator('#bf-sync-status')).to_contain_text('precisam ter o mesmo fator')
            assert page.evaluate('window.__qaWrites.length') == 0
            assert not errors, errors
            context.close()
            print('PASS: JSON com fatores conflitantes no mesmo vínculo é rejeitado antes de alterar a base')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

"""Público por tabela: interruptores, persistência, Supabase e seleção no simulador.

Executa em Chrome isolado com Supabase inteiramente simulado; não acessa produção.
"""
import json
import re
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import expect, sync_playwright

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
SYNC = runpy.run_path(str(Path(__file__).with_name('base-fatores-sync.py')))
KEY = 'ominidata_base_fatores_v1'

# O stub adicional pertence somente a esta suíte. Um schema antigo realmente
# rejeita a seleção/gravação das novas colunas, em vez de aceitar tudo por engano.
STUB = SYNC['STUB'].replace(
    "if(table!=='base_fatores') return {data:[],error:null};",
    """if(table==='base_inss') return {data:window.__qaRegras.map(dados=>({dados,
          nomeBanco:dados.nomeBanco,nome:dados.nome,suspenso:!!dados.suspenso})),error:null};
          if(table!=='base_fatores') return {data:[],error:null};
          const indisponiveis=window.__qaSemPublico
            ? (Array.isArray(window.__qaSemPublico)?window.__qaSemPublico:['publico_assinatura','publico_invalidez']) : [];
          const ausente=indisponiveis.find(col=>this.columns.split(',').map(c=>c.trim()).includes(col)
            || (this.payload||[]).some(row=>Object.hasOwn(row,col)));
          if(ausente) return {data:null,error:{code:'42703',message:'column base_fatores.'+ausente+' does not exist'}};""")
assert STUB != SYNC['STUB'], 'O ponto de extensão do stub de Supabase mudou.'


def tabela(nome, indice, assinatura=None, invalidez=None):
    value = dict(nome=nome, prazos=[dict(prazo=84, fator=.02 + indice * .001, taxa=1.7)])
    if assinatura is not None or invalidez is not None:
        value['publico'] = dict(assinatura=assinatura or 'todos', invalidez=invalidez or 'todos')
    return value


TABELAS = [
    tabela('Normal sem marcação', 0),
    tabela('Normal explícita', 1, 'todos', 'todos'),
    tabela('Assina', 2, 'sim', 'todos'),
    tabela('Não assina', 3, 'nao', 'todos'),
    tabela('Invalidez', 4, 'todos', 'sim'),
    tabela('Sem invalidez', 5, 'todos', 'nao'),
    tabela('Assina e invalidez', 6, 'sim', 'sim'),
]
CADASTRO = {'BancodoBrasil': dict(tabelas=dict(margem=TABELAS, cartao=[
    dict(nome='Cartão normal', prazos=[dict(prazo=96, fator=22.5, taxa=2.15)]),
    dict(nome='Cartão não assina', publico=dict(assinatura='nao', invalidez='todos'),
         prazos=[dict(prazo=96, fator=20, taxa=2.15)])]),
    fazMargem=True, fazCartao=True, seguros=[])}


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)

            def fresh(prefix='', local=CADASTRO, rows=None, width=1440, **flags):
                context = browser.new_context(viewport={'width': width, 'height': 1000}, service_workers='block')
                context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=STUB))
                context.route('https://**/*', lambda r: r.abort())
                context.add_init_script(
                    'window.__qaRows=JSON.parse(sessionStorage.getItem("__qaRemoteRows")||' + json.dumps(json.dumps(rows or [])) + ');'
                    'window.__qaWrites=[];window.__qaRanges=[];window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';'
                    'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));'
                    f'if(!localStorage.getItem("{KEY}"))localStorage.setItem("{KEY}",' + json.dumps(json.dumps(local)) + ');' +
                    ''.join('window.' + name + '=' + json.dumps(value) + ';' for name, value in flags.items()))
                page = context.new_page()
                errors, dialogs = [], []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}')
                        if r.status >= 400 and any(k in r.url for k in ['.js', '.css']) else None)
                page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
                base = f'http://127.0.0.1:{server.server_port}' + prefix
                page.goto(base + '/pages/base-fatores.html')
                expect(page.locator('#bf-sync-status')).to_contain_text('consultados' if rows else 'não retornou fatores')
                return context, page, errors, dialogs, base

            def cache(page):
                return page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')

            def upload(page, value):
                page.locator('#uploadBaseFile').set_input_files(dict(name='publico.json', mimeType='application/json',
                    buffer=json.dumps(value).encode()))

            def expect_tables(page, nomes):
                expect(page.locator('#slTabela option')).to_have_text([
                    re.compile('^' + re.escape(nome) + r' · ') for nome in nomes])

            def switch(card, grupo, valor):
                return card.locator(f'input[data-publico-grupo="{grupo}"][data-publico-valor="{valor}"]')

            normais = ['Normal sem marcação', 'Normal explícita']
            for prefix in ['', '/Ominidata']:
                context, page, errors, _, base = fresh(prefix)
                cards = page.locator('#bf-listaPrazosMargem > .bf-table-card')
                expect(cards).to_have_count(7)
                expect(cards.locator('.bf-table-toggle[aria-expanded="false"]')).to_have_count(7)
                for grupo in ['assinatura', 'invalidez']:
                    expect(switch(cards.first, grupo, 'sim')).not_to_be_checked()
                    expect(switch(cards.first, grupo, 'nao')).not_to_be_checked()
                normal = cards.nth(1)
                normal.locator('.bf-table-toggle').click()
                for grupo in ['assinatura', 'invalidez']:
                    expect(switch(normal, grupo, 'sim')).not_to_be_checked()
                    expect(switch(normal, grupo, 'nao')).not_to_be_checked()
                    switch(normal, grupo, 'sim').locator('..').click()
                    expect(switch(normal, grupo, 'sim')).to_be_checked()
                    switch(normal, grupo, 'nao').locator('..').click()
                    expect(switch(normal, grupo, 'sim')).not_to_be_checked()
                    expect(switch(normal, grupo, 'nao')).to_be_checked()
                    switch(normal, grupo, 'nao').locator('..').click()
                    expect(switch(normal, grupo, 'nao')).not_to_be_checked()
                assert cache(page)['BancodoBrasil']['tabelas']['margem'][1]['publico'] == dict(assinatura='todos', invalidez='todos')
                expect(normal).to_contain_text('Assina')
                expect(normal).to_contain_text('Não assina')
                expect(normal).to_contain_text('Invalidez')
                expect(normal).to_contain_text('Sem invalidez')
                page.reload()
                expect(cards.locator('.bf-table-toggle[aria-expanded="false"]')).to_have_count(7)
                normal.locator('.bf-table-toggle').click()
                cards.first.locator('.bf-table-toggle').click()
                expect(switch(cards.nth(2), 'assinatura', 'sim')).to_be_checked()
                expect(switch(cards.nth(3), 'assinatura', 'nao')).to_be_checked()
                expect(switch(cards.nth(4), 'invalidez', 'sim')).to_be_checked()
                expect(switch(cards.nth(5), 'invalidez', 'nao')).to_be_checked()
                expect(switch(cards.nth(6), 'assinatura', 'sim')).to_be_checked()
                expect(switch(cards.nth(6), 'invalidez', 'sim')).to_be_checked()
                for width in [320, 390, 768, 1440]:
                    page.set_viewport_size({'width': width, 'height': 1000})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'Overflow {width}px'
                    box = switch(normal, 'assinatura', 'sim').locator('..').bounding_box()
                    assert box and box['width'] > 0 and box['height'] > 0, 'Interruptor invisível'
                    if width in [390, 1440]:
                        nome = 'mobile' if width == 390 else 'desktop'
                        cards.first.screenshot(path=str(Path(gettempdir()) / f'ominidata-publico-{nome}.png'))
                page.set_viewport_size({'width': 1440, 'height': 1000})
                upload(page, cache(page))
                expect(page.locator('#bf-sync-status')).to_contain_text('9 fatores confirmados')
                remoto = page.evaluate('window.__qaRows')
                assert len(remoto) == 9
                assert all('id' not in row for w in page.evaluate('window.__qaWrites') for row in w['rows'])
                assert next(r for r in remoto if r['plano'] == 'Assina e invalidez')['publico_assinatura'] == 'sim'
                assert next(r for r in remoto if r['plano'] == 'Assina e invalidez')['publico_invalidez'] == 'sim'
                assert not any(k.startswith('publico_') for k in next(r for r in remoto if r['plano'] == 'Normal sem marcação'))
                page.evaluate('sessionStorage.setItem("__qaRemoteRows",JSON.stringify(window.__qaRows))')
                page.goto(base + '/pages/simulador.html')
                expect(page.locator('#sim-base-status')).to_contain_text('consultados no Supabase')
                page.locator('#slBanco').select_option('BancodoBrasil')
                page.locator('#slOrigemFator').select_option('tabela')
                page.locator('#inpValorMargem').fill('100')
                page.locator('#sim-multiplas > summary').click()
                perfis = [
                    ('qualquer', 'geral', normais + ['Sem invalidez']),
                    ('sim', 'geral', normais + ['Assina', 'Sem invalidez']),
                    ('nao', 'geral', normais + ['Não assina', 'Sem invalidez']),
                    ('qualquer', 'invalidez', normais + ['Invalidez']),
                    ('sim', 'invalidez', normais + ['Assina', 'Invalidez', 'Assina e invalidez']),
                    ('nao', 'invalidez', normais + ['Não assina', 'Invalidez']),
                    ('sim', 'loas', normais + ['Assina', 'Sem invalidez']),
                    ('nao', 'pensao', normais + ['Não assina', 'Sem invalidez']),
                ]
                for assina, especie, nomes in perfis:
                    # Não clica em pesquisar nem na logo: banco escolhido manualmente
                    # também precisa refletir imediatamente o perfil dos campos.
                    page.locator('#sim-assina').select_option(assina)
                    page.locator('#sim-especie').select_option(especie)
                    expect_tables(page, nomes)
                    expect(page.locator('#sim-multi-opcoes input')).to_have_count(len(nomes))
                    for nome in nomes:
                        page.locator('#slTabela').select_option(label=next(t for t in page.locator('#slTabela option').all_text_contents() if t.startswith(nome + ' · ')))
                        page.locator('#btnSimular').click()
                        expect(page.locator('#resPlano')).to_have_text(nome)
                    page.locator('#sim-multi-todas').click()
                    page.locator('#sim-multi-gerar').click()
                    expect(page.locator('.sim-multi-card')).to_have_count(len(nomes))
                    expect(page.locator('.sim-multi-card [data-field=resPlano]')).to_have_text(nomes)
                page.locator('#sim-assina').select_option('sim')
                page.locator('#sim-especie').select_option('invalidez')
                page.locator('#slTabela').select_option(label=next(t for t in page.locator('#slTabela option').all_text_contents() if t.startswith('Assina e invalidez · ')))
                page.locator('#btnSimular').click()
                expect(page.locator('#resPlano')).to_have_text('Assina e invalidez')
                page.locator('#sim-assina').select_option('nao')
                expect_tables(page, normais + ['Não assina', 'Invalidez'])
                page.locator('#btnSimular').click()
                expect(page.locator('#resPlano')).not_to_have_text('Assina e invalidez')
                page.locator('#sim-multi-todas').click()
                page.locator('#sim-multi-gerar').click()
                expect(page.locator('.sim-multi-card [data-field=resPlano]')).to_have_text(normais + ['Não assina', 'Invalidez'])
                page.locator('#slOperacao').select_option('cartao')
                expect_tables(page, ['Cartão normal', 'Cartão não assina'])
                page.locator('#sim-assina').select_option('sim')
                expect_tables(page, ['Cartão normal'])
                page.locator('#slOperacao').select_option('margem')
                page.locator('#slOrigemFator').select_option('manual')
                page.locator('#inpFatorManual').fill('0,04')
                page.locator('#inpTabelaManual').fill('Livre, sem restrição de público')
                page.locator('#sim-assina').select_option('qualquer')
                page.locator('#sim-especie').select_option('geral')
                page.locator('#btnSimular').click()
                expect(page.locator('#resPlano')).to_have_text('Livre, sem restrição de público')
                expect(page.locator('#resValor')).to_contain_text('2.500,00')
                page.locator('#sim-assina').select_option('nao')
                page.locator('#sim-nome').fill('Banco do Brasil')
                page.locator('#sim-search-form button[type=submit]').click()
                page.get_by_role('button', name='Carregar simulação de Banco do Brasil', exact=True).click()
                expect(page.locator('#slOrigemFator')).to_have_value('tabela')
                expect_tables(page, normais + ['Não assina', 'Sem invalidez'])
                page.locator('#sim-search-form button[type=reset]').click()
                expect(page.locator('#sim-assina')).to_have_value('qualquer')
                expect_tables(page, normais + ['Sem invalidez'])
                assert not errors, errors
                context.close()
                print(f'PASS: interruptores exclusivos/reversíveis, persistência, responsivo, upload sem ID, matriz de perfis individual/lote e cálculo manual ({prefix or "/"})')

                ctx2, pg2, errors2, _, _ = fresh(prefix, local={}, rows=remoto, width=390)
                rebuilt = cache(pg2)['BancodoBrasil']['tabelas']['margem']
                assert len(rebuilt) == 7
                assert next(t for t in rebuilt if t['nome'] == 'Assina e invalidez')['publico'] == dict(assinatura='sim', invalidez='sim')
                assert next(t for t in rebuilt if t['nome'] == 'Sem invalidez')['publico'] == dict(assinatura='todos', invalidez='nao')
                assert not errors2, errors2
                ctx2.close()
                print('PASS: outro contexto sem cache reconstitui o público a partir do Supabase')

            context, page, errors, _, _ = fresh()
            result = page.evaluate("""async () => {
                const api=await import('../js/api/baseFatoresApi.js');
                const base={Banco:{tabelas:{margem:[{nome:'Perfil',publico:{assinatura:'sim',invalidez:'nao'},
                    prazos:[{prazo:84,fator:.02,taxa:1.7},{prazo:72,fator:.03,taxa:1.8}]}],cartao:[]}}};
                const initial=await api.enviarFatoresRemotos(base);
                const original=structuredClone(window.__qaRows);
                window.__qaWrites=[];
                const changed=structuredClone(base);changed.Banco.tabelas.margem[0].publico={assinatura:'nao',invalidez:'sim'};
                const update=await api.enviarFatoresRemotos(changed);
                const writes=structuredClone(window.__qaWrites);
                const rows=structuredClone(window.__qaRows);
                window.__qaWrites=[];
                await api.enviarFatoresRemotos(changed);
                const redundant=window.__qaWrites.length;
                const clear=structuredClone(changed);clear.Banco.tabelas.margem[0].publico={assinatura:'todos',invalidez:'todos'};
                await api.enviarFatoresRemotos(clear);
                const cleared=structuredClone(window.__qaRows);
                const bad=[null,[],{assinatura:'talvez'},{invalidez:'sim',outro:true},'sim'];
                const rejected=bad.filter(value=>{const b=structuredClone(base);b.Banco.tabelas.margem[0].publico=value;
                    try{api.prepararFatores(b);return false;}catch{return true;}});
                const flat={Banco:{fatores:{margem:[{prazo:84,fator:.02,plano:'Mesmo nome',publico_assinatura:'sim'},
                    {prazo:72,fator:.03,plano:'Mesmo nome',publico_assinatura:'nao'}],cartao:[]}}};
                let inconsistent=false;try{api.prepararFatores(flat);}catch{inconsistent=true;}
                const row={banco:'Banco',convenio:'INSS',tipo:'margem',plano:'Perfil',prazo:84,fator:.02,taxa:1.7};
                const legacy=api.mesclarFatoresRemotos([row],base).Banco.fatores.margem;
                const partial=api.mesclarFatoresRemotos([{...row,publico_assinatura:'nao',publico_invalidez:'sim'}],base).Banco.fatores.margem;
                const file=api.mesclarArquivoFatores({Banco:{tabelas:{margem:[{nome:'Perfil',publico:{assinatura:'nao',invalidez:'sim'},
                    prazos:[{prazo:84,fator:.02,taxa:1.7}]}],cartao:[]}}},base).Banco.fatores.margem;
                const noMeta=structuredClone(base);delete noMeta.Banco.tabelas.margem[0].publico;
                const noFields=api.prepararFatores(noMeta).every(r=>!Object.hasOwn(r,'publico_assinatura')&&!Object.hasOwn(r,'publico_invalidez'));
                return {initial,original,update,writes,rows,redundant,cleared,rejected:rejected.length,inconsistent,legacy,partial,file,noFields};
            }""")
            assert result['initial']['inseridos'] == 2
            assert result['update']['atualizados'] == 2
            assert len(result['writes']) == 2 and all(w['method'] == 'update' for w in result['writes'])
            assert [r['id'] for r in result['original']] == [r['id'] for r in result['rows']]
            assert all(r['publico_assinatura'] == 'nao' and r['publico_invalidez'] == 'sim' for r in result['rows'])
            assert all('id' not in row for w in result['writes'] for row in w['rows'])
            assert all(w['filters'] == [['id', result['original'][i]['id']]] for i, w in enumerate(result['writes']))
            assert result['redundant'] == 0
            assert all(r['publico_assinatura'] == 'todos' and r['publico_invalidez'] == 'todos' for r in result['cleared'])
            # null tem o mesmo significado de ausência; os demais formatos são erros.
            assert result['rejected'] == 4 and result['inconsistent'], result
            assert result['noFields']
            assert len(result['legacy']) == len(result['partial']) == len(result['file']) == 2
            assert all(r['publico_assinatura'] == 'sim' and r['publico_invalidez'] == 'nao' for r in result['legacy'])
            assert all(r['publico_assinatura'] == 'nao' and r['publico_invalidez'] == 'sim' for r in result['partial'] + result['file'])
            assert not errors, errors
            context.close()
            print('PASS: API valida perfis, rejeita inconsistência na tabela, atualiza só público por ID e permite limpar restrições sem duplicar linhas')

            for missing in [True, ['publico_assinatura'], ['publico_invalidez']]:
                context, page, errors, dialogs, _ = fresh(__qaSemPublico=missing)
                upload(page, CADASTRO)
                expect(page.locator('#bf-sync-status')).to_contain_text('Não foi possível confirmar')
                assert not page.evaluate('window.__qaWrites.length')
                assert 'publico' in dialogs[-1] and '20261020_base_fatores_publico.sql' in dialogs[-1], dialogs
                assert len(cache(page)['BancodoBrasil']['tabelas']['margem']) == 7
                reset = {'Banco normal explícito': dict(tabelas=dict(margem=[tabela('Normal', 0, 'todos', 'todos')], cartao=[]))}
                upload(page, reset)
                expect(page.locator('#bf-sync-status')).to_contain_text('Não foi possível confirmar')
                assert not page.evaluate('window.__qaWrites.length'), 'Reset explícito não pode ser perdido por falta de coluna'
                normal = {'Banco sem restrição': dict(tabelas=dict(margem=[tabela('Normal', 0)], cartao=[]))}
                upload(page, normal)
                expect(page.locator('#bf-sync-status')).to_contain_text('1 fatores confirmados')
                assert len(page.evaluate('window.__qaRows')) == 1
                assert not any(k.startswith('publico_') for k in page.evaluate('window.__qaRows[0]'))
                assert not errors, errors
                context.close()
            print('PASS: schema sem uma/ambas colunas bloqueia restrições antes de gravar, indica SQL e preserva cache; tabela normal continua publicável')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

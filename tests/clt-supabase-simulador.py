"""Integração CLT com servidor simulado; nenhuma leitura/escrita no projeto real."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-outros.py')))
KEY = 'ominidata_base_clt_v1'
CACHE = 'ominidata_base_clt_publicada_v1'


def banco(id, nome, meses):
    return dict(banco_id=id, nome=nome, tempoEmpresaMeses=meses, idadeMinima=18, idadeMaxima=65,
        minimoFuncionarios=10, tempoCnpjMeses=24, faixasIdade=[dict(idadeMinima=18, idadeMaxima=65)],
        documentos=['RG', 'CPF', 'CTPS'], outrosDocumentos='', seguro='nao', seguroDescricao='', observacoes='', suspenso=False)


def rows(bancos):
    return [dict(banco_id=b['banco_id'], nome=b['nome'], suspenso=b['suspenso'], dados=b) for b in bancos]


BASE = [banco('a', 'Banco A CLT', 3), banco('b', 'Banco B CLT', 6), banco('c', 'Banco C CLT', 12),
        banco('d', 'Sem requisito cadastrado', None), {**banco('s', 'Banco suspenso', 1), 'suspenso': True}]
BASE[0]['faixasIdade'] = [dict(idadeMinima=18, idadeMaxima=29), dict(idadeMinima=60, idadeMaxima=75)]
BASE[1].update(documentos=['RG','OUTROS'], outrosDocumentos='Holerite <original> & CTPS')
BASE[2].update(seguro='obrigatorio', seguroDescricao='Seguro explicado no cadastro; custo não é um fator.')
DRAFT = banco('novo', 'Rascunho não publicado', 1)

STUB = QA['STUB'].replace("{perfil:'master'}", "{perfil:window.__perfil || 'master'}").replace(
    "const rows = table === 'base_inss'", '''
        if(table==='base_clt') {
          const result=window.__cltOffline ? {data:null,error:{message:'Offline CLT no teste'}}
            : {data:JSON.parse(localStorage.getItem('__qaCltServidor')||'[]'),error:null};
          return Promise.resolve(result).then(resolve,reject);
        }
        const rows = table === 'base_inss' ''').replace('export const supabase = {', '''
export const supabase = {
  async rpc(nome,p) {
    window.__cltChamadas=(window.__cltChamadas||0)+1;
    if(nome!=='substituir_base_clt')throw Error('RPC inesperada');
    if(window.__cltErroRpc)return {data:null,error:window.__cltErroRpc};
    const previous=JSON.parse(localStorage.getItem('__qaCltServidor')||'[]');
    if(JSON.stringify(previous)!==JSON.stringify(p.p_base_anterior))return {data:null,error:{code:'40001',message:'Conflito'}};
    if(!p.p_registros.length&&!p.p_confirmar_vazia)throw Error('Confirmação vazia ausente');
    const removidos=previous.filter(r=>!p.p_registros.some(n=>n.banco_id===r.banco_id)).length;
    localStorage.setItem('__qaCltServidor',JSON.stringify(p.p_registros));
    if(window.__cltRespostaPerdida)return {data:null,error:{message:'Conexão perdida após envio'}};
    return {data:{registros:p.p_registros,removidos,backup_id:1},error:null};
  },''')


def envelope(bancos):
    return dict(tipo='base_clt', versao=1, bancos=bancos)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QA']['QuietHandler'], directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)

            def contexto(draft=None, cache=None, remote=BASE, offline=False):
                ctx = browser.new_context(service_workers='block', viewport={'width':1440, 'height':1050})
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=STUB))
                ctx.route('https://**/*', lambda r:r.abort())
                initial = { '__qaCltServidor': rows(remote) }
                if draft is not None: initial[KEY] = envelope(draft)
                if cache is not None: initial[CACHE] = envelope(cache)
                ctx.add_init_script('window.__qaRegras=' + json.dumps(QA['QA']['REGRAS']) + ';window.__qaFatoresRemotos=' + json.dumps(QA['REMOTOS']) + ';'
                    'window.__qaOutros=' + json.dumps([dict(banco_id=b['banco_id'],nome=b['nome'],suspenso=b.get('suspenso',False),dados=b) for b in QA['BASE']]) + ';'
                    'window.__cltOffline=' + json.dumps(offline) + ';'
                    'for(const [key,value] of Object.entries(' + json.dumps(initial) + '))if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(value));')
                page = ctx.new_page(); errors=[]
                page.on('pageerror', lambda e:errors.append(str(e)))
                return ctx, page, errors

            for prefix in ['', '/Ominidata']:
                base = f'http://127.0.0.1:{server.server_port}{prefix}'
                ctx, page, errors = contexto(draft=[DRAFT])
                accept = [False]
                page.on('dialog', lambda d:d.accept() if accept[0] else d.dismiss())
                page.goto(base + '/pages/base-clt.html')
                expect(page.locator('#clt-remoto-status')).to_contain_text('rascunho foi mantido')
                expect(page.locator('.clt-bank-name')).to_have_text(DRAFT['nome'])
                page.locator('#clt-enviar').click()
                expect(page.locator('#clt-enviar')).to_be_enabled()
                assert page.evaluate('window.__cltChamadas || 0') == 0
                accept[0] = True
                page.locator('#clt-enviar').click()
                expect(page.locator('#clt-remoto-status')).to_contain_text('1 banco(s) publicado(s); 5 removido(s)')
                assert len(json.loads(page.evaluate('localStorage.getItem("__qaCltServidor")'))) == 1
                page.locator('.clt-bank summary').click()
                page.locator('[data-field=tempoEmpresaMeses]').fill('8')
                page.reload()
                expect(page.locator('#clt-remoto-status')).to_contain_text('rascunho foi mantido')
                page.locator('.clt-bank summary').click()
                expect(page.locator('[data-field=tempoEmpresaMeses]')).to_have_value('8')
                page.locator('#clt-sincronizar').click()
                expect(page.locator('#clt-remoto-status')).to_contain_text('carregado(s) do Supabase')
                backup = json.loads(page.evaluate('localStorage.getItem("ominidata_base_clt_antes_importacao_v1")'))
                assert backup['bancos'][0]['tempoEmpresaMeses'] == '8'
                page.locator('.clt-bank summary').click()
                expect(page.locator('[data-field=tempoEmpresaMeses]')).to_have_value('1')
                # Publicação concorrente: a versão do formulário não sobrescreve silenciosamente.
                page.evaluate('(r)=>localStorage.setItem("__qaCltServidor",JSON.stringify(r))', rows(BASE))
                page.locator('#clt-enviar').click()
                expect(page.locator('#clt-remoto-status')).to_contain_text('mudou desde a leitura')
                expect(page.locator('.clt-bank-name')).to_have_text(DRAFT['nome'])
                page.locator('#clt-sincronizar').click()
                expect(page.locator('.clt-bank')).to_have_count(5)
                # Remover todos os bancos e publicar exige a confirmação explícita do envio vazio.
                while page.locator('.clt-bank').count():
                    page.locator('.clt-bank summary').first.click()
                    page.locator('.clt-remover').first.click()
                page.locator('#clt-enviar').click()
                expect(page.locator('#clt-remoto-status')).to_contain_text('0 banco(s) publicado(s)')
                page.reload()
                expect(page.locator('#clt-remoto-status')).to_contain_text('0 banco(s) no Supabase')
                expect(page.locator('.clt-bank')).to_have_count(0)
                assert not errors, errors
                print('PASS: envio direto, substituição/exclusão, cancelamento, rascunho, backup, sincronização e conflito', prefix)
                ctx.close()

                ctx, page, errors = contexto(draft=[DRAFT])
                page.goto(base + '/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                page.locator('#slBanco').select_option('BancodoBrasil')
                page.locator('#inpFatorManual').fill('0,025')
                page.locator('#inpValorMargem').fill('200')
                page.locator('#inpValorMargem').blur()
                original = page.evaluate('Object.fromEntries(["slBanco","inpFatorManual","inpValorMargem"].map(id=>[id,document.getElementById(id).value]))')
                page.locator('[name=simBaseConsulta][value=clt]').check()
                clt = page.locator('#sim-pesquisa-clt')
                expect(clt).to_be_visible()
                expect(page.locator('#sim-pesquisa-bancos')).to_be_hidden()
                expect(page.locator('#sim-pesquisa-outros')).to_be_hidden()
                expect(clt.locator('#sim-clt-status')).to_contain_text('consultada no Supabase')
                expect(clt.locator('.sim-bank-card')).to_have_count(0)
                page.locator('#sim-clt-tempo-empresa').fill('5')
                expect(clt.locator('.sim-bank-card')).to_have_count(1)
                expect(clt).not_to_contain_text(DRAFT['nome'])
                page.locator('#sim-clt-tempo-empresa').fill('12')
                expect(clt.locator('.sim-bank-card')).to_have_count(3)
                page.locator('#sim-clt-idade').fill('45')
                expect(clt.locator('.sim-bank-card')).to_have_count(2)
                page.locator('#sim-clt-idade').fill('65')
                expect(clt.locator('.sim-bank-card')).to_have_count(3)
                page.locator('#sim-clt-funcionarios').fill('5')
                expect(clt.locator('.sim-bank-card')).to_have_count(0)
                page.locator('#sim-clt-funcionarios').fill('20')
                page.locator('#sim-clt-tempo-cnpj').fill('12')
                expect(clt.locator('.sim-bank-card')).to_have_count(0)
                page.locator('#sim-clt-tempo-cnpj').fill('24')
                expect(clt.locator('.sim-bank-card')).to_have_count(3)
                c = clt.locator('.sim-bank-card').filter(has=page.get_by_role('button',name='Simular CLT com Banco C CLT',exact=True))
                c.locator('summary').click()
                expect(c).to_contain_text('Com seguro — obrigatório')
                expect(c).to_contain_text('Seguro explicado no cadastro')
                c.locator('.sim-bank-simulate').click()
                expect(page.locator('#slBanco')).to_have_value('clt:c')
                expect(page.locator('#slOrigemFator')).to_have_value('manual')
                expect(page.locator('#slOrigemFator option[value=tabela]')).to_be_disabled()
                expect(page.locator('#inpFatorManual')).to_have_value('')
                page.locator('#inpFatorManual').fill('0,02')
                page.locator('#inpValorMargem').fill('100')
                expect(page.locator('#resBancoNome')).to_have_text('Banco C CLT · CLT')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                expect(page.locator('#resSeguroItem')).to_be_hidden()
                page.locator('[name=simBaseConsulta][value=outros]').check()
                expect(page.locator('#sim-pesquisa-outros')).to_be_visible()
                page.locator('#sim-outros-results .sim-bank-simulate').first.click()
                page.locator('#inpFatorManual').fill('0,04')
                page.locator('[name=simBaseConsulta][value=clt]').check()
                expect(page.locator('#inpFatorManual')).to_have_value('0,02')
                expect(page.locator('#slBanco')).to_have_value('clt:c')
                page.locator('[name=simBaseConsulta][value=inss]').check()
                restaurado = page.evaluate('Object.fromEntries(["slBanco","inpFatorManual","inpValorMargem"].map(id=>[id,document.getElementById(id).value]))')
                assert restaurado == original, (original, restaurado)
                page.locator('[name=simBaseConsulta][value=outros]').check()
                expect(page.locator('#inpFatorManual')).to_have_value('0,04')
                page.locator('[name=simBaseConsulta][value=clt]').check()
                page.locator('#sim-clt-tempo-empresa').fill('5')
                expect(page.locator('#slBanco')).to_have_value('')
                expect(page.locator('#inpFatorManual')).to_have_value('')
                expect(page.locator('#sim-result')).to_be_hidden()
                for width in [320,390,768,1440]:
                    page.set_viewport_size({'width':width,'height':1050})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), width
                    assert clt.locator('.sim-bank-card').evaluate_all('els=>els.every(e=>e.scrollHeight<=e.clientHeight+1)'), f'Conteúdo fora do card em {width}px'
                    if not prefix and width in [390,1440]:
                        page.screenshot(path=str(Path(gettempdir()) / f'ominidata-simulador-clt-{width}.png'),full_page=True)
                assert not errors, errors
                print('PASS: 5 meses tem menos bancos que 12; idade/funcionários/CNPJ, documentos, seguro e contextos INSS/Outros/CLT isolados', prefix)
                ctx.close()

                for offline, remote, esperado in [(True,BASE,1),(False,[],0)]:
                    ctx, page, errors = contexto(draft=[DRAFT],cache=BASE,remote=remote,offline=offline)
                    page.goto(base + '/pages/simulador.html')
                    page.locator('[name=simBaseConsulta][value=clt]').check()
                    page.locator('#sim-clt-tempo-empresa').fill('5')
                    expect(page.locator('#sim-clt-status')).to_contain_text('Não foi possível atualizar' if offline else 'consultada no Supabase')
                    expect(page.locator('#sim-clt-results .sim-bank-card')).to_have_count(esperado)
                    expect(page.locator('#sim-clt-results')).not_to_contain_text(DRAFT['nome'])
                    assert not errors, errors
                    ctx.close()
                print('PASS: offline usa apenas cache publicado; remoto vazio é autoritativo e não ressuscita rascunhos', prefix)

                # Resposta perdida após commit: o rascunho não some e o reenvio é recusado por versão.
                ctx, page, errors = contexto(draft=[DRAFT])
                page.on('dialog', lambda d:d.accept())
                page.goto(base + '/pages/base-clt.html')
                expect(page.locator('#clt-remoto-status')).to_contain_text('rascunho foi mantido')
                antes = page.evaluate(f'localStorage.getItem("{KEY}")')
                page.evaluate('window.__cltRespostaPerdida=true')
                page.locator('#clt-enviar').click()
                expect(page.locator('#clt-remoto-status')).to_contain_text('Não foi possível confirmar')
                assert page.evaluate(f'localStorage.getItem("{KEY}")') == antes
                page.evaluate('window.__cltRespostaPerdida=false')
                page.locator('#clt-enviar').click()
                expect(page.locator('#clt-remoto-status')).to_contain_text('mudou desde a leitura')
                assert len(json.loads(page.evaluate('localStorage.getItem("__qaCltServidor")'))) == 1
                assert not errors, errors
                ctx.close()
                # Uma remoção em outro computador retira uma cópia local limpa, não reaparece do cache.
                ctx, page, errors = contexto(draft=BASE,cache=BASE,remote=[])
                page.goto(base + '/pages/base-clt.html')
                expect(page.locator('#clt-remoto-status')).to_contain_text('0 banco(s) no Supabase')
                expect(page.locator('.clt-bank')).to_have_count(0)
                assert not errors, errors
                ctx.close()
                print('PASS: resposta perdida não apaga rascunho nem duplica publicação; exclusão remota atualiza cópia limpa', prefix)
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

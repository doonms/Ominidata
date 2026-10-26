"""Sincronização e publicação de fatores com Supabase simulado; nenhuma conta/dado real."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
OLD = runpy.run_path(str(Path(__file__).with_name('base-fatores-sync.py')))
KEY = 'ominidata_base_fatores_v1'
LOCAL = {'Banco': {'fazMargem': True, 'fazCartao': False, 'seguros': [{'nome': 'Seguro', 'valor': 10}],
    'tabelas': {'margem': [
        {'nome': 'Atual', 'prazos': [{'prazo': 84, 'fator': .02, 'taxa': ''}]},
        {'nome': '', 'prazos': []},
        {'nome': 'Rascunho', 'prazos': [{'prazo': 96, 'fator': '', 'taxa': ''}]},
    ], 'cartao': []}}}
REMOTE = [{'id': 1, 'banco': 'Banco', 'convenio': 'INSS', 'tipo': 'margem', 'prazo': 84,
           'plano': 'Apagada', 'fator': .03, 'taxa': None}]
RPC = """
  async rpc(name,body) {
    window.__qaRpcs.push({name,body});
    if(window.__qaRpcDelay) await new Promise(r=>setTimeout(r,window.__qaRpcDelay));
    if(window.__qaRpcError) return {data:null,error:window.__qaRpcError};
    const before=window.__qaRows.filter(r=>(r.convenio||'INSS').toUpperCase()==='INSS');
    if(JSON.stringify(before)!==JSON.stringify(body.p_base_anterior))
      return {data:null,error:{code:'40001'}};
    const other=window.__qaRows.filter(r=>(r.convenio||'INSS').toUpperCase()!=='INSS');
    const registros=body.p_registros.map((r,i)=>({...r,id:100+i}));
    const removidos=before.filter(r=>!registros.some(n=>n.banco===r.banco&&n.tipo===r.tipo&&n.plano===r.plano&&n.prazo===r.prazo)).length;
    window.__qaRows=[...other,...registros];
    return {data:{registros,removidos,backup_id:1},error:null};
  },
"""
STUB = OLD['STUB'].replace('export const supabase = {', 'export const supabase = {' + RPC)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                context = browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 1000})
                context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=STUB))
                context.route('https://**/*', lambda r: r.abort())
                context.add_init_script(f"if(!localStorage.getItem('{KEY}'))localStorage.setItem('{KEY}'," + json.dumps(json.dumps(LOCAL)) + ');'
                    'window.__qaRows=JSON.parse(sessionStorage.getItem("__qaRowsOverride")||' + json.dumps(json.dumps(REMOTE)) + ');window.__qaWrites=[];window.__qaRanges=[];window.__qaRpcs=[];')
                page = context.new_page()
                errors, dialogs = [], []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
                url = f'http://127.0.0.1:{server.server_port}{prefix}'
                page.goto(url + '/pages/base-fatores.html')
                expect(page.locator('#bf-sync-status')).to_contain_text('Cadastro local preservado')
                assert page.locator('.bf-table-name').evaluate_all('(els)=>els.map(e=>e.value)') == ['Atual', '', 'Rascunho']
                assert not page.evaluate('window.__qaWrites.length')
                page.reload()
                expect(page.locator('#bf-sync-status')).to_contain_text('Cadastro local preservado')
                assert page.locator('.bf-table-name').evaluate_all('(els)=>els.map(e=>e.value)') == ['Atual', '', 'Rascunho']
                print('PASS: tabela apagada não volta no carregamento nem no reload', prefix)

                checks = page.evaluate("""async () => {
                  const api=await import('../js/api/baseFatoresApi.js');
                  const base=JSON.parse(localStorage.getItem('ominidata_base_fatores_v1'));
                  const antes=JSON.stringify(base),p=api.prepararPublicacaoFatores(base);
                  if(p.linhas.length!==1||p.pendentes.length!==2||JSON.stringify(base)!==antes)throw Error('Rascunhos');
                  const banco=base.Banco;
                  banco.tabelas.margem[0].prazos[0].taxa='abc';
                  try {api.prepararPublicacaoFatores(base);throw Error('Taxa inválida aceita');}
                  catch(e){if(e.message==='Taxa inválida aceita')throw e;}
                  banco.tabelas.margem[0].prazos[0].taxa='';
                  banco.tabelas.margem[0].prazos[0].fator=0;
                  try {api.prepararPublicacaoFatores(base);throw Error('Zero aceito');}
                  catch(e){if(e.message==='Zero aceito')throw e;}
                  banco.tabelas.margem[0].prazos[0].fator='';
                  try {api.prepararPublicacaoFatores(base);throw Error('Todos pendentes aceitos');}
                  catch(e){if(e.message==='Todos pendentes aceitos')throw e;}
                  return true;
                }""")
                assert checks
                page.locator('#bf-enviarDireto').click()
                expect(page.locator('#bf-sync-status')).to_contain_text('1 fatores publicados; 1 registros antigos removidos')
                assert 'rascunho' in dialogs[-1] and 'removidos' in dialogs[-1]
                assert page.evaluate('window.__qaRows.map(r=>r.plano)') == ['Atual']
                assert page.evaluate('window.__qaRpcs[0].body.p_registros[0].taxa') is None
                assert page.evaluate('window.__qaWrites.length') == 0, 'Sem DELETE/INSERT separados no cliente'
                assert page.locator('.bf-table-name').evaluate_all('(els)=>els.map(e=>e.value)') == ['Atual', '', 'Rascunho']
                assert page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).Banco.seguros.length") == 1
                print('PASS: envio direto publica exclusões e completos; taxa opcional, rascunhos/seguros preservados')

                page.evaluate("window.__qaRpcError={code:'PGRST202'}")
                page.locator('#bf-enviarDireto').click()
                expect(page.locator('#bf-sync-status')).to_contain_text('20261026_base_fatores_sincronizacao.sql')
                assert page.evaluate('window.__qaRows[0].plano') == 'Atual'
                page.evaluate("window.__qaRpcError={code:'40001'}")
                page.locator('#bf-enviarDireto').click()
                expect(page.locator('#bf-sync-status')).to_contain_text('A substituição foi cancelada')
                page.evaluate('window.__qaRpcError=null')
                print('PASS: SQL ausente/conflito não causam gravação parcial ou fallback destrutivo')

                # Mesmo antes de publicar, uma exclusão do último banco não pode voltar após reload.
                page.locator('#bf-removerBanco').click()
                page.reload()
                expect(page.locator('#bf-sync-status')).to_contain_text('Cadastro local preservado')
                expect(page.locator('#bf-slBanco option')).to_have_count(0)
                page.locator('#bf-enviarDireto').click()
                expect(page.locator('#bf-sync-status')).to_contain_text('0 fatores publicados')
                assert page.evaluate('window.__qaRpcs[0].body.p_confirmar_vazia') is True
                print('PASS: exclusão do último banco persiste; esvaziamento remoto exige confirmação')

                # A consulta explícita substitui prazos, faz backup e preserva metadados.
                page.evaluate('window.__qaRows=' + json.dumps(REMOTE))
                page.locator('#bf-sincronizar').click()
                expect(page.locator('#bf-sync-status')).to_contain_text('Tabelas e prazos sincronizados')
                assert page.locator('.bf-table-name').evaluate_all('(els)=>els.map(e=>e.value)') == ['Apagada']
                assert page.evaluate("localStorage.getItem('ominidata_base_fatores_backup_v1')!==null")
                print('PASS: sincronizar carrega versão remota com confirmação e backup local')

                # Simulador lê versão remota exata, inclusive vazia, e nunca regrava o editor.
                before = page.evaluate(f"localStorage.getItem('{KEY}')")
                page.goto(url + '/pages/simulador.html')
                expect(page.locator('#sim-base-status')).to_contain_text('Fatores consultados')
                assert page.evaluate(f"localStorage.getItem('{KEY}')") == before
                page.evaluate("sessionStorage.setItem('__qaRowsOverride','[]')")
                page.reload()
                expect(page.locator('#sim-base-status')).to_contain_text('não retornou fatores publicados')
                page.locator('#slBanco').select_option('Banco')
                page.locator('#slOrigemFator').select_option('tabela')
                assert page.locator('#slPrazo option').evaluate_all('(els)=>els.every(e=>!e.value)')
                assert page.evaluate(f"localStorage.getItem('{KEY}')") == before
                page.evaluate("sessionStorage.removeItem('__qaRowsOverride')")
                # Muda a resposta remota sem trocar os dados locais por meio de reload.
                page.evaluate('window.__qaRows=[]')
                result = page.evaluate("""async()=>{
                  const {substituirFatoresLocais}=await import('../js/api/baseFatoresApi.js');
                  const local=JSON.parse(localStorage.getItem('ominidata_base_fatores_v1'));
                  return substituirFatoresLocais([],local).Banco.fatores.margem;
                }""")
                assert result == []
                assert not errors, errors
                # Verifica o layout dos novos botões em tela estreita.
                page.goto(url + '/pages/base-fatores.html')
                expect(page.locator('#bf-sincronizar')).to_be_enabled()
                page.set_viewport_size({'width': 390, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                print('PASS: simulador não regrava rascunhos; cache remoto autoritativo e layout móvel sem overflow')
                if not prefix:
                    page.screenshot(path=str(Path(__import__('tempfile').gettempdir()) / 'ominidata-fatores-sync-mobile.png'), full_page=True)
                # Edição durante envio/consulta não pode ser sobrescrita, nem marcada como publicada.
                page.set_viewport_size({'width': 1400, 'height': 1000})
                page.evaluate('window.__qaRpcDelay=800')
                page.locator('#bf-enviarDireto').click()
                expect(page.locator('#bf-enviarDireto')).to_be_disabled()
                page.locator('.bf-table-name').fill('Editada durante envio')
                expect(page.locator('#bf-sync-status')).to_contain_text('ainda não foram publicadas')
                expect(page.locator('.bf-table-name')).to_have_value('Editada durante envio')
                assert page.evaluate("localStorage.getItem('ominidata_base_fatores_sync_v1')") == 'pendente'
                page.evaluate('window.__qaAtraso=800')
                page.locator('#bf-sincronizar').click()
                expect(page.locator('#bf-sincronizar')).to_be_disabled()
                page.locator('.bf-table-name').fill('Editada durante consulta')
                expect(page.locator('#bf-sync-status')).to_contain_text('não as sobrescreveu')
                expect(page.locator('.bf-table-name')).to_have_value('Editada durante consulta')
                print('PASS: edições durante envio e sincronização são mantidas e não marcadas como publicadas')
                context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

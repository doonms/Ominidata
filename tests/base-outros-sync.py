"""Leitura/publicação simuladas: não acessa nem modifica o Supabase real."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('base-outros-convenios.py')))
KEY = QA['KEY']
REMOTE_KEY = 'qa_outros_remote'
STUB = """
const copy = v => JSON.parse(JSON.stringify(v));
export const supabase = {
  auth: { getUser: async () => ({data:{user:window.__noAuth ? null : {id:'00000000-0000-0000-0000-000000000001',email:'dominicplf@gmail.com'}},error:null}) },
  async rpc(name, params) {
    if(window.__missingRpc) return {data:null,error:{code:'PGRST202',message:'RPC ausente'}};
    const payload=copy(params.p_registros);
    window.__writes ||= [];
    window.__writes.push({table:'base_outros_convenios',rows:payload,rpc:name,params:copy(params)});
    const rows=JSON.parse(localStorage.getItem('qa_outros_remote') || '[]');
    if(window.__writeError) return {data:null,error:{code:'42501',message:'RLS teste'}};
    if(window.__concurrent) return {data:null,error:{code:'40001',message:'Concorrência teste'}};
    if(!payload.length && !params.p_confirmar_vazia) return {data:null,error:{message:'Vazia não confirmada'}};
    window.__backups ||= [];
    window.__backups.push(copy(rows));
    localStorage.setItem('qa_outros_remote',JSON.stringify(payload));
    return {data:window.__noConfirm ? null : {registros:copy(payload),
      removidos:rows.filter(r=>!payload.some(p=>p.banco_id===r.banco_id)).length,
      backup_id:window.__backups.length},error:null};
  },
  from(table) {
    if (table === 'perfis_usuarios') {
      const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{perfil:'master'},error:null})};
      return q;
    }
    let payload = null, start = 0, end = 499;
    const q = {
      select() { return q; }, order() { return q; },
      range(a,b) { start=a;end=b;return q; },
      upsert() { throw new Error('Não usar upsert direto fora da transação'); },
      delete() { throw new Error('DELETE não deve ser chamado'); },
      async then(resolve,reject) {
        try {
          if(table !== 'base_outros_convenios') return resolve({data:[],error:null});
          const rows = JSON.parse(localStorage.getItem('qa_outros_remote') || '[]');
          if(payload) {
            if(window.__writeError) return resolve({data:null,error:{code:'42501',message:'RLS teste'}});
            for(const row of payload) {
              const i=rows.findIndex(r=>r.banco_id===row.banco_id);
              if(i<0)rows.push(row);else rows[i]=row;
            }
            localStorage.setItem('qa_outros_remote',JSON.stringify(rows));
            return resolve({data:window.__noConfirm ? [] : copy(payload),error:null});
          }
          window.__reads ||= [];
          window.__reads.push({table,start,end});
          if(window.__holdReads) await new Promise(r=>window.__releaseRead=r);
          if(window.__readError || (window.__secondPageError && start>0)) {
            return resolve({data:null,error:{message:'Offline de teste'}});
          }
          return resolve({data:copy(rows.slice(start,end+1)),error:null});
        } catch(e) { return reject(e); }
      }
    };return q;
  }
};
"""


def main():
    expect.set_options(timeout=15000)
    server = ThreadingHTTPServer(('127.0.0.1',0), partial(QA['QA']['QuietHandler'], directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            for prefix in ['', '/Ominidata']:
                ctx=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block',accept_downloads=True)
                ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=STUB))
                ctx.route('https://**/*',lambda r:r.abort())
                ctx.add_init_script('sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));')
                page=ctx.new_page()
                errors,dialogs=[],[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                dialog_handler = lambda d:(dialogs.append(d.message),d.accept())
                page.on('dialog',dialog_handler)
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/base-outros-convenios.html')
                status=page.locator('#baseOutrosStatus')
                expect(status).to_contain_text('não retornou bancos')

                def remote(rows):
                    page.evaluate('(rows)=>localStorage.setItem("qa_outros_remote",JSON.stringify(rows))',rows)

                def stored():
                    return page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}") || "[]")')

                def read():
                    page.locator('#reloadBaseOutrosBtn').click()
                    expect(page.locator('#reloadBaseOutrosBtn')).to_be_enabled()

                def publish():
                    page.locator('#uploadBaseOutrosBtn').click()
                    expect(page.locator('#uploadBaseOutrosBtn')).to_be_enabled()

                initial = [
                    dict(banco_id='ban1',nome='Banco Alfa',suspenso=True,dados=dict(nome='Nome desatualizado',suspenso=False,convenios=[
                        dict(id='modelo',tipo='padrao_banco',nome='Padrão banco',aceitaCeletista=True,aceitaTemporario=True,
                             prazosCeletista=[dict(idade='18-65',parcelas='72',obs='Celetista remoto')],
                             prazosTemporario=[dict(idade='19-60',parcelas='60',obs='Temporário remoto')]),
                        dict(id='prefeitura',tipo='prefeitura',nome='Prefeitura Alfa',fazMargem=True,
                             prazos=[dict(idade='18-75',parcelas='96',obs='Remoto')])],links=['https://exemplo.test'])),
                    dict(banco_id='ban2',nome='Banco Beta',suspenso=False,dados=dict(nome='Banco Beta',convenios=[
                        dict(id='gov',tipo='governo',nome='Governo Beta',observacoes='Versão 1')]))
                ]
                remote(initial)
                read()
                expect(status).to_contain_text('2 banco(s) lidos')
                assert stored()[0]['nome']=='Banco Alfa' and stored()[0]['suspenso']
                assert stored()[0]['convenios'][0]['prazosCeletista'][0]['obs']=='Celetista remoto'
                assert stored()[0]['convenios'][0]['prazosTemporario'][0]['obs']=='Temporário remoto'
                page.reload()
                expect(status).to_contain_text('2 banco(s) lidos')
                page.locator('[data-toggle-banco="0"]').click()
                page.locator('[data-toggle-convenio="0:prefeitura"]').click()
                page.locator('[data-conv-field="0:prefeitura:exigeDocumentos"]').check()
                page.locator('[data-conv-field="0:prefeitura:documentosNecessarios"]').fill('RG e último contracheque')
                page.locator('[data-conv-field="0:prefeitura:margemMaximaConvenio"]').fill('35,5%')
                page.locator('[data-conv-field="0:prefeitura:margemUtilizadaBanco"]').fill('30%')
                page.locator('[data-conv-field="0:prefeitura:observacoes"]').fill('Rascunho não publicado')
                changed=json.loads(json.dumps(initial))
                changed[0]['dados']['convenios'][1]['observacoes']='Mudança remota concorrente'
                changed[1]['dados']['convenios'][0]['observacoes']='Versão 2'
                remote(changed)
                read()
                expect(status).to_contain_text('Rascunhos locais diferentes foram preservados')
                assert stored()[0]['convenios'][1]['observacoes']=='Rascunho não publicado'
                assert stored()[1]['convenios'][0]['observacoes']=='Versão 2'
                publish()
                expect(status).to_contain_text('envio confirmado')
                writes=page.evaluate('window.__writes')
                assert len(writes)==1 and writes[0]['table']=='base_outros_convenios'
                assert writes[0]['rpc']=='substituir_base_outros_convenios'
                assert writes[0]['params']['p_base_anterior']==changed
                assert all('id' not in row and isinstance(row['dados']['convenios'],list) for row in writes[0]['rows'])
                assert page.evaluate('JSON.parse(localStorage.qa_outros_remote)[0].dados.convenios[1].observacoes')=='Rascunho não publicado'
                assert page.evaluate('JSON.parse(localStorage.qa_outros_remote)[0].dados.convenios[1].exigeDocumentos')
                assert page.evaluate('JSON.parse(localStorage.qa_outros_remote)[0].dados.convenios[1].documentosNecessarios')=='RG e último contracheque'
                assert page.evaluate('JSON.parse(localStorage.qa_outros_remote)[0].dados.convenios[1].margemMaximaConvenio')=='35,5%'
                assert page.evaluate('JSON.parse(localStorage.qa_outros_remote)[0].dados.convenios[1].margemUtilizadaBanco')=='30%'
                # Renaming keeps banco_id; blur must not discard the publish click.
                page.locator('[data-bank-field="0:nome"]').fill('Banco Alfa Renomeado')
                publish()
                expect(status).to_contain_text('envio confirmado')
                assert stored()[0]['banco_id']=='ban1'
                assert len(page.evaluate('JSON.parse(localStorage.qa_outros_remote)'))==2
                print(f'PASS {prefix or "/"}: leitura automática, topo nome/suspenso, cache limpo atualiza, rascunhos preservados, edição e renomeação enviadas com ID estável')

                # Every JSON is a complete replacement; omitted banks are deleted.
                with page.expect_download() as pending:
                    page.locator('#save').click()
                exported=json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))
                exported.extend([dict(nome='Banco Prime 1',convenios=[]),dict(nome='Banco Prime 2',convenios=[])])
                page.locator('#uploadBaseOutrosFile').set_input_files(dict(name='exportado.json',mimeType='application/json',buffer=json.dumps(exported).encode()))
                expect(status).to_contain_text('4 banco(s) com envio confirmado')
                rows=page.evaluate('JSON.parse(localStorage.qa_outros_remote)')
                assert len(rows)==4 and len({r['banco_id'] for r in rows})==4
                legacy={'Banco Legado':dict(status_suspenso=True,fazCartao=True,prazosCartao=[dict(idade='18-70',parcelas='84',obs='Legado')])}
                page.locator('#uploadBaseOutrosFile').set_input_files(dict(name='legado.json',mimeType='application/json',buffer=json.dumps(legacy).encode()))
                expect(status).to_contain_text('1 banco(s) com envio confirmado')
                assert len(page.evaluate('JSON.parse(localStorage.qa_outros_remote)'))==1
                assert len(stored())==1
                assert len(page.evaluate('window.__backups.at(-1)'))==4
                assert dialogs[-2].find('Bancos ausentes serão EXCLUÍDOS') >= 0
                assert stored()[-1]['suspenso'] and stored()[-1]['convenios'][0]['prazosCartao'][0]['obs']=='Legado'
                for bad in [{},[{'nome':''}], [{'nome':'Mesmo','convenios':[]},{'nome':'Mesmo','convenios':[]}],{'Banco':3}]:
                    before=len(page.evaluate('window.__writes'))
                    page.locator('#uploadBaseOutrosFile').set_input_files(dict(name='invalido.json',mimeType='application/json',buffer=json.dumps(bad).encode()))
                    expect(status).to_contain_text('Não foi possível confirmar')
                    assert len(page.evaluate('window.__writes'))==before
                # Restore all fixture banks for the remaining editing checks.
                page.locator('#uploadBaseOutrosFile').set_input_files(dict(name='completa.json',mimeType='application/json',buffer=json.dumps(exported).encode()))
                expect(status).to_contain_text('4 banco(s) com envio confirmado')
                # Local deletion must remain deleted after reload or refresh.
                page.locator('[data-remove-banco="1"]').click()
                assert len(stored())==3
                page.reload()
                expect(status).to_contain_text('Exclusões locais pendentes')
                assert len(stored())==3
                publish()
                expect(status).to_contain_text('1 banco(s) excluído(s)')
                assert len(page.evaluate('JSON.parse(localStorage.qa_outros_remote)'))==3
                assert len(page.evaluate('window.__backups.at(-1)'))==4
                page.locator('[data-toggle-banco="0"]').click()
                page.locator('[data-toggle-convenio="0:prefeitura"]').click()
                print('PASS: substituição completa por edição/JSON, exclusão local persiste ao reabrir, backup remoto inclui excluídos, JSON inválido bloqueado')

                # Error, missing confirmation, empty/malformed remote and pagination failures.
                before=stored()
                page.evaluate('window.__writeError=true')
                publish()
                expect(status).to_contain_text('não tem permissão')
                assert stored()==before
                page.evaluate('window.__writeError=false;window.__noAuth=true')
                count=len(page.evaluate('window.__writes'))
                publish()
                expect(status).to_contain_text('Entre novamente')
                assert len(page.evaluate('window.__writes'))==count
                page.evaluate('window.__noAuth=false;window.__missingRpc=true')
                publish()
                expect(status).to_contain_text('20261021_base_outros_substituicao.sql')
                assert len(page.evaluate('window.__writes'))==count
                assert stored()==before
                page.evaluate('window.__missingRpc=false;window.__concurrent=true')
                remote_before=page.evaluate('JSON.parse(localStorage.qa_outros_remote)')
                publish()
                expect(status).to_contain_text('base mudou durante')
                assert page.evaluate('JSON.parse(localStorage.qa_outros_remote)')==remote_before
                assert stored()==before
                page.evaluate('window.__concurrent=false')
                count=len(page.evaluate('window.__writes'))
                page.evaluate('window.__noAuth=false;window.__readError=true')
                publish()
                expect(status).to_contain_text('Offline')
                assert len(page.evaluate('window.__writes'))==count
                read()
                expect(status).to_contain_text('não foi possível'.capitalize())
                assert stored()==before
                page.evaluate('window.__readError=false;window.__noConfirm=true')
                publish()
                expect(status).to_contain_text('não confirmou todos')
                assert stored()==before
                page.evaluate('window.__noConfirm=false')
                remote([])
                read()
                expect(status).to_contain_text('não retornou bancos')
                assert stored()==[], 'Cache publicado limpo deve acompanhar a exclusão remota'
                # Unpublished drafts survive remote removal.
                remote(remote_before)
                read()
                page.locator('[data-toggle-banco="0"]').click()
                page.locator('[data-toggle-convenio="0:prefeitura"]').click()
                page.locator('[data-conv-field="0:prefeitura:observacoes"]').fill('Rascunho offline')
                before=stored()
                remote([dict(banco_id='bad',nome='Inválido',dados=[])])
                read()
                expect(status).to_contain_text('banco inválido')
                assert stored()==before
                many=[dict(banco_id=f'p{i:04}',nome=f'Paginação {i}',suspenso=False,dados=dict(convenios=[])) for i in range(501)]
                remote(many)
                page.evaluate('window.__secondPageError=true')
                read()
                expect(status).to_contain_text('Offline')
                assert stored()==before
                page.evaluate('window.__secondPageError=false')
                read()
                expect(status).to_contain_text('501 banco(s) lidos')
                assert len(stored())==502, 'Mantém só o banco com rascunho e os novos remotos'
                assert page.evaluate('window.__reads.some(r=>r.start===500)')
                print('PASS: erros de autenticação/RLS/rede, resposta sem confirmação, leitura vazia/inválida e falha na segunda página preservam cache; leitura paginada completa')

                # A slow read cannot overwrite a new edit.
                page.evaluate('window.__holdReads=true')
                page.locator('#reloadBaseOutrosBtn').click()
                expect(status).to_contain_text('Consultando')
                page.locator('[data-conv-field="0:prefeitura:observacoes"]').fill('Edição durante consulta')
                page.evaluate('window.__holdReads=false;window.__releaseRead()')
                expect(status).to_contain_text('edição iniciada durante a consulta foi preservada')
                assert stored()[0]['convenios'][1]['observacoes']=='Edição durante consulta'
                # Explicit empty array requires typed confirmation; Enter alone cancels.
                count=len(page.evaluate('window.__writes'))
                page.locator('#uploadBaseOutrosFile').set_input_files(dict(name='vazia.json',mimeType='application/json',buffer=b'[]'))
                expect(page.locator('#uploadBaseOutrosBtn')).to_be_enabled()
                assert len(page.evaluate('window.__writes'))==count
                page.remove_listener('dialog',dialog_handler)
                page.on('dialog',lambda d:d.accept('APAGAR TODOS') if d.type=='prompt' else d.accept())
                page.locator('#uploadBaseOutrosFile').set_input_files(dict(name='vazia.json',mimeType='application/json',buffer=b'[]'))
                expect(status).to_contain_text('0 banco(s) com envio confirmado')
                assert stored()==[] and page.evaluate('JSON.parse(localStorage.qa_outros_remote)')==[]
                assert len(page.evaluate('window.__backups.at(-1)'))==501
                page.reload()
                expect(status).to_contain_text('não retornou bancos')
                assert stored()==[]
                assert not errors, errors
                print('PASS: consulta lenta preserva edição; esvaziamento só com APAGAR TODOS; RPC ausente/concorrência bloqueiam sem mudança; sem DELETE direto ou chamada real')
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

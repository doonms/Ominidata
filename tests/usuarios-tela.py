"""Tela Master com Auth/RPC/Edge simulados. Não cadastra usuários reais."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA=runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
ACCOUNTS=[
    dict(id='id-master',email='master@example.test',perfil='master',criado_em='2026-10-21T12:00:00Z'),
    dict(id='id-admin',email='admin@example.test',perfil='admin'),
    dict(id='id-consulta',email='consulta@example.test',perfil='consulta'),
    dict(id='id-pendente',email='pendente@example.test',perfil=None),
    dict(id='id-html',email='<img src=x onerror=alert(1)>@example.test',perfil='consulta')
]
STUB="""
const read=()=>JSON.parse(localStorage.getItem('qa_accounts')||'[]');
const save=rows=>localStorage.setItem('qa_accounts',JSON.stringify(rows));
export const supabase={
  auth:{getUser:async()=>({data:{user:{id:'id-master',email:'master@example.test'}},error:null})},
  from(){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{perfil:window.__role||'master'},error:null})};return q;},
  async rpc(name,p){
    window.__rpcCalls ||= [];window.__rpcCalls.push({name,p});
    if(window.__missingSql)return {data:null,error:{code:'PGRST202'}};
    if(window.__role&&window.__role!=='master')return {data:null,error:{code:'42501'}};
    if(name==='listar_usuarios'){
      if(window.__listError)return {data:null,error:{message:'Offline'}};
      const rows=read().filter(a=>a.email.toLowerCase().includes(p.p_busca.toLowerCase()));
      const snapshot=rows.slice(p.p_offset,p.p_offset+p.p_limite).map(a=>({...a,total:rows.length}));
      if(window.__holdList){window.__holdList=false;await new Promise(r=>window.__releaseList=r);}
      return {data:snapshot,error:null};
    }
    const rows=read(),account=rows.find(a=>a.id===p.p_usuario_id);
    if(!account||account.perfil==='master'||!['admin','consulta'].includes(p.p_perfil))return {data:null,error:{code:'42501'}};
    if(window.__saveError)return {data:null,error:{code:'42501'}};
    account.perfil=p.p_perfil;save(rows);
    return {data:{id:account.id,perfil:account.perfil},error:null};
  },
  functions:{async invoke(name,{body}){
    window.__createCalls ||= [];window.__createCalls.push({name,body});
    if(window.__holdCreate)await new Promise(r=>window.__releaseCreate=r);
    if(window.__missingFunction)return {data:null,error:{message:'Failed to fetch'}};
    if(window.__createError)return {data:null,error:{context:{json:async()=>({message:'Cadastro recusado pelo servidor.'})}}};
    const rows=read();
    if(body.acao==='alterar_senha'){
      if(window.__passwordError)return {data:null,error:{context:{json:async()=>({message:'Troca recusada pelo servidor.'})}}};
      if(body.usuario_id==='id-master'&&body.senha_atual!=='senha atual de teste')return {data:null,error:{context:{json:async()=>({message:'A senha atual não foi confirmada.'})}}};
      return {data:{ok:true,senha_alterada:true,usuario_id:body.usuario_id},error:null};
    }
    const email=body.usuario?body.usuario+'@usuarios.ominidata.invalid':body.email;
    if(rows.some(a=>a.email.toLowerCase()===email.toLowerCase()))return {data:null,error:{context:{json:async()=>({code:'EMAIL_EXISTENTE',message:'Este usuário já tem uma conta. Procure na lista e ajuste o perfil.'})}}};
    const account={id:'criado-'+rows.length,email,perfil:window.__partial?null:body.perfil};
    save([account,...rows]);
    if(window.__partial)return {data:null,error:{context:{json:async()=>({code:'PERFIL_PENDENTE',message:'Conta criada, mas o perfil não foi confirmado. Use Liberar acesso nessa conta.'})}}};
    return {data:{ok:true,usuario:account},error:null};
  }}
};
"""


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QA['QuietHandler'],directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            for prefix in ['', '/Ominidata']:
                base=f'http://127.0.0.1:{server.server_port}{prefix}'
                ctx=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block')
                ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=STUB))
                ctx.route('https://**/*',lambda r:r.abort())
                ctx.add_init_script("if(!localStorage.getItem('qa_accounts'))localStorage.setItem('qa_accounts',"+json.dumps(json.dumps(ACCOUNTS))+");")
                page=ctx.new_page()
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('response',lambda r:errors.append(f'HTTP {r.status}: {r.url}') if r.status>=400 and any(s in r.url for s in ['.css','.js']) else None)
                page.on('dialog',lambda d:d.accept())
                page.goto(base+'/pages/usuarios.html')
                expect(page.locator('.usuario-card')).to_have_count(5)
                expect(page.locator('#usuario-criar')).to_be_enabled()
                expect(page.locator('#sidebar a[data-nav=usuarios]')).to_be_visible()
                master=page.locator('[data-usuario-id=id-master]')
                expect(master.locator('select')).to_have_count(0)
                expect(master).to_contain_text('perfil Master')
                assert page.locator('#usuarios-lista img').count()==0,'Email precisa ser texto, não HTML'
                pendente=page.locator('[data-usuario-id=id-pendente]')
                expect(pendente).to_contain_text('Sem perfil')
                pendente.get_by_role('button',name='Liberar acesso').click()
                expect(pendente.locator('.usuario-badge')).to_have_text('Consulta')
                consulta=page.locator('[data-usuario-id=id-consulta]')
                consulta.locator('select').select_option('admin')
                consulta.get_by_role('button',name='Salvar perfil').click()
                expect(consulta.locator('.usuario-badge')).to_have_text('Administrador')
                page.evaluate('window.__saveError=true')
                consulta.locator('select').select_option('consulta')
                consulta.get_by_role('button',name='Salvar perfil').click()
                expect(page.locator('#usuarios-list-status')).to_contain_text('Acesso negado')
                expect(consulta.locator('.usuario-badge')).to_have_text('Administrador')
                page.evaluate('window.__saveError=false')
                print(f'PASS: Master protegido, email escapado, perfis alteráveis, conta pendente recuperável e erro sem falso sucesso ({prefix or "/"})')

                senha_details=consulta.locator('.usuario-senha-details')
                senha_details.locator('summary').click()
                senha_form=senha_details.locator('form')
                expect(senha_form.get_by_label('Senha atual',exact=True)).to_have_count(0)
                nova=senha_form.get_by_label('Nova senha (mínimo 12 caracteres)',exact=True)
                confirmar=senha_form.get_by_label('Confirmar nova senha',exact=True)
                nova.fill('nova senha do cliente 123')
                confirmar.fill('outra senha do cliente 123')
                senha_form.get_by_role('button',name='Salvar nova senha').click()
                assert page.evaluate('window.__createCalls || []')==[], 'Divergência de senha não pode enviar'
                assert 'iguais' in confirmar.evaluate('el=>el.validationMessage')
                confirmar.fill('nova senha do cliente 123')
                senha_form.get_by_role('button',name='Salvar nova senha').click()
                expect(senha_form.get_by_role('status')).to_contain_text('Senha alterada')
                expect(nova).to_have_value('')
                expect(confirmar).to_have_value('')
                assert page.evaluate('window.__createCalls.at(-1).body.acao')=='alterar_senha'
                assert page.evaluate('window.__createCalls.at(-1).body.usuario_id')=='id-consulta'
                page.evaluate('window.__passwordError=true')
                nova.fill('nova senha do cliente 123')
                confirmar.fill('nova senha do cliente 123')
                senha_form.get_by_role('button',name='Salvar nova senha').click()
                expect(senha_form.get_by_role('status')).to_contain_text('Troca recusada')
                expect(nova).to_have_value('')
                page.evaluate('window.__passwordError=false')
                master.locator('.usuario-senha-details summary').click()
                own=master.locator('.usuario-senha-form')
                own.get_by_label('Senha atual',exact=True).fill('senha atual incorreta')
                own.get_by_label('Nova senha (mínimo 12 caracteres)',exact=True).fill('nova senha master 123')
                own.get_by_label('Confirmar nova senha',exact=True).fill('nova senha master 123')
                own.get_by_role('button',name='Salvar nova senha').click()
                expect(own.get_by_role('status')).to_contain_text('senha atual não foi confirmada')
                own.get_by_label('Senha atual',exact=True).fill('senha atual de teste')
                own.get_by_label('Nova senha (mínimo 12 caracteres)',exact=True).fill('nova senha master 123')
                own.get_by_label('Confirmar nova senha',exact=True).fill('nova senha master 123')
                own.get_by_role('button',name='Salvar nova senha').click()
                expect(own.get_by_role('status')).to_contain_text('Senha alterada')
                expect(own.get_by_label('Senha atual',exact=True)).to_have_value('')
                assert page.evaluate("Object.keys(localStorage).every(k=>!localStorage.getItem(k).includes('nova senha')&&!localStorage.getItem(k).includes('senha atual'))")
                page.evaluate('window.__createCalls=[]')
                print('PASS: troca de senha na própria tela, confirmação obrigatória, divergência bloqueada, senha atual do Master, falhas sem falso sucesso e campos limpos')

                def criar(usuario,perfil='consulta'):
                    page.locator('#usuario-login').fill(usuario)
                    page.locator('#usuario-senha').fill('senha inicial segura 123')
                    page.locator('#usuario-perfil').select_option(perfil)
                    page.locator('#usuario-criar').click()

                page.evaluate('window.__holdCreate=true')
                criar('nova.conta','admin')
                expect(page.locator('#usuario-criar')).to_be_disabled()
                expect(page.locator('#usuario-login')).to_be_disabled()
                page.evaluate('window.__holdCreate=false;window.__releaseCreate()')
                expect(page.locator('#usuarios-form-status')).to_contain_text('criada como Administrador')
                expect(page.locator('.usuario-card')).to_have_count(6)
                expect(page.locator('#usuario-senha')).to_have_value('')
                assert len(page.evaluate('window.__createCalls'))==1
                assert page.evaluate('window.__createCalls[0].name')=='criar-usuario'
                assert page.evaluate("localStorage.getItem('ominidata_role')")=='master'
                assert page.evaluate("Object.keys(localStorage).every(k=>!localStorage.getItem(k).includes('senha inicial segura 123'))")
                criar('nova.conta')
                expect(page.locator('#usuarios-form-status')).to_contain_text('já tem uma conta')
                expect(page.locator('.usuario-card')).to_have_count(6)
                page.evaluate('window.__partial=true')
                criar('parcial.conta')
                expect(page.locator('#usuarios-form-status')).to_contain_text('perfil não foi confirmado')
                partial_card=page.locator('.usuario-card').filter(has=page.get_by_role('heading',name='parcial.conta',exact=True))
                expect(partial_card).to_contain_text('Sem perfil')
                partial_card.get_by_role('button',name='Liberar acesso').click()
                expect(partial_card.locator('.usuario-badge')).to_have_text('Consulta')
                page.evaluate('window.__partial=false;window.__missingFunction=true')
                criar('offline.conta')
                expect(page.locator('#usuarios-form-status')).to_contain_text('Edge Function criar-usuario')
                expect(page.locator('#usuario-senha')).to_have_value('')
                page.evaluate('window.__missingFunction=false')
                print('PASS: cadastro sem trocar sessão Master, envio único, senha não persistida/limpa, duplicado, falha parcial e função ausente')

                page.locator('#usuarios-busca').fill('NOVA.')
                page.get_by_role('button',name='Atualizar lista').click()
                expect(page.locator('.usuario-card')).to_have_count(1)
                expect(page.locator('.usuario-card')).to_contain_text('nova.conta')
                # Uma resposta lenta antiga não pode sobrescrever a busca nova.
                page.evaluate('window.__holdList=true')
                page.locator('#usuarios-busca').fill('consulta@')
                page.get_by_role('button',name='Atualizar lista').click()
                page.wait_for_function('typeof window.__releaseList === "function"')
                page.locator('#usuarios-busca').fill('nova.')
                page.get_by_role('button',name='Atualizar lista').click()
                expect(page.locator('.usuario-card')).to_contain_text('nova.conta')
                page.evaluate('window.__releaseList()')
                expect(page.locator('.usuario-card')).to_contain_text('nova.conta')
                page.evaluate('window.__missingSql=true')
                page.get_by_role('button',name='Atualizar lista').click()
                expect(page.locator('#usuarios-list-status')).to_contain_text('20261021_usuarios_master.sql')
                expect(page.locator('#usuario-criar')).to_be_disabled()
                page.evaluate('window.__missingSql=false')
                page.locator('#usuarios-busca').fill('')
                page.get_by_role('button',name='Atualizar lista').click()
                expect(page.locator('#usuario-criar')).to_be_enabled()

                extra=[dict(id=f'pag-{i}',email=f'pag-{i}@example.test',perfil='consulta') for i in range(60)]
                page.evaluate('(rows)=>localStorage.setItem("qa_accounts",JSON.stringify(rows))',extra)
                page.get_by_role('button',name='Atualizar lista').click()
                expect(page.locator('.usuario-card')).to_have_count(50)
                page.locator('#usuarios-proxima').click()
                expect(page.locator('.usuario-card')).to_have_count(10)
                expect(page.locator('#usuarios-pagina')).to_have_text('51–60 de 60')
                page.locator('#usuarios-anterior').click()
                expect(page.locator('.usuario-card')).to_have_count(50)
                print('PASS: busca/paginação, resposta atrasada descartada, SQL ausente bloqueia cadastro e recuperação funciona')

                # Navegação SPA usa o mesmo layout e inicialização da entrada direta.
                page.goto(base+'/index.html')
                page.locator('#menuBtn').click()
                page.locator('#sidebar a[data-nav=usuarios]').click()
                expect(page).to_have_url(base+'/pages/usuarios.html')
                expect(page.locator('body')).to_have_class('od-page usuarios-page')
                expect(page.locator('.usuario-card')).to_have_count(50)
                assert page.locator('.usuarios-grid').evaluate('el=>getComputedStyle(el).gridTemplateColumns.split(" ").length')==2
                page.screenshot(path=str(Path(gettempdir())/'ominidata-usuarios-desktop.png'),full_page=False)
                page.set_viewport_size({'width':390,'height':844})
                page.screenshot(path=str(Path(gettempdir())/'ominidata-usuarios-mobile.png'),full_page=False)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Overflow mobile'
                page.locator('#menuBtn').click()
                page.locator('#sidebar a[data-nav=simulador]').click()
                expect(page.locator('#inpFatorManual')).to_be_visible()
                assert not page.locator('body').evaluate('el=>el.classList.contains("usuarios-page")')
                assert not errors,errors
                print('PASS: entrada por SPA, layout desktop/mobile sem overflow, saída sem contaminar o simulador')
                ctx.close()

                for role in ['admin','consulta']:
                    denied=browser.new_context(service_workers='block')
                    denied.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=STUB))
                    denied.route('https://**/*',lambda r:r.abort())
                    denied.add_init_script(f'window.__role={json.dumps(role)};')
                    page=denied.new_page()
                    page.goto(base+'/pages/usuarios.html')
                    expect(page).to_have_url(base+'/pages/pesquisa.html')
                    expect(page.locator('#sidebar a[data-nav=usuarios]')).to_have_count(0)
                    assert page.evaluate('window.__rpcCalls || []')==[]
                    denied.close()
                print('PASS: Admin e Consulta não abrem Usuários por link direto e não solicitam a lista')
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

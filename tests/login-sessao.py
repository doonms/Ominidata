"""Regressão login -> início -> login com sessão ainda válida.

Simula a confirmação SIGNED_IN emitida durante a recuperação de sessão do
SDK, além de foco, refresh, troca de conta e logout. Não usa credenciais reais.
OMINIDATA_LOGIN_URL permite testar o HTML/JS servido pelo Live Server.
"""
import json
import os
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA=runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
STUB="""
let listener, initialized=false;
const key='qa_session_user';
const user=id=>id?{id,email:id+'@example.test',user_metadata:{perfil:'master'}}:null;
window.__emitAuth=(event,id)=>{
  if(event==='SIGNED_OUT')sessionStorage.removeItem(key);
  else if(id)sessionStorage.setItem(key,id);
  listener?.(event,{user:user(id)});
};
export const supabase={
  auth:{
    onAuthStateChange(fn){listener=fn;},
    async signInWithPassword(credentials){
      initialized=true;
      sessionStorage.setItem('qa_login_email',credentials.email);
      window.__emitAuth('SIGNED_IN','account-a');
      return {data:{user:user('account-a')},error:null};
    },
    async getUser(){
      const id=sessionStorage.getItem(key);
      if(id&&!initialized){
        initialized=true;
        await new Promise(r=>setTimeout(r,20));
        listener?.(window.__initialEvent||'SIGNED_IN',{user:user(id)});
      }
      return {data:{user:user(id)},error:null};
    }
  },
  from(table){
    const q={select(){return q;},eq(){return q;},order(){return q;},range(){return q;},
      async maybeSingle(){
        window.__profileReads=(window.__profileReads||0)+1;
        const perfil=window.__role||'master';
        if(window.__holdProfile){window.__holdProfile=false;await new Promise(r=>window.__releaseProfile=r);}
        return {data:{perfil},error:null};
      },
      then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}
    };return q;
  }
};
"""


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QA['QuietHandler'],directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            targets=[f'http://127.0.0.1:{server.server_port}{prefix}/pages/login.html' for prefix in ['', '/Ominidata']]
            if os.environ.get('OMINIDATA_LOGIN_URL'):
                targets.append(os.environ['OMINIDATA_LOGIN_URL'])
            for login_url in targets:
                base=login_url.rsplit('/pages/',1)[0]

                def fresh(role='master',initial_event='SIGNED_IN'):
                    ctx=browser.new_context(service_workers='block')
                    ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=STUB))
                    ctx.route('https://**/*',lambda r:r.abort())
                    ctx.add_init_script('window.__role='+json.dumps(role)+';window.__initialEvent='+json.dumps(initial_event)+';')
                    page=ctx.new_page()
                    errors=[]
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    return ctx,page,errors

                for role in ['master','admin','consulta']:
                    ctx,page,errors=fresh(role)
                    page.goto(login_url)
                    page.locator('#email').fill('qa@example.test')
                    page.locator('#senha').fill('senha ficticia de teste')
                    page.locator('#loginBtn').click()
                    expect(page.locator('.home-header')).to_be_visible()
                    page.wait_for_function("document.querySelector('.wrap')?.inert===false")
                    # Não basta observar index.html transitoriamente antes do redirecionamento.
                    page.wait_for_timeout(250)
                    expect(page).to_have_url(base+'/index.html')
                    assert page.evaluate("sessionStorage.getItem('ominidata_role')")==role
                    if role=='consulta':
                        expect(page.locator('#sidebar .admin-only')).to_have_count(0)
                    else:
                        expect(page.locator('#sidebar a[data-nav=base_inss]')).to_be_visible()
                    page.reload()
                    page.wait_for_function("document.querySelector('.wrap')?.inert===false")
                    expect(page).to_have_url(base+'/index.html')
                    page.locator('#menuBtn').click()
                    page.locator('#sidebar a[data-nav=pesquisa]').click()
                    expect(page.locator('#btn-search')).to_be_visible()
                    page.evaluate("window.__emitAuth('SIGNED_IN','account-a')")
                    expect(page).to_have_url(base+'/pages/pesquisa.html')
                    assert not errors,errors
                    ctx.close()
                print(f'PASS: login + recuperação SIGNED_IN + permanência no início + reload + SPA/foco nos três perfis ({login_url})')

                ctx,page,errors=fresh()
                page.goto(login_url)
                page.locator('#email').fill(' Maria.Silva ')
                page.locator('#senha').fill('senha ficticia de teste')
                page.locator('#loginBtn').click()
                expect(page.locator('.home-header')).to_be_visible()
                page.wait_for_function("document.querySelector('.wrap')?.inert===false")
                expect(page).to_have_url(base+'/index.html')
                assert page.evaluate("sessionStorage.getItem('qa_login_email')")=='maria.silva@usuarios.ominidata.invalid'
                assert not errors,errors
                ctx.close()
                print('PASS: nome de usuário é normalizado e autenticado pelo mesmo fluxo de sessão, sem substituir o login legado por e-mail')

                ctx,page,errors=fresh(initial_event='INITIAL_SESSION')
                page.goto(login_url)
                page.evaluate("sessionStorage.setItem('qa_session_user','account-a')")
                page.goto(base+'/index.html')
                page.wait_for_function("document.querySelector('.wrap')?.inert===false")
                expect(page).to_have_url(base+'/index.html')
                # Logout verdadeiro continua retirando acesso e não apaga rascunhos.
                page.evaluate("localStorage.setItem('rascunho-preservar','dados locais');window.__emitAuth('SIGNED_OUT')")
                expect(page).to_have_url(login_url)
                assert page.evaluate("localStorage.getItem('ominidata_user')") is None
                assert page.evaluate("localStorage.getItem('rascunho-preservar')")=='dados locais'
                assert not errors,errors
                ctx.close()
                print('PASS: INITIAL_SESSION válido não expulsa; logout verdadeiro redireciona e preserva dados de edição')

                # Testes de concorrência permanecem na tela de login para observar
                # as Promises antigas sem descartar o documento no logout.
                ctx,page,errors=fresh()
                page.goto(login_url)
                page.evaluate("""async()=>{
                  window.__access=await import('../js/auth/accessControl.js');
                  window.__emitAuth('SIGNED_IN','account-a');
                }""")
                for event in ['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED']:
                    page.evaluate("""()=>{
                      window.__holdProfile=true;
                      window.__pending=window.__access.getCurrentUser();
                    }""")
                    page.wait_for_function('typeof window.__releaseProfile === "function"')
                    result=page.evaluate("""async event=>{
                      window.__emitAuth(event,'account-a');
                      const release=window.__releaseProfile;delete window.__releaseProfile;release();
                      return await window.__pending;
                    }""",event)
                    assert result['id']=='account-a' and result['perfil']=='master',result
                # Troca real de usuário invalida a consulta antiga, não libera
                # permissões de A para B. A próxima consulta lê o perfil de B.
                page.evaluate("()=>{window.__holdProfile=true;window.__pending=window.__access.getCurrentUser();}")
                page.wait_for_function('typeof window.__releaseProfile === "function"')
                result=page.evaluate("""async()=>{
                  window.__role='consulta';window.__emitAuth('SIGNED_IN','account-b');
                  const release=window.__releaseProfile;delete window.__releaseProfile;release();
                  return await window.__pending;
                }""")
                assert result is None,'Consulta obsoleta não pode autorizar a conta anterior'
                result=page.evaluate('async()=>await window.__access.getCurrentUser()')
                assert result['id']=='account-b' and result['perfil']=='consulta',result
                # Logout durante uma leitura impede repopular o cache com o
                # usuário anterior quando a resposta da rede chega atrasada.
                page.evaluate("()=>{window.__holdProfile=true;window.__pending=window.__access.getCurrentUser();}")
                page.wait_for_function('typeof window.__releaseProfile === "function"')
                result=page.evaluate("""async()=>{
                  window.__emitAuth('SIGNED_OUT');window.__releaseProfile();
                  return await window.__pending;
                }""")
                assert result is None
                assert page.evaluate("localStorage.getItem('ominidata_user')") is None
                assert page.evaluate('async()=>await window.__access.getCurrentUser()') is None
                assert not errors,errors
                ctx.close()
                print('PASS: reconfirmação/refresh não cancelam leitura válida; troca de conta e logout descartam respostas obsoletas')
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

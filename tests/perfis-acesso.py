"""Perfis com Supabase simulado. Nenhuma chamada ou escrita remota real."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
STUB = """
let listener;
export const supabase = {
  auth: {
    onAuthStateChange(fn) {listener=fn;},
    async getUser() {
      if(window.__authError) return {data:{user:null},error:{message:'Offline'}};
      return {data:{user:window.__noSession ? null : {
        id:'00000000-0000-0000-0000-000000000001',
        email:window.__email || 'dominicplf@gmail.com',
        user_metadata:{perfil:'master'}
      }},error:null};
    },
    async signInWithPassword(credentials) {
      window.__credentials=credentials;
      if(window.__badLogin) return {data:null,error:{message:'Credenciais inválidas'}};
      window.__noSession=false;
      listener?.('SIGNED_IN');
      return this.getUser();
    }
  },
  from(table) {
    const q={
      select(){return q;},eq(){return q;},order(){return q;},range(){return q;},
      async maybeSingle(){
        window.__profileReads=(window.__profileReads||0)+1;
        if(window.__profileError) return {data:null,error:{message:'Perfil offline'}};
        return {data:window.__perfil===null ? null : {perfil:window.__perfil || 'master'},error:null};
      },
      then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}
    };return q;
  }
};
"""


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                base = f'http://127.0.0.1:{server.server_port}{prefix}'

                def fresh(**flags):
                    ctx = browser.new_context(service_workers='block')
                    ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript',body=STUB))
                    ctx.route('https://**/*', lambda r:r.abort())
                    ctx.add_init_script('window.__qaRegras=[];' + ''.join(
                        f'window.{key}={json.dumps(value)};' for key,value in flags.items()) +
                        "localStorage.setItem('ominidata_role','master');"
                        "sessionStorage.setItem('ominidata_user',JSON.stringify({email:'dominicplf@gmail.com',perfil:'master'}));"
                        "localStorage.setItem('rascunho-preservar','não apagar');")
                    page=ctx.new_page()
                    errors=[]
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    return ctx,page,errors

                for role in ['master', 'admin', 'consulta']:
                    ctx,page,errors=fresh(__perfil=role,__email='outro@example.test' if role=='admin' else 'dominicplf@gmail.com')
                    page.goto(base+'/pages/login.html')
                    page.locator('#email').fill('conta@example.test')
                    page.locator('#senha').fill(' senha com espaços ')
                    page.locator('#senha').press('Enter')
                    expect(page).to_have_url(base+'/index.html')
                    assert page.evaluate('window.__credentials') is None  # documento novo
                    page.wait_for_function("document.querySelector('#sidebar a[data-nav=pesquisa]')")
                    if role=='consulta':
                        expect(page.locator('#sidebar .admin-only')).to_have_count(0)
                    else:
                        expect(page.locator('#sidebar a[data-nav=base_inss]')).to_be_visible()
                        expect(page.locator('#sidebar .admin-only')).to_have_count(5)
                    assert page.evaluate("localStorage.getItem('ominidata_role')")==role
                    mod=page.evaluate("""async()=>{
                      const m=await import(new URL('../js/auth/accessControl.js',location.href.replace('index.html','pages/login.html')));
                      const user=await m.getCurrentUser();
                      return {master:m.isMaster(user),admin:m.isAdmin(user),users:m.canAccessRoute(user,'pages/usuarios.html')};
                    }""")
                    assert mod==dict(master=role=='master',admin=role in ['master','admin'],users=role=='master'),mod
                    page.goto(base+'/pages/base-inss.html')
                    if role=='consulta':
                        expect(page).to_have_url(base+'/pages/pesquisa.html')
                    else:
                        expect(page.locator('#add')).to_be_visible()
                        page.wait_for_function("typeof document.querySelector('#add')?.onclick === 'function'")
                        page.locator('#add').click()
                        expect(page.locator('#list .card')).to_have_count(1)
                    assert not errors,errors
                    ctx.close()
                print(f'PASS: login e menus de Master/Admin/Consulta, sem autorização por email/metadata ({prefix or "/"})')

                ctx,page,errors=fresh(__perfil='consulta')
                for path in ['base-fatores','fatores-do-dia','base-inss','base-outros-convenios','base-credito-pessoal','importar-inss','%62ase-inss']:
                    page.goto(base+f'/pages/{path}.html')
                    expect(page).to_have_url(base+'/pages/pesquisa.html')
                    expect(page.locator('#btn-search')).to_be_visible()
                for path,selector in [('simulador','#inpFatorManual'),('bancos','#showAllBtn'),('contatos','#showAllBtn')]:
                    page.goto(base+f'/pages/{path}.html')
                    expect(page.locator(selector)).to_be_visible()
                assert page.evaluate("localStorage.getItem('rascunho-preservar')")=='não apagar'
                assert not errors,errors
                ctx.close()
                print('PASS: endereços diretos protegidos; todas as ferramentas de Consulta acessíveis; rascunhos preservados')

                ctx,page,errors=fresh(__perfil='master')
                page.goto(base+'/index.html')
                expect(page.locator('#sidebar a[data-nav=base_inss]')).to_be_visible()
                # Rebaixamento no servidor durante a sessão deve valer na próxima navegação.
                page.evaluate("window.__perfil='consulta'")
                page.locator('#menuBtn').click()
                page.locator('#sidebar a[data-nav=base_inss]').click()
                expect(page).to_have_url(base+'/pages/pesquisa.html')
                expect(page.locator('#btn-search')).to_be_visible()
                expect(page.locator('#sidebar .admin-only')).to_have_count(0)
                assert not errors,errors
                ctx.close()
                print('PASS: SPA revalida o perfil; rebaixamento não conserva acesso antigo')

                ctx,page,errors=fresh(__noSession=True)
                page.goto(base+'/pages/base-inss.html')
                expect(page).to_have_url(base+'/pages/login.html')
                assert not errors,errors
                ctx.close()

                for flags in [dict(__profileError=True),dict(__perfil=None),dict(__authError=True)]:
                    ctx,page,errors=fresh(**flags)
                    page.goto(base+'/pages/base-inss.html')
                    expect(page.get_by_role('heading',name='Acesso não confirmado')).to_be_visible()
                    expect(page.locator('#add')).to_have_count(0)
                    expect(page.get_by_role('button',name='Tentar novamente')).to_be_visible()
                    # Recuperação da requisição após falha, sem Promise rejeitada presa.
                    recovered=page.evaluate("""async()=>{
                      window.__profileError=false;window.__authError=false;window.__perfil='consulta';
                      return (await (await import('../js/auth/accessControl.js')).getCurrentUser()).perfil;
                    }""")
                    assert recovered=='consulta'
                    assert not errors,errors
                    ctx.close()
                print('PASS: armazenamento forjado não autentica; perfil ausente/rede falhando bloqueiam com recuperação')

                ctx,page,errors=fresh(__profileError=True)
                page.goto(base+'/pages/login.html')
                page.locator('#email').fill('conta@example.test')
                page.locator('#senha').fill(' senha com espaços ')
                page.locator('#loginBtn').click()
                expect(page.locator('#msg')).to_contain_text('perfil de acesso')
                expect(page.locator('#loginBtn')).to_be_enabled()
                assert page.evaluate('window.__credentials.password')==' senha com espaços '
                assert page.url.endswith('/pages/login.html')
                assert page.evaluate("localStorage.getItem('ominidata_role')") is None
                assert not errors,errors
                ctx.close()
                print('PASS: login não entra com perfil indisponível nem remove espaços da senha')
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

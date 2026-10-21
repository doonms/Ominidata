"""Troca de consulta antes do JS carregar, mouse/teclado e entrada pelo menu.

Pode testar o Live Server com OMINIDATA_SIM_URL apontando para simulador.html.
Usa autenticação/dados simulados; não acessa o Supabase real.
"""
import os
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
from pathlib import Path

QA=runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))


def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(QA['QuietHandler'],directory=str(QA['ROOT'])))
 Thread(target=server.serve_forever,daemon=True).start()
 urls=[os.environ['OMINIDATA_SIM_URL']] if os.environ.get('OMINIDATA_SIM_URL') else [
   f'http://127.0.0.1:{server.server_port}{prefix}/pages/simulador.html' for prefix in ['', '/Ominidata']]
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(channel='chrome',headless=True)
   for url in urls:
    ctx=browser.new_context(service_workers='block')
    ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=QA['STUB']))
    ctx.route('https://**/*',lambda r:r.abort())
    ctx.add_init_script('window.__qaRegras=[];sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));')
    page=ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url)
    page.locator('[name=simBaseConsulta][value=outros]').check()
    expect(page.locator('#sim-pesquisa-outros')).to_be_visible()
    expect(page.locator('#sim-pesquisa-bancos')).to_be_hidden()
    print('PASS: clique normal no seletor em '+url)
    # O acesso direto a simulador.html não inicia o roteador (quem inicia é a home).
    # Liga o roteador explicitamente neste contexto isolado para testar a entrada SPA.
    page.evaluate("""async () => {
      const {iniciarSPA}=await import('../js/spaRouter.js');
      iniciarSPA();
    }""")
    page.evaluate("""() => {
      window.__qaConsultaNavegou=false;
      document.addEventListener('spa:page-loaded',()=>window.__qaConsultaNavegou=true,{once:true});
    }""")
    page.locator('#menuBtn').click()
    page.locator('#sidebar a[data-nav=pesquisa]').click()
    expect(page.locator('#btn-search')).to_be_visible()
    page.wait_for_function('window.__qaConsultaNavegou === true')
    page.locator('#menuBtn').click()
    page.locator('#sidebar a[data-nav=simulador]').click()
    expect(page.locator('[name=simBaseConsulta][value=inss]')).to_be_checked()
    page.locator('[name=simBaseConsulta][value=outros]').check()
    expect(page.locator('#sim-pesquisa-outros')).to_be_visible()
    expect(page.locator('#sim-pesquisa-bancos')).to_be_hidden()
    print('PASS: retornar pelo menu inicializa o seletor na nova página')
    ctx.close()
    # Interrompe somente a entrega do JS, reproduzindo carregamento lento/cache.
    ctx=browser.new_context(service_workers='block')
    ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=QA['STUB']))
    ctx.route('https://**/*',lambda r:r.abort())
    ctx.add_init_script('window.__qaRegras=[];sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));')
    pending=[]
    ctx.route('**/js/simulador/index.js*',lambda r:pending.append(r))
    page=ctx.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url,wait_until='commit')
    option=page.locator('[name=simBaseConsulta][value=outros]')
    option.check()
    expect(option).to_be_checked()
    assert pending, 'O JS deve permanecer pendente para testar o clique antecipado'
    for route in pending:route.continue_()
    expect(page.locator('.sim-page')).to_have_attribute('data-sim-inicializado','true')
    expect(page.locator('#sim-pesquisa-outros')).to_be_visible()
    expect(page.locator('#sim-pesquisa-bancos')).to_be_hidden()
    # Alternar abre o painel, mesmo que tenha sido recolhido na visita anterior.
    page.locator('#sim-pesquisa-outros').evaluate('(node)=>node.open=false')
    option.click()
    expect(page.locator('#sim-pesquisa-outros')).to_have_attribute('open','')
    page.locator('#sim-pesquisa-outros').evaluate('(node)=>node.open=false')
    inss=page.locator('[name=simBaseConsulta][value=inss]')
    inss.check()
    expect(page.locator('#sim-pesquisa-bancos')).to_be_visible()
    option.focus()
    option.press('Space')
    expect(page.locator('#sim-pesquisa-outros')).to_be_visible()
    expect(page.locator('#sim-pesquisa-outros')).to_have_attribute('open','')
    assert not errors,errors
    print('PASS: escolha antes do JS carregar é aplicada ao inicializar; mouse/teclado e painel recolhido restaurados')
    ctx.close()
   browser.close()
 finally:server.shutdown()


if __name__=='__main__':main()

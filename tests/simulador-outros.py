"""Consulta Outros Convênios separada do INSS; Supabase simulado."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA=runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
BASE=[
 dict(nome='Banco do Brasil',banco_id='bb',convenios=[
  dict(id='padrao',tipo='padrao_banco',nome='Padrão banco',fazMargem=True),
  dict(id='pref',tipo='prefeitura',nome='Prefeitura Alfa',fazMargem=True,fazCartao=True,
   aceitaCeletista=True,aceitaTemporario=True,
   prazos=[dict(idade='18-60',parcelas='72',obs='Margem até 60'),dict(idade='61-80',parcelas='60',obs='Margem após 60')],
   prazosCartao=[dict(idade='18-80',parcelas='72',obs='Cartão Alfa')],
   prazosCeletista=[dict(idade='18-50',parcelas='72',obs='Celetista Alfa')],
   prazosTemporario=[dict(idade='25-45',parcelas='60',obs='Temporário Alfa')],
   exigeDocumentos=True,documentosNecessarios='RG e contracheque',margemMaximaConvenio='35%',margemUtilizadaBanco='30%'),
  dict(id='gov',tipo='governo',nome='Governo Alfa',fazMargem=True,
   prazos=[dict(idade='18-80',parcelas='96',obs='Governo 96')]),
  dict(id='siape',tipo='siape',nome='SIAPE Alfa',fazCartao=True,aceitaTemporario=True,
   prazosCartao=[dict(idade='18-80',parcelas='96',obs='SIAPE 96')]),
  dict(id='susp',tipo='prefeitura',nome='Prefeitura suspensa',statusSuspenso=True,fazMargem=True)]),
 dict(nome='Outro Banco',banco_id='outro',convenios=[
  dict(id='outro-pref',tipo='prefeitura',nome='Prefeitura Beta',fazMargem=True,
   prazos=[dict(idade='18-80',parcelas='84',obs='Beta 84')])]),
 dict(nome='Banco Suspenso',banco_id='suspenso',suspenso=True,convenios=[
  dict(id='pref-susp',tipo='prefeitura',nome='Suspenso',fazMargem=True)])
]
STUB=QA['STUB'].replace("const rows = table === 'base_inss'", """
        if(table === 'base_outros_convenios')
          return Promise.resolve({data:window.__qaOutros,error:null}).then(resolve,reject);
        const rows = table === 'base_inss'""")


def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(QA['QuietHandler'],directory=str(QA['ROOT'])))
 Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(channel='chrome',headless=True)
   for prefix in ['', '/Ominidata']:
    ctx=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block')
    ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=STUB))
    ctx.route('https://**/*',lambda r:r.abort())
    rows=[dict(banco_id=b['banco_id'],nome=b['nome'],suspenso=b.get('suspenso',False),dados=b) for b in BASE]
    ctx.add_init_script('window.__qaRegras='+json.dumps(QA['REGRAS'])+';window.__qaOutros='+json.dumps(rows)+';'
      'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
      'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));'
      'localStorage.setItem("ominidata_base_fatores_v1",'+json.dumps(json.dumps(QA['FATORES']))+');')
    page=ctx.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/simulador.html')
    original=page.locator('#sim-pesquisa-bancos')
    outros=page.locator('#sim-pesquisa-outros')
    expect(original).to_be_visible();expect(outros).to_be_hidden()
    expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
    page.locator('#sim-idade').fill('65')
    page.locator('#sim-p-margem').check()
    original.get_by_role('button',name='Simular com Banco do Brasil',exact=True).click()
    page.locator('#inpValorMargem').fill('200')
    page.locator('#btnSimular').click()
    expect(page.locator('#sim-result')).to_be_visible()
    saved=page.evaluate('Object.fromEntries(["slBanco","slPrazo","slTabela","slOrigemFator","inpFatorManual","inpValorMargem"].map(id=>[id,document.getElementById(id).value]))')
    page.locator('[name=simBaseConsulta][value=outros]').check()
    expect(original).to_be_hidden();expect(outros).to_be_visible()
    expect(outros.locator('#sim-outros-status')).to_contain_text('consultada no Supabase')
    assert outros.get_by_label('Espécie').count()==0
    assert outros.get_by_label('Cliente assina?').count()==0
    page.locator('#sim-outros-idade').fill('35')
    outros.locator('[name=outrosProduto][value=margem]').check()
    page.locator('#sim-outros-contrato').select_option('celetista')
    cards=outros.locator('.sim-bank-card')
    expect(cards).to_have_count(1)
    expect(cards.first).to_contain_text('Prefeitura Alfa')
    expect(cards.first).to_contain_text('35 anos')
    expect(cards.first).to_contain_text('72x')
    cards.first.locator('summary').click()
    expect(cards.first).to_contain_text('Celetista Alfa')
    expect(cards.first).to_contain_text('RG e contracheque')
    expect(cards.first).to_contain_text('35%')
    assert 'Margem após 60' not in cards.first.inner_text()
    cards.first.locator('.sim-bank-option').click()
    expect(page.locator('#slOrigemFator')).to_have_value('manual')
    expect(page.locator('#inpFatorManual')).to_have_value('')
    expect(page.locator('#inpPrazoManual')).to_have_value('72')
    assert page.locator('#slOrigemFator option[value=tabela]').is_disabled()
    assert page.locator('#slSeguro option').count()==1
    page.locator('#inpValorMargem').fill('200')
    page.locator('#inpFatorManual').fill('0,02')
    page.locator('#btnSimular').click()
    expect(page.locator('#resBancoNome')).to_have_text('Banco do Brasil · Prefeitura Alfa')
    expect(page.locator('#resValor')).to_contain_text('10.000,00')
    expect(page.locator('#resPrazo')).to_have_text('72x')
    expect(page.locator('#resSeguroItem')).to_be_hidden()
    page.locator('[name=simBaseConsulta][value=inss]').check()
    expect(original).to_be_visible()
    expect(page.locator('#sim-idade')).to_have_value('65')
    expect(page.locator('#sim-p-margem')).to_be_checked()
    assert page.evaluate('Object.fromEntries(["slBanco","slPrazo","slTabela","slOrigemFator","inpFatorManual","inpValorMargem"].map(id=>[id,document.getElementById(id).value]))')==saved
    expect(page.locator('#slOrigemFator option[value=tabela]')).to_be_enabled()
    print(f'PASS {prefix or "/"}: pesquisa INSS preservada, outra consulta sem espécie/assinatura, regras e observações do prazo, fator manual sem tabelas/seguros INSS e restauração da seleção INSS')
    page.locator('[name=simBaseConsulta][value=outros]').check()
    page.locator('#sim-outros-contrato').select_option('temporario')
    expect(cards).to_have_count(0) # Prazo do perfil (60) não combina com a operação (72).
    expect(page.locator('#sim-result')).to_be_hidden()
    expect(page.locator('#inpFatorManual')).to_have_value('')
    page.locator('#sim-outros-tipo').select_option('siape')
    outros.locator('[name=outrosProduto][value=margem]').uncheck()
    outros.locator('[name=outrosProduto][value=cartao]').check()
    expect(cards).to_have_count(1)
    expect(cards.first).to_contain_text('SIAPE Alfa')
    expect(cards.first).to_contain_text('96x')
    page.locator('#sim-outros-tipo').select_option('governo')
    page.locator('#sim-outros-contrato').select_option('normal')
    outros.locator('[name=outrosProduto][value=cartao]').uncheck()
    outros.locator('[name=outrosProduto][value=margem]').check()
    expect(cards).to_have_count(1)
    expect(cards.first).to_contain_text('Governo Alfa')
    # Unit checks: same convenio must satisfy every product/profile/age.
    checks=page.evaluate("""async base=>{
      const {pesquisarOutrosConvenios:p}=await import('../js/simulador/pesquisa-outros-convenios.js');
      const f={tipo:'prefeitura',idade:35,contrato:'normal',produtos:['margem','cartao']};
      const both=p(base,f);
      return {both:both.map(x=>x.convenio.id),
        age:p(base,{...f,idade:90}).length,
        celetista:p(base,{...f,contrato:'celetista'}).map(x=>x.prazo),
        older:p(base,{...f,contrato:'celetista',idade:55}).length,
        temporario:p(base,{...f,contrato:'temporario'}).length,
        model:p(base,{...f,tipo:'padrao_banco'}).length};
    }""",BASE)
    assert checks==dict(both=['pref','pref'],age=0,celetista=['72','72'],older=0,temporario=0,model=0), checks
    # Models are not a user-selectable convenio type.
    assert page.locator('#sim-outros-tipo option[value=padrao_banco]').count()==0
    for width in [320,390,768,1440]:
     page.set_viewport_size({'width':width,'height':1000})
     assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
     if width in [390,1440]:
      outros.locator('form').screenshot(path=str(Path(gettempdir()) / f'ominidata-simulador-outros-form-{width}.png'))
      cards.first.screenshot(path=str(Path(gettempdir()) / f'ominidata-simulador-outros-card-{width}.png'))
    assert not errors,errors
    print('PASS: Prefeitura/Governo/SIAPE, Normal/Celetista/Temporário, idade/produtos/prazos no mesmo convênio, suspensão, invalidar seleção e layout 320–1440px')
    ctx.add_init_script('window.__qaFalhar=true;')
    page.reload()
    page.locator('[name=simBaseConsulta][value=outros]').check()
    expect(page.locator('#sim-outros-status')).to_contain_text('última versão publicada')
    assert page.locator('#sim-outros-results .sim-bank-card').count()>0
    ctx.add_init_script('window.__qaFalhar=false;window.__qaOutros=[];')
    page.reload()
    page.locator('[name=simBaseConsulta][value=outros]').check()
    expect(page.locator('#sim-outros-status')).to_contain_text('consultada no Supabase')
    expect(page.locator('#sim-outros-results .sim-bank-card')).to_have_count(0)
    assert not errors,errors
    print('PASS: offline usa somente cache publicado; leitura remota vazia retira condições excluídas sem reaproveitar rascunhos')
    ctx.close()
   browser.close()
 finally:server.shutdown()


if __name__=='__main__':main()

"""Observações do banco na espécie Geral, sem misturar prazos/espécies ou alterar Pesquisa."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
GERAL = 'Conferir <documento> & assinatura.\n' + 'Observação geral do banco com texto longo. ' * 18
REGRAS = [dict(nomeBanco='Banco Teste', nome='Banco Teste', fazMargem=True, fazCartao=True,
    aceitaInvalidez=True, invalidezFazMargem=True, aceitaClientePensao=True, pensaoFazMargem=True,
    aceitaLoas=True, loasFazMargem=True, observacoes=GERAL,
    prazos=[dict(idade='18-59', parcelas='84', obs='Prazo geral para jovem.'),
            dict(idade='60-85', parcelas='72', obs='Prazo geral para idoso.')],
    prazosCartao=[dict(idade='18-85', parcelas='96', obs='Regra exclusiva cartão.')],
    invalidezPrazos=[dict(idade='18-85', parcelas='60', obs='Regra exclusiva invalidez.')],
    prazosPensao=[dict(idade='18-85', parcelas='48', obs='Regra exclusiva pensão.')],
    loas87Ranges=[dict(idade='18-85', parcelas='36', obs='Regra exclusiva LOAS.')]),
    dict(nomeBanco='Banco Sem Obs', nome='Banco Sem Obs', fazMargem=True, observacoes='  \n ',
         prazos=[dict(idade='18-85', parcelas='84', obs='')]),
    dict(nomeBanco='Banco Só Gerais', nome='Banco Só Gerais', fazMargem=True, observacoes='Texto geral sem observação no prazo.',
         prazos=[dict(idade='18-85', parcelas='84', obs='')])]


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 1000})
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=QA['STUB']))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps(REGRAS) + ';'
                    'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));')
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('3 bancos')
                expect(page.locator('#sim-especie')).to_have_value('geral')
                page.locator('#sim-idade').fill('45')
                page.locator('#sim-p-margem').check()
                card = page.locator('.sim-bank-card').filter(has=page.get_by_role('button', name='Simular com Banco Teste', exact=True))
                expect(card.locator('.sim-bank-observation-text')).to_contain_text('Prazo geral para jovem.')
                expect(card.locator('.sim-bank-observation-text')).to_contain_text('Conferir <documento> & assinatura.')
                expect(card).not_to_contain_text('Prazo geral para idoso.')
                expect(card).not_to_contain_text('Regra exclusiva cartão.')
                expect(card).not_to_contain_text('Regra exclusiva invalidez.')
                assert card.locator('documento').count() == 0
                expand = card.locator('.sim-bank-expand')
                expect(expand).to_be_visible()
                expand.click()
                expect(expand).to_have_attribute('aria-expanded', 'true')
                expect(card.locator('.sim-bank-observation-text')).to_have_css('display', 'block')
                assert card.locator('.sim-bank-observation-text').evaluate('(e)=>e.scrollHeight<=e.clientHeight+1')
                expand.click()
                empty = page.locator('.sim-bank-card').filter(has=page.get_by_role('button', name='Simular com Banco Sem Obs', exact=True))
                expect(empty.locator('.sim-bank-observations')).to_have_count(0)
                only = page.locator('.sim-bank-card').filter(has=page.get_by_role('button', name='Simular com Banco Só Gerais', exact=True))
                expect(only).to_contain_text('Texto geral sem observação no prazo.')
                page.locator('#sim-idade').fill('65')
                expect(card).to_contain_text('Prazo geral para idoso.')
                expect(card).not_to_contain_text('Prazo geral para jovem.')
                print('PASS: Geral exibe observação geral e só o prazo correspondente, mesmo sem obs no prazo; textos longos expandem, vazios não criam bloco', prefix)

                page.locator('label:has(#sim-modo-avancado)').click()
                card.locator('.sim-bank-advanced-details > summary').click()
                expect(card.locator('.sim-bank-general-text')).to_contain_text('Conferir <documento> & assinatura.')
                assert card.locator('documento').count() == 0
                expect(empty.locator('.sim-bank-general-text')).to_have_count(0)
                # Pesquisa compartilhada conserva o comportamento anterior sem a opção explícita do Simulador.
                assert page.evaluate("""async b=>{
                  const {renderDetalhesBanco}=await import('../js/filtros/avancado.js');
                  return !renderDetalhesBanco(b,{especie:'geral'}).includes('sim-bank-general-text');
                }""", REGRAS[0])
                for especie, texto in [('invalidez','Regra exclusiva invalidez.'), ('pensao','Regra exclusiva pensão.'), ('loas','Regra exclusiva LOAS.')]:
                    page.locator('#sim-especie').select_option(especie)
                    expect(card.locator('.sim-bank-general-text')).to_have_count(0)
                    page.locator('label:has(#sim-modo-rapido)').click()
                    expect(card.locator('.sim-bank-observation-text')).to_have_text(texto)
                    expect(card).not_to_contain_text('Observação geral do banco')
                    page.locator('label:has(#sim-modo-avancado)').click()
                page.locator('#sim-especie').select_option('geral')
                page.locator('label:has(#sim-modo-rapido)').click()
                expect(card).to_contain_text('Observações gerais:')
                for width in [390, 1400]:
                    page.set_viewport_size({'width':width, 'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
                    heights = page.locator('.sim-bank-card').evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().height)')
                    assert max(heights)-min(heights)<1
                assert not errors, errors
                print('PASS: Avançado exibe gerais apenas na espécie Geral do Simulador; outras espécies/Pesquisa preservadas, cards iguais e sem overflow')
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

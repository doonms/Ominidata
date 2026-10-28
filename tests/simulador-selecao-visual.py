"""Seleção visual e comparação: busca, prazos, tabelas iguais, seleção persistente e responsividade."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA=runpy.run_path(str(Path(__file__).with_name('simulador-multiplas.py')))


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QA['QA']['QuietHandler'],directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            for prefix in ['', '/Ominidata']:
                ctx=browser.new_context(service_workers='block',viewport={'width':1440,'height':1000})
                ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=QA['STUB']))
                ctx.route('https://**/*',lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras='+json.dumps(QA['QA']['REGRAS'])+';window.__qaFatoresRemotos='+json.dumps(QA['REMOTOS'])+';'
                    'localStorage.setItem("ominidata_base_inss_v1",JSON.stringify(window.__qaRegras));'
                    'localStorage.setItem("ominidata_base_fatores_v1",'+json.dumps(json.dumps(QA['FATORES']))+');')
                page=ctx.new_page();errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('4 bancos')
                assert page.evaluate('''()=>{
                    const group=document.querySelector('.sim-calculation-entry');
                    const ids=['inpValorMargem','inpValorDesejado','inpFatorManual','slOrigemFator','btnSimular'];
                    return ids.every(id=>group.contains(document.getElementById(id))) &&
                      !!(document.getElementById('sim-condicoes').compareDocumentPosition(group)&Node.DOCUMENT_POSITION_FOLLOWING);
                }'''), 'Valor, fator e origem devem ficar junto do botão, depois das condições'
                page.locator('#inpValorMargem').fill('100')
                page.locator('#sim-banco-busca').fill('brasil')
                expect(page.locator('#slBanco option')).to_have_count(2)
                page.locator('#slBanco').select_option('BancodoBrasil')
                expect(page.locator('#sim-current-bank')).to_have_text('Banco do Brasil')
                expect(page.locator('#sim-selected-bank-logo')).to_be_visible()
                # Buscar outro banco não pode desfazer uma seleção nem recalcular outro banco.
                page.locator('#sim-banco-busca').fill('não existe')
                expect(page.locator('#slBanco')).to_have_value('BancodoBrasil')
                expect(page.locator('#sim-bank-options-count')).to_contain_text('seleção mantida')
                page.locator('#sim-banco-busca').fill('')
                page.locator('#slOrigemFator').select_option('tabela')
                expect(page.locator('#sim-table-choices .sim-table-choice')).to_have_count(2)
                expect(page.locator('#sim-prazo-chips button')).to_have_count(3)
                page.locator('#sim-table-choices button').filter(has_text='Tabela B').click()
                expect(page.locator('#slTabela')).to_have_value('1')
                expect(page.locator('#sim-current-condition')).to_have_text('Tabela B · 84 parcelas')
                expect(page.locator('#inpFatorManual')).to_have_value('0,0300')
                expect(page.locator('#resValor')).to_contain_text('3.333,33')
                expect(page.locator('#sim-table-choices [aria-pressed=true]')).to_be_focused()
                page.locator('#sim-tabela-busca').fill('Tabela A')
                expect(page.locator('#sim-table-choices button')).to_have_count(1)
                expect(page.locator('#slTabela')).to_have_value('1')
                page.locator('#sim-tabela-busca').fill('inexistente')
                expect(page.locator('#sim-table-empty')).to_be_visible()
                expect(page.locator('#resValor')).to_contain_text('3.333,33')
                page.locator('#sim-tabela-busca').fill('')
                page.locator('#sim-prazo-chips button').filter(has_text='72x').focus()
                page.keyboard.press('Enter')
                expect(page.locator('#slPrazo')).to_have_value('72')
                expect(page.locator('#resValor')).to_contain_text('4.000,00')
                expect(page.locator('#sim-prazo-chips [aria-pressed=true]')).to_be_focused()
                print('PASS: busca de banco preserva seleção; cards de tabela, prazo por teclado e cálculo correspondem à escolha',prefix)

                page.locator('#sim-multiplas > summary').click()
                expect(page.locator('.sim-multi-group')).to_have_count(3)
                expect(page.locator('#sim-multi-context-entry')).to_contain_text('100,00')
                page.locator('#sim-multi-busca').fill('Tabela A')
                expect(page.locator('#sim-multi-visiveis')).to_have_text('2 de 4 condições')
                page.locator('#sim-multi-todas').click()
                expect(page.locator('#sim-multi-selecionadas')).to_have_text('2 selecionadas')
                page.locator('#sim-multi-busca').fill('Tabela B')
                expect(page.locator('#sim-multi-selecionadas')).to_have_text('2 selecionadas')
                expect(page.locator('#sim-multi-visiveis')).to_have_text('1 de 4 condições')
                page.locator('#sim-multi-todas').click()
                expect(page.locator('#sim-multi-selecionadas')).to_have_text('3 selecionadas')
                page.locator('#sim-multi-busca').fill('inexistente')
                expect(page.locator('#sim-multi-sem-busca')).to_be_visible()
                expect(page.locator('#sim-multi-todas')).to_be_disabled()
                page.locator('#sim-multi-gerar').click()
                expect(page.locator('.sim-multi-card')).to_have_count(3)
                expect(page.locator('#sim-multi-result-context')).to_contain_text('Banco do Brasil')
                page.locator('#sim-multi-busca').fill('')
                page.locator('#sim-multi-prazo').select_option('84')
                expect(page.locator('.sim-multi-group:visible')).to_have_count(1)
                expect(page.locator('#sim-multi-selecionadas')).to_have_text('3 selecionadas')
                page.locator('#sim-multi-limpar').click()
                page.locator('[aria-label="Selecionar tabelas do prazo 84"]').click()
                expect(page.locator('#sim-multi-selecionadas')).to_have_text('2 selecionadas')
                page.locator('#inpValorMargem').fill('200')
                expect(page.locator('#sim-multi-context-entry')).to_contain_text('200,00')
                expect(page.locator('#sim-multi-results')).to_be_hidden()
                page.locator('#sim-multi-gerar').click()
                expect(page.locator('.sim-multi-card-condition strong')).to_have_text(['Tabela A','Tabela B'])
                print('PASS: comparação agrupa prazos, busca/filtro não apagam seleção, selecionar visíveis/prazo e contexto atualizado funcionam')
                for width in [320,390,768,1440,1920]:
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), width
                    if not prefix and width in [390,1440]:
                        page.locator('#sim-operation-body').screenshot(path=str(Path(gettempdir())/f'ominidata-selecao-visual-{width}.png'))
                page.locator('#slOrigemFator').select_option('manual')
                expect(page.locator('#grpTabelaCadastrada')).to_be_hidden()
                expect(page.locator('#sim-multi-manual')).to_be_visible()
                expect(page.locator('.sim-multi-manual-title')).to_have_text('Condição manual 1')
                assert page.evaluate('new Set([...document.querySelectorAll("[id]")].map(e=>e.id)).size===document.querySelectorAll("[id]").length')
                assert not errors,errors
                print('PASS: layouts 320–1920px, modo manual, ausência de IDs duplicados e de exceções JavaScript')
                ctx.close()
            browser.close()
    finally:server.shutdown()


if __name__=='__main__':main()

"""Regras desativadas não significam aceitação; detalhes seguem espécie/produto."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
AGIL = dict(nome='Agil', nomeBanco='Agil', fazMargem=True, fazCartao=False,
    aceitaInvalidez=False, aceitaClienteNaoAssina=False,
    invalidezFazMargem=True, invalidezPrazos=[dict(idade='18-85', parcelas='96', obs='INV ANTIGA')],
    naoAssina_precisaVideo=True, naoAssina_precisaVideoObs='NÃO ASSINA ANTIGA',
    prazos=[dict(idade='18-59', parcelas='84', obs='MARGEM JOVEM'), dict(idade='60-85', parcelas='72', obs='MARGEM IDOSO')],
    prazosCartao=[dict(idade='18-85', parcelas='96', obs='CARTÃO DESLIGADO')],
    precisaGravarVideo=True, gravarVideoObs='Vídeo <cliente> & assinatura',
    outrosDocs='Comprovante especial <original>', documentos=['RG'],
    bancosAceitos=['Banco Permitido'], bancosNaoAceitos=['Banco Restrito'],
    links=['https://example.org/consulta', 'javascript:alert(1)'], emails=['contato@example.org'],
    contatos=[dict(numero='11999999999', obs='Equipe operacional')])


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='block')
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=QA['STUB']))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps([AGIL]) + ';')
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('1 banco')
                page.locator('#sim-idade').fill('65')
                page.locator('#sim-p-margem').check()
                page.locator('label:has(#sim-modo-avancado)').click()
                page.locator('.sim-bank-advanced-details > summary').click()
                body = page.locator('.sim-bank-advanced-body')
                for text in ['MARGEM IDOSO', 'Vídeo <cliente> & assinatura', 'Comprovante especial <original>',
                             'Banco Permitido', 'Banco Restrito', 'contato@example.org', 'Equipe operacional']:
                    expect(body).to_contain_text(text)
                for text in ['Invalidez', 'NÃO ASSINA ANTIGA', 'INV ANTIGA', 'MARGEM JOVEM', 'CARTÃO DESLIGADO', 'Regras para cliente não assinante']:
                    expect(body).not_to_contain_text(text)
                assert body.locator('cliente, original, a[href^="javascript:"]').count() == 0
                expect(body.locator('a')).to_have_attribute('rel', 'noopener noreferrer')
                page.locator('#sim-assina').select_option('nao')
                expect(page.locator('.sim-bank-card')).to_have_count(0)
                page.locator('#sim-assina').select_option('qualquer')
                page.locator('#sim-especie').select_option('invalidez')
                expect(page.locator('.sim-bank-card')).to_have_count(0)
                # Strings negativas antigas não são convertidas em aceitação.
                result = page.evaluate('''async bank => {
                    const {aplicarFiltros}=await import('../js/filtros/rapido.js');
                    const {renderDetalhesBanco}=await import('../js/filtros/avancado.js');
                    bank.aceitaInvalidez='false'; bank.aceitaClienteNaoAssina='não';
                    return {count:aplicarFiltros([bank],{especie:'invalidez',assina:'qualquer',prods:{}}).length,
                        html:renderDetalhesBanco(bank,{}, {filtrarContexto:true})};
                }''', AGIL)
                assert result['count'] == 0
                assert 'INV ANTIGA' not in result['html'] and 'NÃO ASSINA ANTIGA' not in result['html']
                # Agora cadastra efetivamente invalidez: usa apenas suas regras.
                bank = {**AGIL, 'aceitaInvalidez': True, 'invalidezFazMargem': True}
                html = page.evaluate('''async b => (await import('../js/filtros/avancado.js')).renderDetalhesBanco(b,
                    {especie:'invalidez',idade:65,prods:{margem:true}}, {filtrarContexto:true})''', bank)
                assert 'INV ANTIGA' in html and 'MARGEM IDOSO' not in html
                assert not errors, errors
                print('PASS: Agil simulado sem aceitação indevida; espécie/produto/idade, informações e segurança', prefix)
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

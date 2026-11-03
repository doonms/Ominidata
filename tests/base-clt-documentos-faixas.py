"""Documentos e múltiplas faixas CLT, inclusive migração do cadastro anterior."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
KEY = 'ominidata_base_clt_v1'
ANTIGA = {'tipo': 'base_clt', 'versao': 1, 'bancos': [dict(banco_id='clt-antigo', nome='Banco do Brasil',
    idadeMinima=18, idadeMaxima=59, tempoEmpresaMeses=12, seguro='nao')]}


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='block', accept_downloads=True, viewport={'width': 1440, 'height': 1000})
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=QA['STUB']))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';'
                    f'if(!localStorage.getItem("{KEY}"))localStorage.setItem("{KEY}",' + json.dumps(json.dumps(ANTIGA)) + ');')
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.on('dialog', lambda d:d.accept())
                base = f'http://127.0.0.1:{server.server_port}{prefix}'
                page.goto(base + '/pages/base-clt.html')
                card = page.locator('.clt-bank')
                expect(card).not_to_have_attribute('open', '')
                card.locator('summary').click()
                expect(card.locator('[data-field=idadeMinima]')).to_have_value('18')
                expect(card.locator('[data-field=idadeMaxima]')).to_have_value('59')
                expect(card.locator('[data-documento]:checked')).to_have_count(0)
                # Ler o cadastro antigo não apaga nem sobrescreve seu conteúdo original.
                assert json.loads(page.evaluate(f'localStorage.getItem("{KEY}")')) == ANTIGA
                card.locator('.clt-add-range').click()
                rows = card.locator('.clt-age-row')
                expect(rows).to_have_count(2)
                expect(rows.nth(1).locator('[data-field=idadeMinima]')).to_be_focused()
                rows.nth(1).locator('[data-field=idadeMinima]').fill('60')
                rows.nth(1).locator('[data-field=idadeMaxima]').fill('75')
                expect(card.locator('.clt-bank-resumo')).to_contain_text('18–59 anos / 60–75 anos')
                for doc in ['RG', 'CPF', 'CTPS', 'OUTROS']:
                    card.locator(f'[data-documento={doc}]').check()
                expect(card.locator('.clt-other-documents')).to_be_visible()
                page.locator('#clt-exportar').click()
                expect(page.locator('#clt-status')).to_contain_text('Confira o campo')
                card.locator('[data-field=outrosDocumentos]').fill('Comprovante <original> & holerite')
                rows.nth(1).locator('[data-field=idadeMaxima]').fill('50')
                page.locator('#clt-exportar').click()
                expect(page.locator('#clt-status')).to_contain_text('Confira o campo')
                expect(rows.nth(1).locator('[data-field=idadeMaxima]')).to_be_focused()
                rows.nth(1).locator('[data-field=idadeMaxima]').fill('75')
                page.reload()
                card.locator('summary').click()
                expect(rows).to_have_count(2)
                expect(rows.nth(1).locator('[data-field=idadeMaxima]')).to_have_value('75')
                expect(card.locator('[data-documento]:checked')).to_have_count(4)
                expect(card.locator('[data-field=outrosDocumentos]')).to_have_value('Comprovante <original> & holerite')
                assert card.locator('original').count() == 0
                with page.expect_download() as download:
                    page.locator('#clt-exportar').click()
                exported = json.loads(Path(download.value.path()).read_text(encoding='utf8'))
                banco = exported['bancos'][0]
                assert banco['faixasIdade'] == [dict(idadeMinima=18, idadeMaxima=59), dict(idadeMinima=60, idadeMaxima=75)]
                assert banco['documentos'] == ['RG', 'CPF', 'CTPS', 'OUTROS']
                assert banco['idadeMinima'] == 18 and banco['idadeMaxima'] == 59
                print('PASS: migração preserva idades antigas; documentos e duas faixas persistem e exportam', prefix)

                rows.nth(0).locator('.clt-remove-range').click()
                expect(rows).to_have_count(1)
                expect(rows.locator('[data-field=idadeMinima]')).to_have_value('60')
                saved = json.loads(page.evaluate(f'localStorage.getItem("{KEY}")'))['bancos'][0]
                assert saved['idadeMinima'] == '60' and len(saved['faixasIdade']) == 1
                card.locator('[data-documento=OUTROS]').uncheck()
                expect(card.locator('.clt-other-documents')).to_be_hidden()
                with page.expect_download() as download:
                    page.locator('#clt-exportar').click()
                sem_outros = json.loads(Path(download.value.path()).read_text(encoding='utf8'))
                assert sem_outros['bancos'][0]['outrosDocumentos'] == ''
                card.locator('[data-documento=OUTROS]').check()
                expect(card.locator('[data-field=outrosDocumentos]')).to_have_value('Comprovante <original> & holerite')
                page.locator('#clt-importar').set_input_files({'name':'base-clt.json', 'mimeType':'application/json', 'buffer':json.dumps(exported).encode()})
                expect(page.locator('#clt-status')).to_contain_text('importada')
                card.locator('summary').click()
                expect(rows).to_have_count(2)
                expect(card.locator('[data-documento]:checked')).to_have_count(4)
                # Modelo valida todas as faixas e não recupera idades antigas quando a lista foi esvaziada.
                results = page.evaluate('''async arquivo => {
                    const {prepararBaseClt}=await import('../js/clt/modelo.js');
                    const b=arquivo.bancos[0];
                    const cases=[
                      {...b,faixasIdade:[{idadeMinima:18,idadeMaxima:59},{idadeMinima:80,idadeMaxima:60}]},
                      {...b,faixasIdade:[{idadeMinima:-1,idadeMaxima:59}]},
                      {...b,faixasIdade:[{idadeMinima:18,idadeMaxima:121}]},
                      {...b,faixasIdade:[{idadeMinima:18.5,idadeMaxima:59}]},
                      {...b,faixasIdade:{}}, {...b,documentos:['<script>']},
                      {...b,documentos:['OUTROS'],outrosDocumentos:''}
                    ];
                    const rejects=cases.map(bank=>{try{prepararBaseClt({...arquivo,bancos:[bank]});return false;}catch{return true;}});
                    const empty=prepararBaseClt({...arquivo,bancos:[{...b,faixasIdade:[]}]})[0];
                    return {rejects,empty};
                }''', exported)
                assert all(results['rejects']), results
                assert results['empty']['faixasIdade'] == [] and results['empty']['idadeMinima'] is None
                for width in [320, 390, 768, 1440]:
                    page.set_viewport_size({'width':width, 'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), width
                    ids = page.locator('[id]').evaluate_all('els=>els.map(e=>e.id)')
                    assert len(ids) == len(set(ids))
                    if not prefix and width in [390,1440]:
                        page.screenshot(path=str(Path(gettempdir()) / f'ominidata-clt-documentos-{width}.png'), full_page=True)
                rows.nth(0).locator('.clt-remove-range').click()
                rows.locator('.clt-remove-range').click()
                expect(rows.locator('[data-field=idadeMinima]')).to_have_value('')
                expect(rows.locator('[data-field=idadeMaxima]')).to_have_value('')
                assert not errors, errors
                print('PASS: remoção, limpeza, Outros condicional, JSON completo, validações e layout 320–1440px', prefix)
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

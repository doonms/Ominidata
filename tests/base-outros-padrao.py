"""Padrão banco: cópia única e independente, sem escrita remota."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('base-outros-convenios.py')))
KEY, OPS, PERFIS = QA['KEY'], QA['OPS'], QA['PERFIS']


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QA']['QuietHandler'], directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(viewport={'width':1440,'height':1000}, service_workers='block', accept_downloads=True)
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=QA['QA']['STUB']))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.add_init_script(
                    'window.__qaRegras=[];sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                    f'if(!localStorage.getItem("{KEY}"))localStorage.setItem("{KEY}",' + json.dumps(json.dumps(QA['INITIAL'])) + ');')
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.on('dialog', lambda d:d.accept())
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/base-outros-convenios.html')
                bank = page.locator('.banco-outros-card').filter(has=page.locator('[data-toggle-banco="0"]'))
                bank.locator('[data-toggle-banco]').click()

                def saved():
                    return page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')

                # Existing data is not retroactively overwritten when the model is added.
                bank.locator('[data-add-convenio][data-type=padrao_banco]').click()
                original = saved()[0]['convenios'][:3]
                template_id = saved()[0]['convenios'][-1]['id']
                template = bank.locator(f'[data-convenio="{template_id}"]')
                expect(template.locator('.convenio-body')).to_be_visible()
                expect(template.locator('[data-conv-field$=":tipo"]')).to_be_disabled()
                expect(template.locator('[data-conv-field$=":nome"]')).to_have_attribute('readonly', '')
                expect(bank.locator('.convenio-card').first).to_have_attribute('data-convenio', template_id)
                bank.locator('[data-add-convenio][data-type=padrao_banco]').click()
                assert len(saved()[0]['convenios']) == 4, 'Only one model per bank'
                for n, (flag, lista) in enumerate(OPS + PERFIS):
                    template.locator(f'[data-conv-field$=":{flag}"]').check()
                    attr = 'data-conv-operacao' if n < len(OPS) else 'data-conv-perfil'
                    template.locator(f'[{attr}={lista}] [data-conv-prazo$=":idade"]').fill(f'{20+n}-{70+n}')
                    template.locator(f'[{attr}={lista}] [data-conv-prazo$=":parcelas"]').fill(str(60+n*12))
                    template.locator(f'[{attr}={lista}] [data-conv-prazo$=":obs"]').fill('Modelo ' + lista)
                template.locator('[data-conv-field$=":aceitaCeletista"]').check()
                template.locator('[data-conv-field$=":perfisOutros"]').fill('Efetivos "A"')
                template.locator('[data-conv-array$=":documentos"][data-value=rg]').check()
                template.locator('[data-conv-field$=":exigeDocumentos"]').check()
                template.locator('[data-conv-field$=":documentosNecessarios"]').fill('RG e comprovante de residência')
                template.locator('[data-conv-field$=":precisaVideoObs"]').fill('Procedimento padrão')
                template.locator('[data-conv-field$=":minimoLiberado"]').fill('1000')
                template.locator('[data-conv-field$=":margemMaximaConvenio"]').fill('35%')
                template.locator('[data-conv-field$=":margemUtilizadaBanco"]').fill('30%')
                template.locator('[data-conv-field$=":observacoes"]').fill('Observação padrão')
                model = saved()[0]['convenios'][-1]
                copies = []
                for tipo in ['prefeitura','governo','siape']:
                    bank.locator('[data-convenio-search]').fill('pesquisa sem resultado')
                    bank.locator(f'[data-add-convenio][data-type={tipo}]').click()
                    expect(bank.locator('[data-convenio-search]')).to_have_value('')
                    copy = saved()[0]['convenios'][-1]
                    assert copy['tipo'] == tipo and copy['nome'] == '' and copy['id'] != template_id
                    for key, value in model.items():
                        if key not in ['id','tipo','nome']:
                            assert copy[key] == value, (tipo,key)
                    card = bank.locator(f'[data-convenio="{copy["id"]}"]')
                    expect(card.locator('.convenio-body')).to_be_visible()
                    card.locator('[data-conv-field$=":nome"]').fill('Convênio ' + tipo)
                    copies.append(copy['id'])
                assert saved()[0]['convenios'][:3] == original
                assert saved()[1]['convenios'][0]['id'] == 'outro-1'

                # Editing one copy must not change its siblings or the template.
                first = bank.locator(f'[data-convenio="{copies[0]}"]')
                first.locator('[data-conv-operacao=prazos] [data-conv-prazo$=":obs"]').fill('Somente prefeitura')
                first.locator('[data-conv-perfil=prazosCeletista] [data-conv-prazo$=":obs"]').fill('Celetista só da prefeitura')
                first.locator('[data-conv-array$=":documentos"][data-value=rg]').uncheck()
                first.locator('[data-conv-field$=":documentosNecessarios"]').fill('Documento exclusivo da prefeitura')
                first.locator('[data-conv-field$=":margemUtilizadaBanco"]').fill('25,5%')
                state = saved()[0]['convenios']
                assert next(c for c in state if c['id'] == template_id) == model
                for copy_id in copies[1:]:
                    copy = next(c for c in state if c['id'] == copy_id)
                    assert copy['prazos'] == model['prazos'] and copy['documentos'] == ['rg']
                    assert copy['prazosCeletista'] == model['prazosCeletista']
                    assert copy['prazosTemporario'] == model['prazosTemporario']
                    assert copy['exigeDocumentos'] and copy['documentosNecessarios'] == model['documentosNecessarios']
                    assert copy['margemMaximaConvenio'] == '35%' and copy['margemUtilizadaBanco'] == '30%'
                previous = {c['id']:c for c in state if c['tipo'] != 'padrao_banco'}
                template.locator('[data-conv-operacao=prazosCartao] [data-conv-prazo$=":obs"]').fill('Modelo atualizado')
                assert {c['id']:c for c in saved()[0]['convenios'] if c['tipo'] != 'padrao_banco'} == previous
                bank.locator('[data-add-convenio][data-type=governo]').click()
                assert saved()[0]['convenios'][-1]['prazosCartao'][0]['obs'] == 'Modelo atualizado'

                # Direct in-memory assertions detect shared references, not only storage values.
                assert page.evaluate("""async () => {
                    const u = await import('../js/components/utilBaseOutros.js');
                    const modelo = u.novoConvenioPadrao(u.TIPO_PADRAO_BANCO);
                    modelo.documentos = ['rg'];
                    modelo.prazos[0].obs = 'Original';
                    modelo.extra = { lista: [{ valor: 1 }] };
                    const a = u.novoConvenioPadrao('governo', modelo);
                    const b = u.novoConvenioPadrao('siape', modelo);
                    a.documentos.push('cnh');
                    a.prazos[0].obs = 'Alterado';
                    a.extra.lista[0].valor = 2;
                    modelo.prazosCartao[0].obs = 'Só o modelo';
                    return b.documentos.length === 1 && modelo.documentos.length === 1 &&
                        b.prazos[0].obs === 'Original' && modelo.prazos[0].obs === 'Original' &&
                        b.extra.lista[0].valor === 1 && modelo.extra.lista[0].valor === 1 &&
                        a.prazosCartao[0].obs === '' && b.prazosCartao[0].obs === '';
                }""")
                for width in [320,390,768,1440]:
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
                    if width in [390,1440]:
                        bank.locator('.convenio-type-buttons').screenshot(path=str(Path(gettempdir()) / f'ominidata-padrao-banco-{width}.png'))
                before = saved()
                with page.expect_download() as download:
                    page.locator('#save').click()
                exported = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
                assert exported == before
                page.reload()
                bank.locator('[data-toggle-banco]').click()
                bank.locator('[data-add-convenio][data-type=padrao_banco]').click()
                assert saved() == before
                page.locator('#file').set_input_files(dict(name='modelo.json',mimeType='application/json',buffer=json.dumps(exported).encode()))
                assert saved() == before
                bank.locator('[data-remove-convenio="' + f'0:{template_id}' + '"]').click()
                assert {c['id']:c for c in saved()[0]['convenios']} == {c['id']:c for c in before[0]['convenios'] if c['id'] != template_id}
                bank.locator('[data-add-convenio][data-type=siape]').click()
                assert not saved()[0]['convenios'][-1]['fazMargem'], 'Sem modelo, usar cadastro vazio'
                # A new bank starts with its own empty model, never another bank's model.
                page.locator('#add').click()
                assert len(saved()[-1]['convenios']) == 1
                assert saved()[-1]['convenios'][0]['tipo'] == 'padrao_banco'
                assert not saved()[-1]['convenios'][0]['fazMargem']
                assert not errors, errors
                print(f'PASS {prefix or "/"}: modelo único por banco; cópias completas e independentes; mudanças só para novos; exportação/importação/reload; exclusão segura; layout 320–1440px')
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

"""Base INSS → exportação/envio simulado → Simulador; imagens presentes/ausentes e layout."""
import base64
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
KEY = 'ominidata_base_inss_v1'
CODIGOS = ['manual', 'rapido', 'medio', 'lento', '']
ARQUIVOS = ['esteira-manual.png', 'paga-rapido.png', 'paga-medio.png', 'paga-lento.png']
TEXTOS = dict(manual='Esteira manual', rapido='Paga rápido', medio='Paga em tempo médio', lento='Paga lento')
REGRAS = [dict(nome=f'{nome} Banco', nomeBanco=f'{nome} Banco', banco_id=f'teste-{i}', fazMargem=True,
    observacoes=f'Observação geral {nome}.', prazos=[dict(idade='18-85', parcelas='84', obs='Prazo correspondente.')])
    for i, nome in enumerate(['Manual', 'Rapido', 'Medio', 'Lento', 'Neutro'])]
STUB = QA['STUB'].replace('from(table) {', '''from(table) {
    if(table==='base_inss') {
      const q={mode:'read',first:0,last:999999,select(){return q;},order(){return q;},eq(){return q;},neq(){return q;},
        range(first,last){q.first=first;q.last=last;return q;},in(column,ids){q.ids=ids;return q;},
        delete(){q.mode='delete';return q;},upsert(rows){q.mode='upsert';q.rows=rows;return q;},
        then(resolve,reject){return Promise.resolve().then(()=>{
          const stored=JSON.parse(sessionStorage.getItem('__qaRemote')||'null');
          const rows=stored||window.__qaRegras.map(dados=>({banco_id:dados.banco_id,nome:dados.nome,suspenso:false,dados}));
          if(q.mode==='delete'){
            if(window.__qaNegarDelete)return {data:null,error:{code:'42501',message:'Negado'}};
            window.__qaWrites.push('delete');const deleted=rows.filter(r=>q.ids.includes(r.banco_id));
            sessionStorage.setItem('__qaRemote',JSON.stringify(rows.filter(r=>!q.ids.includes(r.banco_id))));
            return {data:deleted,error:null,count:deleted.length};
          }
          if(q.mode==='upsert'){
            window.__qaWrites.push(q.rows);
            if(window.__qaErroUpsert)return {data:null,error:window.__qaErroUpsert};
            const next=structuredClone(rows);
            for(const row of q.rows){const i=next.findIndex(r=>r.banco_id===row.banco_id);if(i<0)next.push(row);else next[i]={...next[i],...row};}
            sessionStorage.setItem('__qaRemote',JSON.stringify(next));
            return {data:q.rows.slice(0,window.__qaLimiteRetorno||q.rows.length),error:null,count:window.__qaSemConfirmacao?null:q.rows.length};
          }
          if(window.__qaErroLeitura)return {data:null,error:window.__qaErroLeitura};
          return {data:rows.slice(q.first,q.last+1),error:null};
        }).then(resolve,reject);}};return q;
    }
''')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=')


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx = browser.new_context(service_workers='block', accept_downloads=True,
                                          viewport={'width': 1440, 'height': 1000})
                ctx.route('**/js/supa/supabaseClient.js', lambda r:r.fulfill(content_type='application/javascript', body=STUB))
                ctx.route('https://**/*', lambda r:r.abort())
                ctx.route('**/imagens/velocidade/*.png', lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps(REGRAS) + ';window.__qaWrites=[];')
                page = ctx.new_page()
                errors, dialogs = [], []
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.on('dialog', lambda d:(dialogs.append(d.message), d.accept()))
                url = f'http://127.0.0.1:{server.server_port}{prefix}'
                page.goto(url + '/pages/base-inss.html')
                expect(page.locator('#list .card')).to_have_count(5)
                for i, codigo in enumerate(CODIGOS):
                    page.locator(f'[data-open="{i}"]').click()
                    campo = page.locator(f'[data-put="{i}:velocidadePagamento"]')
                    expect(campo).to_have_value('')
                    expect(campo.locator('option')).to_have_count(5)
                    campo.select_option(codigo)
                    expect(page.locator(f'[data-put="{i}:velocidadePagamento"]')).to_have_value(codigo)
                    assert page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))[{i}].velocidadePagamento") == codigo
                    name = page.locator(f'[data-put="{i}:nome"]').bounding_box()
                    speed = page.locator(f'[data-put="{i}:velocidadePagamento"]').bounding_box()
                    assert abs(name['y']-speed['y'])<2 and speed['x']>name['x'], 'Campos lado a lado no desktop'
                with page.expect_download() as download_info:
                    page.locator('#save').click()
                exportado = json.loads(Path(download_info.value.path()).read_text(encoding='utf-8'))
                assert [b['velocidadePagamento'] for b in exportado] == CODIGOS
                assert [b['nome'] for b in exportado] == [b['nome'] for b in REGRAS]
                page.locator('#uploadBaseInssFile').set_input_files(dict(name='base-inss.json',mimeType='application/json',buffer=json.dumps(exportado).encode()))
                expect(page.locator('#list .card')).to_have_count(5)
                page.wait_for_function("window.__qaWrites.length===1 && JSON.parse(sessionStorage.getItem('__qaRemote')).length===5")
                expect(page.locator('#uploadBaseInssBtn')).to_be_enabled()
                assert dialogs[-1].startswith('✅'), dialogs
                remoto = page.evaluate("JSON.parse(sessionStorage.getItem('__qaRemote'))")
                assert [b['dados']['velocidadePagamento'] for b in remoto] == CODIGOS
                assert [b['nome'] for b in remoto] == [b['nome'] for b in REGRAS], 'Exportação em lista preserva nome no envio'
                page.reload()
                expect(page.locator('#list .card')).to_have_count(5)
                for i, codigo in enumerate(CODIGOS):
                    page.locator(f'[data-open="{i}"]').click()
                    expect(page.locator(f'[data-put="{i}:velocidadePagamento"]')).to_have_value(codigo)
                for width in [390, 1440]:
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    if width==390:
                        name=page.locator('[data-put="0:nome"]').bounding_box()
                        speed=page.locator('[data-put="0:velocidadePagamento"]').bounding_box()
                        assert speed['y']>name['y']
                        if not prefix:
                            page.locator('[data-idx="0"]').screenshot(path=str(Path(gettempdir())/'ominidata-inss-velocidade-mobile.png'))
                print('PASS: quatro velocidades + neutro editam/salvam, exportam, enviam via JSON e voltam do servidor; nomes preservados e formulário responsivo', prefix)

                page.goto(url + '/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('5 bancos')
                for codigo in CODIGOS[:-1]:
                    card=page.locator(f'.sim-bank-card[data-velocidade="{codigo}"]')
                    expect(card).to_have_count(1)
                    expect(card.locator('.sim-bank-speed')).to_be_visible()
                    expect(card.locator('.sim-bank-speed-text')).to_have_text(TEXTOS[codigo])
                    expect(card.locator('.sim-bank-option .sim-bank-speed')).to_have_count(0)
                    assert card.locator('.sim-bank-speed-row').evaluate('(e)=>e.nextElementSibling.classList.contains("sim-bank-observations")')
                    expect(card.locator('.sim-bank-speed-fallback')).to_be_visible()
                    expect(card.locator('.sim-bank-speed-icon')).to_be_hidden()
                    expect(card).to_contain_text('Observação geral')
                    expect(card).to_contain_text('Prazo correspondente.')
                neutro=page.locator('.sim-bank-card:not([data-velocidade])')
                expect(neutro).to_have_count(1)
                expect(neutro.locator('.sim-bank-speed')).to_have_count(0)
                expect(neutro.locator('.sim-bank-speed-row')).to_have_count(0)
                cores=page.locator('.sim-bank-card').evaluate_all('(els)=>els.map(e=>getComputedStyle(e).backgroundColor)')
                assert len(set(cores))==5, cores
                srcs=page.locator('.sim-bank-speed-icon').evaluate_all('(els)=>els.map(e=>e.src.split("/").pop())')
                assert sorted(srcs)==sorted(ARQUIVOS)
                page.locator('label:has(#sim-modo-avancado)').click()
                expect(page.locator('.sim-bank-card[data-velocidade]')).to_have_count(4)
                expect(page.locator('.sim-bank-speed')).to_have_count(4)
                expect(page.locator('.sim-bank-speed-text')).to_have_count(4)
                expect(page.locator('.sim-bank-speed-row').first).to_be_visible()
                page.locator('label:has(#sim-modo-rapido)').click()
                for width in [320, 390, 768, 1440]:
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    heights=page.locator('.sim-bank-card').evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().height)')
                    assert max(heights)-min(heights)<1
                    assert page.locator('.sim-bank-card').evaluate_all('(els)=>els.every(e=>e.scrollHeight<=e.clientHeight+1)')
                if not prefix:
                    page.locator('#sim-pesquisa-bancos').screenshot(path=str(Path(gettempdir())/'ominidata-simulador-velocidade.png'))
                print('PASS: quatro cores/símbolos e neutro nos dois modos; fallback sem imagens, observações mantidas, cards iguais e sem overflow')

                # Quando as imagens forem adicionadas, substituem os símbolos provisórios.
                ctx.unroute('**/imagens/velocidade/*.png')
                ctx.route('**/imagens/velocidade/*.png', lambda r:r.fulfill(content_type='image/png', body=PNG))
                page.reload()
                expect(page.locator('.sim-bank-speed-icon')).to_have_count(4)
                expect(page.locator('.sim-bank-speed-icon').first).to_be_visible()
                expect(page.locator('.sim-bank-speed-fallback').first).to_be_hidden()
                assert page.locator('.sim-bank-speed-icon').evaluate_all('(els)=>els.every(e=>e.complete&&e.naturalWidth>0)')
                assert page.evaluate("""async()=>{
                  const {normalizarVelocidadeBanco,simboloVelocidadeSrc}=await import('../js/utils/velocidade-banco.js');
                  return ['__proto__','constructor','invalido',null].every(v=>normalizarVelocidadeBanco(v)===''&&simboloVelocidadeSrc(v)==='');
                }""")
                # Não altera prazo/cálculo: clicar no card ainda carrega o banco para fator manual.
                page.locator('.sim-bank-card[data-velocidade="rapido"] .sim-bank-option').click()
                expect(page.locator('#slBanco')).to_have_value('Rapido Banco')
                page.locator('#inpValorMargem').fill('100')
                page.locator('#inpFatorManual').fill('0,02')
                expect(page.locator('#resValor')).to_contain_text('5.000,00')
                assert not errors, errors
                print('PASS: imagens disponíveis carregam, códigos inválidos são neutros e seleção/cálculo continuam funcionando')
                page.goto(url + '/pages/base-inss.html')
                expect(page.locator('#list .card')).to_have_count(5)
                page.locator('[data-open="1"]').click()
                page.locator('[data-put="1:velocidadePagamento"]').select_option('')
                legado={b['nome']:b for b in page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")}
                page.locator('#uploadBaseInssFile').set_input_files(dict(name='objeto.json',mimeType='application/json',buffer=json.dumps(legado).encode()))
                page.wait_for_function("window.__qaWrites.length===1")
                expect(page.locator('#uploadBaseInssBtn')).to_be_enabled()
                assert page.evaluate("JSON.parse(sessionStorage.getItem('__qaRemote'))[1].dados.velocidadePagamento") == ''
                writes=page.evaluate('window.__qaWrites.length')
                duplicado=[dict(exportado[0]),dict(exportado[0])]
                with page.expect_event('dialog') as rejected:
                    page.locator('#uploadBaseInssFile').set_input_files(dict(name='duplicado.json',mimeType='application/json',buffer=json.dumps(duplicado).encode()))
                assert rejected.value.message.startswith('❌')
                assert page.evaluate('window.__qaWrites.length')==writes
                page.evaluate('window.__qaNegarDelete=true')
                parcial=dict(list(legado.items())[:-1])
                with page.expect_event('dialog') as denied:
                    page.locator('#uploadBaseInssFile').set_input_files(dict(name='negado.json',mimeType='application/json',buffer=json.dumps(parcial).encode()))
                # O primeiro diálogo é a confirmação de publicar; aguarda a falha da exclusão.
                if denied.value.type=='confirm':
                    page.wait_for_function("!document.getElementById('uploadBaseInssBtn').disabled")
                    assert dialogs[-1].startswith('❌')
                else:
                    assert denied.value.message.startswith('❌')
                assert page.evaluate('window.__qaWrites.length')==writes+1, 'UPSERT confirmado precede remoção; DELETE negado mantém os bancos antigos'
                assert '4 bancos com gravação confirmada' in dialogs[-1]
                page.goto(url + '/pages/simulador.html')
                expect(page.locator('#sim-bank-count')).to_have_text('5 bancos')
                expect(page.locator('.sim-bank-card[data-velocidade="rapido"]')).to_have_count(0)
                expect(page.locator('.sim-bank-card:not([data-velocidade])')).to_have_count(2)
                assert not errors, errors
                print('PASS: limpar classificação remove símbolo/cor, JSON por nome aceito; duplicados não gravam e falha de exclusão informa publicação parcial sem perder bancos antigos')
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

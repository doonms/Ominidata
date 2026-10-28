"""Regressão do envio INSS: identificações, mensagens e ausência de exclusão antecipada.
Supabase inteiramente simulado: não publica/exclui bancos reais.
"""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('bancos-velocidade.py')))


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QA']['QuietHandler'], directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                ctx=browser.new_context(service_workers='block',accept_downloads=True)
                ctx.route('**/js/supa/supabaseClient.js',lambda r:r.fulfill(content_type='application/javascript',body=QA['STUB']))
                ctx.route('https://**/*',lambda r:r.abort())
                ctx.add_init_script('window.__qaRegras=' + json.dumps(QA['REGRAS']) + ';window.__qaWrites=[];')
                page=ctx.new_page()
                errors, dialogs = [], []
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('dialog',lambda d:(dialogs.append(d.message),d.accept()))
                page.goto(f'http://127.0.0.1:{server.server_port}{prefix}/pages/base-inss.html')
                expect(page.locator('#list .card')).to_have_count(5)
                # Identificação externa deve entrar no editor/exportação mesmo se dados não a contém.
                with page.expect_download() as download:
                    page.locator('#save').click()
                exported=json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
                assert [b['banco_id'] for b in exported]==[b['banco_id'] for b in QA['REGRAS']]
                result=page.evaluate("""async()=>{
                  const api=await import('../js/api/baseInssApi.js');
                  const assert=(v,m)=>{if(!v)throw Error(m);};
                  const bank=(nome,extra={})=>({nome,fazMargem:true,velocidadePagamento:'rapido',observacoes:'Geral',...extra});
                  const row=(id,nome)=>({id:42,banco_id:id,nome,suspenso:false,dados:bank(nome)});
                  const setup=(rows)=>{sessionStorage.setItem('__qaRemote',JSON.stringify(rows));window.__qaWrites=[];
                    window.__qaErroUpsert=null;window.__qaErroLeitura=null;window.__qaNegarDelete=false;window.__qaSemConfirmacao=false;};
                  const snap=()=>JSON.parse(sessionStorage.getItem('__qaRemote'));
                  const denied=async(fn)=>{try{await fn();throw Error('Era esperado erro');}catch(e){if(e.message==='Era esperado erro')throw e;return e;}};
                  const json=[bank('Banco PAN'),bank('Banco do Brasil'),bank('Banco Master')];
                  const before=JSON.stringify(json);
                  const novos=api.prepararBaseInss(json);
                  assert(new Set(novos.map(r=>r.banco_id)).size===3,'Nomes com Banco não podem gerar o mesmo ID');
                  assert(JSON.stringify(json)===before,'Não muda arquivo original');
                  setup([row('pan','Banco PAN'),row('bb','Banco do Brasil'),row('antigo','Antigo')]);
                  const r=await api.enviarBaseInss(json);
                  assert(r.quantidade===3&&r.removidos===1,'Envio/remocao confirmados');
                  assert(window.__qaWrites.length===2&&Array.isArray(window.__qaWrites[0])&&window.__qaWrites[1]==='delete','Gravar antes de excluir');
                  assert(snap().some(r=>r.banco_id==='pan')&&snap().some(r=>r.banco_id==='bb'),'IDs existentes preservados por nome');
                  assert(!snap().some(r=>r.banco_id==='antigo'),'Remove só banco ausente');
                  assert(window.__qaWrites[0].every(r=>!Object.hasOwn(r,'id')),'Nunca insere ID GENERATED ALWAYS');
                  assert(snap().every(r=>r.dados.velocidadePagamento==='rapido'),'Velocidade preservada');
                  assert(JSON.parse(localStorage.getItem(api.BACKUP_ENVIO_INSS)).remoto.length===3,'Backup anterior');
                  assert(api.prepararBaseInss([bank('Banco Renomeado',{banco_id:'pan'})],[row('pan','Banco PAN')])[0].banco_id==='pan','Renomear conserva ID explícito');
                  setup([row('pan','Banco PAN'),row('old','Antigo')]);
                  const previous=JSON.stringify(snap());
                  window.__qaErroUpsert={code:'42501',message:'RLS negou o envio'};
                  let e=await denied(()=>api.enviarBaseInss([bank('Banco PAN')]));
                  assert(!window.__qaWrites.includes('delete')&&JSON.stringify(snap())===previous,'RLS no UPSERT não apaga base');
                  assert(api.mensagemErroInss(e).includes('Master ou Admin')&&api.mensagemErroInss(e).includes('42501'),'Erro de permissão específico');
                  setup([row('pan','Banco PAN'),row('old','Antigo')]);window.__qaSemConfirmacao=true;
                  e=await denied(()=>api.enviarBaseInss([bank('Banco PAN')]));
                  assert(!window.__qaWrites.includes('delete')&&snap().length===2,'Sem confirmação não exclui');
                  setup([row('pan','Banco PAN'),row('old','Antigo')]);window.__qaNegarDelete=true;
                  e=await denied(()=>api.enviarBaseInss([bank('Banco PAN')]));
                  assert(e.confirmados===1&&snap().length===2,'Falha de exclusão mantém antigo e informa parcial');
                  assert(api.mensagemErroInss(e).includes('1 bancos com gravação confirmada'),'Não declara sucesso total');
                  setup([row('pan','Banco PAN')]);
                  e=await denied(()=>api.enviarBaseInss([bank('Duplicado'),bank('Duplicado')]));
                  assert(e.message.includes('Duplicado')&&!window.__qaWrites.length,'Nome duplicado claro antes de gravar');
                  e=await denied(()=>api.enviarBaseInss([bank('A',{banco_id:'mesmo'}),bank('B',{banco_id:'mesmo'})]));
                  assert(e.message.includes('mesma identificação')&&e.message.includes('mesmo')&&!window.__qaWrites.length,'ID duplicado claro');
                  const cancelado=await api.enviarBaseInss([bank('Banco PAN')],{antesDeEnviar:()=>false});
                  assert(cancelado===null&&!window.__qaWrites.length,'Cancelar não grava');
                  window.__qaErroLeitura={code:'42501',message:'Leitura negada'};
                  e=await denied(()=>api.enviarBaseInss([bank('Banco PAN')]));
                  assert(!window.__qaWrites.length&&!e.envioIniciado,'Leitura negada não grava');
                  setup([]);
                  const grande=Array.from({length:1001},(_,i)=>bank('Banco '+i));window.__qaLimiteRetorno=1000;
                  const lote=await api.enviarBaseInss(grande);
                  assert(lote.quantidade===1001&&snap().length===1001,'Contagem total e leitura paginada');
                  return true;
                }""")
                assert result
                print('PASS: Banco PAN/Banco do Brasil/Banco Master sem colisão; IDs remotos/renomeação preservados; backup e gravação antes de excluir',prefix)
                print('PASS: RLS, confirmação ausente, falha parcial, duplicados, cancelamento e leitura negada não apagam a base; lote >1000 confirmado')
                # O usuário recebe agora o diagnóstico real em vez do alerta genérico.
                with page.expect_event('dialog') as invalid:
                    page.locator('#uploadBaseInssFile').set_input_files(dict(name='invalido.json',mimeType='application/json',buffer=b'{invalido'))
                assert 'JSON válido' in invalid.value.message
                assert 'Nenhuma gravação foi iniciada' in invalid.value.message
                with page.expect_event('dialog') as duplicate:
                    page.locator('#uploadBaseInssFile').set_input_files(dict(name='duplicados.json',mimeType='application/json',buffer=json.dumps([{'nome':'Banco PAN'},{'nome':'Banco PAN'}]).encode()))
                assert 'Banco PAN' in duplicate.value.message and 'repetido' in duplicate.value.message
                assert not errors,errors
                print('PASS: alerta da tela mostra causa e preserva os dados locais; nenhuma chamada ao Supabase real')
                ctx.close()
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

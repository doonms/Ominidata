"""Testa leitura/upload sem acessar o Supabase real. Requer Playwright e Chrome."""
import json
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
ROOT, FATORES = QA['ROOT'], QA['FATORES']
STUB = """
export const supabase = {
  auth: { getUser: async () => ({data:{user: window.__qaSemSessao ? null : {email:'dominicplf@gmail.com'}}, error:null}) },
  from(table) {
    const query = {
      columns: '*', first:0, last:999999, mode:'read', filters:[],
      select(columns='*') { this.columns=columns; return this; },
      order() { return this; }, eq(column,value) { this.filters.push([column,value]); return this; },
      limit(n) { this.last=n-1; return this; },
      range(first,last) { this.first=first; this.last=last; return this; },
      delete() { throw new Error('PROIBIDO apagar a base'); },
      upsert(rows,options) { this.mode='write'; this.payload=rows; this.options=options; return this; },
      insert(rows,options) { this.mode='insert'; this.payload=rows; this.options=options; return this; },
      update(row,options) { this.mode='update'; this.payload=[row]; this.options=options; return this; },
      then(resolve,reject) {
        const run = async () => {
          if(table!=='base_fatores') return {data:[],error:null};
          if(['write','insert','update'].includes(this.mode)) {
            window.__qaWrites.push({method:this.mode,rows:this.payload,options:this.options,filters:this.filters});
            if(this.payload.some(row => row.id != null)) return {data:null,error:{code:'428C9',message:'cannot insert a non-DEFAULT value into column "id"'}};
            if(this.mode==='insert' && window.__qaExigirData && this.payload.some(row=>row.data==null)) return {data:null,error:{code:'23502',message:'data NOT NULL'}};
            if(window.__qaFalhaEnvio || window.__qaFalharNaGravacao===window.__qaWrites.length) return {data:null,error:{code:'42501',message:'Permissão negada'}};
            const next=structuredClone(window.__qaRows);
            const saved=this.mode==='update'
              ? (window.__qaAtualizacaoInvisivel ? [] : next.filter(row=>this.filters.every(([col,value])=>row[col]===value)))
                .map(row=>Object.assign(row,this.payload[0]))
              : this.payload.map(row=> {
              const copy={...row};
              if(copy.id==null) copy.id=Math.max(0,...next.map(r=>r.id))+1;
              const idx=next.findIndex(r=>r.id===copy.id);
              if(idx<0) next.push(copy); else next[idx]=copy;
              return copy;
            });
            window.__qaRows=next;
            return {data:saved.slice(0,window.__qaLimiteRetorno || saved.length),error:null,count:saved.length};
          }
          if(this.columns==='plano') return window.__qaSemPlano
            ? {data:null,error:{code:'42703',message:'column base_fatores.plano does not exist'}}
            : {data:[],error:null};
          if(this.columns==='grupo_fator') return window.__qaSemVinculos
            ? {data:null,error:{code:'42703',message:'column base_fatores.grupo_fator does not exist'}}
            : {data:[],error:null};
          if(this.columns==='data') return window.__qaSemData
            ? {data:null,error:{code:'42703',message:'column base_fatores.data does not exist'}}
            : {data:[],error:null};
          window.__qaRanges.push([this.first,this.last]);
          const snapshot=structuredClone(window.__qaRows);
          if(window.__qaAtraso) await new Promise(r=>setTimeout(r,window.__qaAtraso));
          if(window.__qaFalhaLeitura) return {data:null,error:{code:'42501',message:'Permissão negada'}};
          return {data:snapshot.slice(this.first,this.last+1),error:null};
        };
        return run().then(resolve,reject);
      }
    };
    return query;
  }
};
"""


def row(id=1, plano='Tabela A', fator=0.02, banco='BancodoBrasil'):
    return dict(id=id, banco=banco, convenio='INSS', data='2026-10-16', tipo='margem',
                prazo=84, fator=fator, taxa=1.7, plano=plano)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)

        def fresh(rows=None, local=FATORES, **flags):
            context = browser.new_context(service_workers='block')
            context.route('**/js/supa/supabaseClient.js', lambda route: route.fulfill(content_type='application/javascript', body=STUB))
            context.route('https://**/*', lambda route: route.abort())
            context.add_init_script('window.__qaRows=' + json.dumps(rows or []) + ';'
                'window.__qaWrites=[];window.__qaRanges=[];'
                "sessionStorage.setItem('ominidata_user', JSON.stringify({email:'dominicplf@gmail.com'}));"
                "localStorage.setItem('ominidata_base_fatores_v1'," + json.dumps(json.dumps(local)) + ');' +
                ''.join('window.' + name + '=' + json.dumps(value) + ';' for name, value in flags.items()))
            page = context.new_page()
            errors, dialogs = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
            page.goto(base + '/pages/base-fatores.html')
            return context, page, errors, dialogs

        def upload(page, value):
            page.locator('#uploadBaseFile').set_input_files(dict(
                name='fatores.json', mimeType='application/json', buffer=json.dumps(value).encode()))
            expect(page.locator('#uploadBaseBtn')).to_be_enabled()

        context, page, errors, dialogs = fresh()
        expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
        expect(page.locator('#bf-slBanco')).to_have_value('BancodoBrasil')
        assert page.evaluate("JSON.parse(localStorage.getItem('ominidata_base_fatores_v1')).BancodoBrasil.seguros.length") == 1
        page.locator('#bf-salvarBanco').click()
        assert 'neste navegador' in dialogs[-1]
        assert not page.evaluate('window.__qaWrites.length')
        assert not errors, errors
        context.close()
        print('PASS: resposta vazia preserva cache/seguros e salvar explicita destino local')

        context, page, errors, dialogs = fresh(__qaSemPlano=True)
        expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
        upload(page, FATORES)
        expect(page.locator('#bf-sync-status')).to_contain_text('coluna "plano"')
        assert not page.evaluate('window.__qaWrites.length')
        assert 'migrations/20261016_base_fatores_plano.sql' in dialogs[-1]
        assert 'sucesso' not in dialogs[-1]
        assert page.evaluate("JSON.parse(localStorage.getItem('ominidata_base_fatores_v1')).BancodoBrasil.tabelas.margem[1].nome") == 'Tabela B'
        assert not errors, errors
        context.close()
        print('PASS: schema antigo bloqueia nomes sem perda; arquivo permanece local e orienta SQL')

        context, page, errors, dialogs = fresh(rows=[row(), row(id=80, banco='Outro banco')])
        expect(page.locator('#bf-sync-status')).to_contain_text('2 fatores consultados')
        upload(page, FATORES)
        expect(page.locator('#bf-sync-status')).to_contain_text('3 fatores confirmados')
        assert page.evaluate('window.__qaRows.length') == 4
        assert page.evaluate("window.__qaRows.find(r=>r.plano==='Tabela A' && r.banco==='BancodoBrasil').id") == 1
        assert page.evaluate('window.__qaWrites.length') == 1
        assert page.evaluate('window.__qaWrites[0].options') == dict(count='exact')
        assert page.evaluate('window.__qaWrites[0].method') == 'insert'
        assert page.evaluate("window.__qaWrites.every(w=>w.rows.every(r=>!Object.hasOwn(r,'id')))")
        upload(page, FATORES)
        expect(page.locator('#bf-sync-status')).to_contain_text('3 fatores confirmados')
        assert page.evaluate('window.__qaRows.length') == 4
        assert page.evaluate('window.__qaWrites.length') == 1
        assert page.evaluate("JSON.parse(localStorage.getItem('ominidata_base_fatores_v1')).BancodoBrasil.seguros.length") == 1
        assert not errors, errors
        context.close()
        print('PASS: INSERT sem ID, reenvio igual sem gravar de novo, preserva outros bancos/IDs e seguros locais')

        context, page, errors, dialogs = fresh(rows=[row(fator=0.01), row(id=80, banco='Outro banco')])
        expect(page.locator('#bf-sync-status')).to_contain_text('2 fatores consultados')
        upload(page, FATORES)
        expect(page.locator('#bf-sync-status')).to_contain_text('3 fatores confirmados')
        assert page.evaluate('window.__qaRows.length') == 4
        writes = page.evaluate('window.__qaWrites')
        assert [w['method'] for w in writes] == ['update', 'insert'], writes
        assert writes[0]['filters'] == [['id', 1]]
        assert writes[0]['rows'] == [dict(fator=0.02, taxa=1.7)]
        assert all('id' not in r for w in writes for r in w['rows'])
        assert page.evaluate('window.__qaRows.find(r=>r.id===1).fator') == 0.02
        assert page.evaluate('window.__qaRows.find(r=>r.id===80).fator') == 0.02
        assert not errors, errors
        context.close()
        print('PASS: banco com ID GENERATED ALWAYS aceita UPDATE por filtro e INSERT sem ID no mesmo envio')

        context, page, errors, dialogs = fresh(rows=[row(fator=0.01)], __qaAtualizacaoInvisivel=True)
        expect(page.locator('#bf-sync-status')).to_contain_text('1 fatores consultados')
        upload(page, FATORES)
        expect(page.locator('#bf-sync-status')).to_contain_text('não confirmou a atualização')
        assert page.evaluate('window.__qaRows.length') == 1
        assert page.evaluate('window.__qaRows[0].fator') == 0.01
        assert page.evaluate('window.__qaWrites.length') == 1
        assert '✅' not in dialogs[-1]
        assert not errors, errors
        context.close()
        print('PASS: UPDATE com zero linhas confirmadas interrompe o envio e não anuncia sucesso')

        context, page, errors, dialogs = fresh(rows=[row(fator=0.01)], __qaFalharNaGravacao=2)
        expect(page.locator('#bf-sync-status')).to_contain_text('1 fatores consultados')
        upload(page, FATORES)
        expect(page.locator('#bf-sync-status')).to_contain_text('Envio parcial: 1 fator com gravação confirmada')
        assert page.evaluate('window.__qaRows.length') == 1
        assert page.evaluate('window.__qaRows[0].fator') == 0.02
        assert 'Envio parcial' in dialogs[-1] and '✅' not in dialogs[-1]
        page.evaluate('window.__qaFalharNaGravacao=0')
        upload(page, FATORES)
        expect(page.locator('#bf-sync-status')).to_contain_text('3 fatores confirmados')
        assert page.evaluate('window.__qaRows.length') == 3
        assert page.evaluate('window.__qaRows.find(r=>r.id===1).fator') == 0.02
        assert not errors, errors
        context.close()
        print('PASS: falha após UPDATE informa envio parcial; reenvio conclui sem duplicar nem trocar ID')

        context, page, errors, dialogs = fresh(rows=[row()], __qaFalhaEnvio=True)
        expect(page.locator('#bf-sync-status')).to_contain_text('1 fatores consultados')
        upload(page, FATORES)
        expect(page.locator('#bf-sync-status')).to_contain_text('permissão')
        assert page.evaluate('window.__qaRows.length') == 1
        assert 'confirmar o envio' in dialogs[-1] and '✅' not in dialogs[-1]
        assert not errors, errors
        context.close()
        print('PASS: falha de permissão não apaga dados nem anuncia sucesso')

        for invalid in [{}, [], {'Banco': {'fatores': {'inss': []}}},
                        {'Banco': {'fatores': {'2026-02-30': {'margem': []}}}},
                        {'Banco': {'fatores': {'2026-10-16': {'margem': [dict(prazo=84, fator=0)]}}}}]:
            context, page, errors, dialogs = fresh()
            expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
            upload(page, invalid)
            expect(page.locator('#bf-sync-status')).to_contain_text('Não foi possível confirmar')
            assert not page.evaluate('window.__qaWrites.length')
            assert page.evaluate("Object.keys(JSON.parse(localStorage.getItem('ominidata_base_fatores_v1')))") == ['BancodoBrasil']
            assert not errors, errors
            context.close()
        print('PASS: JSON vazio, estrutura incompatível, data e fator inválidos rejeitados antes de gravar')

        legacy = {'Banco legado': {'fatores': {'2026-10-16': {'margem': [dict(prazo=84, fator='0,02', taxa='1,70%')]}}}}
        context, page, errors, dialogs = fresh(__qaSemPlano=True)
        expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
        upload(page, legacy)
        expect(page.locator('#bf-sync-status')).to_contain_text('1 fatores confirmados')
        saved = page.evaluate('window.__qaRows[0]')
        assert saved['fator'] == 0.02 and saved['taxa'] == 1.7 and 'plano' not in saved
        assert not errors, errors
        context.close()
        print('PASS: arquivos sem nome de tabela funcionam no schema antigo; decimais pt-BR normalizados')

        context, page, errors, dialogs = fresh(__qaFalhaLeitura=True)
        expect(page.locator('#bf-sync-status')).to_contain_text('permissão')
        expect(page.locator('#bf-slBanco')).to_have_value('BancodoBrasil')
        assert not errors, errors
        context.close()
        print('PASS: erro de leitura preserva dados e é mostrado ao usuário')

        context, page, errors, dialogs = fresh(rows=[row()], __qaAtraso=1200)
        page.locator('#bf-salvarBanco').click()
        expect(page.locator('#bf-sync-status')).to_contain_text('consulta em segundo plano', timeout=5000)
        assert not errors, errors
        context.close()
        print('PASS: consulta atrasada não sobrescreve alterações feitas durante carregamento')

        context, page, errors, dialogs = fresh()
        expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
        result = page.evaluate("""async () => {
          window.__qaRows=Array.from({length:1001},(_,i)=>({id:i+1}));
          window.__qaRanges=[];
          const api=await import('../js/api/baseFatoresApi.js');
          return {count:(await api.carregarFatoresRemotos()).length,ranges:window.__qaRanges};
        }""")
        assert result == dict(count=1001, ranges=[[0, 999], [1000, 1999]]), result
        assert not errors, errors
        context.close()
        print('PASS: paginação lê mais de 1000 registros sem truncar a base')

        context, page, errors, dialogs = fresh()
        expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
        result = page.evaluate("""async () => {
          const api=await import('../js/api/baseFatoresApi.js');
          const local={Banco:{logo:'banco.png',seguros:[{nome:'Seguro'}],fatores:{
            '2026-10-15':{margem:[{prazo:72,fator:.01,plano:'Antiga'}],cartao:[]},
            '2026-10-16':{margem:[{prazo:84,fator:.02,plano:'A'}],cartao:[]}
          }}};
          const arquivo={Banco:{fatores:{'2026-10-16':{margem:[{prazo:84,fator:.03,plano:'B'}]}}}};
          const merged=api.mesclarArquivoFatores(arquivo,local);
          const legado=api.mesclarFatoresRemotos([{banco:'Banco',data:'2026-10-16',tipo:'margem',
            prazo:84,fator:.02,taxa:1.7}],merged);
          window.__qaSemSessao=true;
          let auth='';
          try { await api.enviarFatoresRemotos(arquivo); } catch(e) { auth=e.message; }
          return {merged,legado,local,auth,writes:window.__qaWrites.length};
        }""")
        assert len(result['merged']['Banco']['fatores']) == 2
        assert len(result['merged']['Banco']['fatores']['margem']) == 3
        assert result['merged']['Banco']['seguros'] == [dict(nome='Seguro')]
        assert result['merged']['Banco']['logo'] == 'banco.png'
        assert len(result['local']['Banco']['fatores']['2026-10-16']['margem']) == 1
        assert len(result['legado']['Banco']['fatores']['margem']) == 3
        assert 'Entre novamente' in result['auth'] and result['writes'] == 0
        assert not errors, errors
        context.close()
        print('PASS: importação parcial unifica datas sem perder tabelas/metadados, legado mantém nome local e sessão ausente não grava')

        context, page, errors, dialogs = fresh()
        expect(page.locator('#bf-sync-status')).to_contain_text('não retornou fatores')
        result = page.evaluate("""async () => {
          const api=await import('../js/api/baseFatoresApi.js');
          window.__qaLimiteRetorno=1000;
          const base={Banco:{fatores:{'2026-10-16':{margem:Array.from({length:1001},(_,i)=>({prazo:i+1,fator:.02}))}}}};
          const result=await api.enviarFatoresRemotos(base);
          return {count:result.quantidade,rows:result.linhas.length,saved:window.__qaRows.length,writes:window.__qaWrites.length};
        }""")
        assert result == dict(count=1001, rows=1001, saved=1001, writes=1), result
        assert not errors, errors
        context.close()
        print('PASS: upload com mais de 1000 fatores é confirmado pela contagem total, sem falso erro por limite de retorno')

        context, page, errors, dialogs = fresh(rows=[row(), row(id=2, plano='Tabela B', fator=0.03)], local={})
        expect(page.locator('#bf-sync-status')).to_contain_text('2 fatores consultados')
        page.goto(base + '/pages/simulador.html')
        expect(page.locator('#sim-base-status')).to_contain_text('consultados no Supabase')
        page.locator('#slBanco').select_option('BancodoBrasil')
        page.locator('#slOrigemFator').select_option('tabela')
        expect(page.locator('#slTabela option')).to_have_count(2)
        assert 'Tabela A' in page.locator('#slTabela').inner_text()
        assert 'Tabela B' in page.locator('#slTabela').inner_text()
        assert not errors, errors
        context.close()
        print('PASS: Base de Fatores e Simulador compartilham fonte remota e distinguem tabelas do mesmo prazo')

        corrompido = row()
        corrompido['data'] = None
        context, page, errors, dialogs = fresh(rows=[corrompido])
        expect(page.locator('#bf-sync-status')).to_contain_text('1 fatores consultados')
        expect(page.locator('#bf-slBanco')).to_have_value('BancodoBrasil')
        page.goto(base + '/pages/simulador.html')
        expect(page.locator('#sim-base-status')).to_contain_text('consultados no Supabase')
        page.locator('label:has(#modoParcela)').click()
        page.locator('#inpValorDesejado').fill('5000')
        page.locator('#inpFatorManual').fill('0,02')
        expect(page.locator('#resParcela')).to_contain_text('100,00')
        assert not errors, errors
        context.close()
        print('PASS: registro remoto sem data é aceito e não derruba páginas nem apaga o cache')
        browser.close()
    server.shutdown()


if __name__ == '__main__':
    main()

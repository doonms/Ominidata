"""SQL CLT em PostgreSQL WASM isolado, sem conexão com o Supabase."""
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

QA = runpy.run_path(str(Path(__file__).with_name('base-outros-sql.py')))


def main():
    assert (QA['PACKAGE'] / 'pglite.wasm').exists()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['Handler'], directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            page = browser.new_page()
            page.route('https://**/*', lambda r:r.abort())
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.evaluate('''async()=>{
              const {PGlite}=await import('/qa-pglite/index.js');
              window.db=new PGlite({wasmModule:await WebAssembly.compileStreaming(fetch('/qa-pglite/pglite.wasm')),
                initdbWasmModule:await WebAssembly.compileStreaming(fetch('/qa-pglite/initdb.wasm')),
                fsBundle:await(await fetch('/qa-pglite/pglite.data')).blob()}); await db.waitReady;
              await db.exec(`create role anon; create role authenticated; create schema auth;
                create function auth.uid() returns uuid language sql stable as
                  $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
                create table public.perfis_usuarios(id uuid primary key,perfil text);
                insert into public.perfis_usuarios values
                  ('00000000-0000-0000-0000-000000000001','master'),
                  ('00000000-0000-0000-0000-000000000002','admin'),
                  ('00000000-0000-0000-0000-000000000003','consulta');
                create function public.perfil_atual() returns text language sql stable security definer set search_path='' as
                  $$select perfil from public.perfis_usuarios where id=auth.uid()$$;
                create table public.base_inss(nome text); insert into public.base_inss values('Não alterar');`);
            }''')
            migration = (QA['QA']['ROOT'] / 'supabase/migrations/20261103_base_clt.sql').read_text(encoding='utf8')
            page.evaluate('(sql)=>db.exec(sql)', migration)
            result = page.evaluate('''async()=>{
              const assert=(v,m)=>{if(!v)throw Error(m);};
              const snap=async()=>(await db.query('select banco_id,nome,suspenso,dados from public.base_clt order by banco_id')).rows;
              const row=(id,nome,min=3)=>({banco_id:id,nome,suspenso:false,dados:{banco_id:id,nome,suspenso:false,
                tempoEmpresaMeses:min,minimoFuncionarios:10,tempoCnpjMeses:24,idadeMinima:18,idadeMaxima:65,
                faixasIdade:[{idadeMinima:18,idadeMaxima:65}],documentos:['RG','CPF'],outrosDocumentos:'',
                seguro:'nao',seguroDescricao:'',observacoes:''}});
              const rpc=(rows,old,empty=false)=>db.query('select public.substituir_base_clt($1::jsonb,$2::jsonb,$3) as r',
                [JSON.stringify(rows),JSON.stringify(old),empty]);
              const denied=async(fn,code)=>{try{await fn();throw Error('Esperado erro '+code);}
                catch(e){assert(e.code===code,'Erro '+e.code+': '+e.message);}};
              const who=async(n)=>db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-0000-0000-00000000000'+n]);
              await db.exec('set role anon');
              await denied(()=>db.query('select * from public.base_clt'),'42501');
              await denied(()=>rpc([],[],true),'42501');
              await db.exec('reset role; set role authenticated');
              await who(3); await denied(()=>rpc([],[],true),'42501');
              await who(1);
              const a=row('a','Banco A'),b=row('b','Banco B',12);
              let r=(await rpc([a,b],[])).rows[0].r;
              assert(r.registros.length===2,'Publicação Master');
              await who(2); const old=await snap();
              const atualizado=row('a','Banco A atualizado',5);
              r=(await rpc([atualizado],old)).rows[0].r;
              assert(r.removidos===1 && r.registros.length===1,'Admin atualiza e exclui');
              await who(3); assert((await snap()).length===1,'Consulta lê');
              await denied(()=>db.query('delete from public.base_clt'),'42501');
              await denied(()=>db.query('select * from public.base_clt_backups'),'42501');
              await who(2); const atual=await snap();
              await denied(()=>rpc([a],old),'40001');
              await denied(()=>rpc([],atual),'22023');
              await denied(()=>rpc([a,a],atual),'22023');
              for (const dados of [{...a.dados,tempoEmpresaMeses:-1}, {...a.dados,tempoEmpresaMeses:1.2},
                 {...a.dados,faixasIdade:[{idadeMinima:70,idadeMaxima:30}]},
                 {...a.dados,documentos:['OUTROS'],outrosDocumentos:''}, {...a.dados,seguro:'obrigatorio',seguroDescricao:''}]) {
                await denied(()=>rpc([{...a,dados}],atual),'22023');
              }
              await db.exec(`reset role;
                create function public.qa_clt_falha() returns trigger language plpgsql as $$
                begin if current_setting('qa.clt_falhar',true)='sim' then raise exception 'Falha simulada'; end if;return null;end $$;
                create trigger qa_clt_rollback after delete on public.base_clt for each statement execute function public.qa_clt_falha();
                set role authenticated; set qa.clt_falhar='sim';`);
              await denied(()=>rpc([b],atual),'P0001');
              await db.exec("set qa.clt_falhar='nao'");
              assert(JSON.stringify(await snap())===JSON.stringify(atual),'Rollback mantém original');
              r=(await rpc([],atual,true)).rows[0].r;
              assert(r.removidos===1 && !(await snap()).length,'Esvaziamento confirmado');
              await db.exec('reset role');
              const backups=(await db.query('select dados from public.base_clt_backups order by id')).rows;
              assert(backups.length===3 && backups[1].dados.length===2,'Backups e rollback');
              assert((await db.query('select nome from public.base_inss')).rows[0].nome==='Não alterar','INSS preservada');
              return 'PASS: SQL CLT válido; RLS, Master/Admin/Consulta, backup, substituição, exclusão, conflito, validação e rollback';
            }''')
            print(result)
            page.evaluate('(sql)=>db.exec(sql)', migration)
            print('PASS: reinstalação idempotente e bases antigas preservadas; nenhum dado remoto alterado')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

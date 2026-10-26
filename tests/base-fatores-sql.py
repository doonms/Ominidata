"""PostgreSQL isolado (PGlite): autorização, publicação atômica, exclusões e rollback."""
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

QA = runpy.run_path(str(Path(__file__).with_name('base-outros-sql.py')))


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['Handler'], directory=str(QA['QA']['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            page = browser.new_page()
            page.route('https://**/*', lambda r: r.abort())
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.evaluate("""async()=>{
              const {PGlite}=await import('/qa-pglite/index.js');
              window.db=new PGlite({
                wasmModule:await WebAssembly.compileStreaming(fetch('/qa-pglite/pglite.wasm')),
                initdbWasmModule:await WebAssembly.compileStreaming(fetch('/qa-pglite/initdb.wasm')),
                fsBundle:await(await fetch('/qa-pglite/pglite.data')).blob()
              });await db.waitReady;
              await db.exec(`create role anon;create role authenticated;create schema auth;
                create function auth.uid() returns uuid language sql stable as
                  $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
                create function public.pode_editar_bases() returns boolean language sql stable as
                  $$select current_setting('qa.perfil',true) in ('master','admin')$$;
                create table public.base_fatores(id bigint generated always as identity primary key,
                  banco text not null,convenio text,tipo text not null,prazo integer not null,
                  fator numeric not null,taxa numeric,data date not null);
                grant usage on schema auth to authenticated;
                grant select on public.base_fatores to authenticated;
                create function public.qa_falhar() returns trigger language plpgsql as $$begin
                  if current_setting('qa.falhar',true)='sim' then raise exception 'Falha de teste';end if;
                  return null;end;$$;
                create trigger qa_rollback after delete on public.base_fatores
                  for each statement execute function public.qa_falhar();`);
            }""")
            migration = (QA['QA']['ROOT'] / 'supabase/migrations/20261026_base_fatores_sincronizacao.sql').read_text(encoding='utf-8')
            page.evaluate('(sql)=>db.exec(sql)', migration)
            result = page.evaluate("""async()=>{
              const assert=(v,m)=>{if(!v)throw Error(m);};
              const denied=async(fn,code)=>{try{await fn();throw Error('Esperado '+code);}
                catch(e){assert(e.code===code,e.code+' '+e.message);}};
              const snap=async()=> (await db.query("select coalesce(jsonb_agg(to_jsonb(b) order by b.id::text),'[]'::jsonb) registros from public.base_fatores b where coalesce(convenio,'INSS')='INSS'")).rows[0].registros;
              const rpc=async(rows,previous,empty=false)=>(await db.query(
                'select public.substituir_base_fatores($1::jsonb,$2::jsonb,$3) resultado',
                [JSON.stringify(rows),JSON.stringify(previous),empty])).rows[0].resultado;
              const row=(plano,fator=.02,prazo=84)=>({banco:'Banco',convenio:'INSS',tipo:'margem',prazo,
                fator,taxa:null,plano,grupo_fator:null,publico_assinatura:'todos',publico_invalidez:'todos'});
              await db.exec('set role authenticated');
              await denied(()=>rpc([],[],true),'42501');
              await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);set qa.perfil='consulta'");
              await denied(()=>rpc([],[],true),'42501');
              await db.exec("set qa.perfil='admin'");
              await denied(()=>db.query('select * from public.base_fatores_backups'),'42501');
              let r=await rpc([row('A'),row('B')],[]), previous=await snap();
              assert(r.registros.length===2,'Publicação inicial');
              const id=previous.find(r=>r.plano==='A').id;
              r=await rpc([row('A',.03)],previous);
              assert(r.removidos===1 && r.registros[0].id===id,'Exclui B e preserva ID de A');
              assert(r.registros[0].fator==='0.03'||Number(r.registros[0].fator)===.03,'Atualiza A');
              await db.exec('reset role');
              assert((await db.query('select dados from public.base_fatores_backups where id=$1',[r.backup_id])).rows[0].dados.length===2,'Backup');
              await db.exec("insert into public.base_fatores(banco,convenio,tipo,prazo,fator,data)values('Outro','SIAPE','margem',12,.05,'1970-01-01')");
              previous=await snap();
              const n=Number((await db.query('select count(*) n from public.base_fatores_backups')).rows[0].n);
              await db.exec('set role authenticated');
              await denied(()=>rpc([row('A')],[]),'40001');
              await denied(()=>rpc([],previous),'22023');
              await denied(()=>rpc([row('A'),row('A')],previous),'22023');
              await denied(()=>rpc([row('A',0)],previous),'22023');
              await denied(()=>rpc([{...row('A'),id:4}],previous),'22023');
              await denied(()=>rpc([{...row('A'),publico_assinatura:'invalido'}],previous),'22023');
              await db.exec("set qa.falhar='sim'");
              await denied(()=>rpc([row('C')],previous),'P0001');
              await db.exec("set qa.falhar='nao';reset role");
              assert(JSON.stringify(await snap())===JSON.stringify(previous),'Rollback total');
              assert(Number((await db.query('select count(*) n from public.base_fatores_backups')).rows[0].n)===n,'Backup revertido');
              await db.exec("set role authenticated;set qa.perfil='master'");
              r=await rpc([],previous,true);
              assert(r.registros.length===0&&r.removidos===1,'Vazia confirmada');
              assert((await db.query("select * from public.base_fatores where convenio='SIAPE'")).rows.length===1,'Outro convênio preservado');
              await db.exec('reset role;alter table public.base_fatores drop column data;set role authenticated');
              r=await rpc([row('Sem data')],[]);
              assert(r.registros.length===1,'Schema sem data');
              await db.exec('reset role');
              return 'PASS: SQL real, Admin/Master permitidos, Consulta/anônimo negados, backups privados, identidade automática, IDs preservados, exclusões, concorrência, validação, rollback total, vazio explícito, outros convênios preservados e schemas com/sem data';
            }""")
            print(result)
            page.evaluate('(sql)=>db.exec(sql)', migration)
            print('PASS: migração idempotente; nenhum acesso ao Supabase real')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

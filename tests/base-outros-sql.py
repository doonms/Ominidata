"""Executa a migração em PostgreSQL WASM isolado. Não acessa o Supabase real.

Requer Chrome/Playwright e @electric-sql/pglite extraído em
%TEMP%/ominidata-outros-sql-qa/package (ou OMINIDATA_PGLITE_DIR).
"""
import os
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir
from threading import Thread
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
PACKAGE = Path(os.environ.get('OMINIDATA_PGLITE_DIR', str(Path(gettempdir()) / 'ominidata-outros-sql-qa/package'))) / 'dist'


class Handler(QA['QuietHandler']):
    def translate_path(self, path):
        path = unquote(urlparse(path).path)
        if path.startswith('/qa-pglite/'):
            target = (PACKAGE / path[len('/qa-pglite/'):]).resolve()
            if target.is_relative_to(PACKAGE.resolve()):
                return str(target)
        return super().translate_path(path)


def main():
    assert (PACKAGE / 'pglite.wasm').exists(), 'Instale o pacote local de teste indicado no cabeçalho.'
    server = ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome',headless=True)
            page = browser.new_page()
            page.route('https://**/*',lambda r:r.abort())
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.evaluate("""async () => {
              const {PGlite}=await import('/qa-pglite/index.js');
              window.db=new PGlite({
                wasmModule:await WebAssembly.compileStreaming(fetch('/qa-pglite/pglite.wasm')),
                initdbWasmModule:await WebAssembly.compileStreaming(fetch('/qa-pglite/initdb.wasm')),
                fsBundle:await (await fetch('/qa-pglite/pglite.data')).blob()
              });await db.waitReady;
            }""")
            page.evaluate("""async () => db.exec(`
              create role anon; create role authenticated;
              create schema auth;
              create table auth.users(id uuid primary key,email text);
              insert into auth.users values
                ('00000000-0000-0000-0000-000000000001','dominicplf@gmail.com'),
                ('00000000-0000-0000-0000-000000000002','usuario@example.test');
              create function auth.uid() returns uuid language sql stable as
                $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
              create table public.base_outros_convenios(
                id bigint generated always as identity primary key,
                banco_id text unique not null,nome text not null,suspenso boolean not null,dados jsonb not null);
              grant select on public.base_outros_convenios to authenticated;
              create function public.qa_falhar() returns trigger language plpgsql as $$
              begin
                if current_setting('qa.falhar_delete',true)='sim' then raise exception 'Falha após exclusão'; end if;
                return null;
              end;$$;
              create trigger qa_rollback after delete on public.base_outros_convenios
                for each statement execute function public.qa_falhar();
            `)""")
            migration=(QA['ROOT'] / 'supabase/migrations/20261021_base_outros_substituicao.sql').read_text(encoding='utf-8')
            page.evaluate('(sql)=>db.exec(sql)',migration)
            result=page.evaluate("""async () => {
              const assert=(v,m)=>{if(!v)throw Error(m);};
              const snap=async()=> (await db.query("select banco_id,nome,suspenso,dados from public.base_outros_convenios order by banco_id")).rows;
              const row=(id,nome)=>({banco_id:id,nome,suspenso:false,dados:{banco_id:id,nome,suspenso:false,convenios:[]}});
              const rpc=(rows,previous,empty=false)=>db.query(
                'select public.substituir_base_outros_convenios($1::jsonb,$2::jsonb,$3) as resultado',
                [JSON.stringify(rows),JSON.stringify(previous),empty]);
              const denied=async(fn,code)=>{try{await fn();throw Error('Era esperado erro '+code);}
                catch(e){assert(e.code===code,'Código inesperado: '+e.code+' '+e.message);}};
              const backupCount=async()=>Number((await db.query('select count(*) as n from public.base_outros_convenios_backups')).rows[0].n);
              await db.exec("set role authenticated");
              await denied(()=>rpc([],[],true),'42501');
              await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-0000-0000-000000000002']);
              await denied(()=>rpc([],[],true),'42501');
              await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-0000-0000-000000000001']);
              await denied(()=>db.query('select * from public.base_outros_convenios_backups'),'42501');
              const a=row('a','Banco A'), b=row('b','Banco B');
              let res=(await rpc([a,b],[])).rows[0].resultado;
              assert(res.registros.length===2 && res.removidos===0,'Criar base');
              let previous=await snap();
              const atualizado=row('a','Banco A atualizado');
              res=(await rpc([atualizado],previous)).rows[0].resultado;
              assert(res.removidos===1 && (await snap()).length===1,'Substituir/remove banco');
              await db.exec('reset role');
              const backup=(await db.query('select dados from public.base_outros_convenios_backups where id=$1',[res.backup_id])).rows[0].dados;
              assert(backup.length===2,'Backup contém banco excluído');
              const n=await backupCount();
              await db.exec('set role authenticated');
              previous=await snap();
              await denied(()=>rpc([a],[]),'40001');
              await denied(()=>rpc([],previous),'22023');
              await denied(()=>rpc([a,a],previous),'22023');
              await denied(()=>rpc([row('a','Mesmo'),row('z','Mesmo')],previous),'22023');
              await db.exec("set qa.falhar_delete='sim'");
              await denied(()=>rpc([b],previous),'P0001');
              await db.exec("set qa.falhar_delete='nao'; reset role");
              assert(JSON.stringify(await snap())===JSON.stringify(previous),'Rollback de update e delete');
              assert(await backupCount()===n,'Backup também reverte na falha');
              await db.exec('set role authenticated');
              res=(await rpc([],previous,true)).rows[0].resultado;
              assert(res.removidos===1 && res.registros.length===0 && (await snap()).length===0,'Esvaziamento explícito');
              await db.exec('reset role');
              return 'PASS: PostgreSQL real em memória: SQL válido, autorização, backups privados, substituição/exclusão, concorrência, validação, rollback após DELETE e esvaziamento explícito';
            }""")
            print(result)
            # Reinstalar o SQL não modifica o conteúdo já publicado.
            page.evaluate('(sql)=>db.exec(sql)',migration)
            print('PASS: migração idempotente; nenhuma conexão ou alteração no Supabase real')
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

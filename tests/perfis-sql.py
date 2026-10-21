"""PostgreSQL WASM isolado: nunca conecta ao Supabase real."""
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

SQL_QA=runpy.run_path(str(Path(__file__).with_name('base-outros-sql.py')))
QA=SQL_QA['QA']


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(SQL_QA['Handler'],directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            page=browser.new_page()
            page.route('https://**/*',lambda r:r.abort())
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.evaluate("""async()=>{
              const {PGlite}=await import('/qa-pglite/index.js');
              window.db=new PGlite({
                wasmModule:await WebAssembly.compileStreaming(fetch('/qa-pglite/pglite.wasm')),
                initdbWasmModule:await WebAssembly.compileStreaming(fetch('/qa-pglite/initdb.wasm')),
                fsBundle:await (await fetch('/qa-pglite/pglite.data')).blob()
              });await db.waitReady;
              await db.exec(`
                create role anon;create role authenticated;create role service_role bypassrls;
                create schema auth;
                grant usage on schema auth to authenticated,anon;
                create table auth.users(id uuid primary key,email text);
                insert into auth.users values
                  ('00000000-0000-0000-0000-000000000001','dominicplf@gmail.com'),
                  ('00000000-0000-0000-0000-000000000002','admin@example.test'),
                  ('00000000-0000-0000-0000-000000000003','consulta@example.test');
                create function auth.uid() returns uuid language sql stable as
                  $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
                create table public.base_fatores(id bigint generated always as identity primary key,nome text);
                create table public.base_inss(id bigint generated always as identity primary key,nome text);
                create table public.base_outros_convenios(
                  id bigint generated always as identity primary key,
                  banco_id text unique not null,nome text not null,suspenso boolean not null,dados jsonb not null);
                grant all on public.base_fatores,public.base_inss,public.base_outros_convenios to anon,authenticated;
                create policy politica_antiga_aberta on public.base_fatores for all to authenticated using(true) with check(true);
                create policy politica_antiga_aberta on public.base_inss for all to authenticated using(true) with check(true);
                create policy politica_antiga_aberta on public.base_outros_convenios for all to authenticated using(true) with check(true);
                insert into public.base_fatores(nome) values ('Fator preservado');
                insert into public.base_inss(nome) values ('INSS preservado');
              `);
            }""")
            migrations=QA['ROOT']/'supabase/migrations'
            for name in ['20261021_perfis_inicial.sql','20261021_base_outros_substituicao.sql','20261021_perfis_permissoes.sql']:
                page.evaluate('(sql)=>db.exec(sql)',(migrations/name).read_text(encoding='utf-8'))
            page.evaluate("""async()=>db.exec(`
              alter table auth.users add column created_at timestamptz default now();
              alter table auth.users add column last_sign_in_at timestamptz;
            `)""")
            page.evaluate('(sql)=>db.exec(sql)',(migrations/'20261021_usuarios_master.sql').read_text(encoding='utf-8'))
            result=page.evaluate("""async()=>{
              const assert=(v,m)=>{if(!v)throw Error(m);};
              const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
              const denied=async(fn)=>{try{await fn();throw Error('Era esperado bloqueio');}
                catch(e){assert(e.code==='42501','Erro inesperado: '+e.code+' '+e.message);}};
              const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
              const login=async(n)=>{
                await db.exec('reset role');
                await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);
                await db.exec(n?'set role authenticated':'set role anon');
              };
              // Admin definido pelo proprietário no teste; cliente não tem acesso de escrita.
              await db.query("update public.perfis_usuarios set perfil='admin' where id=$1",[uid(2)]);
              assert((await rows("select tablename from pg_tables where schemaname='public' and tablename in ('base_fatores','base_inss','base_outros_convenios') and rowsecurity")).length===3,'RLS ativo');
              assert((await rows("select * from pg_policies where policyname='politica_antiga_aberta'")).length===0,'Sem políticas permissivas antigas');
              for(const [n,role] of [[1,'master'],[2,'admin'],[3,'consulta']]) {
                await login(n);
                assert((await rows('select public.perfil_atual() as perfil'))[0].perfil===role,'Perfil do chamador');
                const profile=await rows('select id,perfil from public.perfis_usuarios');
                assert(profile.length===1 && profile[0].id===uid(n),'Só próprio perfil');
                await denied(()=>db.query("update public.perfis_usuarios set perfil='master'"));
                await denied(()=>db.query("insert into public.perfis_usuarios(id,perfil) values($1,'master')",[uid(n)]));
                for(const table of ['base_fatores','base_inss']) {
                  const before=await rows(`select * from public.${table} order by id`);
                  assert(before.length===1,'Leitura autenticada preservada');
                  await denied(()=>db.exec(`truncate public.${table}`));
                  if(role==='consulta') {
                    await denied(()=>db.query(`insert into public.${table}(nome) values ('Indevido')`));
                    await db.exec(`update public.${table} set nome='Indevido';delete from public.${table}`);
                    assert(JSON.stringify(await rows(`select * from public.${table} order by id`))===JSON.stringify(before),'Consulta não altera/exclui');
                  } else {
                    const id=(await rows(`insert into public.${table}(nome) values ('Permitido') returning id`))[0].id;
                    await db.query(`update public.${table} set nome='Alterado' where id=$1`,[id]);
                    assert((await rows(`select nome from public.${table} where id=$1`,[id]))[0].nome==='Alterado','Editor atualiza');
                    await db.query(`delete from public.${table} where id=$1`,[id]);
                  }
                }
              }
              await login(3);
              await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:'dominicplf@gmail.com',user_metadata:{perfil:'master'}})]);
              assert((await rows('select public.pode_editar_bases() as pode'))[0].pode===false,'Metadata não promove');
              const bank={banco_id:'a',nome:'Banco A',suspenso:false,dados:{banco_id:'a',nome:'Banco A',suspenso:false,convenios:[]}};
              const rpc=(next,previous,empty=false)=>db.query('select public.substituir_base_outros_convenios($1::jsonb,$2::jsonb,$3) as resultado',[JSON.stringify(next),JSON.stringify(previous),empty]);
              const snap=()=>rows('select banco_id,nome,suspenso,dados from public.base_outros_convenios order by banco_id');
              await denied(()=>rpc([bank],[]));
              await denied(()=>db.query("insert into public.base_outros_convenios(banco_id,nome,suspenso,dados) values ('x','Indevido',false,'{}')"));
              await login(2);
              let res=(await rpc([bank],[])).rows[0].resultado;
              assert(res.registros.length===1 && res.backup_id,'Admin publica com backup');
              await denied(()=>db.query('select * from public.base_outros_convenios_backups'));
              await login(3);
              const before=await snap();
              await db.exec("update public.base_outros_convenios set nome='Indevido';delete from public.base_outros_convenios");
              assert(JSON.stringify(await snap())===JSON.stringify(before),'Consulta não altera Outros');
              await login(1);
              res=(await rpc([],before,true)).rows[0].resultado;
              assert(res.removidos===1,'Master substitui/exclui com confirmação');
              // O e-mail não é uma chave de autorização após a implantação.
              await db.exec('reset role');
              await db.query("update auth.users set email='novo-master@example.test' where id=$1",[uid(1)]);
              await login(1);
              assert((await rows('select public.pode_editar_bases() as pode'))[0].pode,'Master por ID estável');
              // Conta criada fora do provisionamento não ganha acesso automaticamente.
              await db.exec('reset role');
              await db.query('insert into auth.users(id,email) values($1,$2)',[uid(4),'sem-perfil@example.test']);
              await login(4);
              assert((await rows('select * from public.base_fatores')).length===0,'Sem perfil não lê bases');
              await denied(()=>rpc([],[],true));
              await login(0);
              await denied(()=>db.query('select * from public.base_fatores'));
              await denied(()=>db.query('select * from public.base_inss'));
              await denied(()=>db.query('select * from public.base_outros_convenios'));
              await denied(()=>db.query('select * from public.perfis_usuarios'));
              await denied(()=>rpc([],[],true));
              await db.exec('reset role');
              return 'PASS: RLS das três bases, Master/Admin gravam, Consulta só lê, visitante e conta sem perfil bloqueados, perfis privados, metadata ignorada, RPC autoriza Admin/Master e mantém backups privados';
            }""")
            print(result)
            print(page.evaluate("""async()=>{
              const assert=(v,m)=>{if(!v)throw Error(m);};
              const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
              const login=async(n)=>{
                await db.exec('reset role');
                await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);
                await db.exec(n?'set role authenticated':'set role anon');
              };
              const denied=async(fn,code='42501')=>{try{await fn();throw Error('Era esperado bloqueio');}
                catch(e){assert(e.code===code,e.code+' '+e.message);}};
              const list=(search='',limit=50,offset=0)=>db.query('select * from public.listar_usuarios($1,$2,$3)',[search,limit,offset]);
              const assign=(n,role)=>db.query('select public.definir_perfil_usuario($1,$2) as resultado',[uid(n),role]);
              for(const n of [0,2,3,4]) {
                await login(n);
                await denied(()=>list());
                await denied(()=>assign(2,'admin'));
                await denied(()=>assign(n||4,'master'));
              }
              await login(1);
              let accounts=(await list()).rows;
              assert(accounts.length===4 && Number(accounts[0].total)===4,'Master lista contas');
              assert(accounts.find(u=>u.id===uid(4)).perfil===null,'Conta sem perfil visível para recuperação');
              assert(Object.keys(accounts[0]).sort().join(',')==='criado_em,email,id,perfil,total,ultimo_acesso','Sem dados secretos');
              assert((await list('CONSULTA@')).rows.length===1,'Busca case insensitive');
              assert((await list('%')).rows.length===0,'Busca literal sem wildcard');
              assert((await list("' OR true --")).rows.length===0,'Busca não injeta SQL');
              assert((await list('',1,1)).rows.length===1,'Paginação');
              await denied(()=>list('',0),'22023');
              await denied(()=>list('',101),'22023');
              await denied(()=>list('',50,-1),'22023');
              await denied(()=>list('x'.repeat(255)),'22023');
              await denied(()=>assign(3,'master'),'22023');
              await denied(()=>assign(1,'consulta'));
              await denied(()=>assign(99,'consulta'),'22023');
              await denied(()=>db.query('insert into auth.users(id,email) values($1,$2)',[uid(9),'indevido@example.test']));
              let result=(await assign(4,'consulta')).rows[0].resultado;
              assert(result.id===uid(4) && result.perfil==='consulta','Finaliza perfil faltante');
              await assign(3,'admin');
              await assign(2,'consulta');
              await login(3);
              assert((await db.query('select public.pode_editar_bases() as pode')).rows[0].pode,'Promoção pelo Master tem efeito');
              await login(2);
              assert(!(await db.query('select public.pode_editar_bases() as pode')).rows[0].pode,'Rebaixamento tem efeito');
              await db.exec('reset role');
              await db.query('insert into auth.users(id,email) values($1,$2)',[uid(5),'outro-master@example.test']);
              await db.query("insert into public.perfis_usuarios(id,perfil) values($1,'master')",[uid(5)]);
              await login(1);
              await denied(()=>assign(5,'admin'));
              await db.exec('reset role');
              return 'PASS: só Master lista/define perfis; sem senhas/tokens; paginação/busca; Admin não promove; Master não altera a própria conta nem outro Master; conta pendente recuperável; perfis novos aplicados às bases';
            }"""))
            page.evaluate('(sql)=>db.exec(sql)',(migrations/'20261021_usuarios_master.sql').read_text(encoding='utf-8'))
            migration=(migrations/'20261021_perfis_permissoes.sql').read_text(encoding='utf-8')
            page.evaluate('(sql)=>db.exec(sql)',migration)
            assert page.evaluate("async()=>(await db.query('select count(*)::integer as n from public.base_fatores')).rows[0].n")==1
            assert page.evaluate("async()=>(await db.query('select count(*)::integer as n from public.base_inss')).rows[0].n")==1
            print('PASS: migração repetível, bases existentes preservadas; nenhuma alteração no Supabase real')
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

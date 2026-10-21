"""Exercita a lógica da Edge Function com clientes injetados, sem Supabase real.

Remove somente as quatro anotações TypeScript das assinaturas para executar
o mesmo corpo no Chrome. Não substitui um teste de implantação no Deno.
"""
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

QA=runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QA['QuietHandler'],directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        source=(QA['ROOT']/'supabase/functions/criar-usuario/index.ts').read_text(encoding='utf-8')
        for old,new in [
            ('import { createClient } from "npm:@supabase/supabase-js@2.118.0";', 'const createClient=()=>{throw Error("Não usar cliente real no teste");};'),
            (': typeof createClient',''),
            (': (key: string) => string | undefined',''),
            ('(req: Request): Promise<Response>','(req)'),
            ('(status: number, body: unknown)','(status, body)')
        ]:
            assert old in source, 'A assinatura mudou: revisar a remoção de tipos do teste.'
            source=source.replace(old,new)
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            page=browser.new_page()
            page.route('https://**/*',lambda r:r.abort())
            page.goto(f'http://127.0.0.1:{server.server_port}/pages/login.html')
            page.evaluate("""async source=>{
              const mod=await import(URL.createObjectURL(new Blob([source],{type:'application/javascript'})));
              window.createHandler=mod.createHandler;
            }""",source)
            result=page.evaluate("""async()=>{
              const assert=(v,m)=>{if(!v)throw Error(m);};
              const uid='00000000-0000-0000-0000-000000000002';
              const masterId='00000000-0000-0000-0000-000000000001';
              const defaults={SUPABASE_URL:'https://qa.example.test',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'secret-test'};
              const payload={email:' Conta@Example.Test ',senha:' senha segura 123 ',perfil:'consulta'};
              const run=async(options={})=>{
                const state={factories:[],creates:[],rpcs:[],tokens:[],updates:[],lookups:[],reauth:[],cleanup:[],profileReads:0};
                const factory=(url,key,config)=>{
                  state.factories.push({url,key,config});
                  if(key==='secret-test') return {
                    from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){
                      return {data:options.noTargetProfile?null:{perfil:options.targetMaster?'master':'consulta'},error:options.targetProfileError?{message:'Offline'}:null};
                    }};return q;},
                    auth:{admin:{async createUser(params){
                    state.creates.push(params);
                    if(options.createThrow)throw Error('secret-test senha segura 123');
                    if(options.createError)return {data:null,error:options.createError};
                    return {data:{user:options.noUser?null:{id:uid,email:params.email}},error:null};
                  },async getUserById(id){
                    state.lookups.push(id);
                    return {data:{user:options.noTarget?null:{id}},error:null};
                  },async updateUserById(id,attrs){
                    state.updates.push({id,attrs});
                    if(options.updateThrow)throw Error('secret-test');
                    return {data:{user:options.noUpdatedUser?null:{id}},error:options.updateError||null};
                  }}}};
                  if(!config.global)return {auth:{
                    async signInWithPassword(credentials){
                      state.reauth.push(credentials);
                      return {data:{user:{id:options.wrongSelf?'outra-conta':masterId}},error:options.reauthError?{message:'Incorreta'}:null};
                    },
                    async signOut(options){state.cleanup.push(options);return {error:null};}
                  }};
                  return {
                    auth:{async getUser(token){
                      state.tokens.push(token);
                      if(options.authThrow)throw Error('secret-test');
                      return {data:{user:token!=='valid'||options.noUserSession?null:{id:masterId,email:'master@example.test',user_metadata:{perfil:'master'}}},error:options.authError?{message:'Falha'}:null};
                    }},
                    from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){
                      state.profileReads++;
                      return {data:{perfil:options.demoted&&state.profileReads>1?'consulta':options.role||'master'},error:options.profileError?{message:'Falha'}:null};
                    }};return q;},
                    async rpc(name,params){
                      state.rpcs.push({name,params});
                      if(name==='listar_usuarios')return {data:[],error:options.setupError?{message:'Ausente'}:null};
                      if(options.assignThrow)throw Error('secret-test senha segura 123');
                      return {data:options.badAssignment?null:{id:params.p_usuario_id,perfil:params.p_perfil},error:options.assignError?{message:'Falha'}:null};
                    }
                  };
                };
                const env={...defaults,...options.env};
                const handler=createHandler(factory,key=>env[key]);
                const method=options.method||'POST';
                const headers={'Content-Type':'application/json','Authorization':'Bearer valid',Origin:'https://ominidata.netlify.app',...options.headers};
                for(const [k,v]of Object.entries(headers))if(v===null)delete headers[k];
                // Request do navegador remove Origin manual; o objeto abaixo
                // reproduz os cabeçalhos recebidos pelo runtime do servidor.
                const req={method,headers:new Headers(headers),
                  text:async()=>(options.raw??JSON.stringify(options.body??payload))};
                const response=await handler(req);
                const text=await response.text();
                assert(!text.includes('secret-test')&&!text.includes('senha segura 123'),'Segredo/senha vazou na resposta');
                assert(response.headers.get('cache-control')==='no-store','Não cachear respostas');
                return {status:response.status,body:text?JSON.parse(text):null,headers:response.headers,state};
              };
              let res=await run({method:'OPTIONS',headers:{Authorization:null}});
              assert(res.status===204 && !res.state.factories.length,'Preflight sem executar cadastro');
              res=await run({headers:{Origin:'https://evil.example'}});
              assert(res.status===403&&!res.state.factories.length&&!res.headers.has('access-control-allow-origin'),'Origem bloqueada');
              assert((await run({headers:{Origin:'null'}})).status===403,'Origem opaca bloqueada');
              assert((await run({method:'GET'})).status===405,'Método bloqueado');
              for(const origin of ['http://127.0.0.1:5500','http://localhost:6000']){
                res=await run({method:'OPTIONS',headers:{Origin:origin}});
                assert(res.status===204 && res.headers.get('access-control-allow-origin')===origin,'CORS local');
              }
              for(const options of [
                {headers:{Authorization:null}},{headers:{Authorization:'Bearer forged'}},
                {noUserSession:true},{authError:true}
              ]) {
                res=await run(options);assert(res.status===401&&!res.state.creates.length,'Sessão inválida');
              }
              for(const role of ['admin','consulta']) {
                res=await run({role});assert(res.status===403&&!res.state.creates.length&&res.state.factories.length===1,'Só Master, mesmo com metadata forjada');
              }
              res=await run({profileError:true});assert(res.status===503&&!res.state.creates.length,'Falha perfil fecha acesso');
              res=await run({setupError:true});assert(res.status===503&&!res.state.creates.length,'SQL ausente não cria conta');
              res=await run({env:{SUPABASE_SERVICE_ROLE_KEY:''}});assert(res.status===503&&!res.state.factories.length,'Configuração ausente');
              for(const options of [
                {raw:'{'},{body:[]},{body:{...payload,perfil:'master'}},
                {body:{...payload,senha:'curta'}},{body:{...payload,email:'inválido'}},
                {body:{...payload,user_metadata:{perfil:'master'}}}
              ]) {
                res=await run(options);assert(res.status===400&&!res.state.creates.length,'Payload inválido bloqueado');
              }
              res=await run({headers:{'Content-Type':'text/plain'}});assert(res.status===415&&!res.state.creates.length,'Exige JSON');
              res=await run({raw:'x'.repeat(4097)});assert(res.status===413&&!res.state.creates.length,'Limite de tamanho');
              for(const perfil of ['admin','consulta']) {
                res=await run({body:{...payload,perfil}});
                assert(res.status===201&&res.body.ok&&res.body.usuario.perfil===perfil,'Cadastro confirmado');
                assert(res.state.creates.length===1&&res.state.creates[0].email==='conta@example.test','Normaliza email e cria uma vez');
                assert(res.state.creates[0].password===payload.senha&&res.state.creates[0].email_confirm===true,'Senha intacta e email confirmado pelo Master');
                assert(!res.state.creates[0].user_metadata&&!res.state.creates[0].app_metadata,'Perfil nunca por metadata');
                assert(res.state.rpcs.map(x=>x.name).join(',')==='listar_usuarios,definir_perfil_usuario','Pré-verifica SQL e atribui perfil via chamador');
                assert(res.state.rpcs[1].params.p_usuario_id===uid,'Somente a conta recém-criada');
                assert(res.state.tokens[0]==='valid','Verifica token no Auth');
              }
              for(const options of [{assignError:true},{assignThrow:true},{badAssignment:true}]) {
                res=await run(options);
                assert(res.status===409&&res.body.code==='PERFIL_PENDENTE'&&res.body.usuario.id===uid&&res.state.creates.length===1,'Falha parcial recuperável sem recriar/apagar conta');
              }
              for(const code of ['email_exists','user_already_exists']) {
                res=await run({createError:{code,message:'secret-test'}});
                assert(res.status===409&&res.body.code==='EMAIL_EXISTENTE'&&res.state.rpcs.length===1,'Duplicado não redefine perfil');
              }
              assert((await run({createError:{code:'weak_password'}})).status===400,'Senha fraca');
              assert((await run({noUser:true})).status===502,'Resposta sem usuário não confirma sucesso');
              assert((await run({createError:{message:'secret-test'}})).status===502,'Não vaza erro interno');
              res=await run({createThrow:true});assert(res.status===503&&res.state.creates.length===1,'Sem reenvio automático após falha ambígua');
              // Usuário sem e-mail visível: cliente e função usam a mesma tradução.
              const ident=await import('/js/auth/identificador.js');
              res=await run({body:{usuario:' Maria.Silva ',senha:payload.senha,perfil:'consulta'}});
              assert(res.status===201&&res.body.usuario.usuario==='maria.silva','Cadastro por usuário normalizado');
              assert(res.state.creates[0].email===ident.emailParaLogin('Maria.Silva'),'Mesma tradução no login/servidor');
              assert(ident.nomeDeAcesso(res.state.creates[0].email)==='maria.silva','Não mostrar endereço técnico');
              assert(ident.emailParaLogin(' MASTER@EXAMPLE.TEST ')==='master@example.test','Contas anteriores mantêm email');
              for(const usuario of ['ab','x'.repeat(33),'márcia','maria silva','maria..silva','.maria','maria.','maria@empresa.test']){
                res=await run({body:{usuario,senha:payload.senha,perfil:'consulta'}});
                assert(res.status===400&&!res.state.creates.length,'Usuário inválido: '+usuario);
              }
              res=await run({body:{...payload,usuario:'maria'}});assert(res.status===400,'Não misturar formatos');
              const reset={acao:'alterar_senha',usuario_id:uid,senha:payload.senha};
              res=await run({body:reset});
              assert(res.status===200&&res.body.senha_alterada&&res.body.usuario_id===uid,'Master altera senha de usuário');
              assert(res.state.updates.length===1&&res.state.updates[0].id===uid,'Só a conta indicada');
              assert(Object.keys(res.state.updates[0].attrs).join(',')==='password'&&res.state.updates[0].attrs.password===payload.senha,'Só senha, preservada exatamente');
              assert(!res.state.creates.length&&!res.state.rpcs.length&&!res.state.reauth.length,'Não recria conta, não muda perfis nem pede senha anterior do usuário');
              for(const role of ['admin','consulta']){
                res=await run({body:reset,role});assert(res.status===403&&!res.state.updates.length,'Só Master altera senha');
              }
              for(const options of [{targetMaster:true},{demoted:true}]){
                res=await run({body:reset,...options});assert(res.status===403&&!res.state.updates.length,'Proteção de Master/revogação antes da escrita');
              }
              assert((await run({body:reset,noTarget:true})).status===404,'Conta inexistente');
              assert((await run({body:reset,targetProfileError:true})).status===503,'Não ignora erro de público alvo');
              assert((await run({body:{...reset,usuario_id:'inválido'}})).status===400,'UUID inválido');
              assert((await run({body:{...reset,senha:'curta'}})).status===400,'Senha fraca local');
              assert((await run({body:{...reset,perfil:'master'}})).status===400,'Reset não aceita alterar papel');
              const own={...reset,usuario_id:masterId,senha_atual:'senha anterior valida'};
              res=await run({body:own,targetMaster:true});
              assert(res.status===200&&res.state.updates[0].id===masterId,'Master muda própria senha com reautenticação');
              assert(res.state.reauth[0].email==='master@example.test'&&res.state.reauth[0].password===own.senha_atual,'Confere senha atual na conta autenticada');
              assert(res.state.cleanup.length===1&&res.state.cleanup[0].scope==='local','Encerra somente sessão temporária de reautenticação');
              res=await run({body:{...own,senha_atual:''},targetMaster:true});assert(res.status===400&&!res.state.updates.length,'Própria conta exige senha atual');
              for(const options of [{reauthError:true},{wrongSelf:true}]){
                res=await run({body:own,targetMaster:true,...options});assert(res.status===403&&!res.state.updates.length,'Não ignora senha atual/ID divergente');
              }
              assert((await run({body:reset,updateError:{code:'weak_password'}})).status===400,'Regra remota de senha');
              assert((await run({body:reset,updateError:{message:'secret-test'}})).status===502,'Erro não vaza informação sensível');
              assert((await run({body:reset,noUpdatedUser:true})).status===502,'Resposta sem confirmação');
              res=await run({body:reset,updateThrow:true});assert(res.status===503&&res.state.updates.length===1,'Sem retry de troca ambígua');
              return 'PASS: Edge isolada: cadastro por email/usuário, validação consistente, reset exclusivo do Master, senha atual na própria conta, outros Masters protegidos, sem mudança de perfil/conta, falhas sem falso sucesso e sem Supabase real';
            }""")
            print(result)
            browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()

import { esc } from '../util.js';

export function getAbaGeralHTML(b, idx, show){
  return `
  <div data-panel="${idx}:geral" style="display:${show?'block':'none'}">

    <!-- Status do banco -->
    <div class="subpanel">
      <h3>Status</h3>
      <div class="checkbox-grid">
        <label><input type="checkbox" data-put="${idx}:suspenso" ${b.suspenso?'checked':''}/> banco suspenso?</label>
      </div>
      <div class="muted" style="margin-top:6px">Se marcado, o banco ficará oculto na Pesquisa, mas permanece salvo na base.</div>
    </div>

    <!-- Bloco 1: Operações -->
    <div class="subpanel">
      <h3>Operações</h3>
      <div class="checkbox-grid">
        <label><input type="checkbox" data-put="${idx}:fazMargem" ${b.fazMargem?'checked':''}/> faz margem?</label>
        <label><input type="checkbox" data-put="${idx}:fazCartao" ${b.fazCartao?'checked':''}/> faz cartão?</label>
        <label><input type="checkbox" data-put="${idx}:fazRefin" ${b.fazRefin?'checked':''}/> faz refin?</label>
        <label><input type="checkbox" data-put="${idx}:fazSaqueComplementar" ${b.fazSaqueComplementar?'checked':''}/> faz saque complementar?</label>
        <label><input type="checkbox" data-put="${idx}:fazPortabilidade" ${b.fazPortabilidade?'checked':''}/> faz portabilidade?</label>
      </div>
    </div>

    <!-- Bloco 2: Perfis aceitos -->
    <div class="subpanel">
      <h3>Perfis aceitos</h3>
      <div class="checkbox-grid">
        <label><input type="checkbox" data-put="${idx}:aceitaClienteNaoAssina" ${b.aceitaClienteNaoAssina?'checked':''}/> aceita cliente não assinante?</label>
        <label><input type="checkbox" data-put="${idx}:aceitaLoas" ${b.aceitaLoas?'checked':''}/> aceita cliente LOAS?</label>
        <label><input type="checkbox" data-put="${idx}:aceitaInvalidez" ${b.aceitaInvalidez?'checked':''}/> aceita cliente Invalidez?</label>
        <label><input type="checkbox" data-put="${idx}:aceitaClientePensao" ${b.aceitaClientePensao?'checked':''}/> aceita cliente pensão?</label>
      </div>

      <!-- Rogo junto do não assinante -->
      <div id="rogoWrap-${idx}" style="display:${b.aceitaClienteNaoAssina?'block':'none'};margin-top:8px">
        <label style="margin-bottom:6px">Tipos de rogo aceitos</label>
        <div class="rogo-grid">
          <label><input type="checkbox" data-rogo="${idx}:pai"     ${ (b.rogo||[]).includes('pai') ? 'checked' : '' } /> Pai</label>
          <label><input type="checkbox" data-rogo="${idx}:mae"     ${ (b.rogo||[]).includes('mae') ? 'checked' : '' } /> Mãe</label>
          <label><input type="checkbox" data-rogo="${idx}:irmao"   ${ (b.rogo||[]).includes('irmao') ? 'checked' : '' } /> Irmão</label>
          <label><input type="checkbox" data-rogo="${idx}:conjuge" ${ (b.rogo||[]).includes('conjuge') ? 'checked' : '' } /> Cônjuge</label>
          <label><input type="checkbox" data-rogo="${idx}:filhos"  ${ (b.rogo||[]).includes('filhos') ? 'checked' : '' } /> Filhos</label>
          <label><input type="checkbox" data-rogo="${idx}:netos"   ${ (b.rogo||[]).includes('netos') ? 'checked' : '' } /> Netos</label>
          <label><input type="checkbox" data-rogo="${idx}:avos"    ${ (b.rogo||[]).includes('avos') ? 'checked' : '' } /> Avós</label>
        </div>
        <div class="rogo-outros">
          <label style="font-weight:700;color:#cfe7ff">Outros (descrever)</label>
          <input type="text" data-put="${idx}:rogoOutros" placeholder="Descreva outros tipos..." value="${esc(b.rogoOutros||'')}" />
        </div>
      </div>
    </div>

    <!-- Bloco 2b: Documentos aceitos -->
    <div class="subpanel">
      <h3>Documentos aceitos</h3>
      <div class="checkbox-grid">
        <label><input type="checkbox" data-doc="${idx}:rg" ${ (b.documentos||[]).includes('rg') ? 'checked' : '' } /> RG</label>
        <label><input type="checkbox" data-doc="${idx}:cnh" ${ (b.documentos||[]).includes('cnh') ? 'checked' : '' } /> CNH</label>
        <label><input type="checkbox" data-doc="${idx}:ctps" ${ (b.documentos||[]).includes('ctps') ? 'checked' : '' } /> CTPS</label>
      </div>
      <div class="cond-box" style="margin-top:8px">
        <label>Outros (descrever)</label>
        <input type="text" data-put="${idx}:outrosDocs" placeholder="Descreva outros documentos..." value="${esc(b.outrosDocs||'')}" />
      </div>
    </div>

    <!-- Bloco 3: Procedimentos -->
    <div class="subpanel">
      <h3>Procedimentos</h3>
      <div class="checkbox-grid">
        <label><input type="checkbox" data-put="${idx}:precisaVideo" ${b.precisaVideo?'checked':''}/> Precisa de vídeo chamada?</label>
        <label><input type="checkbox" data-put="${idx}:fazLigacaoCliente" ${b.fazLigacaoCliente?'checked':''}/> Faz ligação para o cliente?</label>
        <label><input type="checkbox" data-put="${idx}:clienteLigaBanco" ${b.clienteLigaBanco?'checked':''}/> Cliente tem de ligar no banco?</label>
        <label><input type="checkbox" data-put="${idx}:precisaGravarVideo" ${b.precisaGravarVideo?'checked':''}/> Precisa gravar vídeo?</label>
        <label><input type="checkbox" data-put="${idx}:precisaEnviarContratoBanco" ${b.precisaEnviarContratoBanco?'checked':''}/> Precisa enviar contrato ao banco?</label>
      </div>

      <!-- Descritivos gerais -->
      <div class="cond-box" style="display:${b.precisaVideo?'block':'none'}">
        <label>Se precisa de vídeo chamada — descreva</label>
        <textarea data-put="${idx}:precisaVideoObs" class="small-row-text" rows="1">${esc(b.precisaVideoObs||'')}</textarea>
      </div>
      <div class="cond-box" style="display:${b.fazLigacaoCliente?'block':'none'}">
        <label>Se faz ligação para o cliente — descreva</label>
        <textarea data-put="${idx}:fazLigacaoClienteObs" class="small-row-text" rows="1">${esc(b.fazLigacaoClienteObs||'')}</textarea>
      </div>
      <div class="cond-box" style="display:${b.clienteLigaBanco?'block':'none'}">
        <label>Se cliente tem de ligar no banco — descreva</label>
        <textarea data-put="${idx}:clienteLigaBancoObs" class="small-row-text" rows="1">${esc(b.clienteLigaBancoObs||'')}</textarea>
      </div>
      <div class="cond-box" style="display:${b.precisaGravarVideo?'block':'none'}">
        <label>Se precisa gravar vídeo — descreva</label>
        <textarea data-put="${idx}:gravarVideoObs" class="small-row-text" rows="1">${esc(b.gravarVideoObs||'')}</textarea>
      </div>

      <!-- Contrato 60+ -->
      <div class="checkbox-grid" style="margin-top:8px">
        <label><input type="checkbox" data-put="${idx}:contrato60" ${b.contrato60?'checked':''}/> faz contrato 60+ nos estados relevantes?</label>
      </div>
      <div class="cond-box" style="display:${b.contrato60?'block':'none'}">
        <div class="row" style="margin-bottom:6px">
          <div class="col">
            <label>Se sim, listar estados</label>
            <input data-put="${idx}:contrato60_estados" placeholder="Ex: SP, RJ, MG" value="${esc(b.contrato60_estados||'')}" />
          </div>
        </div>
        <div class="checkbox-grid">
          <label><input type="checkbox" data-put="${idx}:contrato60_enviarFisico" ${b.contrato60_enviarFisico?'checked':''}/> precisa enviar o físico para o banco?</label>
          <label><input type="checkbox" data-put="${idx}:contrato60_enviarEmail" ${b.contrato60_enviarEmail?'checked':''}/> precisa enviar físico por email?</label>
          <label><input type="checkbox" data-put="${idx}:contrato60_precisaGravarVideo" ${b.contrato60_precisaGravarVideo?'checked':''}/> precisa gravar vídeo?</label>
        </div>
        <div class="cond-box" style="display:${b.contrato60_precisaGravarVideo?'block':'none'}">
          <label>Se precisa gravar vídeo — descreva</label>
          <textarea data-put="${idx}:contrato60_gravarVideoObs" class="small-row-text" rows="1">${esc(b.contrato60_gravarVideoObs||'')}</textarea>
        </div>
      </div>

      <!-- Regras específicas para "cliente não assinante" -->
      <div class="subpanel" style="margin-top:10px; display:${b.aceitaClienteNaoAssina?'block':'none'}">
        <h3>Regras para cliente não assinante</h3>
        <div class="checkbox-grid">
          <label><input type="checkbox" data-put="${idx}:naoAssina_precisaEnviarFisico" ${b.naoAssina_precisaEnviarFisico?'checked':''}/> precisa enviar o físico para o banco?</label>
          <label><input type="checkbox" data-put="${idx}:naoAssina_precisaVideo" ${b.naoAssina_precisaVideo?'checked':''}/> precisa na videochamada?</label>
          <label><input type="checkbox" data-put="${idx}:naoAssina_fazLigacao" ${b.naoAssina_fazLigacao?'checked':''}/> faz ligação para o cliente?</label>
          <label><input type="checkbox" data-put="${idx}:naoAssina_clienteLigaBanco" ${b.naoAssina_clienteLigaBanco?'checked':''}/> cliente tem de ligar no banco?</label>
          <label><input type="checkbox" data-put="${idx}:naoAssina_precisaEnviarEmail" ${b.naoAssina_precisaEnviarEmail?'checked':''}/> precisa enviar físico por email?</label>
          <label><input type="checkbox" data-put="${idx}:naoAssina_precisaGravarVideo" ${b.naoAssina_precisaGravarVideo?'checked':''}/> precisa gravar vídeo?</label>
        </div>
        <div class="cond-box" style="display:${b.naoAssina_precisaVideo?'block':'none'}">
          <label>Se precisa na videochamada — descreva</label>
          <textarea data-put="${idx}:naoAssina_precisaVideoObs" class="small-row-text" rows="1">${esc(b.naoAssina_precisaVideoObs||'')}</textarea>
        </div>
        <div class="cond-box" style="display:${b.naoAssina_fazLigacao?'block':'none'}">
          <label>Se faz ligação para o cliente — descreva</label>
          <textarea data-put="${idx}:naoAssina_fazLigacaoObs" class="small-row-text" rows="1">${esc(b.naoAssina_fazLigacaoObs||'')}</textarea>
        </div>
        <div class="cond-box" style="display:${b.naoAssina_clienteLigaBanco?'block':'none'}">
          <label>Se cliente tem de ligar no banco — descreva</label>
          <textarea data-put="${idx}:naoAssina_clienteLigaBancoObs" class="small-row-text" rows="1">${esc(b.naoAssina_clienteLigaBancoObs||'')}</textarea>
        </div>
        <div class="cond-box" style="display:${b.naoAssina_precisaGravarVideo?'block':'none'}">
          <label>Se precisa gravar vídeo — descreva</label>
          <textarea data-put="${idx}:naoAssina_gravarVideoObs" class="small-row-text" rows="1">${esc(b.naoAssina_gravarVideoObs||'')}</textarea>
        </div>
      </div>
    </div>

    <!-- Teimosinha / Mínimo -->
    <div class="row" style="margin-top:8px">
      <div class="col"><label>Teimosinha</label><input data-put="${idx}:teimosinha" placeholder="ex: 120 dias" value="${esc(b.teimosinha||'')}" /></div>
      <div class="col"><label>Mínimo liberado</label><input data-put="${idx}:minimoLiberado" type="number" value="${esc(b.minimoLiberado||'')}" /></div>
      <div class="col"><label>Tipo de mínimo</label>
        <select data-put="${idx}:tipoMinimo">
          <option value="valor liberado" ${b.tipoMinimo==='valor liberado'?'selected':''}>valor liberado</option>
          <option value="parcela" ${b.tipoMinimo==='parcela'?'selected':''}>parcela</option>
        </select>
      </div>
    </div>

    <!-- Prazos comuns -->
    ${ b.fazMargem ? `<div style="margin-top:8px"><label>Geral — Prazos por idade (Margem)</label><div class="prazo-line" data-prazos="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-prazo="${idx}">+ Adicionar prazo</button></div></div>` : '' }
    ${ b.fazCartao ? `<div style="margin-top:12px"><label>Geral — Prazos por idade (Cartão)</label><div class="prazo-line" data-prazos-cartao="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-prazo-cartao="${idx}">+ Adicionar prazo (Cartão)</button></div></div>` : '' }
    ${ b.fazPortabilidade ? `<div style="margin-top:12px"><label>Geral — Prazos por idade (Portabilidade)</label><div class="prazo-line" data-prazos-portabilidade="${idx}"></div><div style="margin-top:6px"><button class="small" data-add-prazo-port="${idx}">+ Adicionar prazo (Portabilidade)</button></div></div>` : '' }

    <!-- Bancos aceitos/negados -->
    <div style="margin-top:10px" class="row">
      <div class="col col-obs">
        <label>Bancos aceitos</label>
        <input class="bank-input wide-input" data-put="${idx}:bancosAceitos" value="${(b.bancosAceitos||[]).join(', ')}" placeholder="Itaú, Bradesco (separar por vírgula)"/>
        <label style="margin-top:8px">Bancos não aceitos</label>
        <input class="bank-input wide-input" data-put="${idx}:bancosNaoAceitos" value="${(b.bancosNaoAceitos||[]).join(', ')}" placeholder="Separar por vírgula" />
      </div>
    </div>

    <!-- Outras Informações (links/emails/contatos) -->
    <div class="subpanel" style="margin-top:10px">
      <h3>Outras Informações</h3>

      <label>Links do banco</label>
      <div class="other-list" id="links-${idx}"></div>
      <button class="small" data-add-link="${idx}" style="margin-top:6px">+ Adicionar link</button>

      <label style="margin-top:12px">Emails do banco</label>
      <div class="other-list" id="emails-${idx}"></div>
      <button class="small" data-add-email="${idx}" style="margin-top:6px">+ Adicionar email</button>

      <label style="margin-top:12px">Contatos (número + OBS)</label>
      <div class="other-list" id="contatos-${idx}"></div>
      <button class="small" data-add-contato="${idx}" style="margin-top:6px">+ Adicionar contato</button>
    </div>

    <div style="margin-top:8px">
      <label>Observações gerais</label>
      <textarea class="observacoes-geral" data-put="${idx}:observacoes">${esc(b.observacoes||'')}</textarea>
    </div>
  </div>
  `;
}

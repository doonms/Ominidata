"""Rascunhos antigos sem prazo não podem impedir o carregamento da Base de Fatores.

Usa Chrome isolado e Supabase simulado: não acessa nem grava dados reais.
"""
import json
import re
import runpy
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

QA = runpy.run_path(str(Path(__file__).with_name('simulador-fluxo.py')))
SYNC = runpy.run_path(str(Path(__file__).with_name('base-fatores-sync.py')))
KEY = 'ominidata_base_fatores_v1'
BACKUP = 'ominidata_base_fatores_antes_editor_tabelas_v1'
SEGUROS = [dict(nome='Seguro preservado', tipo='fixo', valor=25)]
LEGACY = {'BancodoBrasil': dict(
    fatores=dict(margem=[
        dict(prazo='', fator=.03, taxa=1.8, plano='Rascunho'),
        dict(prazo=12, fator=.04, taxa=1.9, plano='Rascunho'),
    ], cartao=[]), fazMargem=True, fazCartao=False, seguros=SEGUROS)}
REMOTOS = [
    dict(id=1, banco='BancodoBrasil', convenio='INSS', tipo='margem', prazo=12,
         fator=.05, taxa=2, plano='Rascunho'),
    dict(id=2, banco='BancodoBrasil', convenio='INSS', tipo='margem', prazo=24,
         fator=.025, taxa=1.7, plano='Remota'),
]


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QA['QuietHandler'], directory=str(QA['ROOT'])))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            for prefix in ['', '/Ominidata']:
                for rows in [[], REMOTOS]:
                    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
                    context.route('**/js/supa/supabaseClient.js', lambda r: r.fulfill(content_type='application/javascript', body=SYNC['STUB']))
                    context.route('https://**/*', lambda r: r.abort())
                    context.add_init_script('window.__qaRows=' + json.dumps(rows) + ';window.__qaWrites=[];window.__qaRanges=[];'
                        'sessionStorage.setItem("ominidata_user",JSON.stringify({email:"dominicplf@gmail.com"}));'
                        f'if(!localStorage.getItem("{KEY}"))localStorage.setItem("{KEY}",' + json.dumps(json.dumps(LEGACY)) + ');')
                    page = context.new_page()
                    errors = []
                    page.on('pageerror', lambda e: errors.append(str(e)))
                    page.on('response', lambda r: errors.append(f'HTTP {r.status}: {r.url}')
                            if r.status >= 400 and any(k in r.url for k in ['.css', '.js']) else None)
                    page.on('dialog', lambda d: d.accept())
                    base = f'http://127.0.0.1:{server.server_port}' + prefix
                    expected_factor = .04  # Editor mantém rascunhos; servidor só substitui por sincronização explícita.

                    def saved():
                        return page.evaluate(f'JSON.parse(localStorage.getItem("{KEY}"))')

                    def expect_editor():
                        expect(page.locator('#bf-sync-status')).to_contain_text('consultados' if rows else 'não retornou fatores')
                        expect(page.locator('#bf-novoBanco')).to_be_enabled()
                        expect(page.locator('#bf-slBanco')).to_have_value('BancodoBrasil')
                        expect(page.locator('#bf-listaPrazosMargem > .bf-table-card')).to_have_count(1)
                        expect(page.locator('.bf-term-row.is-pending')).to_have_count(1)
                        expect(page.locator('input.bf-prazo-pendente')).to_have_count(1)
                        state = saved()['BancodoBrasil']
                        assert state['seguros'] == SEGUROS
                        draft = next(t for t in state['tabelas']['margem'] if t['nome'] == 'Rascunho')
                        pending = next(r for r in draft['prazos'] if r['prazo'] == '')
                        assert pending['fator'] == .03 and pending['taxa'] == 1.8
                        valid = next(r for r in draft['prazos'] if r['prazo'] == 12)
                        assert valid['fator'] == expected_factor
                        assert len(draft['prazos']) == 2
                        backup = page.evaluate(f'JSON.parse(localStorage.getItem("{BACKUP}"))')
                        assert backup is not None, 'A conversão precisa preservar a base original em backup.'
                        assert backup.get('bancos', backup) == LEGACY
                        assert not page.evaluate('window.__qaWrites.length')

                    page.goto(base + '/pages/base-fatores.html')
                    expect_editor()
                    for _ in range(2):
                        page.reload()
                        expect_editor()
                    print(f'PASS: rascunho sem prazo sobrevive à conversão e dois reloads, com backup, seguro e dados remotos preservados ({prefix or "/"}; remoto={bool(rows)})')

                    rejection = page.evaluate("""async key => {
                        const { prepararFatores } = await import('../js/api/baseFatoresApi.js');
                        try { prepararFatores(JSON.parse(localStorage.getItem(key))); return ''; }
                        catch (error) { return error.message; }
                    }""", KEY)
                    assert re.search(r'prazo|pendente|rascunho', rejection, re.I), rejection
                    assert not page.evaluate('window.__qaWrites.length')

                    # Sem fatores publicados, usa fallback local somente se a leitura realmente falhar.
                    if not rows:
                        page.add_init_script("if(location.pathname.endsWith('/simulador.html'))window.__qaFalhaLeitura=true;")
                    page.goto(base + '/pages/simulador.html')
                    expect(page.locator('#sim-base-status')).to_contain_text('consultados' if rows else 'navegador')
                    page.locator('#slBanco').select_option('BancodoBrasil')
                    page.locator('#slOrigemFator').select_option('tabela')
                    expect(page.locator('#slPrazo option')).to_have_count(2 if rows else 1)
                    assert all(value not in ['', '0'] for value in page.locator('#slPrazo option').evaluate_all('(options)=>options.map(o=>o.value)'))
                    page.locator('#slPrazo').select_option('12')
                    page.locator('#inpValorMargem').fill('100')
                    expect(page.locator('#resPlano')).to_have_text('Rascunho')
                    expect(page.locator('#resValor')).to_contain_text('2.000,00' if rows else '2.500,00')
                    assert saved()['BancodoBrasil']['seguros'] == SEGUROS
                    assert not page.evaluate('window.__qaWrites.length')
                    print('PASS: publicação rejeita prazo pendente; simulador ignora apenas o rascunho e calcula com prazo válido')

                    page.goto(base + '/pages/base-fatores.html')
                    expect_editor()
                    pending = page.locator('input.bf-prazo-pendente')
                    pending.locator('xpath=ancestor::section[contains(@class,"bf-table-card")]').locator('.bf-table-toggle').click()
                    pending.fill('12')
                    pending.press('Tab')
                    expect(page.locator('#bf-vinculos-status')).to_contain_text(re.compile(r'já existe|já cadastrad|repetid', re.I))
                    expect(page.locator('.bf-term-row.is-pending')).to_have_count(1)
                    expect_editor()
                    pending.fill('90')
                    pending.press('Tab')
                    expect(page.locator('.bf-term-row.is-pending')).to_have_count(0)
                    corrected = page.locator('#bf-listaPrazosMargem .bf-term-row[data-prazo="90"]')
                    expect(corrected).to_have_count(1)
                    assert float(corrected.locator('.fator').input_value().replace(',', '.')) == .03
                    assert float(corrected.locator('.taxa').input_value().replace(',', '.')) == 1.8
                    validation = page.evaluate("""async key => {
                        const { prepararFatores } = await import('../js/api/baseFatoresApi.js');
                        return prepararFatores(JSON.parse(localStorage.getItem(key)));
                    }""", KEY)
                    assert len(validation) == 2
                    assert next(r for r in validation if r['prazo'] == 90)['fator'] == .03
                    page.reload()
                    expect(page.locator('#bf-sync-status')).to_contain_text('consultados' if rows else 'não retornou fatores')
                    expect(page.locator('.bf-term-row.is-pending')).to_have_count(0)
                    expect(page.locator('#bf-listaPrazosMargem .bf-term-row[data-prazo="90"]')).to_have_count(1)
                    assert saved()['BancodoBrasil']['seguros'] == SEGUROS
                    assert not page.evaluate('window.__qaWrites.length')
                    assert not errors, errors
                    context.close()
                    print('PASS: prazo duplicado bloqueado; completar 90x mantém fator/taxa e persiste sem gravar no Supabase')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

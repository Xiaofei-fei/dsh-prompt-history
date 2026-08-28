<div align="center">

# ⌨️ dsh-prompt-history

**Entrada estilo terminal para o compositor da Web GUI do DeepSeek Harness: histórico de prompts tipo bash, copiar e citar, e colar com botão direito.**

*Pressione ↑ como num terminal — histórico, citações e colagem em um único plugin.*

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#)
[![npm version](https://img.shields.io/npm/v/dsh-prompt-history)](https://www.npmjs.com/package/dsh-prompt-history)
[![npm downloads](https://img.shields.io/npm/dm/dsh-prompt-history)](https://www.npmjs.com/package/dsh-prompt-history)

[English](README.en.md) · [简体中文](README.md) · [Español](README.es.md) · **Português**

</div>

---

## Compatibilidade

| Superfície | Estado |
|---|---|
| Plataforma | Somente Web GUI (plugin de cliente; estado local do navegador; sem rede, sem código nativo) |
| Node | `>=20` |
| Modelo | Qualquer (não faz requisições ao modelo — comportamento puro de UI) |
| Idioma da interface | 中文 / English (segue o idioma do app DSH, alterável em Configurações) |

## O que você obtém

`dsh-prompt-history` coloca o histórico de um terminal no compositor da Web GUI do DeepSeek Harness:

1. **Recuperação com setas estilo shell** — com o rascunho vazio, **↑** recupera a mensagem enviada mais recente (a mais nova primeiro); **com um prefixo digitado, ↑ salta para a mensagem mais recente que começa com esse prefixo** (`history-search-backward` do bash); continue pressionando ↑ para voltar pelas correspondências; **↓** avança (inclusive pelas correspondências de prefixo) e, na borda inferior, **restaura a linha que você digitava antes de começar a navegar** (comportamento pending-line do readline).
2. **Editar sai da navegação** — editar o rascunho durante a navegação volta para a linha ativa.
3. **Busca reversa com Ctrl+R** — busca incremental no histórico com correspondência em tempo real (overlay estilo bash `(reverse-i-search)`consulta``); Ctrl+R novamente vai para a correspondência mais antiga; Enter aceita, Escape cancela e restaura o rascunho anterior.
4. **Copiar + citar (dois modos, em Configurações)** — qualquer seleção não vazia na página — o campo do compositor, mensagens do chat, blocos de código — é tratada conforme o modo escolhido:
   - **Barra de ferramentas** (padrão): botões Copiar / Citar aparecem acima da seleção — copiar grava na área de transferência apenas ao clicar (sem inundar o Win+V); **Citar** insere o TEXTO COMPLETO selecionado como um blockquote markdown limpo com prefixo `>` no compositor (renderizado como citação ao enviar).
   - **Auto** (estilo terminal): copia a seleção direto para a área de transferência do sistema ao selecionar.
5. **Botão direito cola diretamente** — um clique com o botão direito no compositor cola a área de transferência — sem menu de contexto, como num terminal Linux. A colagem usa o mesmo pipeline do Ctrl+V (imagens e chips de referência se comportam igual), com fallback da Clipboard API quando o caminho execCommand está bloqueado.
6. **Histórico entre sessões** (alternância em Configurações, desligado por padrão) — mantém o histórico de ↑/↓ entre sessões, armazenado em localStorage do navegador (limite 200), sobrevive a recarregamentos e trocas de sessão.
7. **TOC do chat (índice da conversa)** — quando a conversa fica longa, uma alça sutil, semitransparente e arrastável na borda esquerda do chat (acende no hover) expande um índice de cada mensagem de usuário em ordem — clique em qualquer item para saltar para aquele ponto e role por todas as entradas quando a lista ficar longa; clique fora ou pressione Esc para fechar. Pode ser desativado nas Configurações.

Comportamento puro de UI: sem eventos de sessão, sem mudanças no loop do agente, sem requisições ao modelo. O texto recuperado ou citado só entra no rascunho comum do compositor — chega ao modelo apenas se *você* pressionar Enter.

## Início rápido

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add dsh-prompt-history

# 2. recarregue a página — sem necessidade de reiniciar o serviço
```

## Instalar e desinstalar

- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-prompt-history`
- **Canal git** (desenvolvimento local, último `main`): `dsh plugin --profile web add "github:Xiaofei-fei/dsh-prompt-history#main"` (um checkout de código precisa ser compilado primeiro — `pnpm run build`; um bundle não compilado se recusa a iniciar)
- **Desinstalar**: `dsh plugin --profile web remove dsh-prompt-history`

## Configuração

Abra **Configurações → `>_ Terminal Input`** (armazenado em localStorage do navegador, efeito imediato):

| Opção | Padrão | Significado |
|---|---|---|
| Modo de cópia (ao selecionar) | `Barra de ferramentas` | `Barra` (recomendado; grava na área de transferência só ao clicar) / `Copiar automaticamente ao selecionar` (estilo terminal) |
| Histórico entre sessões | Desligado | O histórico de ↑/↓ persiste entre sessões em localStorage (limite 200) |
| TOC do chat | Ligado | Mostrar a alça arrastável na borda esquerda do chat; pode ser desativado |
| Colar com botão direito | Ligado | Desligado restaura o menu de contexto nativo do navegador |

O histórico de ↑/↓ está sempre ligado, independentemente dessas alternâncias.

## Recursos

- **O histórico vem do registro de mensagens da própria sessão**: lê os nós de usuário (`user` / `steering`) do snapshot da conversa e os anexa conforme chegam — estritamente consistente com a transcrição, persistido com a sessão, sobrevive a recarregamentos de página e não precisa de configuração nem armazenamento extra.
- **Duplicados consecutivos são colapsados**; o estado de navegação é redefinido ao trocar de sessão.
- **Interface internacionalizada**: cada texto (configurações, barra de ferramentas, avisos, TOC, overlay de busca) segue o idioma do app DSH (中文 / English).
- O bundle do cliente pesa ~12 KB compactado e depende apenas dos pacotes peer oficiais `@deepseek-ai/*`.

## Limitações conhecidas

- **Ctrl+R**: com o compositor focado, Ctrl+R é busca reversa — ele não recarrega mais a página (clique fora do campo primeiro para recarregar).
- Ao trocar de sessão, apenas as mensagens da janela de eventos atualmente carregada podem ser recuperadas (tudo enviado com a página aberta está incluído); não há busca de histórico do lado do host.
- Apenas texto simples: mensagens só com imagens ou chips não são recuperadas; os rascunhos recuperados são texto simples.

## Desenvolvimento

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsc (lib/types) + tsdown (lib/index.js / lib/invariant.js / lib/client.js)
```

A metade do navegador (`src/client/`) se registra no slot `conversation.input.right`; o build emite o formato de closure `__ModuleLoader__` do DSH com `react` como único externo (o resto vem da tabela de módulos do navegador). Os dicionários vivem em `src/client/locales.ts` (`zh` autoritativo, `en` com paridade de chaves) e se registram via `ctx.locale.register`.

## Como funciona

O plugin é uma entrada de slot invisível do compositor que monta um listener `keydown` em fase de captura no documento. Ele assume ↑/↓ apenas quando o alvo é o campo do compositor, sem modificadores pressionados, sem composição IME ativa, sem menu de sugestões aberto e com a sessão não ocupada — então escreve o texto recuperado via `inputActions.setDraft`. A lista de histórico é alimentada pelos nós `user`/`steering` do snapshot (deduplicados por seq); a posição de navegação (índice mais a linha pendente de restauração) vive em refs do componente.

## Licença

[MIT](LICENSE)

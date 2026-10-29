# Integrando um sistema ao Linkord por webhook

Um **bot** no Linkord é um canal que recebe mensagens de fora. Seu sistema (um deploy, um monitor, uma automação, um script no cron) faz um `POST` HTTP para a URL do bot, e a mensagem aparece na hora para todo mundo que participa dele, com selo **BOT**, contagem de não lidas e notificação.

Ninguém digita num bot: ele só recebe. Quem participa lê, reage e recebe os avisos.

---

## Sumário

1. [Criar o bot](#1-criar-o-bot)
2. [Guardar a URL do webhook](#2-guardar-a-url-do-webhook)
3. [Enviar a primeira mensagem](#3-enviar-a-primeira-mensagem)
4. [Convidar quem vai receber os avisos](#4-convidar-quem-vai-receber-os-avisos)
5. [Formato da mensagem](#5-formato-da-mensagem)
6. [Cards (embeds)](#6-cards-embeds)
7. [Evitar mensagens duplicadas](#7-evitar-mensagens-duplicadas)
8. [Respostas e erros](#8-respostas-e-erros)
9. [Limites](#9-limites)
10. [Exemplos prontos](#10-exemplos-prontos)
11. [Segurança](#11-segurança)
12. [Problemas comuns](#12-problemas-comuns)

---

## 1. Criar o bot

1. No Linkord, na lista de conversas, abra a aba **Bots** (ao lado de Amigos e Grupos).
2. Clique no **+** no topo da lista.
3. Dê um nome (ex.: *Deploys*, *Monitoramento*). Se quiser, já escolha amigos para convidar.
4. Clique em **Criar bot**.

Depois de criado, você pode trocar o nome e a foto do bot nos detalhes dele (ícone **ⓘ** no topo da conversa). As mensagens antigas passam a mostrar o nome e a foto novos.

> Cada conta pode ter até 10 bots (o limite é configurável na instância por `MAX_OWNED_BOTS_PER_USER`).

## 2. Guardar a URL do webhook

Logo após criar, o Linkord mostra a **URL do webhook**:

```
https://seu-linkord/api/webhooks/<id>/<token>
```

**Copie agora e guarde num lugar seguro** (o cofre de segredos do seu CI, uma variável de ambiente etc.). O Linkord guarda só um hash do token: a URL **não aparece de novo**.

Perdeu a URL? Abra o bot → **ⓘ** → aba **Webhook** → **Gerar nova URL**. A URL antiga para de funcionar na mesma hora, então atualize todos os sistemas que a usavam.

> A URL é a credencial inteira: quem tiver ela consegue postar como o bot. Trate-a como uma senha.

## 3. Enviar a primeira mensagem

Com a URL em mãos, um `POST` com JSON já basta:

```bash
curl -X POST "$LINKORD_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d '{"content": "Deploy concluído ✅"}'
```

Resposta de sucesso (`201 Created`):

```json
{ "id": 123, "duplicate": false }
```

A mensagem aparece no bot em tempo real para quem estiver online, e como não lida para quem não estiver.

### Duas formas de mandar o token

| Forma | Quando usar |
|---|---|
| Token na URL: `POST /api/webhooks/<id>/<token>` | Ferramentas que só aceitam uma URL (a maioria dos serviços com "webhook"). |
| Header: `POST /api/webhooks/<id>` com `Authorization: Bearer <token>` | Quando você controla o código e quer o token fora da URL. Proxies e logs de acesso costumam registrar URLs, mas não headers. |

O `<id>` e o `<token>` são as duas últimas partes da URL que o Linkord mostrou.

```bash
curl -X POST "https://seu-linkord/api/webhooks/$WEBHOOK_ID" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content": "Backup terminou"}'
```

## 4. Convidar quem vai receber os avisos

Um bot funciona como um grupo: quem cria é o dono e convida os outros.

1. Abra o bot → **ⓘ** → **Convidar amigos**.
2. Escolha os amigos. Cada um recebe um card de convite na conversa com você e entra ao aceitar.

Quem entra **só lê**: o bot não tem campo de mensagem. Membros podem reagir e sair quando quiserem. O dono também pode remover membros, transferir o bot para outro membro e apagar mensagens do bot.

## 5. Formato da mensagem

O corpo é um objeto JSON:

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `content` | string | sim, se não houver `embeds` | Texto da mensagem, até **2000 caracteres**. |
| `embeds` | lista | sim, se não houver `content` | Até **5 cards**, veja a [seção 6](#6-cards-embeds). |

O `Content-Type` precisa ser `application/json`.

### Formatação do texto

O `content` aceita o mesmo markdown do chat:

| Escreva | Aparece como |
|---|---|
| `**negrito**` | **negrito** |
| `*itálico*` ou `_itálico_` | *itálico* |
| `~~riscado~~` | ~~riscado~~ |
| `` `código` `` | `código` |
| ` ```bloco de código``` ` (com linguagem opcional: ` ```js `) | bloco com destaque de sintaxe |
| `> citação` | citação |
| `- item` ou `1. item` | lista |
| `https://...` | link, com prévia do site |
| `<https://...>` | link sem prévia |
| `@usuario` | menção destacada |

Texto acima de 2000 caracteres é **recusado** (não cortado), para o seu sistema saber que nem tudo chegaria.

## 6. Cards (embeds)

Para avisos mais legíveis, mande `embeds`: cards com barra colorida, título, campos e rodapé. O formato é o mesmo do Discord, então payloads feitos para o Discord costumam funcionar como estão.

```json
{
  "content": "Novo deploy em produção",
  "embeds": [
    {
      "title": "Deploy concluído",
      "url": "https://ci.exemplo.com/runs/42",
      "color": "green",
      "description": "Pipeline **main** passou em todos os testes.",
      "fields": [
        { "name": "Versão", "value": "1.4.2", "inline": true },
        { "name": "Ambiente", "value": "produção", "inline": true },
        { "name": "Duração", "value": "3m 12s", "inline": true },
        { "name": "Commit", "value": "`b13da04` feat: nova tela" }
      ],
      "footer": "CI",
      "timestamp": "2026-10-28T18:45:00Z"
    }
  ]
}
```

### Campos de um card

| Campo | Tipo | Limite | Descrição |
|---|---|---|---|
| `title` | string | 256 | Título em destaque. Vira link se houver `url`. |
| `url` | string | 2048 | Link do título. Só `http://` ou `https://`. |
| `description` | string | 2000 | Corpo do card, com markdown. |
| `color` | número ou string | — | Cor da barra lateral, veja abaixo. |
| `fields` | lista | 10 | Pares nome/valor, veja abaixo. |
| `footer` | string ou `{ "text": "..." }` | 256 | Linha pequena no fim do card. |
| `timestamp` | string ISO 8601 | — | Data mostrada no rodapé, no fuso de quem lê. |

Todo card precisa de pelo menos um `title`, `description` ou `fields`.

### Campos (`fields`)

| Campo | Tipo | Limite | Descrição |
|---|---|---|---|
| `name` | string | 256 | Rótulo, em negrito. |
| `value` | string | 1024 | Valor, com markdown. |
| `inline` | boolean | — | `true` para dividir a linha com outros campos `inline` (até 3 por linha). Sem ele, o campo ocupa a linha toda. |

### Cores

A `color` aceita três formas:

- **Número** `0xRRGGBB`, como no Discord: `5763719`.
- **Texto hexadecimal**: `"#57F287"` ou `"57F287"`.
- **Nome**: `"red"`, `"green"`, `"yellow"`, `"blue"`, `"orange"`, `"purple"` ou `"gray"`.

Uma convenção útil: verde para sucesso, vermelho para falha ou alerta, amarelo para aviso, azul para informação.

### O que não é suportado

Imagens, miniaturas e autor (`image`, `thumbnail`, `author`) são ignorados de propósito: o card nunca faz o navegador de quem lê carregar algo de um endereço que o remetente escolheu. Para indicar uma página ou imagem, coloque o link no `content` (ele ganha a prévia normal de links do chat) ou no `url` do card.

## 7. Evitar mensagens duplicadas

Se o seu sistema reenvia quando a rede falha (uma fila, um retry automático), mande o header **`Idempotency-Key`** com um identificador único daquele evento:

```bash
curl -X POST "$LINKORD_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: deploy-42' \
  -d '{"content": "Deploy 42 concluído"}'
```

- O primeiro envio com a chave cria a mensagem: `201` e `{"id": 123, "duplicate": false}`.
- Um reenvio com a **mesma chave** não cria outra: responde `200` e `{"id": 123, "duplicate": true}`, com o id da mensagem original.

A chave vale por webhook, tem até 128 caracteres visíveis (sem espaços) e fica livre de novo se a mensagem for apagada. Bons exemplos: o id do job do CI, o id do alerta no monitor, `pedido-981-pago`.

## 8. Respostas e erros

Todo erro vem no mesmo formato:

```json
{ "error": { "code": "invalid_message", "message": "embeds[0]: \"url\" precisa ser um link http(s)." } }
```

A `message` diz exatamente o que corrigir.

| Status | `code` | Quando |
|---|---|---|
| `201` | — | Mensagem criada. |
| `200` | — | Reenvio de um `Idempotency-Key` já usado: nada novo foi criado. |
| `400` | `invalid_message` | Sem `content` nem `embeds`, ou algum card inválido. |
| `400` | `message_too_long` | `content` com mais de 2000 caracteres. |
| `400` | `invalid_request` | `Idempotency-Key` inválida. |
| `400` | `invalid_json` | O corpo não é um objeto JSON. |
| `401` | `invalid_webhook` | URL ou token errado, URL substituída por uma nova, webhook revogado pela administração, ou bot suspenso. |
| `413` | `FST_ERR_CTP_BODY_TOO_LARGE` | Corpo maior que 64 KB. |
| `415` | `FST_ERR_CTP_INVALID_MEDIA_TYPE` | `Content-Type` diferente de `application/json`. |
| `429` | `rate_limited` | Envios demais em pouco tempo. Respeite o header `Retry-After`, em segundos. |

Um `401` nunca diz qual parte está errada, de propósito. Se ele começar a aparecer de repente, a URL provavelmente foi trocada ou revogada: peça uma nova ao dono do bot.

**Vale repetir o envio?** Sim em `429` (após o `Retry-After`) e em erros `5xx` ou de rede. Use `Idempotency-Key` para que o retry nunca duplique. Não adianta repetir em `400`, `401`, `413` ou `415` sem mudar o pedido.

## 9. Limites

| Limite | Valor |
|---|---|
| Envios por webhook | 30 por minuto |
| Envios por IP | 120 por minuto |
| Tamanho do corpo | 64 KB |
| Texto (`content`) | 2000 caracteres |
| Cards por mensagem | 5 |
| Campos por card | 10 |
| Bots por conta | 10 |
| Membros por bot | 100 |

Precisa mandar muita coisa de uma vez? Agrupe num único envio (vários `fields` ou vários cards) em vez de uma mensagem por item.

## 10. Exemplos prontos

### Shell

```bash
#!/usr/bin/env bash
# avisa no Linkord quando o disco passa de 90%
uso=$(df / | awk 'NR==2 {gsub("%", "", $5); print $5}')
if [ "$uso" -gt 90 ]; then
  curl -sS -X POST "$LINKORD_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"embeds\": [{\"title\": \"Disco quase cheio\", \"color\": \"red\", \"fields\": [{\"name\": \"Host\", \"value\": \"$(hostname)\", \"inline\": true}, {\"name\": \"Uso\", \"value\": \"${uso}%\", \"inline\": true}]}]}"
fi
```

### Node.js (18+)

```js
async function avisar(content, embeds, idempotencyKey) {
  const res = await fetch(process.env.LINKORD_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ content, embeds }),
  });
  if (res.status === 429) {
    const espera = Number(res.headers.get('retry-after') ?? 1);
    await new Promise((r) => setTimeout(r, espera * 1000));
    return avisar(content, embeds, idempotencyKey);
  }
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(`Linkord recusou: ${error.code}: ${error.message}`);
  }
  return res.json(); // { id, duplicate }
}

await avisar('Pedido pago', [{
  title: 'Pedido #981', color: 'green',
  fields: [{ name: 'Valor', value: 'R$ 249,90', inline: true }, { name: 'Cliente', value: 'Ana', inline: true }],
}], 'pedido-981-pago');
```

### Python

```python
import os, time, requests

def avisar(content=None, embeds=None, idempotency_key=None):
    headers = {"Idempotency-Key": idempotency_key} if idempotency_key else {}
    body = {k: v for k, v in {"content": content, "embeds": embeds}.items() if v}
    res = requests.post(os.environ["LINKORD_WEBHOOK_URL"], json=body, headers=headers, timeout=10)
    if res.status_code == 429:
        time.sleep(int(res.headers.get("Retry-After", "1")))
        return avisar(content, embeds, idempotency_key)
    res.raise_for_status()
    return res.json()

avisar(embeds=[{
    "title": "Backup concluído",
    "color": "blue",
    "fields": [{"name": "Tamanho", "value": "12,4 GB", "inline": True}],
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}])
```

### GitHub Actions

Guarde a URL em **Settings → Secrets and variables → Actions** como `LINKORD_WEBHOOK_URL` e adicione um passo no fim do workflow:

```yaml
      - name: Avisar no Linkord
        if: always()
        env:
          LINKORD_WEBHOOK_URL: ${{ secrets.LINKORD_WEBHOOK_URL }}
          STATUS: ${{ job.status }}
        run: |
          if [ "$STATUS" = "success" ]; then COR=green; TITULO="Deploy concluído"; else COR=red; TITULO="Deploy falhou"; fi
          curl -sS -X POST "$LINKORD_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -H "Idempotency-Key: gh-${{ github.run_id }}-${{ github.run_attempt }}" \
            -d "{\"embeds\": [{\"title\": \"$TITULO\", \"url\": \"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\", \"color\": \"$COR\", \"fields\": [{\"name\": \"Branch\", \"value\": \"${{ github.ref_name }}\", \"inline\": true}, {\"name\": \"Autor\", \"value\": \"${{ github.actor }}\", \"inline\": true}], \"footer\": \"GitHub Actions\"}]}"
```

## 11. Segurança

- **A URL é um segredo.** Guarde-a em variáveis de ambiente ou no cofre de segredos, nunca no código nem num repositório.
- **Prefira o header `Authorization: Bearer`** quando puder: o token fica fora de URLs, que costumam aparecer em logs de proxies e de acesso. O Linkord nunca registra o token nos próprios logs.
- **Vazou? Gere uma nova URL** (bot → **ⓘ** → **Webhook** → **Gerar nova URL**). A anterior morre na hora.
- **O Linkord guarda só o hash do token.** Nem a administração da instância consegue ver a sua URL.
- **A administração pode revogar o webhook ou suspender o bot** (por abuso ou vazamento). Nos dois casos os envios passam a receber `401`. Depois de uma revogação, o dono volta a receber avisos gerando uma nova URL. Depois de uma suspensão, a mesma URL volta a funcionar quando a administração reativar o bot.
- **Links nos cards** só podem ser `http(s)`. Não existe forma de executar script ou carregar imagem externa por um card.

## 12. Problemas comuns

**Recebo `401 invalid_webhook` numa URL que funcionava.**
A URL foi trocada (alguém clicou em "Gerar nova URL"), a administração revogou o webhook, ou o bot está suspenso. Peça ao dono do bot uma URL nova.

**Recebo `415`.**
Falta o header `Content-Type: application/json`.

**Recebo `400 invalid_json`.**
O corpo não é um objeto JSON válido. Em shell, cuidado com aspas: valide o JSON com `echo "$BODY" | jq .` antes de enviar.

**A mensagem chegou duas vezes.**
Seu sistema repetiu o envio. Mande um `Idempotency-Key` único por evento ([seção 7](#7-evitar-mensagens-duplicadas)).

**Um campo apareceu sozinho na linha.**
Só campos com `"inline": true` dividem a linha, até 3 por vez.

**Ninguém recebeu a mensagem.**
Confira se as pessoas aceitaram o convite: só membros veem o bot. Quem não estava online vê a mensagem como não lida na próxima vez que abrir o Linkord.

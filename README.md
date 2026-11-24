# SOL SOLUÇÕES — Controle de Estoque

Site simples de controle de estoque: resumo com histórico, entrada de
produtos, saída de produtos (por condomínio) e cadastro geral de produtos —
tudo separado em depósitos independentes (ex.: "SOL 1" e "SOL 2"), com
aviso de estoque baixo. Feito em HTML/CSS/JS puro (sem build), pronto pra
publicar como página estática no GitHub Pages, usando o Supabase como
banco de dados.

## 1. Criar o repositório no GitHub

1. Crie um repositório novo (vazio) no GitHub, ex.: `sol-solucoes-estoque`.
2. Nesta pasta, rode:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/sol-solucoes-estoque.git
   git branch -M main
   git push -u origin main
   ```
   (o repositório já vem com o primeiro commit pronto)

## 2. Configurar o banco de dados (Supabase)

1. Entre no seu projeto Supabase (o "SOL SOLUÇÕES" que você já criou, ou um novo em https://supabase.com).
2. Vá em **SQL Editor → New query**, cole todo o conteúdo do arquivo
   [`sql/schema.sql`](sql/schema.sql) e clique em **Run**. Isso cria as
   tabelas `produtos` e `movimentacoes` e as regras de acesso.
3. Vá em **Project Settings → API** e copie:
   - **Project URL**
   - **anon public key**
4. Abra o arquivo [`js/config.js`](js/config.js) neste repositório e cole
   esses dois valores em `SUPABASE_CONFIG.url` e `SUPABASE_CONFIG.anonKey`.
5. Suba a alteração:
   ```bash
   git add js/config.js
   git commit -m "Configura Supabase"
   git push
   ```

> Como o acesso ao site é controlado por uma senha única (e não por login
> individual do Supabase), a chave `anon` fica liberada para ler/gravar nas
> duas tabelas. Isso é suficiente para o uso combinado (você + mais 2
> pessoas), mas não compartilhe essa chave fora do projeto — quem a tiver
> consegue acessar os dados diretamente.

> **Atualização (depósitos separados):** se você já tinha rodado o
> `schema.sql` antes, rode-o de novo — ele foi atualizado com a coluna
> `deposito` (o script é seguro de rodar mais de uma vez, não duplica nada,
> e todos os produtos que já existiam ficam automaticamente no depósito
> "SOL 1").

## 3. Publicar no GitHub Pages

1. No GitHub, vá em **Settings → Pages**.
2. Em "Build and deployment", escolha **Deploy from a branch**, branch
   `main`, pasta `/ (root)`.
3. Salve. Em alguns minutos o site estará em
   `https://SEU-USUARIO.github.io/sol-solucoes-estoque/`.

## 4. Acessar o site

A senha de entrada é **SolSolucoes** (definida em `js/config.js`, em
`APP_PASSWORD` — pode trocar por outra se quiser, é só editar e subir de
novo).

## Como o site funciona

- **Seletor de Estoque** (topo da tela) — escolhe qual depósito você está
  vendo/mexendo agora (ex.: "SOL 1" ou "SOL 2"). Cada depósito tem seus
  próprios produtos, entradas e saídas, totalmente separados um do outro —
  é como se fossem dois sites diferentes. A escolha fica salva no
  navegador, então ele lembra qual você usou por último.
- **Aviso de estoque baixo** — sempre que um produto do depósito atual
  ficar com 3 unidades ou menos, aparece uma faixa vermelha no topo do site
  avisando quais produtos estão baixos. Ela só some quando alguém clica em
  "Estou ciente" — e volta a aparecer se a quantidade mudar de novo
  enquanto continuar baixa (ex.: deu mais saída, ou entrou e saiu de novo).
- **Resumo** — cartões com total de produtos, quantos estão com estoque
  baixo, entradas e saídas registradas (tudo já filtrado pelo depósito
  escolhido); histórico completo de entradas/saídas com filtro por tipo,
  período e busca.
- **Entrada** — escolhe o produto (SKU) e a quantidade; soma direto no
  estoque do depósito atual. Não pede condomínio.
- **Saída** — escolhe o produto, a quantidade, o condomínio de destino
  (obrigatório — tem a opção "Outros" pra serviço feito fora dos
  condomínios) e uma observação (opcional, ex.: motivo da saída); desconta
  do estoque do depósito atual. Se pedir mais do que tem em estoque, o site
  avisa e não deixa completar.
- **Estoque Geral** — cadastra produtos novos (nome, quantidade inicial e
  foto opcional — o SKU é gerado automaticamente) dentro do depósito
  escolhido no momento; lista os produtos desse depósito, com opção de
  editar nome/foto ou excluir (só é possível excluir um produto que ainda
  não tem nenhuma entrada/saída registrada).

O site não guarda mais valor/preço dos produtos — só nome, quantidade e
foto, pra manter a tela limpa.

## Editar a lista de depósitos (estoques separados)

Os depósitos disponíveis no seletor do topo ficam em `js/config.js`, em
`window.DEPOSITOS` (vem com `["SOL 1", "SOL 2"]`). Pra adicionar um novo
depósito, é só acrescentar o nome nessa lista e subir a alteração — ele
aparece vazio no seletor, pronto pra cadastrar produtos dentro dele.

> Na primeira vez que você rodar o `sql/schema.sql` atualizado, todos os
> produtos que já existiam no banco são automaticamente colocados no
> depósito "SOL 1" (não precisa fazer nada manual pra isso).

## Editar a lista de condomínios

A lista de condomínios usada na tela de Saída fica em `js/config.js`, em
`window.CONDOMINIOS`. Para adicionar, remover ou renomear um condomínio,
edite essa lista e suba a alteração.

## Rodando localmente antes de publicar (opcional)

Não é obrigatório, mas se quiser conferir antes de subir, rode um servidor
local simples dentro da pasta do projeto:
```bash
python3 -m http.server 8000
```
e acesse `http://localhost:8000` no navegador (não abra o `index.html`
direto com duplo clique — alguns navegadores bloqueiam o carregamento dos
scripts locais quando o arquivo é aberto assim).

# SOL SOLUÇÕES — Controle de Estoque

Site simples de controle de estoque: resumo com histórico e comparativo de
gastos, entrada de produtos, saída de produtos (por condomínio) e cadastro
geral de produtos. Feito em HTML/CSS/JS puro (sem build), pronto pra
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

- **Resumo** — cartões com total de produtos, valor total em estoque,
  entradas e saídas registradas; gráfico com o comparativo de gastos
  (valor das saídas) mês a mês; histórico completo de entradas/saídas com
  filtro por tipo e busca.
- **Entrada** — escolhe o produto (SKU) e a quantidade; soma direto no
  estoque geral. Não pede condomínio.
- **Saída** — escolhe o produto, a quantidade, o condomínio de destino
  (obrigatório) e uma observação (opcional, ex.: motivo da saída); desconta
  do estoque geral. Se pedir mais do que tem em estoque, o site avisa e não
  deixa completar.
- **Estoque Geral** — cadastra produtos novos (nome, valor unitário,
  quantidade inicial — o SKU é gerado automaticamente); lista todos os
  produtos com valor total (valor unitário × quantidade), com opção de
  editar nome/valor ou excluir (só é possível excluir um produto que ainda
  não tem nenhuma entrada/saída registrada).

O valor guardado em cada entrada/saída é o valor do produto *no momento da
movimentação* — se você editar o valor de um produto depois, o histórico e
o gráfico de gastos de meses passados não mudam retroativamente.

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

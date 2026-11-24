-- SOL SOLUÇÕES — Controle de Estoque
-- Rode este script UMA VEZ no seu projeto Supabase:
-- Supabase → seu projeto → SQL Editor → New query → cole tudo → Run

create extension if not exists pgcrypto;

-- Tabela de produtos do estoque geral
create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  nome text not null,
  valor_unitario numeric(12,2) not null default 0,
  quantidade integer not null default 0,
  created_at timestamptz not null default now()
);

-- Histórico de entradas e saídas
create table if not exists movimentacoes (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  quantidade integer not null check (quantidade > 0),
  valor_unitario numeric(12,2) not null default 0,
  condominio text,
  motivo text,
  data timestamptz not null default now()
);

create index if not exists idx_movimentacoes_data on movimentacoes (data desc);
create index if not exists idx_movimentacoes_produto on movimentacoes (produto_id);

-- Foto do produto (se o seu banco ainda não tiver essa coluna).
alter table produtos add column if not exists foto text;

-- Depósito/armazém ao qual o produto pertence. Cada depósito é um estoque
-- totalmente separado (produtos, entradas e saídas independentes).
-- Ao rodar isso pela primeira vez, TODOS os produtos que já existiam ficam
-- automaticamente no depósito "SOL 1" (valor padrão da coluna). "SOL 2"
-- começa vazio — só aparece como opção pra cadastrar produtos novos nele.
alter table produtos add column if not exists deposito text not null default 'SOL 1';
create index if not exists idx_produtos_deposito on produtos (deposito);

-- Segurança: como o site usa uma senha única de acesso (definida no próprio
-- site) em vez de login individual do Supabase, liberamos a chave "anon"
-- para ler/escrever nessas duas tabelas. Isso é suficiente para o uso
-- combinado (você + mais 2 pessoas), mas vale saber: quem tiver a
-- SUPABASE_ANON_KEY consegue acessar os dados diretamente, então não a
-- compartilhe fora do projeto.
alter table produtos enable row level security;
alter table movimentacoes enable row level security;

drop policy if exists "allow all - produtos" on produtos;
create policy "allow all - produtos" on produtos for all using (true) with check (true);

drop policy if exists "allow all - movimentacoes" on movimentacoes;
create policy "allow all - movimentacoes" on movimentacoes for all using (true) with check (true);

grant usage on schema public to anon;
grant all on produtos to anon;
grant all on movimentacoes to anon;

-- Função que registra uma entrada ou saída de forma atômica:
-- atualiza a quantidade do produto e grava o histórico numa única operação,
-- e impede saída maior do que o estoque disponível.
create or replace function registrar_movimentacao(
  p_produto_id uuid,
  p_tipo text,
  p_quantidade integer,
  p_condominio text default null,
  p_motivo text default null
) returns void as $$
declare
  v_valor numeric(12,2);
  v_estoque_atual integer;
begin
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade inválida';
  end if;

  select valor_unitario, quantidade into v_valor, v_estoque_atual
  from produtos
  where id = p_produto_id
  for update;

  if not found then
    raise exception 'Produto não encontrado';
  end if;

  if p_tipo = 'entrada' then
    update produtos set quantidade = quantidade + p_quantidade where id = p_produto_id;
  elsif p_tipo = 'saida' then
    if v_estoque_atual < p_quantidade then
      raise exception 'Estoque insuficiente. Disponível no momento: %', v_estoque_atual;
    end if;
    update produtos set quantidade = quantidade - p_quantidade where id = p_produto_id;
  else
    raise exception 'Tipo de movimentação inválido: %', p_tipo;
  end if;

  insert into movimentacoes (produto_id, tipo, quantidade, valor_unitario, condominio, motivo)
  values (p_produto_id, p_tipo, p_quantidade, coalesce(v_valor, 0), p_condominio, nullif(trim(p_motivo), ''));
end;
$$ language plpgsql security definer;

grant execute on function registrar_movimentacao(uuid, text, integer, text, text) to anon;

-- Empréstimo entre depósitos: desconta a quantidade do produto no depósito
-- de origem (pode deixar NEGATIVO de propósito — isso representa "devo X
-- unidades desse produto") e soma essa quantidade no mesmo produto (por
-- nome) no depósito de destino, criando o produto lá se ele ainda não
-- existir. Registra os dois lados no histórico de movimentações, pra ficar
-- rastreável. Depois, quando o produto for reposto normalmente (Entrada),
-- a soma simples já resolve sozinha a "dívida" (ex.: -1 + 3 = 2).
create or replace function emprestar_produto(
  p_produto_id uuid,
  p_deposito_destino text,
  p_quantidade integer
) returns void as $$
declare
  v_nome text;
  v_foto text;
  v_deposito_origem text;
  v_destino_id uuid;
  v_base text;
  v_sufixo text;
  v_tentativas integer := 0;
begin
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade inválida';
  end if;

  select nome, foto, deposito into v_nome, v_foto, v_deposito_origem
  from produtos
  where id = p_produto_id
  for update;

  if not found then
    raise exception 'Produto não encontrado';
  end if;

  if p_deposito_destino is null or trim(p_deposito_destino) = '' then
    raise exception 'Escolha um depósito de destino';
  end if;

  if p_deposito_destino = v_deposito_origem then
    raise exception 'O depósito de destino precisa ser diferente do atual';
  end if;

  -- desconta no depósito de origem (pode ficar negativo — é o empréstimo)
  update produtos set quantidade = quantidade - p_quantidade where id = p_produto_id;

  -- procura o mesmo produto (por nome) já cadastrado no depósito de destino
  select id into v_destino_id
  from produtos
  where deposito = p_deposito_destino
    and lower(trim(nome)) = lower(trim(v_nome))
  for update
  limit 1;

  if v_destino_id is not null then
    update produtos set quantidade = quantidade + p_quantidade where id = v_destino_id;
  else
    v_base := upper(substring(regexp_replace(v_nome, '[^A-Za-z]', '', 'g') from 1 for 3));
    if v_base is null or v_base = '' then
      v_base := 'EMP';
    end if;
    loop
      v_sufixo := lpad(floor(random() * 900 + 100)::text, 3, '0');
      begin
        insert into produtos (sku, nome, quantidade, foto, deposito, valor_unitario)
        values (v_base || '-' || v_sufixo, v_nome, p_quantidade, v_foto, p_deposito_destino, 0)
        returning id into v_destino_id;
        exit;
      exception when unique_violation then
        v_tentativas := v_tentativas + 1;
        if v_tentativas > 6 then
          raise exception 'Não foi possível gerar um SKU único pro produto no depósito de destino.';
        end if;
      end;
    end loop;
  end if;

  insert into movimentacoes (produto_id, tipo, quantidade, condominio, motivo)
  values (p_produto_id, 'saida', p_quantidade, null, 'Empréstimo enviado para ' || p_deposito_destino);

  insert into movimentacoes (produto_id, tipo, quantidade, condominio, motivo)
  values (v_destino_id, 'entrada', p_quantidade, null, 'Empréstimo recebido de ' || v_deposito_origem);
end;
$$ language plpgsql security definer;

grant execute on function emprestar_produto(uuid, text, integer) to anon;

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

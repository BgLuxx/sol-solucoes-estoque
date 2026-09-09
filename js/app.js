(function () {
  "use strict";

  const PAGE_SIZE = 50;

  const state = {
    supabase: null,
    produtos: [],
    historico: [],
    historicoOffset: 0,
    historicoTemMais: true,
    chart: null,
  };

  const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const fmtDataHora = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };
  const fmtMesAno = (date) => date.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });

  // ---------------- SUPABASE ----------------
  function initSupabase() {
    const cfg = window.SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.anonKey || cfg.url.startsWith("COLE_AQUI") || cfg.anonKey.startsWith("COLE_AQUI")) {
      document.body.innerHTML =
        '<div style="max-width:520px;margin:60px auto;font-family:sans-serif;padding:24px;line-height:1.5;">' +
        "<h2>Configuração pendente</h2>" +
        "<p>Abra o arquivo <code>js/config.js</code> e preencha <code>SUPABASE_CONFIG.url</code> e " +
        "<code>SUPABASE_CONFIG.anonKey</code> com os dados do seu projeto Supabase (veja o README.md).</p>" +
        "</div>";
      throw new Error("Supabase não configurado");
    }
    state.supabase = window.supabase.createClient(cfg.url, cfg.anonKey);
  }

  // ---------------- LOGIN ----------------
  function isAuthed() {
    return localStorage.getItem("sol_estoque_auth") === "ok";
  }

  function showApp() {
    document.getElementById("login-screen").hidden = true;
    document.getElementById("app").hidden = false;
    bootstrapApp();
  }

  function wireLogin() {
    const form = document.getElementById("login-form");
    const errorEl = document.getElementById("login-error");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = document.getElementById("login-password").value;
      if (val === window.APP_PASSWORD) {
        localStorage.setItem("sol_estoque_auth", "ok");
        errorEl.hidden = true;
        showApp();
      } else {
        errorEl.hidden = false;
      }
    });

    document.getElementById("logout-btn").addEventListener("click", () => {
      localStorage.removeItem("sol_estoque_auth");
      window.location.reload();
    });
  }

  // ---------------- TABS ----------------
  function wireTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      });
    });
  }

  // ---------------- TOAST ----------------
  let toastTimer = null;
  function toast(msg, isError) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3500);
  }

  function setFeedback(el, msg, ok) {
    el.textContent = msg;
    el.hidden = false;
    el.classList.remove("ok", "error");
    el.classList.add(ok ? "ok" : "error");
  }

  // ---------------- PRODUTOS ----------------
  async function carregarProdutos() {
    const { data, error } = await state.supabase
      .from("produtos")
      .select("*")
      .order("nome", { ascending: true });
    if (error) {
      toast("Erro ao carregar produtos: " + error.message, true);
      return;
    }
    state.produtos = data || [];
    renderSelectsProdutos();
    renderTabelaProdutos();
    renderStatsProdutos();
  }

  function renderSelectsProdutos() {
    const options =
      '<option value="">Selecione um produto...</option>' +
      state.produtos
        .map(
          (p) =>
            `<option value="${p.id}">${p.sku} — ${escapeHtml(p.nome)} (estoque: ${p.quantidade})</option>`
        )
        .join("");
    document.getElementById("entrada-produto").innerHTML = options;
    document.getElementById("saida-produto").innerHTML = options;
  }

  function renderTabelaProdutos() {
    const busca = (document.getElementById("estoque-busca").value || "").toLowerCase();
    const linhas = state.produtos.filter(
      (p) => p.nome.toLowerCase().includes(busca) || p.sku.toLowerCase().includes(busca)
    );
    const body = document.getElementById("produtos-body");
    if (!linhas.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">Nenhum produto encontrado.</td></tr>';
      return;
    }
    body.innerHTML = linhas
      .map(
        (p) => `
      <tr>
        <td>${p.sku}</td>
        <td>${escapeHtml(p.nome)}</td>
        <td>${fmtMoeda.format(p.valor_unitario)}</td>
        <td>${p.quantidade}</td>
        <td>${fmtMoeda.format(p.valor_unitario * p.quantidade)}</td>
        <td>
          <button class="link-btn" data-edit="${p.id}">Editar</button>
          <button class="link-btn danger" data-del="${p.id}">Excluir</button>
        </td>
      </tr>`
      )
      .join("");

    body.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => abrirEdicao(btn.dataset.edit))
    );
    body.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => excluirProduto(btn.dataset.del))
    );
  }

  function renderStatsProdutos() {
    document.getElementById("stat-produtos").textContent = state.produtos.length;
    const valorTotal = state.produtos.reduce((acc, p) => acc + p.valor_unitario * p.quantidade, 0);
    document.getElementById("stat-valor-estoque").textContent = fmtMoeda.format(valorTotal);
  }

  function skuBase(nome) {
    const limpo = nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    return limpo.slice(0, 3) || "PRD";
  }

  async function inserirProdutoComSku(base) {
    for (let i = 0; i < 6; i++) {
      const sufixo = String(Math.floor(100 + Math.random() * 900));
      const sku = `${skuBase(base.nome)}-${sufixo}`;
      const { data, error } = await state.supabase
        .from("produtos")
        .insert({ ...base, sku })
        .select()
        .single();
      if (!error) return { data, error: null };
      if (error.code !== "23505") return { data: null, error };
    }
    return { data: null, error: { message: "Não foi possível gerar um SKU único. Tente novamente." } };
  }

  function wireFormProduto() {
    const form = document.getElementById("form-produto");
    const msg = document.getElementById("produto-msg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nome = document.getElementById("produto-nome").value.trim();
      const valor = parseFloat(document.getElementById("produto-valor").value);
      const quantidade = parseInt(document.getElementById("produto-quantidade").value, 10);
      if (!nome || isNaN(valor) || isNaN(quantidade)) return;

      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      const { data, error } = await inserirProdutoComSku({ nome, valor_unitario: valor, quantidade });
      submitBtn.disabled = false;

      if (error) {
        setFeedback(msg, "Erro: " + error.message, false);
        return;
      }
      setFeedback(msg, `Produto "${data.nome}" cadastrado com SKU ${data.sku}.`, true);
      form.reset();
      document.getElementById("produto-quantidade").value = "0";
      await carregarProdutos();
    });

    document.getElementById("estoque-busca").addEventListener("input", renderTabelaProdutos);
  }

  // ---------------- EDITAR / EXCLUIR PRODUTO ----------------
  function abrirEdicao(id) {
    const p = state.produtos.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("edit-id").value = p.id;
    document.getElementById("edit-nome").value = p.nome;
    document.getElementById("edit-valor").value = p.valor_unitario;
    document.getElementById("edit-modal").hidden = false;
  }

  function wireModalEdicao() {
    document.getElementById("edit-cancel").addEventListener("click", () => {
      document.getElementById("edit-modal").hidden = true;
    });
    document.getElementById("edit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-id").value;
      const nome = document.getElementById("edit-nome").value.trim();
      const valor = parseFloat(document.getElementById("edit-valor").value);
      const { error } = await state.supabase
        .from("produtos")
        .update({ nome, valor_unitario: valor })
        .eq("id", id);
      if (error) {
        toast("Erro ao salvar: " + error.message, true);
        return;
      }
      document.getElementById("edit-modal").hidden = true;
      toast("Produto atualizado.");
      await carregarProdutos();
    });
  }

  async function excluirProduto(id) {
    if (!confirm("Excluir este produto? Essa ação não pode ser desfeita.")) return;
    const { error } = await state.supabase.from("produtos").delete().eq("id", id);
    if (error) {
      if (error.code === "23503") {
        toast("Não é possível excluir: já existem entradas/saídas registradas para este produto.", true);
      } else {
        toast("Erro ao excluir: " + error.message, true);
      }
      return;
    }
    toast("Produto excluído.");
    await carregarProdutos();
  }

  // ---------------- ENTRADA / SAÍDA ----------------
  function wireFormEntrada() {
    const form = document.getElementById("form-entrada");
    const msg = document.getElementById("entrada-msg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const produtoId = document.getElementById("entrada-produto").value;
      const quantidade = parseInt(document.getElementById("entrada-quantidade").value, 10);
      if (!produtoId || !quantidade) return;

      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      const { error } = await state.supabase.rpc("registrar_movimentacao", {
        p_produto_id: produtoId,
        p_tipo: "entrada",
        p_quantidade: quantidade,
        p_condominio: null,
        p_motivo: null,
      });
      submitBtn.disabled = false;

      if (error) {
        setFeedback(msg, "Erro: " + error.message, false);
        return;
      }
      setFeedback(msg, "Entrada registrada com sucesso.", true);
      form.reset();
      await Promise.all([carregarProdutos(), recarregarResumo()]);
    });
  }

  function wireFormSaida() {
    const form = document.getElementById("form-saida");
    const msg = document.getElementById("saida-msg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const produtoId = document.getElementById("saida-produto").value;
      const quantidade = parseInt(document.getElementById("saida-quantidade").value, 10);
      const condominio = document.getElementById("saida-condominio").value;
      const motivo = document.getElementById("saida-motivo").value.trim();
      if (!produtoId || !quantidade || !condominio) return;

      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      const { error } = await state.supabase.rpc("registrar_movimentacao", {
        p_produto_id: produtoId,
        p_tipo: "saida",
        p_quantidade: quantidade,
        p_condominio: condominio,
        p_motivo: motivo || null,
      });
      submitBtn.disabled = false;

      if (error) {
        setFeedback(msg, "Erro: " + error.message, false);
        return;
      }
      setFeedback(msg, "Saída registrada com sucesso.", true);
      form.reset();
      await Promise.all([carregarProdutos(), recarregarResumo()]);
    });
  }

  function preencherCondominios() {
    const sel = document.getElementById("saida-condominio");
    const options =
      '<option value="">Selecione o condomínio...</option>' +
      (window.CONDOMINIOS || []).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    sel.innerHTML = options;
  }

  // ---------------- RESUMO: contadores ----------------
  async function carregarContadores() {
    const [{ count: totalEntradas }, { count: totalSaidas }] = await Promise.all([
      state.supabase.from("movimentacoes").select("id", { count: "exact", head: true }).eq("tipo", "entrada"),
      state.supabase.from("movimentacoes").select("id", { count: "exact", head: true }).eq("tipo", "saida"),
    ]);
    document.getElementById("stat-entradas").textContent = totalEntradas ?? "—";
    document.getElementById("stat-saidas").textContent = totalSaidas ?? "—";
  }

  // ---------------- RESUMO: gráfico de gastos por mês ----------------
  async function carregarGraficoGastos() {
    const desde = new Date();
    desde.setMonth(desde.getMonth() - 11);
    desde.setDate(1);
    desde.setHours(0, 0, 0, 0);

    const { data, error } = await state.supabase
      .from("movimentacoes")
      .select("quantidade, valor_unitario, data")
      .eq("tipo", "saida")
      .gte("data", desde.toISOString());

    if (error) {
      console.error(error);
      return;
    }

    const meses = [];
    const cursor = new Date(desde);
    for (let i = 0; i < 12; i++) {
      meses.push({ key: `${cursor.getFullYear()}-${cursor.getMonth()}`, label: fmtMesAno(cursor), total: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    (data || []).forEach((mov) => {
      const d = new Date(mov.data);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = meses.find((m) => m.key === key);
      if (bucket) bucket.total += mov.quantidade * mov.valor_unitario;
    });

    const ctx = document.getElementById("chart-gastos").getContext("2d");
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: meses.map((m) => m.label),
        datasets: [
          {
            label: "Gasto com saídas (R$)",
            data: meses.map((m) => m.total.toFixed(2)),
            backgroundColor: "#f2701f",
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => fmtMoeda.format(v) },
          },
        },
      },
    });
  }

  // ---------------- RESUMO: histórico ----------------
  async function carregarHistorico(reset) {
    if (reset) {
      state.historico = [];
      state.historicoOffset = 0;
      state.historicoTemMais = true;
    }
    if (!state.historicoTemMais) return;

    const from = state.historicoOffset;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await state.supabase
      .from("movimentacoes")
      .select("id, tipo, quantidade, valor_unitario, condominio, motivo, data, produtos(nome, sku)")
      .order("data", { ascending: false })
      .range(from, to);

    if (error) {
      toast("Erro ao carregar histórico: " + error.message, true);
      return;
    }

    state.historico = state.historico.concat(data || []);
    state.historicoOffset += (data || []).length;
    state.historicoTemMais = (data || []).length === PAGE_SIZE;

    renderHistorico();
    document.getElementById("carregar-mais-btn").hidden = !state.historicoTemMais;
  }

  function renderHistorico() {
    const tipoFiltro = document.getElementById("filtro-tipo").value;
    const busca = (document.getElementById("filtro-busca").value || "").toLowerCase();

    const linhas = state.historico.filter((m) => {
      if (tipoFiltro && m.tipo !== tipoFiltro) return false;
      if (!busca) return true;
      const alvo = `${m.produtos?.nome || ""} ${m.produtos?.sku || ""} ${m.condominio || ""}`.toLowerCase();
      return alvo.includes(busca);
    });

    const body = document.getElementById("historico-body");
    if (!linhas.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">Nenhuma movimentação encontrada.</td></tr>';
      return;
    }

    body.innerHTML = linhas
      .map(
        (m) => `
      <tr>
        <td>${fmtDataHora(m.data)}</td>
        <td><span class="badge ${m.tipo}">${m.tipo === "entrada" ? "Entrada" : "Saída"}</span></td>
        <td>${escapeHtml(m.produtos?.nome || "—")} <span class="muted small">(${m.produtos?.sku || "—"})</span></td>
        <td>${m.quantidade}</td>
        <td>${fmtMoeda.format(m.quantidade * m.valor_unitario)}</td>
        <td>${escapeHtml(m.condominio || "—")}</td>
        <td>${escapeHtml(m.motivo || "—")}</td>
      </tr>`
      )
      .join("");
  }

  function wireFiltrosHistorico() {
    document.getElementById("filtro-tipo").addEventListener("change", renderHistorico);
    document.getElementById("filtro-busca").addEventListener("input", renderHistorico);
    document.getElementById("carregar-mais-btn").addEventListener("click", () => carregarHistorico(false));
  }

  async function recarregarResumo() {
    await Promise.all([carregarContadores(), carregarGraficoGastos(), carregarHistorico(true)]);
  }

  // ---------------- UTIL ----------------
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  // ---------------- BOOTSTRAP ----------------
  let bootstrapped = false;
  async function bootstrapApp() {
    if (bootstrapped) return;
    bootstrapped = true;
    preencherCondominios();
    wireFormProduto();
    wireModalEdicao();
    wireFormEntrada();
    wireFormSaida();
    wireFiltrosHistorico();
    await carregarProdutos();
    await recarregarResumo();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initSupabase();
    wireLogin();
    wireTabs();
    if (isAuthed()) showApp();
  });
})();

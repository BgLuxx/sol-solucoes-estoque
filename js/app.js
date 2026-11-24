(function () {
  "use strict";

  const PAGE_SIZE = 50;
  const ESTOQUE_BAIXO_LIMITE = 3;

  const state = {
    supabase: null,
    produtos: [],
    historico: [],
    historicoOffset: 0,
    historicoTemMais: true,
    depositoAtual: null,
  };

  const fmtDataHora = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

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

  // ---------------- FOTO DE PRODUTO ----------------
  const FOTO_MAX_DIM = 800; // px, maior lado
  const FOTO_MAX_BYTES_ORIGINAL = 8 * 1024 * 1024; // 8MB antes de comprimir

  function lerArquivoComoImagem(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Não foi possível ler essa imagem."));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
      reader.readAsDataURL(file);
    });
  }

  async function comprimirFoto(file) {
    if (!file.type || !file.type.startsWith("image/")) {
      throw new Error("Selecione um arquivo de imagem.");
    }
    if (file.size > FOTO_MAX_BYTES_ORIGINAL) {
      throw new Error("Imagem muito grande (máximo 8MB).");
    }
    const img = await lerArquivoComoImagem(file);
    let { width, height } = img;
    if (width > FOTO_MAX_DIM || height > FOTO_MAX_DIM) {
      if (width >= height) {
        height = Math.round((height * FOTO_MAX_DIM) / width);
        width = FOTO_MAX_DIM;
      } else {
        width = Math.round((width * FOTO_MAX_DIM) / height);
        height = FOTO_MAX_DIM;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.75);
  }

  // Liga um <input type="file"> a uma pré-visualização com botão de remover.
  // onChange recebe: string (data URL nova), ou null (removida explicitamente).
  function wireFotoInput({ inputId, previewWrapId, previewImgId, removerBtnId, onChange }) {
    const input = document.getElementById(inputId);
    const wrap = document.getElementById(previewWrapId);
    const img = document.getElementById(previewImgId);
    const removerBtn = document.getElementById(removerBtnId);

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const dataUrl = await comprimirFoto(file);
        img.src = dataUrl;
        wrap.hidden = false;
        onChange(dataUrl);
      } catch (err) {
        toast(err.message, true);
        input.value = "";
      }
    });

    removerBtn.addEventListener("click", () => {
      input.value = "";
      img.src = "";
      wrap.hidden = true;
      onChange(null);
    });
  }

  function abrirFotoModal(id) {
    const p = state.produtos.find((x) => x.id === id);
    if (!p || !p.foto) return;
    const img = document.getElementById("foto-modal-img");
    img.src = p.foto;
    img.alt = p.nome;
    document.getElementById("foto-modal").hidden = false;
  }

  function wireFotoModal() {
    document.getElementById("foto-modal-fechar").addEventListener("click", () => {
      document.getElementById("foto-modal").hidden = true;
    });
    document.getElementById("foto-modal").addEventListener("click", (e) => {
      if (e.target.id === "foto-modal") document.getElementById("foto-modal").hidden = true;
    });
  }

  // ---------------- DEPÓSITOS (estoques separados) ----------------
  function chaveAckEstoqueBaixo() {
    return `sol_estoque_baixo_ack_${state.depositoAtual}`;
  }

  function lerAckEstoqueBaixo() {
    try {
      return JSON.parse(localStorage.getItem(chaveAckEstoqueBaixo()) || "{}");
    } catch {
      return {};
    }
  }

  function salvarAckEstoqueBaixo(mapa) {
    localStorage.setItem(chaveAckEstoqueBaixo(), JSON.stringify(mapa));
  }

  function preencherSeletorDeposito() {
    const sel = document.getElementById("deposito-select");
    const lista = window.DEPOSITOS && window.DEPOSITOS.length ? window.DEPOSITOS : ["SOL 1"];
    sel.innerHTML = lista.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
    const salvo = localStorage.getItem("sol_estoque_deposito_atual");
    state.depositoAtual = lista.includes(salvo) ? salvo : lista[0];
    sel.value = state.depositoAtual;
  }

  function wireSeletorDeposito() {
    document.getElementById("deposito-select").addEventListener("change", async (e) => {
      state.depositoAtual = e.target.value;
      localStorage.setItem("sol_estoque_deposito_atual", state.depositoAtual);
      document.getElementById("alerta-estoque-baixo").hidden = true;
      await recarregarTudo();
    });
  }

  function confirmarCienteEstoqueBaixo() {
    const barra = document.getElementById("alerta-estoque-baixo");
    const itens = JSON.parse(barra.dataset.skus || "[]");
    const ack = lerAckEstoqueBaixo();
    itens.forEach((it) => (ack[it.sku] = it.quantidade));
    salvarAckEstoqueBaixo(ack);
    barra.hidden = true;
  }

  function renderListaModalEstoqueBaixo(itens) {
    const lista = document.getElementById("estoque-baixo-modal-lista");
    if (!itens.length) {
      lista.innerHTML = '<p class="muted small">Nenhum produto com estoque baixo no momento.</p>';
      return;
    }
    lista.innerHTML = itens
      .map(
        (p) => `
      <div class="mini-item">
        <div class="mini-item-top">
          <span>${escapeHtml(p.nome)}</span>
          <span class="mini-item-qtd">${p.quantidade} un.</span>
        </div>
      </div>`
      )
      .join("");
  }

  function abrirModalEstoqueBaixoPendentes() {
    const barra = document.getElementById("alerta-estoque-baixo");
    const itens = JSON.parse(barra.dataset.skus || "[]");
    renderListaModalEstoqueBaixo(itens);
    document.getElementById("estoque-baixo-modal").hidden = false;
  }

  function abrirModalEstoqueBaixoCompleto() {
    const baixos = state.produtos.filter((p) => p.quantidade <= ESTOQUE_BAIXO_LIMITE);
    renderListaModalEstoqueBaixo(baixos);
    document.getElementById("estoque-baixo-modal").hidden = false;
  }

  function wireAlertaEstoqueBaixo() {
    document.getElementById("alerta-estoque-ver").addEventListener("click", abrirModalEstoqueBaixoPendentes);
    document.getElementById("alerta-estoque-ciente").addEventListener("click", confirmarCienteEstoqueBaixo);
    document.getElementById("card-estoque-baixo").addEventListener("click", abrirModalEstoqueBaixoCompleto);
    document.getElementById("estoque-baixo-modal-fechar").addEventListener("click", () => {
      document.getElementById("estoque-baixo-modal").hidden = true;
    });
    document.getElementById("estoque-baixo-modal-ciente").addEventListener("click", () => {
      confirmarCienteEstoqueBaixo();
      document.getElementById("estoque-baixo-modal").hidden = true;
    });
  }

  async function recarregarTudo() {
    document.getElementById("resumo-deposito-label").textContent = state.depositoAtual;
    await carregarProdutos();
    await Promise.all([
      recarregarResumo(),
      carregarPainelMovimentacoes("entrada"),
      carregarPainelMovimentacoes("saida"),
    ]);
  }

  // ---------------- PRODUTOS ----------------
  async function carregarProdutos() {
    const { data, error } = await state.supabase
      .from("produtos")
      .select("*")
      .eq("deposito", state.depositoAtual)
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
      body.innerHTML = '<tr><td colspan="5" class="muted">Nenhum produto encontrado.</td></tr>';
      return;
    }
    const temOutroDeposito =
      (window.DEPOSITOS || []).filter((d) => d !== state.depositoAtual).length > 0;
    body.innerHTML = linhas
      .map(
        (p) => `
      <tr>
        <td>${
          p.foto
            ? `<img src="${p.foto}" class="produto-thumb" data-view="${p.id}" alt="Foto de ${escapeHtml(p.nome)}" />`
            : '<span class="produto-thumb-vazia">Sem foto</span>'
        }</td>
        <td>${p.sku}</td>
        <td>${escapeHtml(p.nome)}</td>
        <td>${
          p.quantidade <= ESTOQUE_BAIXO_LIMITE
            ? `<span class="qtd-baixa">${p.quantidade}</span>`
            : p.quantidade
        }</td>
        <td>
          <button class="link-btn" data-edit="${p.id}">Editar</button>
          ${
            temOutroDeposito
              ? `<button class="link-btn" data-emprestar="${p.id}">Emprestar</button>`
              : ""
          }
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
    body.querySelectorAll("[data-view]").forEach((el) =>
      el.addEventListener("click", () => abrirFotoModal(el.dataset.view))
    );
    body.querySelectorAll("[data-emprestar]").forEach((btn) =>
      btn.addEventListener("click", () => abrirEmprestimo(btn.dataset.emprestar))
    );
  }

  // ---------------- EMPRÉSTIMO ENTRE DEPÓSITOS ----------------
  function abrirEmprestimo(id) {
    const p = state.produtos.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("emprestar-produto-id").value = p.id;
    document.getElementById("emprestar-produto-nome").textContent = p.nome;
    const outros = (window.DEPOSITOS || []).filter((d) => d !== state.depositoAtual);
    document.getElementById("emprestar-deposito-destino").innerHTML = outros
      .map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`)
      .join("");
    document.getElementById("emprestar-quantidade").value = "";
    document.getElementById("emprestar-modal").hidden = false;
  }

  function wireModalEmprestimo() {
    document.getElementById("emprestar-cancel").addEventListener("click", () => {
      document.getElementById("emprestar-modal").hidden = true;
    });
    document.getElementById("emprestar-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const produtoId = document.getElementById("emprestar-produto-id").value;
      const destino = document.getElementById("emprestar-deposito-destino").value;
      const quantidade = parseInt(document.getElementById("emprestar-quantidade").value, 10);
      if (!produtoId || !destino || !quantidade) return;

      const submitBtn = e.target.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      const { error } = await state.supabase.rpc("emprestar_produto", {
        p_produto_id: produtoId,
        p_deposito_destino: destino,
        p_quantidade: quantidade,
      });
      submitBtn.disabled = false;

      if (error) {
        toast("Erro ao emprestar: " + error.message, true);
        return;
      }
      document.getElementById("emprestar-modal").hidden = true;
      toast(`Empréstimo registrado: ${quantidade} un. enviada(s) pra ${destino}.`);
      await recarregarTudo();
    });
  }

  // ---------------- IMPRIMIR / BAIXAR LISTA DE ESTOQUE ----------------
  function imprimirListaProdutos() {
    const linhas = [...state.produtos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const dataStr = new Date().toLocaleDateString("pt-BR");
    const win = window.open("", "_blank");
    if (!win) {
      toast("Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.", true);
      return;
    }
    const linhasHtml = linhas
      .map(
        (p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(p.sku)}</td>
        <td>${escapeHtml(p.nome)}</td>
        <td class="qtd">${p.quantidade}</td>
        <td class="vazio"></td>
        <td class="vazio"></td>
      </tr>`
      )
      .join("");
    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Estoque ${escapeHtml(state.depositoAtual)} — ${dataStr}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #1c2733; }
  h1 { font-size: 1.3rem; margin: 0 0 2px; }
  p.sub { color: #6b7a89; margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { border: 1px solid #999; padding: 6px 10px; text-align: left; }
  th { background: #eee; }
  td.qtd { text-align: center; font-weight: 700; }
  td.vazio { min-width: 90px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Estoque — ${escapeHtml(state.depositoAtual)}</h1>
  <p class="sub">Impresso em ${dataStr} · ${linhas.length} produto(s)</p>
  <table>
    <thead>
      <tr><th>#</th><th>SKU</th><th>Produto</th><th>Qtd. no sistema</th><th>Contagem física</th><th>Diferença</th></tr>
    </thead>
    <tbody>${linhasHtml}</tbody>
  </table>
</body>
</html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  function wireImprimirLista() {
    document.getElementById("estoque-imprimir-btn").addEventListener("click", imprimirListaProdutos);
  }

  function renderStatsProdutos() {
    document.getElementById("stat-produtos").textContent = state.produtos.length;
    renderEstoqueBaixo();
  }

  function renderEstoqueBaixo() {
    const baixos = state.produtos.filter((p) => p.quantidade <= ESTOQUE_BAIXO_LIMITE);
    document.getElementById("stat-estoque-baixo").textContent = baixos.length;

    const ack = lerAckEstoqueBaixo();
    const pendentes = baixos.filter((p) => ack[p.sku] !== p.quantidade);

    const barra = document.getElementById("alerta-estoque-baixo");
    barra.dataset.skus = JSON.stringify(
      pendentes.map((p) => ({ sku: p.sku, quantidade: p.quantidade, nome: p.nome }))
    );
    if (!pendentes.length) {
      barra.hidden = true;
      return;
    }
    barra.hidden = false;
    document.getElementById("alerta-estoque-contador").textContent = pendentes.length;
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

  let novaFotoProduto = null;

  function wireFormProduto() {
    const form = document.getElementById("form-produto");
    const msg = document.getElementById("produto-msg");

    wireFotoInput({
      inputId: "produto-foto",
      previewWrapId: "produto-foto-preview",
      previewImgId: "produto-foto-preview-img",
      removerBtnId: "produto-foto-remover",
      onChange: (dataUrl) => {
        novaFotoProduto = dataUrl;
      },
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nome = document.getElementById("produto-nome").value.trim();
      const quantidade = parseInt(document.getElementById("produto-quantidade").value, 10);
      if (!nome || isNaN(quantidade)) return;

      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      const { data, error } = await inserirProdutoComSku({
        nome,
        quantidade,
        foto: novaFotoProduto,
        deposito: state.depositoAtual,
      });
      submitBtn.disabled = false;

      if (error) {
        setFeedback(msg, "Erro: " + error.message, false);
        return;
      }
      setFeedback(msg, `Produto "${data.nome}" cadastrado com SKU ${data.sku}.`, true);
      form.reset();
      document.getElementById("produto-quantidade").value = "0";
      novaFotoProduto = null;
      document.getElementById("produto-foto-preview").hidden = true;
      await carregarProdutos();
    });

    document.getElementById("estoque-busca").addEventListener("input", renderTabelaProdutos);
  }

  // ---------------- EDITAR / EXCLUIR PRODUTO ----------------
  // undefined = manter foto atual; null = remover; string = nova foto
  let editFotoValor;

  function abrirEdicao(id) {
    const p = state.produtos.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("edit-id").value = p.id;
    document.getElementById("edit-nome").value = p.nome;

    editFotoValor = undefined;
    document.getElementById("edit-foto").value = "";
    const preview = document.getElementById("edit-foto-preview");
    const previewImg = document.getElementById("edit-foto-preview-img");
    if (p.foto) {
      previewImg.src = p.foto;
      preview.hidden = false;
    } else {
      previewImg.src = "";
      preview.hidden = true;
    }

    document.getElementById("edit-modal").hidden = false;
  }

  function wireModalEdicao() {
    wireFotoInput({
      inputId: "edit-foto",
      previewWrapId: "edit-foto-preview",
      previewImgId: "edit-foto-preview-img",
      removerBtnId: "edit-foto-remover",
      onChange: (dataUrl) => {
        editFotoValor = dataUrl;
      },
    });

    document.getElementById("edit-cancel").addEventListener("click", () => {
      document.getElementById("edit-modal").hidden = true;
    });
    document.getElementById("edit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-id").value;
      const nome = document.getElementById("edit-nome").value.trim();
      const patch = { nome };
      if (editFotoValor !== undefined) patch.foto = editFotoValor;
      const { error } = await state.supabase.from("produtos").update(patch).eq("id", id);
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
      await Promise.all([carregarProdutos(), recarregarResumo(), carregarPainelMovimentacoes("entrada")]);
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
      await Promise.all([carregarProdutos(), recarregarResumo(), carregarPainelMovimentacoes("saida")]);
    });
  }

  // ---------------- PAINÉIS LATERAIS (entrada / saída) ----------------
  function formatarDataCurta(iso) {
    const d = new Date(iso);
    return {
      hora: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      dia: d.toLocaleDateString("pt-BR"),
      mes: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    };
  }

  async function carregarPainelMovimentacoes(tipo) {
    const prefixo = tipo === "entrada" ? "entrada" : "saida";
    const listaEl = document.getElementById(`${prefixo}-lista`);
    const diaVal = document.getElementById(`${prefixo}-filtro-dia`).value;
    const mesVal = document.getElementById(`${prefixo}-filtro-mes`).value;

    let query = state.supabase
      .from("movimentacoes")
      .select("id, quantidade, condominio, motivo, data, produtos!inner(nome, sku, deposito)")
      .eq("tipo", tipo)
      .eq("produtos.deposito", state.depositoAtual)
      .order("data", { ascending: false })
      .limit(100);

    if (diaVal) {
      const [inicio, fim] = getDayRange(diaVal);
      query = query.gte("data", inicio).lt("data", fim);
    } else if (mesVal) {
      const [inicio, fim] = getMonthRange(mesVal);
      query = query.gte("data", inicio).lt("data", fim);
    }

    const { data, error } = await query;

    if (error) {
      listaEl.innerHTML = `<p class="muted small">Erro ao carregar: ${escapeHtml(error.message)}</p>`;
      return;
    }

    if (!data || !data.length) {
      listaEl.innerHTML = '<p class="muted small">Nenhuma movimentação encontrada nesse período.</p>';
      return;
    }

    listaEl.innerHTML = data
      .map((m) => {
        const { hora, dia, mes } = formatarDataCurta(m.data);
        const ehEmprestimo = (m.motivo || "").startsWith("Empréstimo");
        const partesExtra = [];
        if (tipo === "saida" && m.condominio) partesExtra.push(escapeHtml(m.condominio));
        if (m.motivo) partesExtra.push(escapeHtml(m.motivo));
        const extra = partesExtra.length
          ? `<div class="mini-item-extra">${partesExtra.join(" · ")}</div>`
          : "";
        return `
      <div class="mini-item${ehEmprestimo ? " mini-item-emprestimo" : ""}">
        <div class="mini-item-top">
          <span>${ehEmprestimo ? "🔁 " : ""}${escapeHtml(m.produtos?.nome || "—")} <span class="muted small">(${m.produtos?.sku || "—"})</span></span>
          <span class="mini-item-qtd">${m.quantidade}x</span>
        </div>
        <div class="mini-item-meta">${dia} às ${hora} · ${mes}</div>
        ${extra}
      </div>`;
      })
      .join("");
  }

  function wirePainelFiltro(tipo) {
    const prefixo = tipo === "entrada" ? "entrada" : "saida";
    const diaInput = document.getElementById(`${prefixo}-filtro-dia`);
    const mesInput = document.getElementById(`${prefixo}-filtro-mes`);
    const limparBtn = document.getElementById(`${prefixo}-filtro-limpar`);

    diaInput.addEventListener("change", () => {
      if (diaInput.value) mesInput.value = "";
      carregarPainelMovimentacoes(tipo);
    });
    mesInput.addEventListener("change", () => {
      if (mesInput.value) diaInput.value = "";
      carregarPainelMovimentacoes(tipo);
    });
    limparBtn.addEventListener("click", () => {
      diaInput.value = "";
      mesInput.value = "";
      carregarPainelMovimentacoes(tipo);
    });
  }

  function preencherCondominios() {
    const sel = document.getElementById("saida-condominio");
    const options =
      '<option value="">Selecione o condomínio...</option>' +
      '<option value="Outros">Outros (serviço fora dos condomínios)</option>' +
      (window.CONDOMINIOS || []).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    sel.innerHTML = options;
  }

  // ---------------- RESUMO: contadores ----------------
  async function carregarContadores() {
    const [{ count: totalEntradas }, { count: totalSaidas }] = await Promise.all([
      state.supabase
        .from("movimentacoes")
        .select("id, produtos!inner(deposito)", { count: "exact", head: true })
        .eq("tipo", "entrada")
        .eq("produtos.deposito", state.depositoAtual),
      state.supabase
        .from("movimentacoes")
        .select("id, produtos!inner(deposito)", { count: "exact", head: true })
        .eq("tipo", "saida")
        .eq("produtos.deposito", state.depositoAtual),
    ]);
    document.getElementById("stat-entradas").textContent = totalEntradas ?? "—";
    document.getElementById("stat-saidas").textContent = totalSaidas ?? "—";
  }

  // ---------------- RESUMO: filtro de período ----------------
  function obterRangePeriodoResumo() {
    const modo = document.getElementById("filtro-periodo-modo").value;
    if (modo === "dia" || modo === "semana") {
      const val = document.getElementById("filtro-periodo-dia").value;
      if (!val) return null;
      return modo === "dia" ? getDayRange(val) : getWeekRange(val);
    }
    if (modo === "mes") {
      const val = document.getElementById("filtro-periodo-mes").value;
      if (!val) return null;
      return getMonthRange(val);
    }
    return null;
  }

  function atualizarVisibilidadePeriodo() {
    const modo = document.getElementById("filtro-periodo-modo").value;
    document.getElementById("filtro-periodo-dia").hidden = !(modo === "dia" || modo === "semana");
    document.getElementById("filtro-periodo-mes").hidden = modo !== "mes";
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
    let query = state.supabase
      .from("movimentacoes")
      .select("id, tipo, quantidade, condominio, motivo, data, produtos!inner(nome, sku, deposito)")
      .eq("produtos.deposito", state.depositoAtual)
      .order("data", { ascending: false })
      .range(from, to);

    const tipoFiltro = document.getElementById("filtro-tipo").value;
    if (tipoFiltro) query = query.eq("tipo", tipoFiltro);

    const periodoRange = obterRangePeriodoResumo();
    if (periodoRange) query = query.gte("data", periodoRange[0]).lt("data", periodoRange[1]);

    const { data, error } = await query;

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
    const busca = (document.getElementById("filtro-busca").value || "").toLowerCase();

    const linhas = state.historico.filter((m) => {
      if (!busca) return true;
      const alvo = `${m.produtos?.nome || ""} ${m.produtos?.sku || ""} ${m.condominio || ""} ${m.motivo || ""}`.toLowerCase();
      return alvo.includes(busca);
    });

    const body = document.getElementById("historico-body");
    if (!linhas.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">Nenhuma movimentação encontrada.</td></tr>';
      return;
    }

    body.innerHTML = linhas
      .map((m) => {
        const ehEmprestimo = (m.motivo || "").startsWith("Empréstimo");
        return `
      <tr>
        <td>${fmtDataHora(m.data)}</td>
        <td><span class="badge ${m.tipo}">${m.tipo === "entrada" ? "Entrada" : "Saída"}</span>${
          ehEmprestimo ? '<span class="badge emprestimo">🔁 Empréstimo</span>' : ""
        }</td>
        <td>${escapeHtml(m.produtos?.nome || "—")} <span class="muted small">(${m.produtos?.sku || "—"})</span></td>
        <td>${m.quantidade}</td>
        <td>${escapeHtml(m.condominio || "—")}</td>
        <td>${escapeHtml(m.motivo || "—")}</td>
      </tr>`;
      })
      .join("");
  }

  function wireFiltrosHistorico() {
    atualizarVisibilidadePeriodo();
    document.getElementById("filtro-tipo").addEventListener("change", () => carregarHistorico(true));
    document.getElementById("filtro-periodo-modo").addEventListener("change", () => {
      atualizarVisibilidadePeriodo();
      carregarHistorico(true);
    });
    document.getElementById("filtro-periodo-dia").addEventListener("change", () => carregarHistorico(true));
    document.getElementById("filtro-periodo-mes").addEventListener("change", () => carregarHistorico(true));
    document.getElementById("filtro-busca").addEventListener("input", renderHistorico);
    document.getElementById("carregar-mais-btn").addEventListener("click", () => carregarHistorico(false));
  }

  async function recarregarResumo() {
    await Promise.all([carregarContadores(), carregarHistorico(true)]);
  }

  // ---------------- UTIL: intervalos de data ----------------
  function getDayRange(dateStr) {
    const start = new Date(dateStr + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return [start.toISOString(), end.toISOString()];
  }

  function getWeekRange(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const dia = d.getDay();
    const diffSegunda = dia === 0 ? -6 : 1 - dia;
    const segunda = new Date(d);
    segunda.setDate(d.getDate() + diffSegunda);
    const proximaSegunda = new Date(segunda);
    proximaSegunda.setDate(segunda.getDate() + 7);
    return [segunda.toISOString(), proximaSegunda.toISOString()];
  }

  function getMonthRange(monthStr) {
    const [y, m] = monthStr.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return [start.toISOString(), end.toISOString()];
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
    preencherSeletorDeposito();
    wireSeletorDeposito();
    wireAlertaEstoqueBaixo();
    preencherCondominios();
    wireFormProduto();
    wireModalEdicao();
    wireModalEmprestimo();
    wireImprimirLista();
    wireFotoModal();
    wireFormEntrada();
    wireFormSaida();
    wireFiltrosHistorico();
    wirePainelFiltro("entrada");
    wirePainelFiltro("saida");
    await recarregarTudo();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initSupabase();
    wireLogin();
    wireTabs();
    if (isAuthed()) showApp();
  });
})();

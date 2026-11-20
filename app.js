(() => {
  "use strict";

  const config = window.ARCHIVE_CONFIG || {};
  const PAGE_SIZE = 12;
  const ARCHIVE_AGE_DAYS = 7;
  const API_URL = String(config.supabaseUrl || "").replace(/\/+$/, "") + "/rest/v1";
  const API_KEY = config.supabaseKey || "";

  const state = {
    page: 0,
    total: 0,
    search: "",
    categoryId: "",
    subcategoryId: "",
    categories: [],
    subcategories: [],
    categoryNames: new Map(),
    subcategoryNames: new Map(),
    articles: []
  };

  const el = {
    filters: document.getElementById("filters"),
    search: document.getElementById("search-input"),
    category: document.getElementById("category-filter"),
    subcategory: document.getElementById("subcategory-filter"),
    reset: document.getElementById("reset-button"),
    count: document.getElementById("archive-count"),
    summary: document.getElementById("results-summary"),
    message: document.getElementById("message"),
    articles: document.getElementById("articles"),
    pagination: document.getElementById("pagination"),
    prev: document.getElementById("prev-page"),
    next: document.getElementById("next-page"),
    pageIndicator: document.getElementById("page-indicator"),
    dialog: document.getElementById("article-dialog"),
    dialogCategory: document.getElementById("dialog-category"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogMeta: document.getElementById("dialog-meta"),
    dialogBody: document.getElementById("dialog-body"),
    dialogSource: document.getElementById("dialog-source")
  };

  document.getElementById("year").textContent = String(new Date().getFullYear());

  function setMessage(message, visible) {
    el.message.textContent = message || "";
    el.message.hidden = !visible;
  }

  function apiHeaders() {
    return {
      apikey: API_KEY,
      Authorization: "Bearer " + API_KEY,
      Accept: "application/json",
      Prefer: "count=exact"
    };
  }

  async function apiGet(table, params, range) {
    const url = new URL(API_URL + "/" + table);
    Object.keys(params).forEach((key) => url.searchParams.set(key, params[key]));
    const headers = apiHeaders();
    if (range) {
      headers.Range = range.start + "-" + range.end;
      headers["Range-Unit"] = "items";
    }
    const response = await fetch(url.toString(), { method: "GET", headers });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("خطای دریافت اطلاعات (" + response.status + ")" + (detail ? ": " + detail.slice(0, 180) : ""));
    }
    const totalHeader = response.headers.get("Content-Range") || "";
    const totalMatch = totalHeader.match(/\/(\d+|\*)$/);
    return {
      data: await response.json(),
      total: totalMatch && totalMatch[1] !== "*" ? Number(totalMatch[1]) : null
    };
  }

  function fillSelect(select, rows, placeholder) {
    select.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);
    rows.forEach((row) => {
      const option = document.createElement("option");
      option.value = String(row.id);
      option.textContent = row.title;
      select.appendChild(option);
    });
  }

  async function loadTaxonomy() {
    const [categories, subcategories] = await Promise.all([
      apiGet("categories", {
        select: "id,title,slug,sort_order,is_active",
        is_active: "eq.true",
        order: "sort_order.asc"
      }),
      apiGet("subcategories", {
        select: "id,category_id,title,slug,sort_order,is_active",
        is_active: "eq.true",
        order: "sort_order.asc"
      })
    ]);
    state.categories = categories.data || [];
    state.subcategories = subcategories.data || [];
    state.categories.forEach((item) => state.categoryNames.set(String(item.id), item.title));
    state.subcategories.forEach((item) => state.subcategoryNames.set(String(item.id), item.title));
    fillSelect(el.category, state.categories, "همه بخش‌ها");
    updateSubcategoryOptions();
  }

  function updateSubcategoryOptions() {
    const selectedCategory = el.category.value;
    const rows = state.subcategories.filter((item) => !selectedCategory || String(item.category_id) === selectedCategory);
    fillSelect(el.subcategory, rows, "همه زیرعنوان‌ها");
    el.subcategory.disabled = rows.length === 0;
    if (state.subcategoryId && !rows.some((item) => String(item.id) === state.subcategoryId)) {
      state.subcategoryId = "";
    }
    el.subcategory.value = state.subcategoryId;
  }

  function archiveCutoff() {
    return new Date(Date.now() - ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  function safeSearchTerm(value) {
    return value
      .trim()
      .replace(/[,*()\\]/g, " ")
      .replace(/[<>]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 80);
  }

  function archiveQuery() {
    const params = {
      select: "id,title,body,category_id,subcategory_id,published_at,created_at,source_name,source_url,image_url",
      is_published: "eq.true",
      published_at: "not.is.null",
      and: "(published_at.lte." + archiveCutoff() + ")",
      order: "published_at.desc"
    };
    if (state.categoryId) params.category_id = "eq." + state.categoryId;
    if (state.subcategoryId) params.subcategory_id = "eq." + state.subcategoryId;
    if (state.search) {
      const term = safeSearchTerm(state.search);
      if (term) params.or = "(title.ilike.*" + term + "*,body.ilike.*" + term + "*)";
    }
    return params;
  }

  function formatDate(value) {
    if (!value) return "تاریخ نامشخص";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "تاریخ نامشخص";
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "long",
      timeZone: "Asia/Tehran"
    }).format(date);
  }

  function categoryLabel(article) {
    return state.subcategoryNames.get(String(article.subcategory_id))
      || state.categoryNames.get(String(article.category_id))
      || "مطالب نشاط زندگی";
  }

  function createText(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? "" : String(value);
    return node;
  }

  function createArticleCard(article) {
    const card = document.createElement("article");
    card.className = "article-card";

    const top = document.createElement("div");
    top.className = "card-top";
    top.appendChild(createText("span", "category-chip", categoryLabel(article)));
    top.appendChild(createText("time", "date-label", formatDate(article.published_at)));

    const title = createText("h3", "card-title", article.title || "بدون عنوان");
    const body = createText("p", "card-excerpt", article.body || "متن این مطلب ثبت نشده است.");
    const sourceName = article.source_name || "تیم تحریریه نشاط زندگی";
    const source = createText("span", "card-source", "منبع: " + sourceName);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "read-more";
    open.textContent = "مطالعه کامل";
    open.addEventListener("click", () => openArticle(article));

    card.append(top, title, body, source, open);
    return card;
  }

  function openArticle(article) {
    el.dialogCategory.textContent = categoryLabel(article);
    el.dialogTitle.textContent = article.title || "بدون عنوان";
    el.dialogMeta.textContent = "تاریخ انتشار: " + formatDate(article.published_at);
    el.dialogBody.textContent = article.body || "متن این مطلب ثبت نشده است.";
    el.dialogSource.replaceChildren();
    const sourceName = article.source_name || "تیم تحریریه نشاط زندگی";
    el.dialogSource.appendChild(document.createTextNode("منبع: "));
    let safeSourceUrl = "";
    try {
      const parsedUrl = new URL(article.source_url);
      if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") safeSourceUrl = parsedUrl.href;
    } catch (_) {
      safeSourceUrl = "";
    }
    if (safeSourceUrl) {
      const link = document.createElement("a");
      link.href = safeSourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = sourceName;
      el.dialogSource.appendChild(link);
    } else {
      el.dialogSource.appendChild(document.createTextNode(sourceName));
    }
    if (typeof el.dialog.showModal === "function") el.dialog.showModal();
  }

  function renderPagination() {
    const pageCount = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    el.pagination.hidden = state.total <= PAGE_SIZE;
    el.prev.disabled = state.page <= 0;
    el.next.disabled = state.page >= pageCount - 1;
    el.pageIndicator.textContent = "صفحه " + (state.page + 1) + " از " + pageCount;
  }

  function renderArticles() {
    el.articles.replaceChildren();
    if (!state.articles.length) {
      setMessage("برای این جست‌وجو هنوز مطلبی در آرشیو پیدا نشد.", true);
    } else {
      setMessage("", false);
      state.articles.forEach((article) => el.articles.appendChild(createArticleCard(article)));
    }
    el.count.textContent = state.total.toLocaleString("fa-IR");
    const first = state.total ? state.page * PAGE_SIZE + 1 : 0;
    const last = Math.min((state.page + 1) * PAGE_SIZE, state.total);
    el.summary.textContent = state.total
      ? "نمایش " + first.toLocaleString("fa-IR") + " تا " + last.toLocaleString("fa-IR") + " از " + state.total.toLocaleString("fa-IR") + " مطلب"
      : "مطلبی برای نمایش وجود ندارد";
    renderPagination();
  }

  async function loadArticles() {
    setMessage("در حال دریافت مطالب آرشیو…", true);
    el.articles.replaceChildren();
    el.pagination.hidden = true;
    try {
      const start = state.page * PAGE_SIZE;
      const result = await apiGet("contents", archiveQuery(), {
        start,
        end: start + PAGE_SIZE - 1
      });
      state.articles = result.data || [];
      state.total = result.total == null ? state.articles.length : result.total;
      renderArticles();
    } catch (error) {
      console.error(error);
      setMessage("دریافت مطالب با مشکل روبه‌رو شد. اتصال اینترنت و تنظیمات دسترسی عمومی را بررسی کنید. " + error.message, true);
      el.summary.textContent = "خطا در دریافت اطلاعات";
    }
  }

  el.filters.addEventListener("submit", (event) => {
    event.preventDefault();
    state.search = el.search.value;
    state.categoryId = el.category.value;
    state.subcategoryId = el.subcategory.value;
    state.page = 0;
    loadArticles();
  });

  el.category.addEventListener("change", () => {
    state.categoryId = el.category.value;
    state.subcategoryId = "";
    updateSubcategoryOptions();
  });

  el.subcategory.addEventListener("change", () => {
    state.subcategoryId = el.subcategory.value;
  });

  el.reset.addEventListener("click", () => {
    el.search.value = "";
    el.category.value = "";
    state.search = "";
    state.categoryId = "";
    state.subcategoryId = "";
    state.page = 0;
    updateSubcategoryOptions();
    loadArticles();
  });

  el.prev.addEventListener("click", () => {
    if (state.page > 0) {
      state.page -= 1;
      loadArticles();
      window.scrollTo({ top: document.querySelector(".archive-wrap").offsetTop - 24, behavior: "smooth" });
    }
  });

  el.next.addEventListener("click", () => {
    if ((state.page + 1) * PAGE_SIZE < state.total) {
      state.page += 1;
      loadArticles();
      window.scrollTo({ top: document.querySelector(".archive-wrap").offsetTop - 24, behavior: "smooth" });
    }
  });

  document.getElementById("close-dialog").addEventListener("click", () => el.dialog.close());
  el.dialog.addEventListener("click", (event) => {
    if (event.target === el.dialog) el.dialog.close();
  });

  async function start() {
    if (!API_URL.startsWith("https://") || !API_KEY) {
      setMessage("تنظیمات اتصال به پایگاه داده کامل نیست. فایل config.js را بررسی کنید.", true);
      return;
    }
    try {
      await loadTaxonomy();
      await loadArticles();
    } catch (error) {
      console.error(error);
      setMessage("اتصال به دسته‌بندی‌ها برقرار نشد. لطفاً دسترسی عمومی Supabase را بررسی کنید. " + error.message, true);
    }
  }

  start();
})();
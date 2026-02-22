const els = {
  accountSelect: document.getElementById("accountSelect"),
  categoryForm: document.getElementById("categoryForm"),
  categoryName: document.getElementById("categoryName"),
  categoryBudget: document.getElementById("categoryBudget"),
  categoryList: document.getElementById("categoryList"),
  categoryState: document.getElementById("categoryState"),
  expenseForm: document.getElementById("expenseForm"),
  expenseCategory: document.getElementById("expenseCategory"),
  expenseAmount: document.getElementById("expenseAmount"),
  expenseDate: document.getElementById("expenseDate"),
  expenseState: document.getElementById("expenseState"),
  totalBudget: document.getElementById("totalBudget"),
  totalSpent: document.getElementById("totalSpent"),
  remainingBudget: document.getElementById("remainingBudget"),
  overspentCount: document.getElementById("overspentCount"),
  summaryList: document.getElementById("summaryList"),
  summaryState: document.getElementById("summaryState"),
  transactionList: document.getElementById("transactionList"),
  transactionState: document.getElementById("transactionState"),
  importUsersForm: document.getElementById("importUsersForm"),
  importBudgetsForm: document.getElementById("importBudgetsForm"),
  importExpensesForm: document.getElementById("importExpensesForm"),
  usersCsv: document.getElementById("usersCsv"),
  budgetsCsv: document.getElementById("budgetsCsv"),
  expensesCsv: document.getElementById("expensesCsv"),
  importStatus: document.getElementById("importStatus"),
};

const state = {
  users: [],
  activeUserId: null,
  budgets: [],
  expenses: [],
};

init();

async function init() {
  els.expenseDate.valueAsDate = new Date();
  wireEvents();
  await loadUsers();
  await refreshData();
}

function wireEvents() {
  els.accountSelect.addEventListener("change", async () => {
    state.activeUserId = Number(els.accountSelect.value);
    await refreshData();
  });

  els.categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = els.categoryName.value.trim();
    const budget = Number(els.categoryBudget.value);

    if (!name || Number.isNaN(budget) || budget < 0) return;

    const res = await fetch(`/api/users/${state.activeUserId}/budgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, budget }),
    });

    if (!res.ok) {
      const body = await res.json();
      alert(body.error || "Could not add category");
      return;
    }

    els.categoryForm.reset();
    await refreshData();
  });

  els.expenseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const budgetId = Number(els.expenseCategory.value);
    const amount = Number(els.expenseAmount.value);
    const date = els.expenseDate.value;

    if (!budgetId || Number.isNaN(amount) || amount <= 0 || !date) return;

    const res = await fetch(`/api/users/${state.activeUserId}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetId, amount, date }),
    });

    if (!res.ok) {
      const body = await res.json();
      alert(body.error || "Could not add expense");
      return;
    }

    els.expenseAmount.value = "";
    await refreshData();
  });

  els.importUsersForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await uploadCsv("users", els.usersCsv.files[0]);
  });

  els.importBudgetsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await uploadCsv("budgets", els.budgetsCsv.files[0]);
  });

  els.importExpensesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await uploadCsv("expenses", els.expensesCsv.files[0]);
  });
}

async function uploadCsv(table, file) {
  if (!file) return;

  const formData = new FormData();
  formData.append("csvfile", file);

  const res = await fetch(`/api/import/${table}`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json();
    els.importStatus.textContent = body.error || `Failed to import ${table}.csv`;
    return;
  }

  els.importStatus.textContent = `Imported ${table}.csv successfully.`;
  await loadUsers();
  await refreshData();
}

async function loadUsers() {
  const users = await fetchJson("/api/users");
  state.users = users;

  if (users.length === 0) {
    state.activeUserId = null;
  } else if (!users.some((user) => user.id === state.activeUserId)) {
    state.activeUserId = users[0].id;
  }

  els.accountSelect.innerHTML = "";
  users.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = user.name;
    if (user.id === state.activeUserId) option.selected = true;
    els.accountSelect.append(option);
  });
}

async function refreshData() {
  if (!state.activeUserId) {
    state.budgets = [];
    state.expenses = [];
    render();
    return;
  }

  const month = currentMonth();
  const [budgets, expenses] = await Promise.all([
    fetchJson(`/api/users/${state.activeUserId}/budgets`),
    fetchJson(`/api/users/${state.activeUserId}/expenses?month=${month}`),
  ]);

  state.budgets = budgets;
  state.expenses = expenses;
  render();
}

function render() {
  renderCategoryList();
  renderExpenseCategoryOptions();
  renderDashboardMetrics();
  renderSummary();
  renderTransactions();
}

function renderCategoryList() {
  els.categoryList.innerHTML = "";
  const hasCategories = state.budgets.length > 0;
  els.categoryState.hidden = hasCategories;

  state.budgets.forEach((category) => {
    const item = document.createElement("li");
    item.className = "list-item";

    const meta = document.createElement("div");
    meta.innerHTML = `<strong>${category.name}</strong><div class="list-meta">Budget: ${currency(category.budget)}</div>`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      await fetch(`/api/users/${state.activeUserId}/budgets/${category.id}`, { method: "DELETE" });
      await refreshData();
    });

    item.append(meta, del);
    els.categoryList.append(item);
  });
}

function renderExpenseCategoryOptions() {
  els.expenseCategory.innerHTML = "";
  const hasCategories = state.budgets.length > 0;

  els.expenseForm
    .querySelectorAll("input, select, button")
    .forEach((control) => (control.disabled = !hasCategories));

  els.expenseState.hidden = hasCategories;
  if (!hasCategories) return;

  state.budgets.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    els.expenseCategory.append(option);
  });
}

function renderDashboardMetrics() {
  const totalBudget = state.budgets.reduce((sum, category) => sum + Number(category.budget), 0);
  const totalSpent = state.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);

  const spentByCategory = new Map();
  state.expenses.forEach((expense) => {
    spentByCategory.set(expense.budgetId, (spentByCategory.get(expense.budgetId) || 0) + Number(expense.amount));
  });

  const overspent = state.budgets.filter((category) => {
    const spent = spentByCategory.get(category.id) || 0;
    return spent > Number(category.budget);
  }).length;

  els.totalBudget.textContent = currency(totalBudget);
  els.totalSpent.textContent = currency(totalSpent);
  els.remainingBudget.textContent = currency(totalBudget - totalSpent);
  els.overspentCount.textContent = String(overspent);
}

function renderSummary() {
  els.summaryList.innerHTML = "";
  const hasCategories = state.budgets.length > 0;
  els.summaryState.hidden = hasCategories;

  const spentByCategory = new Map();
  state.expenses.forEach((expense) => {
    spentByCategory.set(expense.budgetId, (spentByCategory.get(expense.budgetId) || 0) + Number(expense.amount));
  });

  state.budgets.forEach((category) => {
    const budget = Number(category.budget);
    const spent = spentByCategory.get(category.id) || 0;
    const pct = budget === 0 ? 0 : Math.round((spent / budget) * 100);

    const item = document.createElement("li");
    item.className = "list-item summary-row";
    item.innerHTML = `
      <div><strong>${category.name}</strong></div>
      <div class="list-meta">${currency(spent)} / ${currency(budget)} (${pct}%)</div>
      <div class="progress ${spent > budget ? "overspent" : ""}">
        <span style="width: ${Math.min(pct, 100)}%"></span>
      </div>
    `;

    els.summaryList.append(item);
  });
}

function renderTransactions() {
  els.transactionList.innerHTML = "";
  const sorted = [...state.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
  els.transactionState.hidden = sorted.length > 0;

  sorted.slice(0, 8).forEach((expense) => {
    const item = document.createElement("li");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <strong>${expense.categoryName || "Deleted Category"}</strong>
        <div class="list-meta">${new Date(expense.date).toLocaleDateString("en-IN")}</div>
      </div>
      <strong>${currency(expense.amount)}</strong>
    `;
    els.transactionList.append(item);
  });
}

function currency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(Number(value));
}

function currentMonth() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${url}`);
  return res.json();
}

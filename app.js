const STORAGE_KEY = "expense-tracker-state-v1";

const defaultState = {
  activeAccountId: "dev",
  accounts: [
    { id: "dev", name: "Dev", categories: [], expenses: [] },
    { id: "devi", name: "Devi", categories: [], expenses: [] },
  ],
};

const state = loadState();

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
};

init();

function init() {
  renderAccountSelect();
  els.expenseDate.valueAsDate = new Date();
  wireEvents();
  render();
}

function wireEvents() {
  els.accountSelect.addEventListener("change", () => {
    state.activeAccountId = els.accountSelect.value;
    persistState();
    render();
  });

  els.categoryForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = els.categoryName.value.trim();
    const budget = Number(els.categoryBudget.value);

    if (!name || Number.isNaN(budget) || budget < 0) {
      return;
    }

    const account = getActiveAccount();
    const exists = account.categories.some(
      (category) => category.name.toLowerCase() === name.toLowerCase()
    );

    if (exists) {
      alert("Category already exists for this account.");
      return;
    }

    account.categories.push({
      id: crypto.randomUUID(),
      name,
      budget,
    });

    els.categoryForm.reset();
    persistState();
    render();
  });

  els.expenseForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const account = getActiveAccount();
    const categoryId = els.expenseCategory.value;
    const amount = Number(els.expenseAmount.value);
    const date = els.expenseDate.value;

    if (!categoryId || Number.isNaN(amount) || amount <= 0 || !date) {
      return;
    }

    account.expenses.push({
      id: crypto.randomUUID(),
      categoryId,
      amount,
      date,
    });

    els.expenseAmount.value = "";
    persistState();
    render();
  });
}

function renderAccountSelect() {
  els.accountSelect.innerHTML = "";

  state.accounts.forEach((account) => {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = account.name;
    if (account.id === state.activeAccountId) option.selected = true;
    els.accountSelect.append(option);
  });
}

function render() {
  const account = getActiveAccount();
  const monthExpenses = getCurrentMonthExpenses(account);

  renderCategoryList(account);
  renderExpenseCategoryOptions(account);
  renderDashboardMetrics(account, monthExpenses);
  renderSummary(account, monthExpenses);
  renderTransactions(account, monthExpenses);
}

function renderCategoryList(account) {
  els.categoryList.innerHTML = "";
  const hasCategories = account.categories.length > 0;
  els.categoryState.hidden = hasCategories;

  account.categories.forEach((category) => {
    const item = document.createElement("li");
    item.className = "list-item";

    const meta = document.createElement("div");
    meta.innerHTML = `<strong>${category.name}</strong><div class="list-meta">Budget: ${currency(
      category.budget
    )}</div>`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      account.categories = account.categories.filter((c) => c.id !== category.id);
      account.expenses = account.expenses.filter((e) => e.categoryId !== category.id);
      persistState();
      render();
    });

    item.append(meta, del);
    els.categoryList.append(item);
  });
}

function renderExpenseCategoryOptions(account) {
  els.expenseCategory.innerHTML = "";
  const hasCategories = account.categories.length > 0;
  const enableExpenseForm = hasCategories;

  els.expenseForm
    .querySelectorAll("input, select, button")
    .forEach((control) => (control.disabled = !enableExpenseForm));
  els.expenseState.hidden = hasCategories;

  if (!hasCategories) {
    return;
  }

  account.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    els.expenseCategory.append(option);
  });
}

function renderDashboardMetrics(account, monthExpenses) {
  const totalBudget = account.categories.reduce((sum, category) => sum + category.budget, 0);
  const totalSpent = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0);

  const byCategorySpent = new Map();
  monthExpenses.forEach((expense) => {
    byCategorySpent.set(expense.categoryId, (byCategorySpent.get(expense.categoryId) || 0) + expense.amount);
  });

  const overspent = account.categories.filter((category) => {
    const spent = byCategorySpent.get(category.id) || 0;
    return spent > category.budget;
  }).length;

  els.totalBudget.textContent = currency(totalBudget);
  els.totalSpent.textContent = currency(totalSpent);
  els.remainingBudget.textContent = currency(totalBudget - totalSpent);
  els.overspentCount.textContent = String(overspent);
}

function renderSummary(account, monthExpenses) {
  els.summaryList.innerHTML = "";
  const hasCategories = account.categories.length > 0;
  els.summaryState.hidden = hasCategories;

  const categorySpendMap = new Map();
  monthExpenses.forEach((expense) => {
    categorySpendMap.set(expense.categoryId, (categorySpendMap.get(expense.categoryId) || 0) + expense.amount);
  });

  account.categories.forEach((category) => {
    const spent = categorySpendMap.get(category.id) || 0;
    const pct = category.budget === 0 ? 0 : Math.round((spent / category.budget) * 100);

    const item = document.createElement("li");
    item.className = "list-item summary-row";

    item.innerHTML = `
      <div><strong>${category.name}</strong></div>
      <div class="list-meta">${currency(spent)} / ${currency(category.budget)} (${pct}%)</div>
      <div class="progress ${spent > category.budget ? "overspent" : ""}">
        <span style="width: ${Math.min(pct, 100)}%"></span>
      </div>
    `;

    els.summaryList.append(item);
  });
}

function renderTransactions(account, monthExpenses) {
  els.transactionList.innerHTML = "";
  const sorted = [...monthExpenses].sort((a, b) => new Date(b.date) - new Date(a.date));

  els.transactionState.hidden = sorted.length > 0;

  sorted.slice(0, 8).forEach((expense) => {
    const category = account.categories.find((c) => c.id === expense.categoryId);
    const item = document.createElement("li");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <strong>${category ? category.name : "Deleted Category"}</strong>
        <div class="list-meta">${new Date(expense.date).toLocaleDateString()}</div>
      </div>
      <strong>${currency(expense.amount)}</strong>
    `;
    els.transactionList.append(item);
  });
}

function getCurrentMonthExpenses(account) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  return account.expenses.filter((expense) => {
    const date = new Date(expense.date + "T00:00:00");
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  });
}

function getActiveAccount() {
  return state.accounts.find((account) => account.id === state.activeAccountId) || state.accounts[0];
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(defaultState);

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.accounts) || !parsed.accounts.length) {
      return structuredClone(defaultState);
    }
    return parsed;
  } catch {
    return structuredClone(defaultState);
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

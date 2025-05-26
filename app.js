// app.js

// --- PWA Service Worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', {
            scope: '/micro-walleta/'
        })
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

// --- Base de Datos (Dexie.js) ---
const db = new Dexie('ViajesGastosDB');
db.version(2).stores({
    budgets: '++id,name,currency,startDate,endDate', // id auto-incrementable, indexados los demás
    categories: '++id,budgetId,name,budgetedAmount', // budgetId es un foreign key manual
    expenses: '++id,categoryId,budgetId,name,date', // categoryId es un foreign key manual
    expenseItems: '++id,expenseId,description,quantity,price' // expenseId es un foreign key manual
});

// --- Estado de la Aplicación y Navegación ---
const appState = {
    currentView: 'budgets-list-view',
    currentBudgetId: null,
    currentCategoryId: null,
    currentExpenseId: null, // Para editar gastos
    lastFormState: null, // Para guardar estado de formulario no guardado
    views: { // Breadcrumb texts
        'budgets-list-view': { breadcrumb: 'Mis Presupuestos' },
        'budget-form-view': { breadcrumb: 'Formulario de Presupuesto' }, // Será sobreescrito por updateBreadcrumbs
        'budget-detail-view': { breadcrumb: 'Detalle de Presupuesto' }, // Será sobreescrito
        'category-form-view': { breadcrumb: 'Formulario de Categoría' }, // Será sobreescrito
        'category-detail-view': { breadcrumb: 'Detalle de Categoría' }, // Será sobreescrito
        'expense-form-view': { breadcrumb: 'Formulario de Gasto' }, // Será sobreescrito
    }
};

const breadcrumbsEl = document.getElementById('breadcrumbs');

function updateBreadcrumbs() {
    let path = [appState.views['budgets-list-view'].breadcrumb]; // Siempre empieza con "Mis Presupuestos"
    let currentBudget = null;
    let currentCategory = null;

    async function buildPath() {
        if (appState.currentBudgetId) {
            currentBudget = await db.budgets.get(appState.currentBudgetId);
            if (currentBudget) path.push(currentBudget.name);
        }

        if (appState.currentCategoryId && (appState.currentView === 'category-detail-view' || appState.currentView === 'expense-form-view' || appState.currentView === 'category-form-view' && document.getElementById('category-id').value)) {
             // Solo añadir nombre de categoría si estamos viendo detalles de categoría, formulario de gasto, o editando categoría
            currentCategory = await db.categories.get(appState.currentCategoryId);
            if (currentCategory) path.push(currentCategory.name);
        }


        // Añadir el estado actual del formulario o acción
        if (appState.currentView === 'budget-form-view') {
            path.push(document.getElementById('budget-id').value ? 'Editar Presupuesto' : 'Nuevo Presupuesto');
        } else if (appState.currentView === 'category-form-view') {
             // Si estamos en el form de categoría y hay un currentBudgetId pero no currentCategoryId (o el ID del form está vacío), es "Nueva Categoría"
            if (appState.currentBudgetId && (!appState.currentCategoryId || !document.getElementById('category-id').value)) {
                 path.push('Nueva Categoría');
            } else if (appState.currentCategoryId && document.getElementById('category-id').value) {
                 path.push('Editar Categoría');
            }
        } else if (appState.currentView === 'expense-form-view') {
            path.push(appState.currentExpenseId ? 'Editar Gasto' : 'Nuevo Gasto');
        }
        // Para vistas de detalle, el path ya está construido con nombres de budget/category

        breadcrumbsEl.textContent = path.join(' > ');
    }
    buildPath();
}


function navigateTo(viewId, budgetId = null, categoryId = null, expenseId = null, formStateToRestore = null) {
    console.log(`Navigating to: ${viewId}, budget: ${budgetId}, category: ${categoryId}, expense: ${expenseId}`);
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    const targetViewElement = document.getElementById(viewId);
    if (targetViewElement) {
        targetViewElement.classList.add('active');
    } else {
        console.error(`View with id "${viewId}" not found.`);
        // Fallback a la vista principal si la vista solicitada no existe
        document.getElementById('budgets-list-view').classList.add('active');
        appState.currentView = 'budgets-list-view';
        appState.currentBudgetId = null;
        appState.currentCategoryId = null;
        appState.currentExpenseId = null;
        updateBreadcrumbs();
        return;
    }

    appState.currentView = viewId;
    appState.currentBudgetId = budgetId;
    appState.currentCategoryId = categoryId;
    appState.currentExpenseId = expenseId;

    localStorage.setItem('lastVisitedView', JSON.stringify({
        viewId,
        budgetId,
        categoryId,
        expenseId
    }));

    updateBreadcrumbs();

    const messageArea = document.getElementById('message-area');
    messageArea.innerHTML = '';
    messageArea.className = 'message-area'; // Reset classes

    if (formStateToRestore) {
        appState.lastFormState = formStateToRestore;
        if (viewId === 'expense-form-view' && formStateToRestore.type === 'expense') {
            restoreExpenseFormState(formStateToRestore.data);
        }
    } else {
        if (appState.lastFormState &&
            viewId === appState.lastFormState.targetView &&
            appState.lastFormState.budgetId === budgetId &&
            appState.lastFormState.categoryId === categoryId) {
            if (viewId === 'expense-form-view' && appState.lastFormState.type === 'expense') {
                restoreExpenseFormState(appState.lastFormState.data);
            }
        } else {
            appState.lastFormState = null;
            localStorage.removeItem('lastFormState');
        }
    }

    if (viewId === 'budgets-list-view') loadBudgetsList();
    if (viewId === 'budget-detail-view' && budgetId) loadBudgetDetail(budgetId);
    if (viewId === 'category-detail-view' && categoryId) loadCategoryDetail(categoryId);

    if (viewId === 'budget-form-view' && budgetId) loadBudgetFormForEdit(budgetId);
    else if (viewId === 'budget-form-view') resetBudgetForm();

    if (viewId === 'category-form-view' && categoryId) loadCategoryFormForEdit(categoryId);
    else if (viewId === 'category-form-view' && budgetId) resetCategoryForm(budgetId);

    if (viewId === 'expense-form-view' && expenseId) loadExpenseFormForEdit(expenseId);
    else if (viewId === 'expense-form-view' && categoryId) resetExpenseForm(categoryId);
}

function showMessage(text, type = 'success') {
    const messageArea = document.getElementById('message-area');
    let icon;
    if (type === 'success') {
        messageArea.className = 'message-area success';
        icon = '<i class="fas fa-check-circle"></i>';
    } else if (type === 'error') {
        messageArea.className = 'message-area error';
        icon = '<i class="fas fa-exclamation-triangle"></i>';
    } else {
        messageArea.className = 'message-area info';
        icon = '<i class="fas fa-info-circle"></i>';
    }
    messageArea.innerHTML = `${icon} ${text}`;
    setTimeout(() => {
        messageArea.innerHTML = '';
        messageArea.className = 'message-area';
    }, 5000);
}

const addBudgetBtn = document.getElementById('add-budget-btn');
const budgetForm = document.getElementById('budget-form');
const cancelBudgetFormBtn = document.getElementById('cancel-budget-form');
const budgetsContainer = document.getElementById('budgets-container');

addBudgetBtn.addEventListener('click', () => {
    navigateTo('budget-form-view');
});

cancelBudgetFormBtn.addEventListener('click', () => {
    navigateTo('budgets-list-view');
    resetBudgetForm();
});

budgetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idInput = document.getElementById('budget-id').value;
    const id = idInput ? parseInt(idInput) : null;
    const name = document.getElementById('budget-name').value;
    const currency = document.getElementById('budget-currency').value.toUpperCase();
    const startDate = document.getElementById('budget-start-date').value;
    const endDate = document.getElementById('budget-end-date').value;

    if (!name || !currency || !startDate || !endDate) {
        showMessage("Todos los campos son obligatorios.", "error");
        return;
    }
    if (new Date(startDate) > new Date(endDate)) {
        showMessage("La fecha de inicio no puede ser posterior a la fecha de fin.", "error");
        return;
    }

    const budgetData = { name, currency, startDate, endDate };

    try {
        if (id) {
            await db.budgets.update(id, budgetData);
            showMessage('Presupuesto actualizado con éxito!');
        } else {
            await db.budgets.add(budgetData);
            showMessage('Presupuesto creado con éxito!');
        }
        resetBudgetForm();
        navigateTo('budgets-list-view');
    } catch (error) {
        console.error("Error guardando presupuesto:", error);
        showMessage(`Error guardando presupuesto: ${error.message || error}`, 'error');
    }
});

function resetBudgetForm() {
    document.getElementById('budget-form').reset();
    document.getElementById('budget-id').value = '';
    document.getElementById('budget-form-title').textContent = 'Crear Nuevo Presupuesto';
}

async function loadBudgetsList() {
    budgetsContainer.innerHTML = '<div class="loader"></div>';
    const budgets = await db.budgets.orderBy('name').toArray();
    budgetsContainer.innerHTML = '';
    if (budgets.length === 0) {
        budgetsContainer.innerHTML = '<p class="empty-list-message">No hay presupuestos todavía. ¡Crea uno!</p>';
        return;
    }
    for (const budget of budgets) { // Changed to for...of for async/await within loop
        const { totalBudget, currentBalance } = await calculateBudgetTotals(budget.id);
        const budgetCardDiv = document.createElement('div');
        budgetCardDiv.className = 'card budget-card'; // Added .card
        budgetCardDiv.dataset.budgetId = budget.id;
        budgetCardDiv.innerHTML = `
            <h3>${budget.name}</h3>
            <p>${formatDate(budget.startDate)} - ${formatDate(budget.endDate)} | Moneda: ${budget.currency}</p>
            <div class="mt-2 text-xs grid grid-cols-2 gap-1">
                <span>Total Presupuestado: <strong class="text-green-600">${formatCurrency(totalBudget, budget.currency)}</strong></span>
                <span>Saldo Restante: <strong class="text-blue-600">${formatCurrency(currentBalance, budget.currency)}</strong></span>
            </div>
        `;
        // Re-apply Tailwind equivalent classes or ensure CSS covers these:
        // mt-2, text-xs, grid, grid-cols-2, gap-1, text-green-600, text-blue-600
        // For now, I'll assume CSS will handle the visual aspects based on parent or specific rules.
        // Let's make them more semantic or specific if needed in CSS.
        const totalsDiv = budgetCardDiv.querySelector('.mt-2.text-xs.grid');
        if (totalsDiv) {
            totalsDiv.className = 'budget-card-totals'; // Example of semantic class
            totalsDiv.querySelector('.text-green-600').className = 'total-amount';
            totalsDiv.querySelector('.text-blue-600').className = 'balance-amount';
        }


        budgetCardDiv.addEventListener('click', (e) => {
            const budgetId = parseInt(e.currentTarget.dataset.budgetId);
            navigateTo('budget-detail-view', budgetId);
        });
        budgetsContainer.appendChild(budgetCardDiv);
    }
}

async function loadBudgetFormForEdit(budgetId) {
    const budget = await db.budgets.get(budgetId);
    if (budget) {
        document.getElementById('budget-id').value = budget.id;
        document.getElementById('budget-name').value = budget.name;
        document.getElementById('budget-currency').value = budget.currency;
        document.getElementById('budget-start-date').value = budget.startDate;
        document.getElementById('budget-end-date').value = budget.endDate;
        document.getElementById('budget-form-title').textContent = 'Editar Presupuesto';
    }
}

const budgetDetailName = document.getElementById('budget-detail-name');
const budgetDetailDates = document.getElementById('budget-detail-dates');
const budgetDetailCurrency = document.getElementById('budget-detail-currency');
const budgetDetailTotal = document.getElementById('budget-detail-total');
const budgetDetailBalance = document.getElementById('budget-detail-balance');
const categoriesContainer = document.getElementById('categories-container');
const addCategoryBtn = document.getElementById('add-category-btn');
const backToBudgetsListBtn = document.getElementById('back-to-budgets-list');
const editCurrentBudgetBtn = document.getElementById('edit-current-budget-btn');
const deleteCurrentBudgetBtn = document.getElementById('delete-current-budget-btn');

backToBudgetsListBtn.addEventListener('click', () => navigateTo('budgets-list-view'));
addCategoryBtn.addEventListener('click', () => {
    navigateTo('category-form-view', appState.currentBudgetId);
});
editCurrentBudgetBtn.addEventListener('click', () => {
    if(appState.currentBudgetId) navigateTo('budget-form-view', appState.currentBudgetId);
});
deleteCurrentBudgetBtn.addEventListener('click', () => {
    if(appState.currentBudgetId) {
        showConfirmationModal(
            'Eliminar Presupuesto',
            '¿Estás seguro de que quieres eliminar este presupuesto y todas sus categorías y gastos asociados? Esta acción no se puede deshacer.',
            async () => {
                await deleteBudget(appState.currentBudgetId);
                navigateTo('budgets-list-view');
                showMessage('Presupuesto eliminado correctamente.', 'success');
            }
        );
    }
});

async function loadBudgetDetail(budgetId) {
    categoriesContainer.innerHTML = '<div class="loader"></div>';
    const budget = await db.budgets.get(budgetId);
    if (!budget) {
        showMessage('Presupuesto no encontrado.', 'error');
        navigateTo('budgets-list-view');
        return;
    }
    budgetDetailName.textContent = budget.name;
    budgetDetailDates.textContent = `${formatDate(budget.startDate)} - ${formatDate(budget.endDate)}`;
    budgetDetailCurrency.textContent = budget.currency;

    const { totalBudget, currentBalance } = await calculateBudgetTotals(budgetId);
    budgetDetailTotal.textContent = formatCurrency(totalBudget, budget.currency);
    budgetDetailBalance.textContent = formatCurrency(currentBalance, budget.currency);
    budgetDetailBalance.className = currentBalance >= 0 ? 'balance-amount' : 'balance-amount negative';


    const categories = await db.categories.where('budgetId').equals(budgetId).toArray(); //.orderBy('name')
    categoriesContainer.innerHTML = '';
    if (categories.length === 0) {
        categoriesContainer.innerHTML = '<p class="empty-list-message">No hay categorías para este presupuesto. ¡Añade una!</p>';
    } else {
        for (const category of categories) {
            const { categoryBalance, dailyAllowance } = await calculateCategoryStats(category, budget);
            const categoryCardDiv = document.createElement('div');
            categoryCardDiv.className = 'card category-card'; // Added .card
            categoryCardDiv.dataset.categoryId = category.id;
            categoryCardDiv.innerHTML = `
                <h4>${category.name}</h4>
                <p>Asignado: ${formatCurrency(category.budgetedAmount, budget.currency)}</p>
                <p>Saldo: <strong class="${categoryBalance >= 0 ? 'balance-amount' : 'balance-amount negative'}">${formatCurrency(categoryBalance, budget.currency)}</strong></p>
                <p>Gasto Diario Sugerido: <strong class="daily-allowance-amount">${formatCurrency(dailyAllowance, budget.currency)}/día</strong></p>
            `;
            categoryCardDiv.addEventListener('click', (e) => {
                const categoryId = parseInt(e.currentTarget.dataset.categoryId);
                navigateTo('category-detail-view', budgetId, categoryId);
            });
            categoriesContainer.appendChild(categoryCardDiv);
        }
    }
}

const categoryForm = document.getElementById('category-form');
const cancelCategoryFormBtn = document.getElementById('cancel-category-form');
const formCategoryCurrencySpan = document.getElementById('form-category-currency');

cancelCategoryFormBtn.addEventListener('click', () => {
    navigateTo('budget-detail-view', appState.currentBudgetId);
    resetCategoryForm(appState.currentBudgetId);
});

categoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idInput = document.getElementById('category-id').value;
    const id = idInput ? parseInt(idInput) : null;
    const budgetId = parseInt(document.getElementById('category-budget-id').value);
    const name = document.getElementById('category-name').value;
    const budgetedAmount = parseFloat(document.getElementById('category-budgeted-amount').value);

    if (!name || isNaN(budgetedAmount)) {
        showMessage("Nombre y monto asignado son obligatorios y el monto debe ser un número.", "error");
        return;
    }
    if (budgetedAmount < 0) {
        showMessage("El monto asignado no puede ser negativo.", "error");
        return;
    }
    const categoryData = { budgetId, name, budgetedAmount };

    try {
        if (id) {
            await db.categories.update(id, categoryData);
            showMessage('Categoría actualizada con éxito!');
        } else {
            await db.categories.add(categoryData);
            showMessage('Categoría creada con éxito!');
        }
        resetCategoryForm(budgetId);
        navigateTo('budget-detail-view', budgetId);
    } catch (error) {
        console.error("Error guardando categoría:", error);
        showMessage(`Error guardando categoría: ${error.message || error}`, 'error');
    }
});

async function resetCategoryForm(budgetId) { // Made async
    document.getElementById('category-form').reset();
    document.getElementById('category-id').value = '';
    document.getElementById('category-budget-id').value = budgetId;
    document.getElementById('category-form-title').textContent = 'Añadir Nueva Categoría';
    if (budgetId) { // Ensure budgetId is valid before fetching
        const budget = await db.budgets.get(budgetId);
        if (budget) formCategoryCurrencySpan.textContent = budget.currency;
    } else {
        formCategoryCurrencySpan.textContent = ''; // Clear if no budgetId
    }
}

async function loadCategoryFormForEdit(categoryId) {
    const category = await db.categories.get(categoryId);
    if (category) {
        const budget = await db.budgets.get(category.budgetId);
        document.getElementById('category-id').value = category.id;
        document.getElementById('category-budget-id').value = category.budgetId;
        document.getElementById('category-name').value = category.name;
        document.getElementById('category-budgeted-amount').value = category.budgetedAmount;
        document.getElementById('category-form-title').textContent = 'Editar Categoría';
        if (budget) formCategoryCurrencySpan.textContent = budget.currency;
    }
}

const categoryDetailName = document.getElementById('category-detail-name');
const categoryDetailBudgetName = document.getElementById('category-detail-budget-name');
const categoryDetailBudgeted = document.getElementById('category-detail-budgeted');
const categoryDetailBalance = document.getElementById('category-detail-balance');
const categoryDetailDailyAllowance = document.getElementById('category-detail-daily-allowance');
const expensesContainer = document.getElementById('expenses-container');
const addExpenseBtn = document.getElementById('add-expense-btn');
const backToBudgetDetailBtn = document.getElementById('back-to-budget-detail');
const editCurrentCategoryBtn = document.getElementById('edit-current-category-btn');
const deleteCurrentCategoryBtn = document.getElementById('delete-current-category-btn');

backToBudgetDetailBtn.addEventListener('click', () => navigateTo('budget-detail-view', appState.currentBudgetId));
addExpenseBtn.addEventListener('click', () => {
    navigateTo('expense-form-view', appState.currentBudgetId, appState.currentCategoryId);
});
editCurrentCategoryBtn.addEventListener('click', () => {
    if(appState.currentCategoryId) navigateTo('category-form-view', appState.currentBudgetId, appState.currentCategoryId);
});
deleteCurrentCategoryBtn.addEventListener('click', () => {
    if(appState.currentCategoryId) {
        showConfirmationModal(
            'Eliminar Categoría',
            '¿Estás seguro de que quieres eliminar esta categoría y todos sus gastos asociados? Esta acción no se puede deshacer.',
            async () => {
                await deleteCategory(appState.currentCategoryId);
                navigateTo('budget-detail-view', appState.currentBudgetId);
                showMessage('Categoría eliminada correctamente.', 'success');
            }
        );
    }
});

async function loadCategoryDetail(categoryId) {
    expensesContainer.innerHTML = '<div class="loader"></div>';
    const category = await db.categories.get(categoryId);
    if (!category) {
        showMessage('Categoría no encontrada.', 'error');
        navigateTo('budget-detail-view', appState.currentBudgetId);
        return;
    }
    const budget = await db.budgets.get(category.budgetId);
    if (!budget) {
        showMessage('Presupuesto asociado no encontrado.', 'error');
        navigateTo('budgets-list-view');
        return;
    }

    categoryDetailName.textContent = category.name;
    categoryDetailBudgetName.textContent = budget.name;
    categoryDetailBudgeted.textContent = formatCurrency(category.budgetedAmount, budget.currency);

    const { categoryBalance, dailyAllowance } = await calculateCategoryStats(category, budget);
    categoryDetailBalance.textContent = formatCurrency(categoryBalance, budget.currency);
    categoryDetailBalance.className = categoryBalance >= 0 ? 'balance-amount' : 'balance-amount negative';
    categoryDetailDailyAllowance.textContent = `${formatCurrency(dailyAllowance, budget.currency)}/día`;

    const expenses = await db.expenses.where({ categoryId: categoryId, budgetId: budget.id }).sortBy('date');
    expensesContainer.innerHTML = '';
    if (expenses.length === 0) {
        expensesContainer.innerHTML = '<p class="empty-list-message">No hay gastos registrados en esta categoría.</p>';
    } else {
        for (const expense of expenses) {
            const expenseTotal = await calculateExpenseTotal(expense.id);
            const expenseCardDiv = document.createElement('div');
            expenseCardDiv.className = 'card expense-card'; // Added .card
            expenseCardDiv.dataset.expenseId = expense.id;
            expenseCardDiv.innerHTML = `
                <div class="expense-card-header">
                    <div>
                        <h5>${expense.name}</h5>
                        <p class="date-text">${formatDateTime(expense.date)}</p>
                    </div>
                    <span class="amount-text">${formatCurrency(expenseTotal, budget.currency)}</span>
                </div>
                <div class="expense-card-actions">
                    <button class="btn-icon edit-expense-btn" data-expense-id="${expense.id}"><i class="fas fa-edit"></i>Editar</button>
                    <button class="btn-icon delete-expense-btn" data-expense-id="${expense.id}"><i class="fas fa-trash"></i>Eliminar</button>
                </div>
            `;
            // Event listeners for edit/delete buttons
            expenseCardDiv.querySelector('.edit-expense-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const expenseId = parseInt(e.currentTarget.dataset.expenseId);
                navigateTo('expense-form-view', budget.id, category.id, expenseId);
            });
            expenseCardDiv.querySelector('.delete-expense-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const expenseId = parseInt(e.currentTarget.dataset.expenseId);
                showConfirmationModal(
                    'Eliminar Gasto',
                    '¿Estás seguro de que quieres eliminar este gasto?',
                    async () => {
                        await deleteExpense(expenseId);
                        loadCategoryDetail(categoryId);
                        showMessage('Gasto eliminado.', 'success');
                    }
                );
            });
            expensesContainer.appendChild(expenseCardDiv);
        }
    }
}

const expenseForm = document.getElementById('expense-form');
const cancelExpenseFormBtn = document.getElementById('cancel-expense-form');
const addExpenseItemBtn = document.getElementById('add-expense-item-btn');
const expenseItemsContainer = document.getElementById('expense-items-container');
const expenseFormTotalEl = document.getElementById('expense-form-total');
const formExpenseBudgetName = document.getElementById('form-expense-budget-name');
const formExpenseBudgetBalance = document.getElementById('form-expense-budget-balance');
const formExpenseCategoryName = document.getElementById('form-expense-category-name');
const formExpenseCategoryBalance = document.getElementById('form-expense-category-balance');
const formExpenseCurrentTotalProvisional = document.getElementById('form-expense-current-total-provisional');
const formExpenseCurrencySymbol = document.getElementById('form-expense-currency-symbol');

let provisionalExpenseTotal = 0;

cancelExpenseFormBtn.addEventListener('click', () => {
    navigateTo('category-detail-view', appState.currentBudgetId, appState.currentCategoryId);
    resetExpenseForm(appState.currentCategoryId);
    clearFormState();
});

expenseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idInput = document.getElementById('expense-id').value;
    const id = idInput ? parseInt(idInput) : null;
    const budgetId = parseInt(document.getElementById('expense-budget-id').value);
    const categoryId = parseInt(document.getElementById('expense-category-id').value);
    const name = document.getElementById('expense-name').value;
    const date = document.getElementById('expense-date').value;

    if (!name || !date) {
        showMessage("Descripción y fecha del gasto son obligatorios.", "error");
        return;
    }

    const items = [];
    expenseItemsContainer.querySelectorAll('.expense-item-row').forEach(row => {
        const description = row.querySelector('.item-description').value;
        const quantityInput = row.querySelector('.item-quantity').value;
        const priceInput = row.querySelector('.item-price').value;

        // Validar que cantidad y precio sean números y no estén vacíos
        if (description && quantityInput.trim() !== '' && priceInput.trim() !== '') {
            const quantity = parseFloat(quantityInput);
            const price = parseFloat(priceInput);

            if (!isNaN(quantity) && quantity > 0 && !isNaN(price) && price >= 0) {
                 items.push({ description, quantity, price });
            } else {
                // Podrías añadir un mensaje de error específico para este ítem si lo deseas
                console.warn("Ítem inválido o incompleto:", {description, quantityInput, priceInput});
            }
        }
    });


    if (items.length === 0) {
        showMessage("Debes añadir al menos un ítem válido al gasto.", "error");
        return;
    }

    const expenseData = { budgetId, categoryId, name, date };

    try {
        if (id) {
            await db.transaction('rw', db.expenses, db.expenseItems, async () => {
                await db.expenses.update(id, expenseData);
                await db.expenseItems.where('expenseId').equals(id).delete();
                const itemsToAdd = items.map(item => ({ ...item, expenseId: id }));
                await db.expenseItems.bulkAdd(itemsToAdd);
            });
            showMessage('Gasto actualizado con éxito!');
        } else {
            await db.transaction('rw', db.expenses, db.expenseItems, async () => {
                const newExpenseId = await db.expenses.add(expenseData);
                const itemsToAdd = items.map(item => ({ ...item, expenseId: newExpenseId }));
                await db.expenseItems.bulkAdd(itemsToAdd);
            });
            showMessage('Gasto registrado con éxito!');
        }
        resetExpenseForm(categoryId);
        clearFormState();
        navigateTo('category-detail-view', budgetId, categoryId);
    } catch (error) {
        console.error("Error guardando gasto:", error);
        showMessage(`Error guardando gasto: ${error.message || error}`, 'error');
    }
});

addExpenseItemBtn.addEventListener('click', () => addExpenseItemRow());

function addExpenseItemRow(item = { description: '', quantity: 1, price: '' }) {
    const itemRow = document.createElement('div');
    itemRow.className = 'expense-item-row';
    itemRow.innerHTML = `
        <input type="text" placeholder="Descripción" value="${item.description}" class="item-description" required>
        <input type="number" placeholder="Cant." value="${item.quantity}" min="0.01" step="0.01" class="item-quantity" required>
        <input type="number" placeholder="Precio" value="${item.price}" min="0" step="0.01" class="item-price" required>
        <button type="button" class="remove-item-btn"><i class="fas fa-times"></i> Quitar</button>
    `;
    expenseItemsContainer.appendChild(itemRow);
    itemRow.querySelector('.remove-item-btn').addEventListener('click', () => {
        itemRow.remove();
        updateExpenseFormTotal();
        saveCurrentExpenseFormState();
    });
    itemRow.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => {
            updateExpenseFormTotal();
            saveCurrentExpenseFormState();
        });
    });
    updateExpenseFormTotal();
    if(item.description || item.price) saveCurrentExpenseFormState();
}

function updateExpenseFormTotal() {
    let total = 0;
    expenseItemsContainer.querySelectorAll('.expense-item-row').forEach(row => {
        const quantity = parseFloat(row.querySelector('.item-quantity').value) || 0;
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        total += quantity * price;
    });
    provisionalExpenseTotal = total;
    expenseFormTotalEl.textContent = formatCurrency(total, ''); // Currency symbol is separate
    formExpenseCurrentTotalProvisional.textContent = formatCurrency(total, '');
    updateProvisionalBalancesInForm(total);
}

async function updateProvisionalBalancesInForm(currentExpenseTotal) {
    if (!appState.currentBudgetId || !appState.currentCategoryId) return;

    const budget = await db.budgets.get(appState.currentBudgetId);
    const category = await db.categories.get(appState.currentCategoryId);
    if (!budget || !category) return;

    const { currentBalance: budgetOriginalBalance } = await calculateBudgetTotals(appState.currentBudgetId, appState.currentExpenseId);
    const { categoryBalance: categoryOriginalBalance } = await calculateCategoryStats(category, budget, appState.currentExpenseId);

    formExpenseBudgetBalance.textContent = formatCurrency(budgetOriginalBalance - currentExpenseTotal, budget.currency);
    formExpenseCategoryBalance.textContent = formatCurrency(categoryOriginalBalance - currentExpenseTotal, budget.currency);
}

async function resetExpenseForm(categoryId) {
    document.getElementById('expense-form').reset();
    document.getElementById('expense-id').value = '';
    expenseItemsContainer.innerHTML = '';
    addExpenseItemRow();
    document.getElementById('expense-form-title').textContent = 'Registrar Nuevo Gasto';

    // Set default date to current date and time
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('expense-date').value = `${year}-${month}-${day}T${hours}:${minutes}`;


    provisionalExpenseTotal = 0;
    expenseFormTotalEl.textContent = '0.00';
    formExpenseCurrentTotalProvisional.textContent = '0.00';

    if (categoryId) {
        const category = await db.categories.get(categoryId);
        if (category) {
            document.getElementById('expense-category-id').value = category.id;
            document.getElementById('expense-budget-id').value = category.budgetId;
            const budget = await db.budgets.get(category.budgetId);
            if (budget) {
                formExpenseBudgetName.textContent = budget.name;
                const { currentBalance: budgetOriginalBalance } = await calculateBudgetTotals(budget.id);
                formExpenseBudgetBalance.textContent = formatCurrency(budgetOriginalBalance, budget.currency);

                formExpenseCategoryName.textContent = category.name;
                const { categoryBalance: categoryOriginalBalance } = await calculateCategoryStats(category, budget);
                formExpenseCategoryBalance.textContent = formatCurrency(categoryOriginalBalance, budget.currency);
                formExpenseCurrencySymbol.textContent = budget.currency;
            }
        }
    }
    updateExpenseFormTotal();
}

async function loadExpenseFormForEdit(expenseId) {
    const expense = await db.expenses.get(expenseId);
    if (expense) {
        const budget = await db.budgets.get(expense.budgetId);
        const category = await db.categories.get(expense.categoryId);

        document.getElementById('expense-id').value = expense.id;
        document.getElementById('expense-budget-id').value = expense.budgetId;
        document.getElementById('expense-category-id').value = expense.categoryId;
        document.getElementById('expense-name').value = expense.name;
        document.getElementById('expense-date').value = expense.date;
        document.getElementById('expense-form-title').textContent = 'Editar Gasto';

        if(budget) {
            formExpenseBudgetName.textContent = budget.name;
            formExpenseCurrencySymbol.textContent = budget.currency;
        }
        if(category) formExpenseCategoryName.textContent = category.name;

        expenseItemsContainer.innerHTML = '';
        const items = await db.expenseItems.where('expenseId').equals(expenseId).toArray();
        if (items.length > 0) {
            items.forEach(item => addExpenseItemRow(item));
        } else {
            addExpenseItemRow(); // Add an empty row if no items exist
        }
        
        // This needs to be called after items are loaded and before provisional balances are updated for editing context
        updateExpenseFormTotal(); 

        // Now, correctly set the provisional balances considering this expense is being edited.
        // The updateProvisionalBalancesInForm function will use appState.currentExpenseId (which is set to expenseId)
        // to exclude this expense's old total from the "original" balances.
        if (budget && category) {
             await updateProvisionalBalancesInForm(provisionalExpenseTotal);
        }


    } else {
         showMessage('Gasto no encontrado para editar.', 'error');
         navigateTo('category-detail-view', appState.currentBudgetId, appState.currentCategoryId);
    }
}

function saveCurrentExpenseFormState() {
    if (appState.currentView !== 'expense-form-view') return;

    const expenseData = {
        name: document.getElementById('expense-name').value,
        date: document.getElementById('expense-date').value,
        items: []
    };
    expenseItemsContainer.querySelectorAll('.expense-item-row').forEach(row => {
        expenseData.items.push({
            description: row.querySelector('.item-description').value,
            quantity: row.querySelector('.item-quantity').value,
            price: row.querySelector('.item-price').value
        });
    });

    const hasData = expenseData.name || expenseData.date || expenseData.items.some(item => item.description || item.quantity || item.price);

    if (hasData) {
        appState.lastFormState = {
            type: 'expense',
            targetView: 'expense-form-view',
            budgetId: appState.currentBudgetId,
            categoryId: appState.currentCategoryId,
            expenseId: appState.currentExpenseId, // Important for restoring edit state
            data: expenseData
        };
        localStorage.setItem('lastFormState', JSON.stringify(appState.lastFormState));
        console.log("Estado del formulario de gastos guardado:", appState.lastFormState);
    } else {
        clearFormState();
    }
}

function restoreExpenseFormState(data) {
    if (!data) return;
    console.log("Restaurando estado del formulario de gastos:", data);
    document.getElementById('expense-name').value = data.name || '';
    if (data.date) { // Only restore date if it was saved
      document.getElementById('expense-date').value = data.date;
    }

    expenseItemsContainer.innerHTML = '';
    if (data.items && data.items.length > 0) {
        data.items.forEach(item => addExpenseItemRow(item));
    } else {
        addExpenseItemRow();
    }
    updateExpenseFormTotal(); // This will also update provisional balances
}

function clearFormState() {
    appState.lastFormState = null;
    localStorage.removeItem('lastFormState');
    console.log("Estado del formulario limpiado.");
}

document.getElementById('expense-name').addEventListener('input', saveCurrentExpenseFormState);
document.getElementById('expense-date').addEventListener('change', saveCurrentExpenseFormState);


async function calculateBudgetTotals(budgetId, excludeExpenseId = null) {
    const categories = await db.categories.where('budgetId').equals(budgetId).toArray();
    let totalBudget = 0;
    let totalSpent = 0;

    for (const category of categories) {
        totalBudget += category.budgetedAmount;
        const expenses = await db.expenses.where('categoryId').equals(category.id).toArray();
        for (const expense of expenses) {
            if (excludeExpenseId && expense.id === excludeExpenseId) continue;
            totalSpent += await calculateExpenseTotal(expense.id);
        }
    }
    return {
        totalBudget: totalBudget,
        currentBalance: totalBudget - totalSpent
    };
}

async function calculateCategoryStats(category, budget, excludeExpenseId = null) {
    let totalSpentInCategory = 0;
    const expenses = await db.expenses.where('categoryId').equals(category.id).toArray();
    for (const expense of expenses) {
         if (excludeExpenseId && expense.id === excludeExpenseId) continue;
        totalSpentInCategory += await calculateExpenseTotal(expense.id);
    }
    const categoryBalance = category.budgetedAmount - totalSpentInCategory;

    let dailyAllowance = 0;
    const today = new Date();
    today.setHours(0,0,0,0);
    const budgetStartDate = new Date(budget.startDate);
    budgetStartDate.setHours(0,0,0,0); // Normalize start date
    const budgetEndDate = new Date(budget.endDate);
    budgetEndDate.setHours(23,59,59,999);

    if (today > budgetEndDate) {
        dailyAllowance = 0;
    } else {
        let effectiveStartDate = today < budgetStartDate ? budgetStartDate : today;
        let daysRemaining = Math.ceil((budgetEndDate - effectiveStartDate) / (1000 * 60 * 60 * 24)) +1;
        
        // If trip hasn't started, calculate based on full duration from start date
        if (today < budgetStartDate) {
            daysRemaining = Math.ceil((budgetEndDate - budgetStartDate) / (1000 * 60 * 60 * 24)) + 1;
        }


        if (daysRemaining > 0) {
            dailyAllowance = categoryBalance > 0 ? categoryBalance / daysRemaining : 0;
        } else { // Should ideally not happen if today <= budgetEndDate
            dailyAllowance = categoryBalance > 0 ? categoryBalance : 0; // If it's the last day or somehow daysRemaining is 0
        }
    }
    return {
        categoryBalance,
        dailyAllowance: dailyAllowance > 0 ? dailyAllowance : 0
    };
}

async function calculateExpenseTotal(expenseId) {
    const items = await db.expenseItems.where('expenseId').equals(expenseId).toArray();
    return items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() + userTimezoneOffset).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(dateTimeString) {
    if (!dateTimeString) return 'N/A';
    const date = new Date(dateTimeString);
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(amount, currencyCode) {
    if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
    if (!currencyCode) return amount.toFixed(2);
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    } catch (e) {
        return `${amount.toFixed(2)} ${currencyCode}`;
    }
}

async function deleteBudget(budgetId) {
    return db.transaction('rw', db.budgets, db.categories, db.expenses, db.expenseItems, async () => {
        const categories = await db.categories.where('budgetId').equals(budgetId).toArray();
        for (const category of categories) {
            await deleteCategoryContents(category.id);
        }
        await db.categories.where('budgetId').equals(budgetId).delete();
        await db.budgets.delete(budgetId);
    });
}

async function deleteCategory(categoryId) {
     return db.transaction('rw', db.categories, db.expenses, db.expenseItems, async () => {
        await deleteCategoryContents(categoryId);
        await db.categories.delete(categoryId);
    });
}

async function deleteCategoryContents(categoryId) {
    const expensesInCategory = await db.expenses.where('categoryId').equals(categoryId).toArray();
    for (const expense of expensesInCategory) {
        await db.expenseItems.where('expenseId').equals(expense.id).delete();
    }
    await db.expenses.where('categoryId').equals(categoryId).delete();
}

async function deleteExpense(expenseId) {
    return db.transaction('rw', db.expenses, db.expenseItems, async () => {
        await db.expenseItems.where('expenseId').equals(expenseId).delete();
        await db.expenses.delete(expenseId);
    });
}

const confirmationModal = document.getElementById('confirmation-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
let confirmCallback = null;

function showConfirmationModal(title, message, onConfirm) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    confirmCallback = onConfirm;
    confirmationModal.classList.remove('hidden');
}

modalConfirmBtn.addEventListener('click', () => {
    if (confirmCallback) {
        confirmCallback();
    }
    confirmationModal.classList.add('hidden');
    confirmCallback = null;
});

modalCancelBtn.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmCallback = null;
});

window.addEventListener('DOMContentLoaded', () => {
    const lastVisitString = localStorage.getItem('lastVisitedView');
    const lastFormStateString = localStorage.getItem('lastFormState');
    let formStateToRestore = null;

    if (lastFormStateString) {
        try {
            formStateToRestore = JSON.parse(lastFormStateString);
        } catch (e) {
            console.error("Error parsing lastFormState from localStorage", e);
            localStorage.removeItem('lastFormState');
        }
    }

    if (lastVisitString) {
        try {
            const lastVisit = JSON.parse(lastVisitString);
            if (formStateToRestore && lastVisit.viewId === formStateToRestore.targetView &&
                lastVisit.budgetId === formStateToRestore.budgetId &&
                lastVisit.categoryId === formStateToRestore.categoryId &&
                lastVisit.expenseId === formStateToRestore.expenseId // Check expenseId for edit state
                ) {
                navigateTo(lastVisit.viewId, lastVisit.budgetId, lastVisit.categoryId, lastVisit.expenseId, formStateToRestore);
            } else {
                // If formStateToRestore exists but doesn't match the last visited view context,
                // it might be stale, so don't attempt to restore it with navigateTo.
                // Let navigateTo clear it if it's not relevant to the target view.
                navigateTo(lastVisit.viewId, lastVisit.budgetId, lastVisit.categoryId, lastVisit.expenseId);
            }
        } catch (e) {
            console.error("Error parsing lastVisitedView from localStorage", e);
            localStorage.removeItem('lastVisitedView');
            navigateTo('budgets-list-view');
        }
    } else {
        navigateTo('budgets-list-view');
    }
    // updateBreadcrumbs(); // Already called inside navigateTo
});

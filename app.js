// 全局数据
let appData = {
    countdowns: [],
    todos: [],
    partitions: ['默认'],
    settings: {
        theme: 'light'
    }
};

let chartInstance = null;
let searchQuery = '';

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initTheme();
    renderAll();
    registerSW();

    // 绑定主题切换
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    
    // Check notifications
    if (Notification.permission === 'granted') {
        checkNotifications();
    }

    // Swipe Tutorial
    showSwipeTutorial();
});

// Service Worker 注册
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registered'))
            .catch(err => console.log('SW registration failed', err));
    }
}

// 数据管理
function loadData() {
    const saved = localStorage.getItem('timeTrackerData');
    if (saved) {
        appData = JSON.parse(saved);
        // 兼容性处理
        if (!appData.partitions) appData.partitions = ['默认'];
        if (!appData.settings) appData.settings = { theme: 'light' };
    }
}

function saveData() {
    localStorage.setItem('timeTrackerData', JSON.stringify(appData));
}

// 主题管理
function initTheme() {
    const isDark = appData.settings.theme === 'dark';
    if (isDark) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
        document.documentElement.classList.remove('dark');
        appData.settings.theme = 'light';
    } else {
        document.documentElement.classList.add('dark');
        appData.settings.theme = 'dark';
    }
    saveData();
}

// Search Functions
function toggleSearch() {
    const bar = document.getElementById('search-bar');
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) {
        document.getElementById('search-input').focus();
    } else {
        searchQuery = '';
        document.getElementById('search-input').value = '';
        renderAll();
    }
}

function handleSearch(val) {
    searchQuery = val.toLowerCase().trim();
    renderAll();
}

// Tab 切换
function switchTab(tab) {
    const p1 = document.getElementById('page-countdown');
    const p2 = document.getElementById('page-todo');
    const n1 = document.getElementById('nav-countdown');
    const n2 = document.getElementById('nav-todo');

    if (tab === 'countdown') {
        p1.classList.remove('-translate-x-full', 'opacity-0', 'pointer-events-none');
        p2.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        
        n1.classList.add('text-primary');
        n1.classList.remove('text-gray-400');
        n2.classList.remove('text-secondary'); // 假设todo用secondary色
        n2.classList.add('text-gray-400');
    } else {
        p1.classList.add('-translate-x-full', 'opacity-0', 'pointer-events-none');
        p2.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        
        n1.classList.remove('text-primary');
        n1.classList.add('text-gray-400');
        n2.classList.add('text-secondary');
        n2.classList.remove('text-gray-400');
    }
}

// 渲染逻辑
function renderAll() {
    renderCountdowns();
    renderPartitions();
    renderTodos();
}

function renderCountdowns() {
    const container = document.getElementById('countdown-list');
    const emptyState = document.getElementById('empty-countdown');
    
    container.innerHTML = '';
    
    let filteredList = appData.countdowns;
    if (searchQuery) {
        filteredList = filteredList.filter(item => item.title.toLowerCase().includes(searchQuery));
    }
    
    if (filteredList.length === 0) {
        if (!searchQuery) emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        // 排序：最近的在前面
        const sorted = [...filteredList].sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate));
        sorted.forEach(item => {
            container.appendChild(createCountdownCard(item));
        });
    }
}

function createCountdownCard(item) {
    const now = new Date();
    let target = new Date(item.targetDate);
    
    // Handle Repeating Logic
    if (item.repeat && item.repeat !== 'none') {
        const originalTarget = new Date(item.targetDate);
        let next = new Date(originalTarget);
        
        // Reset to base
        if (item.repeat === 'yearly') {
            next.setFullYear(now.getFullYear());
            if (next < now) next.setFullYear(now.getFullYear() + 1);
        } else if (item.repeat === 'monthly') {
            next.setMonth(now.getMonth());
            if (next < now) next.setMonth(now.getMonth() + 1);
        } else if (item.repeat === 'weekly') {
             while(next < now) {
                next.setDate(next.getDate() + 7);
             }
        }
        target = next;
    }

    const diffMs = target - now;
    const isPast = diffMs < 0;
    
    // Display Logic
    let displayDays = 0;
    let labelText = '';
    
    if (isPast) {
        // Count Up
        labelText = '已累计';
        displayDays = Math.abs(Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    } else {
        // Countdown
        labelText = '还剩';
        displayDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }
    
    // 颜色映射
    const colorMap = {
        blue: 'from-blue-500 to-cyan-400',
        red: 'from-red-500 to-orange-400',
        green: 'from-emerald-500 to-green-400',
        purple: 'from-purple-500 to-indigo-400'
    };
    const bgClass = colorMap[item.color] || colorMap.blue;

    const div = document.createElement('div');
    div.className = 'relative overflow-hidden rounded-xl shadow-md h-24 touch-pan-y';
    
    // Bg Image Logic
    let contentStyle = '';
    let overlay = '';
    let textColorClass = 'text-gray-800 dark:text-gray-100';
    let subTextColorClass = 'text-gray-500 dark:text-gray-400';
    let iconBgClass = `bg-gradient-to-br ${bgClass}`;
    let countTextClass = isPast ? 'text-secondary' : 'text-primary';
    
    if (item.bgImage) {
        contentStyle = `background-image: url('${item.bgImage}'); background-size: cover; background-position: center;`;
        overlay = '<div class="absolute inset-0 bg-black/40"></div>';
        textColorClass = 'text-white';
        subTextColorClass = 'text-gray-200';
        countTextClass = 'text-white';
    }

    div.innerHTML = `
        <div class="delete-bg" onclick="deleteCountdown('${item.id}')">
            <i class="fa-solid fa-trash mr-2"></i> 删除
        </div>
        <div class="swipe-item absolute inset-0 bg-white dark:bg-gray-800 flex items-center p-4 cursor-pointer transition-transform duration-200" id="cd-${item.id}" style="${contentStyle}">
            ${overlay}
            <div class="relative z-10 flex items-center w-full">
                <div class="w-12 h-12 rounded-lg ${iconBgClass} flex items-center justify-center text-white shrink-0 shadow-sm">
                    <i class="fa-solid ${getIconByType(item.type)} text-xl"></i>
                </div>
                <div class="ml-4 flex-1 min-w-0">
                    <h3 class="font-bold ${textColorClass} truncate">
                        ${item.title} 
                        ${item.repeat && item.repeat !== 'none' ? '<i class="fa-solid fa-rotate-right text-xs ml-1 opacity-70"></i>' : ''}
                    </h3>
                    <p class="text-xs ${subTextColorClass}">${target.toLocaleDateString()} ${target.getHours()}:${String(target.getMinutes()).padStart(2,'0')}</p>
                </div>
                <div class="text-right shrink-0">
                    <p class="text-xs ${subTextColorClass} mb-1">${labelText}</p>
                    <p class="text-2xl font-bold ${countTextClass} leading-none">${displayDays}<span class="text-xs font-normal ml-1">天</span></p>
                </div>
            </div>
        </div>
    `;
    
    bindSwipe(div.querySelector('.swipe-item'), () => deleteCountdown(item.id));
    
    return div;
}

function getIconByType(type) {
    const map = {
        anniversary: 'fa-heart',
        exam: 'fa-graduation-cap',
        birthday: 'fa-cake-candles',
        work: 'fa-briefcase',
        other: 'fa-star'
    };
    return map[type] || 'fa-star';
}

function renderPartitions() {
    const nav = document.getElementById('partition-nav');
    const list = document.getElementById('partition-manage-list');
    
    // 渲染顶部导航
    nav.innerHTML = appData.partitions.map((p, idx) => `
        <button onclick="switchPartition('${p}')" class="px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${idx === 0 ? 'bg-secondary text-white shadow-md' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}">
            ${p}
        </button>
    `).join('') + `
        <button onclick="openModal('modal-manage-partition')" class="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 shrink-0">
            <i class="fa-solid fa-plus text-xs"></i>
        </button>
    `;

    // 渲染管理列表
    list.innerHTML = appData.partitions.map(p => `
        <div class="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-2 rounded">
            <span class="text-sm dark:text-gray-300">${p}</span>
            ${p !== '默认' ? `<button onclick="deletePartition('${p}')" class="text-red-400 hover:text-red-500"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
    `).join('');
}

let currentPartition = '默认';
function switchPartition(p) {
    currentPartition = p;
    renderPartitions(); // 重新渲染以更新高亮
    // 更新高亮样式
    const nav = document.getElementById('partition-nav');
    Array.from(nav.children).forEach(btn => {
        if (btn.textContent.trim() === p) {
            btn.className = 'px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors bg-secondary text-white shadow-md';
        } else if (!btn.querySelector('.fa-plus')) {
            btn.className = 'px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
        }
    });
    renderTodos();
}

function renderTodos() {
    const container = document.getElementById('todo-list');
    const emptyState = document.getElementById('empty-todo');
    
    container.innerHTML = '';
    
    const filtered = appData.todos.filter(t => (t.partition || '默认') === currentPartition);
    let displayList = filtered;
    
    if (searchQuery) {
        displayList = displayList.filter(item => item.title.toLowerCase().includes(searchQuery));
    }
    
    if (displayList.length === 0) {
        if (!searchQuery) emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        // 未完成在前，已完成在后
        const sorted = [...displayList].sort((a, b) => {
            if (a.completed === b.completed) return new Date(b.createdAt) - new Date(a.createdAt);
            return a.completed ? 1 : -1;
        });
        
        sorted.forEach(item => {
            container.appendChild(createTodoCard(item));
        });
    }
}

function createTodoCard(item) {
    const div = document.createElement('div');
    div.className = 'relative overflow-hidden rounded-xl shadow-sm bg-white dark:bg-gray-800 touch-pan-y';
    
    const progressColor = item.progress >= 100 ? 'text-green-500' : 'text-secondary';
    
    const subtaskInfo = item.subtasks && item.subtasks.length > 0 
        ? `<span class="text-xs text-gray-400 mr-2"><i class="fa-solid fa-list-ul mr-1"></i>${item.subtasks.filter(s=>s.completed).length}/${item.subtasks.length}</span>`
        : '';
        
    const deadlineInfo = item.deadline 
        ? `<span class="text-xs ${new Date(item.deadline) < new Date() ? 'text-red-400' : 'text-gray-400'}"><i class="fa-regular fa-clock mr-1"></i>${new Date(item.deadline).toLocaleDateString()}</span>` 
        : '';

    div.innerHTML = `
        <div class="p-4 flex items-center cursor-pointer" onclick="openTodoDetail('${item.id}')">
            <div class="mr-3" onclick="event.stopPropagation(); toggleTodo('${item.id}')">
                <div class="w-6 h-6 rounded-full border-2 ${item.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-gray-600'} flex items-center justify-center transition-colors">
                    ${item.completed ? '<i class="fa-solid fa-check text-white text-xs"></i>' : ''}
                </div>
            </div>
            <div class="flex-1 min-w-0 flex flex-col justify-center">
                <h3 class="font-bold text-gray-800 dark:text-gray-100 truncate ${item.completed ? 'line-through text-gray-400' : ''}">${item.title}</h3>
                <div class="flex items-center mt-1">
                    ${subtaskInfo}
                    ${deadlineInfo}
                </div>
            </div>
            <div class="ml-2 flex items-center space-x-3">
                 <!-- Circular Progress -->
                 <div class="relative w-10 h-10 flex items-center justify-center">
                    ${getCircularProgress(item.progress, 40, progressColor)}
                    <span class="absolute text-[10px] font-bold ${item.completed ? 'text-green-500' : 'text-gray-500 dark:text-gray-400'}">${item.progress}%</span>
                 </div>
                 
                <button onclick="event.stopPropagation(); deleteTodo('${item.id}')" class="text-gray-400 hover:text-red-500 p-2">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `;
    return div;
}

function getCircularProgress(percentage, size, colorClass) {
    const radius = 16; 
    const circumference = 100; 
    const offset = circumference - (percentage / 100) * circumference;
    
    return `
        <svg class="transform -rotate-90" width="${size}" height="${size}">
            <circle
                class="text-gray-100 dark:text-gray-700"
                stroke-width="3"
                stroke="currentColor"
                fill="transparent"
                r="16"
                cx="20"
                cy="20"
            />
            <circle
                class="${colorClass} transition-all duration-500 ease-out"
                stroke-width="3"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${offset}"
                stroke-linecap="round"
                stroke="currentColor"
                fill="transparent"
                r="16"
                cx="20"
                cy="20"
            />
        </svg>
    `;
}

// 模态框操作
function openModal(id) {
    const modal = document.getElementById(id);
    modal.classList.remove('hidden');
    // 简单的入场动画逻辑
    setTimeout(() => {
        const content = modal.querySelector('.modal-content');
        if(content) {
            content.classList.remove('translate-y-full');
        }
    }, 10);
}

function closeModal(id) {
    const modal = document.getElementById(id);
    const content = modal.querySelector('.modal-content');
    if(content) {
        content.classList.add('translate-y-full');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
    } else {
        modal.classList.add('hidden');
    }
}

// 表单处理
function handleCountdownSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const fileInput = document.getElementById('countdown-bg-file');
    const file = fileInput ? fileInput.files[0] : null;
    
    processImage(file, (bgDataUrl) => {
        const newItem = {
            id: Date.now().toString(),
            title: form.title.value,
            type: form.type.value,
            color: form.color.value,
            repeat: form.repeat.value,
            targetDate: form.targetDate.value,
            bgImage: bgDataUrl,
            createdAt: new Date().toISOString()
        };
        
        appData.countdowns.push(newItem);
        saveData();
        renderCountdowns();
        closeModal('modal-add-countdown');
        form.reset();
        if(fileInput) fileInput.value = '';
        showToast('倒数日添加成功');
    });
}

function handleTodoSubmit(e) {
    e.preventDefault();
    const form = e.target;
    
    const newItem = {
        id: Date.now().toString(),
        title: form.title.value,
        deadline: form.deadline.value,
        progress: parseInt(form.progress.value) || 0,
        description: form.description.value,
        partition: currentPartition,
        completed: (parseInt(form.progress.value) || 0) === 100,
        subtasks: [],
        history: [], // For git style log
        createdAt: new Date().toISOString()
    };
    
    if (newItem.progress > 0) {
        newItem.history.push({
            date: new Date().toISOString(),
            progress: newItem.progress,
            note: '初始进度'
        });
    }
    
    appData.todos.push(newItem);
    saveData();
    renderTodos();
    closeModal('modal-add-todo');
    form.reset();
    
    if (newItem.completed) triggerConfetti();
    showToast('待办添加成功');
}

// 删除与状态更新
function deleteCountdown(id) {
    if(confirm('确定删除吗？')) {
        appData.countdowns = appData.countdowns.filter(i => i.id !== id);
        saveData();
        renderCountdowns();
    }
}

function deleteTodo(id) {
    if(confirm('确定删除吗？')) {
        appData.todos = appData.todos.filter(i => i.id !== id);
        saveData();
        renderTodos();
    }
}

function toggleTodo(id) {
    const item = appData.todos.find(i => i.id === id);
    if (item) {
        item.completed = !item.completed;
        if (item.completed) {
            item.progress = 100;
            triggerConfetti();
            item.history.push({
                date: new Date().toISOString(),
                progress: 100,
                note: '标记完成'
            });
        } else {
            item.progress = 0;
        }
        saveData();
        renderTodos();
    }
}

// 分区管理
function addPartition() {
    const input = document.getElementById('new-partition-name');
    const name = input.value.trim();
    if (name && !appData.partitions.includes(name)) {
        appData.partitions.push(name);
        saveData();
        renderPartitions();
        input.value = '';
    }
}

function deletePartition(name) {
    if (confirm(`确定删除分区 "${name}" 吗？该分区下的待办将移至默认分区。`)) {
        appData.partitions = appData.partitions.filter(p => p !== name);
        // 移动待办
        appData.todos.forEach(t => {
            if (t.partition === name) t.partition = '默认';
        });
        if (currentPartition === name) currentPartition = '默认';
        saveData();
        renderPartitions();
        renderTodos();
    }
}

// 待办详情逻辑
let currentTodoId = null;

function openTodoDetail(id) {
    const item = appData.todos.find(i => i.id === id);
    if (!item) return;
    currentTodoId = id;
    
    document.getElementById('detail-title').innerText = item.title;
    document.getElementById('detail-deadline').innerText = item.deadline ? new Date(item.deadline).toLocaleString() : '无';
    document.getElementById('detail-progress-text').innerText = item.progress + '%';
    document.getElementById('detail-desc').innerText = item.description || '无说明';
    
    const slider = document.getElementById('detail-slider');
    slider.value = item.progress;
    document.getElementById('detail-slider-val').innerText = item.progress + '%';
    
    slider.oninput = function() {
        document.getElementById('detail-slider-val').innerText = this.value + '%';
    };
    
    renderHistory(item.history);
    renderChart(item.history);
    renderSubtasks(item.subtasks || []);
    
    openModal('modal-todo-detail');
}

function addSubtask() {
    const input = document.getElementById('new-subtask');
    const content = input.value.trim();
    if (!content) return;
    
    const item = appData.todos.find(i => i.id === currentTodoId);
    if (!item) return;
    
    if (!item.subtasks) item.subtasks = [];
    
    item.subtasks.push({
        id: Date.now().toString(),
        content: content,
        completed: false
    });
    
    updateProgressFromSubtasks(item);
    saveData();
    renderSubtasks(item.subtasks);
    renderTodos();
    input.value = '';
}

function toggleSubtask(subId) {
    const item = appData.todos.find(i => i.id === currentTodoId);
    if (!item || !item.subtasks) return;
    
    const sub = item.subtasks.find(s => s.id === subId);
    if (sub) {
        sub.completed = !sub.completed;
        updateProgressFromSubtasks(item);
        saveData();
        renderSubtasks(item.subtasks);
        renderTodos();
    }
}

function deleteSubtask(subId) {
    const item = appData.todos.find(i => i.id === currentTodoId);
    if (!item || !item.subtasks) return;
    
    item.subtasks = item.subtasks.filter(s => s.id !== subId);
    updateProgressFromSubtasks(item);
    saveData();
    renderSubtasks(item.subtasks);
    renderTodos();
}

function updateProgressFromSubtasks(item) {
    if (item.subtasks && item.subtasks.length > 0) {
        const total = item.subtasks.length;
        const completed = item.subtasks.filter(s => s.completed).length;
        const newProgress = Math.round((completed / total) * 100);
        
        if (newProgress !== item.progress) {
            item.progress = newProgress;
            item.completed = newProgress === 100;
            
            item.history.push({
                date: new Date().toISOString(),
                progress: newProgress,
                note: `子任务: ${completed}/${total}`
            });
            
            saveData(); // Ensure saved before render
            renderTodos(); 
            
            // Update Detail View Elements
            document.getElementById('detail-progress-text').innerText = newProgress + '%';
            document.getElementById('detail-slider').value = newProgress;
            document.getElementById('detail-slider-val').innerText = newProgress + '%';
            renderHistory(item.history);
            renderChart(item.history);
        }
    }
}

function renderSubtasks(subtasks) {
    const list = document.getElementById('subtask-list');
    if (!subtasks || subtasks.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">无子任务</p>';
        return;
    }
    
    list.innerHTML = subtasks.map(s => `
        <div class="flex items-center justify-between bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-100 dark:border-gray-600">
            <div class="flex items-center space-x-2 flex-1 min-w-0 cursor-pointer" onclick="toggleSubtask('${s.id}')">
                <div class="w-5 h-5 rounded border ${s.completed ? 'bg-secondary border-secondary' : 'border-gray-300 dark:border-gray-500'} flex items-center justify-center transition-colors">
                    ${s.completed ? '<i class="fa-solid fa-check text-white text-[10px]"></i>' : ''}
                </div>
                <span class="text-sm dark:text-gray-300 truncate ${s.completed ? 'line-through text-gray-400' : ''}">${s.content}</span>
            </div>
            <button onclick="deleteSubtask('${s.id}')" class="text-gray-400 hover:text-red-500 ml-2 px-2"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join('');
}

function updateTodoProgress() {
    const item = appData.todos.find(i => i.id === currentTodoId);
    if (!item) return;
    
    const slider = document.getElementById('detail-slider');
    const note = document.getElementById('progress-note');
    const tagSelect = document.getElementById('progress-tag');
    
    const newProgress = parseInt(slider.value);
    const tag = tagSelect ? tagSelect.value : '';
    
    if (newProgress !== item.progress || note.value) {
        item.progress = newProgress;
        item.completed = newProgress === 100;
        item.history.push({
            date: new Date().toISOString(),
            progress: newProgress,
            note: note.value || '更新进度',
            tag: tag
        });
        
        saveData();
        renderTodos();
        
        // 更新详情页视图
        document.getElementById('detail-progress-text').innerText = newProgress + '%';
        renderHistory(item.history);
        renderChart(item.history);
        
        note.value = '';
        if(tagSelect) tagSelect.value = '';
        showToast('进度已更新');
    }
}

function renderHistory(history) {
    const list = document.getElementById('history-list');
    list.innerHTML = history.slice().reverse().map(h => {
        let tagHtml = '';
        if (h.tag) {
            let color = 'bg-gray-200 text-gray-700';
            if (h.tag === 'Fix') color = 'bg-red-100 text-red-700';
            else if (h.tag === 'Feat') color = 'bg-green-100 text-green-700';
            else if (h.tag === 'Docs') color = 'bg-blue-100 text-blue-700';
            else if (h.tag === 'Refactor') color = 'bg-purple-100 text-purple-700';
            
            tagHtml = `<span class="text-[10px] px-1.5 py-0.5 rounded ${color} mr-2">${h.tag}</span>`;
        }
        
        return `
        <div class="relative pl-6 pb-4 border-l border-gray-200 dark:border-gray-600 last:pb-0">
            <div class="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-500"></div>
            <div class="text-xs text-gray-400 mb-1 flex items-center">
                ${new Date(h.date).toLocaleString()}
            </div>
            <div class="text-sm dark:text-gray-300 flex items-center">
                ${tagHtml}
                <span class="font-bold text-secondary mr-2">${h.progress}%</span>
                <span>${h.note}</span>
            </div>
        </div>
    `}).join('');
}

function renderChart(history) {
    const ctx = document.getElementById('progressChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    
    const labels = history.map(h => new Date(h.date).toLocaleDateString());
    const data = history.map(h => h.progress);
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '进度 (%)',
                data: data,
                borderColor: '#ec4899',
                backgroundColor: 'rgba(236, 72, 153, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100 },
                x: { display: false }
            }
        }
    });
}

// 通用工具
function bindSwipe(element, action) {
    let startX = 0;
    let currentX = 0;
    
    element.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
    });
    
    element.addEventListener('touchmove', e => {
        currentX = e.touches[0].clientX;
        const diff = currentX - startX;
        if (diff < 0 && diff > -100) {
            element.style.transform = `translateX(${diff}px)`;
            // Vibration
            if (diff < -80) {
                if (!element.classList.contains('vibrated')) {
                    if (navigator.vibrate) navigator.vibrate(10);
                    element.classList.add('vibrated');
                }
            } else {
                element.classList.remove('vibrated');
            }
        }
    });
    
    element.addEventListener('touchend', e => {
        const diff = currentX - startX;
        if (diff < -80) { 
            element.style.transform = 'translateX(0)';
            action();
        } else {
            element.style.transform = 'translateX(0)';
        }
        currentX = 0;
        element.classList.remove('vibrated');
    });
}

function processImage(file, callback) {
    if (!file) {
        callback(null);
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const maxWidth = 600; 
            const scale = maxWidth / img.width;
            if (scale < 1) {
                canvas.width = maxWidth;
                canvas.height = img.height * scale;
            } else {
                canvas.width = img.width;
                canvas.height = img.height;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            callback(canvas.toDataURL('image/jpeg', 0.7)); 
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- 辅助功能 ---
function triggerConfetti() {
    const colors = ['#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];
    
    for (let i = 0; i < 50; i++) {
        const confetto = document.createElement('div');
        confetto.style.position = 'fixed';
        confetto.style.left = '50%';
        confetto.style.top = '50%';
        confetto.style.width = '8px';
        confetto.style.height = '8px';
        confetto.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetto.style.zIndex = '9999';
        confetto.style.pointerEvents = 'none';
        confetto.style.borderRadius = '2px';
        
        document.body.appendChild(confetto);
        
        const angle = Math.random() * Math.PI * 2;
        const velocity = 5 + Math.random() * 10;
        const tx = Math.cos(angle) * velocity * 20; 
        const ty = Math.sin(angle) * velocity * 20;
        const rot = Math.random() * 360;
        
        const animation = confetto.animate([
            { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
            { transform: `translate(${tx}px, ${ty}px) scale(0) rotate(${rot}deg)`, opacity: 0 }
        ], {
            duration: 1000 + Math.random() * 1000,
            easing: 'cubic-bezier(0, .9, .57, 1)',
            fill: 'forwards'
        });
        
        animation.onfinish = () => confetto.remove();
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    toast.classList.remove('opacity-0');
    toast.style.top = '100px'; // 稍微下移
    setTimeout(() => {
        toast.classList.add('opacity-0');
        toast.style.top = '20px';
    }, 2000);
}

// --- 统计与热力图 ---
function openStatsModal() {
    renderHeatmap();
    openModal('modal-stats');
}

function renderHeatmap() {
    const container = document.getElementById('heatmap-container');
    container.innerHTML = '';
    
    // 1. Gather Data
    const activityMap = {};
    appData.todos.forEach(todo => {
        if (todo.history) {
            todo.history.forEach(h => {
                const dateKey = new Date(h.date).toISOString().slice(0, 10);
                activityMap[dateKey] = (activityMap[dateKey] || 0) + 1;
            });
        }
    });
    
    // 2. Generate Dates (Last 1 year, aligned to week)
    const today = new Date();
    const startDate = new Date(today);
    startDate.setFullYear(startDate.getFullYear() - 1);
    
    // Adjust start date to previous Sunday (0)
    while(startDate.getDay() !== 0) {
        startDate.setDate(startDate.getDate() - 1);
    }
    
    const dates = [];
    let d = new Date(startDate);
    while(d <= today) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
    }
    
    // 3. Render Grid
    const grid = document.createElement('div');
    grid.className = 'grid grid-rows-7 grid-flow-col gap-1';
    
    dates.forEach(dateObj => {
        const dateKey = dateObj.toISOString().slice(0, 10);
        const count = activityMap[dateKey] || 0;
        
        let colorClass = 'bg-gray-100 dark:bg-gray-700';
        if (count > 0) colorClass = 'bg-green-200';
        if (count > 2) colorClass = 'bg-green-400';
        if (count > 5) colorClass = 'bg-green-600';
        if (count > 8) colorClass = 'bg-green-800';
        
        const cell = document.createElement('div');
        cell.className = `w-3 h-3 rounded-sm ${colorClass}`;
        cell.title = `${dateKey}: ${count} 次贡献`;
        
        grid.appendChild(cell);
    });
    
    container.appendChild(grid);
}

// --- 消息通知 ---
function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast('浏览器不支持通知');
        return;
    }
    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            showToast('通知已开启');
            checkNotifications();
        } else {
            showToast('通知权限被拒绝');
        }
    });
}

function checkNotifications() {
    const now = new Date();
    
    appData.countdowns.forEach(item => {
        const target = new Date(item.targetDate);
        const diff = target - now;
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        
        // Notify if today (0) or tomorrow (1)
        if (days === 0 || days === 1) {
             sendNotification(item.title, days === 0 ? '目标日就在今天！' : '目标日就在明天！');
        }
    });
    
    appData.todos.forEach(item => {
        if (!item.completed && item.deadline) {
            const target = new Date(item.deadline);
            const diff = target - now;
            const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
            
            if (days === 0 || days === 1) {
                sendNotification('待办提醒: ' + item.title, days === 0 ? '任务今天截止！' : '任务明天截止！');
            }
        }
    });
}

function sendNotification(title, body) {
    // Basic debounce check could be added here
    if (Notification.permission === 'granted') {
        // Try Service Worker registration first
        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(registration => {
                registration.showNotification(title, {
                    body: body,
                    icon: './icon-192.png',
                    vibrate: [200, 100, 200]
                });
            });
        } else {
            new Notification(title, {
                body: body,
                icon: './icon-192.png'
            });
        }
    }
}

// --- 数据导入导出 ---
function exportData() {
    const dataStr = JSON.stringify(appData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time_tracker_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('数据已导出');
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (parsed && typeof parsed === 'object') {
                if (confirm('导入数据将覆盖当前数据，确定吗？')) {
                    appData = { ...appData, ...parsed }; 
                    saveData();
                    renderAll();
                    initTheme(); 
                    showToast('数据导入成功');
                    closeModal('modal-settings');
                }
            } else {
                alert('无效的数据文件');
            }
        } catch (err) {
            console.error(err);
            alert('文件解析失败');
        }
    };
    reader.readAsText(file);
    input.value = ''; 
}

function showSwipeTutorial() {
    if (!localStorage.getItem('hasShownSwipeTutorial')) {
        setTimeout(() => {
            const firstCard = document.querySelector('.swipe-item');
            if (firstCard) {
                // Add transition class if not present
                firstCard.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.1, 0.25, 1)';
                
                // Animate: slight left, then back
                firstCard.style.transform = 'translateX(-60px)';
                
                // Show a hint toast or just relying on the visual movement?
                // Visual movement is usually enough.
                
                setTimeout(() => {
                    firstCard.style.transform = 'translateX(0)';
                    localStorage.setItem('hasShownSwipeTutorial', 'true');
                }, 800);
            }
        }, 1500); // Wait a bit for user to orient themselves
    }
}

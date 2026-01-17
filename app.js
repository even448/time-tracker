// 全局数据
let appData = {
    countdowns: [],
    todos: [],
    partitions: ['默认'],
    settings: {
        theme: 'light'
    },
    focusSessions: [], // { id, taskId, taskTitle, startTime, duration, type, createdAt }
    focusTasks: [] // { id, title } - Independent focus tasks
};

let chartInstance = null;
let searchQuery = '';

// Focus Timer State
let focusTimer = {
    interval: null,
    timeLeft: 25 * 60, // seconds
    totalTime: 25 * 60, // target for pomodoro
    elapsed: 0, // for stopwatch
    isRunning: false,
    isPaused: false,
    mode: 'pomodoro', // 'pomodoro' or 'stopwatch'
    currentTask: null // { id, title }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initTheme();
    renderAll();
    renderFocusStats(); // Initial stats render
    updateFocusTaskUI();
    updateTimerButtonState(false);
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

// Cloud Sync Manager
let cloudSync = {
    db: null,
    docRef: null,
    unsubscribe: null,
    config: null,
    enabled: false
};

function initCloudSync() {
    const savedConfig = localStorage.getItem('firebaseConfig');
    const savedEnabled = localStorage.getItem('cloudSyncEnabled') === 'true';
    
    if (savedConfig) {
        try {
            cloudSync.config = JSON.parse(savedConfig);
            document.getElementById('firebase-config-input').value = savedConfig;
        } catch (e) {
            console.error('Invalid Firebase Config');
        }
    }
    
    document.getElementById('cloud-sync-toggle').checked = savedEnabled;
    cloudSync.enabled = savedEnabled;

    if (cloudSync.enabled && cloudSync.config) {
        connectToCloud();
    }
}

function connectToCloud() {
    if (!window.firebaseModules) {
        setTimeout(connectToCloud, 500); // Wait for modules to load
        return;
    }

    try {
        const { initializeApp, getFirestore, doc, onSnapshot, setDoc } = window.firebaseModules;
        
        const app = initializeApp(cloudSync.config);
        cloudSync.db = getFirestore(app);
        // Use a static doc ID 'user_data' for simplicity (Single User Mode)
        // In a real app, you'd use Auth UID
        cloudSync.docRef = doc(cloudSync.db, "time_tracker", "user_data");
        
        // Listen for changes
        cloudSync.unsubscribe = onSnapshot(cloudSync.docRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                // Check if cloud data is newer or different?
                // For simplicity, we just trust cloud if it's an update not from us
                // But to avoid loops, we might need timestamps.
                // Let's just overwrite local appData with Cloud Data
                // BUT only if we didn't just write it.
                // Simplified: Just overwrite and render.
                
                // Merge logic could be complex. Here we replace.
                if (JSON.stringify(data) !== JSON.stringify(appData)) {
                    console.log('Received Cloud Update');
                    appData = data;
                    saveData(false); // Save to local but DON'T push back to cloud
                    renderAll();
                    showToast('数据已从云端同步');
                }
            }
        });

        document.getElementById('cloud-status').classList.remove('hidden');
        showToast('已连接到云端数据库');

    } catch (e) {
        console.error('Cloud Connection Failed', e);
        showToast('云端连接失败，请检查配置');
    }
}

function openCloudSyncModal() {
    openModal('modal-cloud-sync');
}

function saveCloudConfig() {
    let input = document.getElementById('firebase-config-input').value.trim();
    if (!input) return;
    
    try {
        // Allow user to paste JS object format (keys without quotes) and convert to JSON
        // Simple regex to add quotes to keys if missing
        if (!input.trim().startsWith('"') && !input.trim().startsWith('{')) {
             throw new Error("Invalid start");
        }
        
        // Relaxed JSON parsing: try to fix common copy-paste formats
        // 1. Remove "const firebaseConfig =" if present
        input = input.replace(/const\s+firebaseConfig\s*=\s*/, '');
        // 2. Remove trailing semicolon
        input = input.replace(/;\s*$/, '');
        
        // 3. Try standard JSON parse first
        let config;
        try {
            config = JSON.parse(input);
        } catch (e) {
            // 4. If failed, try to evaluate as JS object (risky but convenient for this specific user pasting config)
            // Or better: use regex to quote keys. 
            // Replace unquoted keys:  key: "value"  ->  "key": "value"
            const jsonString = input.replace(/(\w+):/g, '"$1":');
            config = JSON.parse(jsonString);
        }

        localStorage.setItem('firebaseConfig', JSON.stringify(config));
        cloudSync.config = config;
        
        if (cloudSync.enabled) {
            connectToCloud();
        }
        
        closeModal('modal-cloud-sync');
        showToast('配置已保存');
    } catch (e) {
        console.error(e);
        alert('配置格式错误，请确保只复制了 { ... } 部分，或者手动给属性名加上双引号。');
    }
}

function toggleCloudSync(el) {
    cloudSync.enabled = el.checked;
    localStorage.setItem('cloudSyncEnabled', el.checked);
    
    if (cloudSync.enabled) {
        if (cloudSync.config) {
            connectToCloud();
        } else {
            showToast('请先输入 Firebase 配置');
        }
    } else {
        if (cloudSync.unsubscribe) {
            cloudSync.unsubscribe();
            cloudSync.unsubscribe = null;
        }
        document.getElementById('cloud-status').classList.add('hidden');
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
        if (!appData.focusTasks) appData.focusTasks = [];
    }
    
    // Init Cloud after local load
    initCloudSync();
}

function saveData(syncToCloud = true) {
    localStorage.setItem('timeTrackerData', JSON.stringify(appData));
    
    if (syncToCloud && cloudSync.enabled && cloudSync.db) {
        const { setDoc } = window.firebaseModules;
        // Debounce could be good here, but for now direct write
        setDoc(cloudSync.docRef, appData)
            .then(() => console.log('Synced to Cloud'))
            .catch(e => console.error('Cloud Save Error', e));
    }
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
    const p3 = document.getElementById('page-focus');
    
    const n1 = document.getElementById('nav-countdown');
    const n2 = document.getElementById('nav-todo');
    const n3 = document.getElementById('nav-focus');

    // Reset all content
    [p1, p2, p3].forEach(p => {
        p.classList.add('translate-x-full', 'opacity-0', 'pointer-events-none');
        p.classList.remove('-translate-x-full');
    });
    
    // Reset nav buttons
    [n1, n2, n3].forEach(n => {
        n.classList.remove('active', 'text-stone-800', 'dark:text-stone-100');
        n.classList.add('text-stone-400'); // Fallback text color for non-active
    });

    if (tab === 'countdown') {
        p1.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        n1.classList.add('active');
        n1.classList.remove('text-stone-400');
    } else if (tab === 'todo') {
        p2.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        n2.classList.add('active');
        n2.classList.remove('text-stone-400');
    } else if (tab === 'focus') {
        p3.classList.remove('translate-x-full', 'opacity-0', 'pointer-events-none');
        n3.classList.add('active');
        n3.classList.remove('text-stone-400');
        renderFocusStats();
    }
}

// 渲染逻辑
function renderAll() {
    renderCountdowns();
    renderPartitions();
    renderTodos();
    renderFocusPresets();
    renderFocusTodoList();
}

function renderCountdowns() {
    const container = document.getElementById('countdown-list');
    const emptyState = document.getElementById('empty-countdown');
    
    container.innerHTML = '';
    
    // Filter out archived
    let filteredList = appData.countdowns.filter(item => !item.archived);
    
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
    
    // Handle Repeating Logic (Only if NOT a fixed past event "Count Up" mode)
    // If user explicitly chose "Count Up" (item.countUpMode), we usually stick to original date unless user wants annual anniversary count up?
    // Usually "Count Up" means "Days Since...", so we don't repeat the target date to future.
    
    if (!item.countUpMode && item.repeat && item.repeat !== 'none') {
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
    
    // --- OPTIMIZED VISUAL DESIGN & LOGIC ---

    const absDiff = Math.abs(diffMs);
    const totalHours = absDiff / (1000 * 60 * 60);
    const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((absDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60));

    // 1. Urgency Color Logic
    let headerBgClass = ''; // This will replace bgClass logic
    
    if (isPast) {
         headerBgClass = item.countUpMode ? 'bg-orange-500' : 'bg-stone-500';
    } else {
        if (totalHours < 24) headerBgClass = 'bg-[#FF5252]'; // Coral/Red (<24h)
        else if (totalHours < 72) headerBgClass = 'bg-blue-500'; // Blue (1-3d)
        else headerBgClass = 'bg-emerald-500'; // Green (>3d)
    }

    // 2. Number Logic (Hero Number)
    let labelText = isPast ? (item.countUpMode ? '已经起始' : '已经过去') : '还有';
    let mainNumber = days;
    let mainUnit = '天';
    let isUrgentTime = (!isPast && totalHours < 1);
    
    if (!isPast) {
        if (days >= 1) { mainNumber = days; mainUnit = '天'; }
        else if (hours >= 1) { mainNumber = hours; mainUnit = '小时'; }
        else { mainNumber = minutes; mainUnit = '分'; }
    } else {
        mainNumber = days; mainUnit = '天';
    }
    
    // Subtext
    let subText = `${days}天 ${hours}小时 ${minutes}分钟`;
    
    // 3. Progress Bar Logic
    let startTime = item.createdAt ? new Date(item.createdAt).getTime() : (target.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (item.repeat && item.repeat !== 'none') {
         const thirtyDays = 30 * 24 * 60 * 60 * 1000;
         const potentialStart = target.getTime() - thirtyDays;
         if (startTime < potentialStart) startTime = potentialStart; 
    }
    const totalDuration = target.getTime() - startTime;
    const elapsed = now.getTime() - startTime;
    let progressPct = 0;
    if (totalDuration > 0) {
        progressPct = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
    }
    if (isPast && !item.countUpMode) progressPct = 100;

    const div = document.createElement('div');
    div.className = 'relative touch-pan-y transition-transform duration-200 mt-4'; 
    
    let headerStyle = '';
    let headerClass = `calendar-top ${headerBgClass} transition-colors duration-300`;
    
    if (item.bgImage) {
        headerStyle = `background-image: url('${item.bgImage}'); background-size: cover; background-position: center; height: 100px;`;
        headerClass = 'calendar-top h-[100px]'; 
    }

    const archiveBtn = (isPast && !item.countUpMode) 
        ? `<button onclick="archiveCountdown('${item.id}')" class="absolute top-2 right-2 text-white/90 hover:text-white z-30 p-2"><i class="fa-solid fa-box-archive"></i></button>` 
        : '';
        
    const focusBtn = (!isPast) 
        ? `<button onclick="startSubjectFocus('${item.title}')" class="absolute -bottom-4 right-4 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-200 text-xs px-3 py-1.5 rounded-full shadow-md hover:scale-105 active:scale-95 transition-transform flex items-center border border-stone-100 dark:border-stone-700 z-20">
            <i class="fa-solid fa-stopwatch mr-1 text-primary"></i> 专注
           </button>`
        : '';

    div.innerHTML = `
        <div class="delete-bg" onclick="deleteCountdown('${item.id}')">
            <i class="fa-solid fa-trash mr-2"></i> 删除
        </div>
        
        <div class="swipe-item modern-card calendar-card overflow-visible relative z-10" id="cd-${item.id}">
            <!-- Header -->
            <div class="${headerClass}" style="${headerStyle}">
                <div class="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
                ${archiveBtn}
                <div class="relative z-10 w-full flex justify-between items-end pb-1">
                     <h3 class="font-bold text-white text-lg truncate flex-1 mr-2 drop-shadow-md">
                        ${item.title} 
                        ${item.repeat && item.repeat !== 'none' ? '<i class="fa-solid fa-rotate-right text-xs ml-1 opacity-80"></i>' : ''}
                    </h3>
                    ${item.countUpMode ? '<span class="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">正数</span>' : ''}
                </div>
            </div>
            
            ${focusBtn}

            <!-- Body -->
            <div class="p-5 pt-6 flex items-center justify-between relative bg-white dark:bg-[#1c1917]">
                <div class="flex-1 relative z-10 mr-4">
                     <div class="flex items-baseline space-x-1 mb-1">
                        <p class="text-xs text-stone-500 dark:text-stone-400 font-medium uppercase tracking-wide">${labelText}</p>
                        <p class="text-xs text-stone-300 dark:text-stone-600">|</p>
                        <p class="text-xs text-stone-400 dark:text-stone-500 font-mono">${target.toLocaleDateString()}</p>
                     </div>
                     <p class="text-xs text-stone-400 dark:text-stone-500 font-normal leading-relaxed">${subText}</p>
                </div>
                
                <div class="relative z-10 text-right flex flex-col items-end">
                    <div class="flex items-baseline">
                        <span class="text-4xl font-bold text-stone-800 dark:text-stone-100 hero-number ${isUrgentTime ? 'urgent-pulse text-red-500' : ''}">${mainNumber}</span>
                        <span class="text-sm text-stone-500 dark:text-stone-400 font-medium ml-1">${mainUnit}</span>
                    </div>
                </div>
            </div>
            
            <!-- Progress Bar -->
            <div class="h-1 bg-stone-100 dark:bg-stone-800 w-full mt-0">
                <div class="h-full ${headerBgClass} opacity-80" style="width: ${progressPct}%"></div>
            </div>
        </div>
    `;
    
    bindSwipe(div.querySelector('.swipe-item'), () => deleteCountdown(item.id));
    
    return div;
}

// 自动更新计时器 (Every minute)
setInterval(() => {
    // Only re-render if we are on the countdown tab to save performance?
    // Or just re-render specific parts. For simplicity, re-render all countdowns.
    // Ideally we should just update the DOM elements, but renderCountdowns is fast enough for < 100 items.
    if (!document.getElementById('page-countdown').classList.contains('opacity-0')) {
        renderCountdowns();
    }
    // Also update Todos deadlines
    if (!document.getElementById('page-todo').classList.contains('opacity-0')) {
        renderTodos();
    }
}, 60000);

// Archive Logic
function archiveCountdown(id) {
    const item = appData.countdowns.find(i => i.id === id);
    if (item) {
        if(confirm('确定归档此已过期的倒数日吗？归档后可在设置中查看。')) {
            item.archived = true;
            saveData();
            renderCountdowns();
            showToast('已归档');
        }
    }
}

function unarchiveCountdown(id) {
    const item = appData.countdowns.find(i => i.id === id);
    if (item) {
        item.archived = false;
        saveData();
        renderArchiveList(); // Refresh archive modal
        renderCountdowns(); // Refresh main list
        showToast('已取消归档');
    }
}

function openArchiveModal() {
    renderArchiveList();
    openModal('modal-archive');
}

function renderArchiveList() {
    const list = document.getElementById('archive-list');
    const archived = appData.countdowns.filter(i => i.archived);
    
    if (archived.length === 0) {
        list.innerHTML = '<p class="text-center text-stone-400 py-4">暂无归档</p>';
        return;
    }
    
    list.innerHTML = archived.map(item => `
        <div class="flex justify-between items-center bg-stone-50 dark:bg-stone-700/50 p-3 rounded-lg mb-2">
            <div>
                <p class="font-bold text-sm dark:text-stone-200">${item.title}</p>
                <p class="text-xs text-stone-400">${new Date(item.targetDate).toLocaleDateString()}</p>
            </div>
            <button onclick="unarchiveCountdown('${item.id}')" class="text-primary text-sm font-bold">还原</button>
        </div>
    `).join('');
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
        <button onclick="switchPartition('${p}')" class="px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${idx === 0 ? 'bg-primary text-white shadow-md' : 'bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300'}">
            ${p}
        </button>
    `).join('') + `
        <button onclick="openModal('modal-manage-partition')" class="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-700 flex items-center justify-center text-stone-500 shrink-0">
            <i class="fa-solid fa-plus text-xs"></i>
        </button>
    `;

    // 渲染管理列表
    list.innerHTML = appData.partitions.map(p => `
        <div class="flex justify-between items-center bg-stone-50 dark:bg-stone-700/50 p-2 rounded">
            <span class="text-sm dark:text-stone-300">${p}</span>
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
            btn.className = 'px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300';
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
    renderFocusTodoList();
}

function createTodoCard(item) {
    const div = document.createElement('div');
    div.className = 'modern-card relative overflow-hidden touch-pan-y';
    
    const progressColor = item.progress >= 100 ? 'text-green-500' : 'text-secondary';
    
    const subtaskInfo = item.subtasks && item.subtasks.length > 0 
        ? `<span class="text-xs text-stone-400 mr-2"><i class="fa-solid fa-list-ul mr-1"></i>${item.subtasks.filter(s=>s.completed).length}/${item.subtasks.length}</span>`
        : '';
        
    const deadlineInfo = item.deadline 
        ? `<span class="text-xs ${new Date(item.deadline) < new Date() ? 'text-red-400' : 'text-stone-400'}"><i class="fa-regular fa-clock mr-1"></i>${new Date(item.deadline).toLocaleDateString()}</span>` 
        : '';

    div.innerHTML = `
        <div class="p-4 flex items-center cursor-pointer" onclick="openTodoDetail('${item.id}')">
            <div class="mr-3" onclick="event.stopPropagation(); toggleTodo('${item.id}')">
                <div class="w-6 h-6 rounded-full border-2 ${item.completed ? 'bg-green-500 border-green-500' : 'border-stone-300 dark:border-stone-600'} flex items-center justify-center transition-colors">
                    ${item.completed ? '<i class="fa-solid fa-check text-white text-xs"></i>' : ''}
                </div>
            </div>
            <div class="flex-1 min-w-0 flex flex-col justify-center">
                <h3 class="font-bold text-stone-800 dark:text-stone-100 truncate ${item.completed ? 'line-through text-stone-400' : ''}">${item.title}</h3>
                <div class="flex items-center mt-1">
                    ${subtaskInfo}
                    ${deadlineInfo}
                </div>
            </div>
            <div class="ml-2 flex items-center space-x-3">
                 <!-- Circular Progress -->
                 <div class="relative w-10 h-10 flex items-center justify-center">
                    ${getCircularProgress(item.progress, 40, progressColor)}
                    <span class="absolute text-[10px] font-bold ${item.completed ? 'text-green-500' : 'text-stone-500 dark:text-stone-400'}">${item.progress}%</span>
                 </div>
                 
                <button onclick="event.stopPropagation(); deleteTodo('${item.id}')" class="text-stone-400 hover:text-red-500 p-2">
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
                class="text-stone-100 dark:text-stone-700"
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

// Focus Timer Logic
function setFocusMode(mode) {
    if (focusTimer.isRunning) {
        if(!confirm('切换模式将重置当前计时，确定吗？')) return;
        stopTimer(false); // Stop without saving
    }
    
    focusTimer.mode = mode;
    const btnP = document.getElementById('btn-mode-pomodoro');
    const btnS = document.getElementById('btn-mode-stopwatch');
    const circle = document.getElementById('timer-progress');
    const playBtn = document.getElementById('btn-timer-toggle');
    
    if (mode === 'pomodoro') {
        const defaultDuration = (focusTimer.currentTask && focusTimer.currentTask.duration) 
            ? focusTimer.currentTask.duration * 60 
            : 25 * 60;
        focusTimer.timeLeft = defaultDuration;
        focusTimer.totalTime = defaultDuration;
        btnP.className = 'px-4 py-1.5 rounded-full text-sm font-medium transition-all bg-white dark:bg-stone-600 shadow-sm text-emerald-600';
        btnS.className = 'px-4 py-1.5 rounded-full text-sm font-medium transition-all text-stone-500 dark:text-stone-400';
        circle.classList.remove('stopwatch-mode');
        playBtn.classList.remove('bg-blue-500', 'bg-blue-600', 'shadow-blue-500/40');
        playBtn.classList.add('bg-emerald-500', 'shadow-emerald-500/40');
    } else {
        focusTimer.elapsed = 0;
        focusTimer.timeLeft = 0; // In stopwatch, we display elapsed
        btnS.className = 'px-4 py-1.5 rounded-full text-sm font-medium transition-all bg-white dark:bg-stone-600 shadow-sm text-blue-500';
        btnP.className = 'px-4 py-1.5 rounded-full text-sm font-medium transition-all text-stone-500 dark:text-stone-400';
        circle.classList.add('stopwatch-mode');
        playBtn.classList.remove('bg-emerald-500', 'bg-emerald-600', 'shadow-emerald-500/40');
        playBtn.classList.add('bg-blue-500', 'shadow-blue-500/40');
    }
    
    resetTimer();
}

function updateFocusTaskUI() {
    const activeDisplay = document.getElementById('active-task-display');
    const activeTitle = document.getElementById('active-task-title');
    const currentTaskSpan = document.getElementById('current-focus-task');
    if (!activeDisplay || !activeTitle || !currentTaskSpan) return;

    if (focusTimer.currentTask) {
        activeTitle.textContent = focusTimer.currentTask.title;
        activeDisplay.classList.remove('hidden');
        currentTaskSpan.textContent = '更换任务';
    } else {
        activeDisplay.classList.add('hidden');
        currentTaskSpan.textContent = '🤔 你现在想专注于什么？';
    }
}

function updateTimerButtonState(isRunning) {
    const btn = document.getElementById('btn-timer-toggle');
    if (!btn) return;
    const isPomodoro = focusTimer.mode === 'pomodoro';
    const baseClass = isPomodoro ? 'bg-emerald-500' : 'bg-blue-500';
    const runningClass = isPomodoro ? 'bg-emerald-600' : 'bg-blue-600';
    btn.classList.remove('bg-emerald-500', 'bg-emerald-600', 'bg-blue-500', 'bg-blue-600');
    btn.classList.add(isRunning ? runningClass : baseClass);
}

function toggleTimer() {
    const btn = document.getElementById('btn-timer-toggle');
    
    if (focusTimer.isRunning) {
        // Pause
        clearInterval(focusTimer.interval);
        focusTimer.isRunning = false;
        focusTimer.isPaused = true;
        btn.innerHTML = '<i class="fa-solid fa-play ml-1"></i>';
        updateTimerButtonState(false);
    } else {
        // Start
        focusTimer.isRunning = true;
        focusTimer.isPaused = false;
        btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        updateTimerButtonState(true);
        
        focusTimer.interval = setInterval(() => {
            if (focusTimer.mode === 'pomodoro') {
                if (focusTimer.timeLeft > 0) {
                    focusTimer.timeLeft--;
                    updateTimerDisplay();
                } else {
                    stopTimer(true); // Completed
                    showToast('专注完成！休息一下吧');
                    if(Notification.permission === 'granted') {
                        new Notification('专注完成', { body: '你已完成一个番茄钟！' });
                    }
                }
            } else {
                focusTimer.elapsed++;
                updateTimerDisplay();
            }
        }, 1000);
    }
}

function stopTimer(save = true) {
    clearInterval(focusTimer.interval);
    const btn = document.getElementById('btn-timer-toggle');
    btn.innerHTML = '<i class="fa-solid fa-play ml-1"></i>';
    updateTimerButtonState(false);
    
    if (focusTimer.isRunning || focusTimer.isPaused) {
        if (save) {
            const duration = focusTimer.mode === 'pomodoro' 
                ? (focusTimer.totalTime - focusTimer.timeLeft) 
                : focusTimer.elapsed;
            
            if (duration > 60) { // Only save if > 1 minute
                saveFocusSession(duration);
            }
        }
    }
    
    focusTimer.isRunning = false;
    focusTimer.isPaused = false;
    
    // Reset to initial state
    if (focusTimer.mode === 'pomodoro') {
        const defaultDuration = (focusTimer.currentTask && focusTimer.currentTask.duration) 
            ? focusTimer.currentTask.duration * 60 
            : 25 * 60;
        focusTimer.timeLeft = defaultDuration;
        // Ensure totalTime is synced (though usually it is, but if changed dynamically)
        focusTimer.totalTime = defaultDuration;
    } else {
        focusTimer.elapsed = 0;
    }
    updateTimerDisplay();
}

function resetTimer() {
    stopTimer(false);
}

function updateTimerDisplay() {
    const display = document.getElementById('timer-display');
    const circle = document.getElementById('timer-progress');
    const fullDash = 703.72; // 2 * PI * 112
    
    let seconds = 0;
    let progress = 0;
    
    if (focusTimer.mode === 'pomodoro') {
        seconds = focusTimer.timeLeft;
        progress = (focusTimer.totalTime - focusTimer.timeLeft) / focusTimer.totalTime;
    } else {
        seconds = focusTimer.elapsed;
        progress = 0; // Stopwatch typically doesn't have a progress circle unless we set a limit. Let's keep it full or spinning.
        // For visual feedback, let's make it spin based on minute? Or just full.
        // Let's invert it: circle fills up every 60m? No, let's just keep it full.
        circle.style.strokeDashoffset = 0;
    }
    
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    display.textContent = `${m}:${s}`;
    
    if (focusTimer.mode === 'pomodoro') {
        const offset = fullDash - (progress * fullDash); // Start full, reduce
        // Actually typically pomodoro starts full and reduces. 
        // If progress is 0 (start), offset should be 0.
        // If progress is 1 (end), offset should be fullDash.
        // Wait, stroke-dashoffset: 0 is full line. stroke-dashoffset: fullDash is empty.
        // So we want to start at 0 and go to fullDash.
        // progress goes 0 -> 1.
        circle.style.strokeDashoffset = -1 * (progress * fullDash); 
    }

    updateFocusTaskUI();
}

function openFocusTaskSelect() {
    openModal('modal-focus-task');
}

function renderFocusTodoList() {
    const list = document.getElementById('focus-task-list');
    if (!list) return;

    list.innerHTML = appData.todos.filter(t => !t.completed).map(t => `
        <button onclick="selectFocusTask('${t.id}')" class="w-full text-left px-4 py-3 bg-stone-50 dark:bg-stone-700/50 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 flex justify-between items-center group transition-colors">
            <span class="font-medium text-stone-700 dark:text-stone-200 truncate text-sm">${t.title}</span>
            <i class="fa-solid fa-check text-primary opacity-0 group-hover:opacity-100 transition-opacity"></i>
        </button>
    `).join('');
    
    if (appData.todos.filter(t => !t.completed).length === 0) {
        list.innerHTML = '<p class="text-center text-xs text-stone-400 py-2">暂无待办任务</p>';
    }
}

function renderFocusPresets() {
    const container = document.getElementById('focus-presets-list');
    if (!container) return; // In case element doesn't exist yet
    
    container.innerHTML = appData.focusTasks.map(task => `
        <div class="flex items-center justify-between bg-white dark:bg-stone-700 px-4 py-3 rounded-xl shadow-sm border border-stone-100 dark:border-stone-600 group cursor-pointer hover:border-primary transition-colors" onclick="selectFocusTask('${task.id}')">
            <div class="flex items-center space-x-3">
                <div class="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                    <i class="fa-solid fa-bolt"></i>
                </div>
                <div>
                    <span class="font-medium text-stone-700 dark:text-stone-200">${task.title}</span>
                    <span class="text-xs text-stone-400 ml-2 bg-stone-100 dark:bg-stone-600 px-1.5 py-0.5 rounded">${task.duration || 25}m</span>
                </div>
            </div>
            <button onclick="event.stopPropagation(); deleteFocusPreset('${task.id}')" class="text-stone-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

function addFocusPreset() {
    const input = document.getElementById('new-focus-task-input');
    const durationInput = document.getElementById('new-focus-task-duration');
    const title = input.value.trim();
    if (!title) return;
    
    const duration = parseInt(durationInput.value) || 25;

    const newTask = {
        id: 'fp-' + Date.now(),
        title: title,
        duration: duration
    };
    
    appData.focusTasks.push(newTask);
    saveData();
    renderFocusPresets();
    input.value = '';
    durationInput.value = '';
    showToast('已添加常用专注');
}

function deleteFocusPreset(id) {
    if(confirm('确定删除此常用专注吗？')) {
        appData.focusTasks = appData.focusTasks.filter(t => t.id !== id);
        saveData();
        renderFocusPresets();
    }
}

// Modify selectFocusTask to handle object or id
function selectFocusTask(taskOrId) {
    if (taskOrId && typeof taskOrId === 'object') {
        // Direct object passed
        focusTimer.currentTask = { id: taskOrId.id, title: taskOrId.title };
        updateFocusTaskUI();
        closeModal('modal-focus-task');
    } else if (taskOrId) {
        // ID passed - check Focus Presets first, then Todos
        let task = appData.focusTasks.find(t => t.id === taskOrId);
        if (!task) {
            task = appData.todos.find(t => t.id === taskOrId);
        }
        
        if (task) {
            focusTimer.currentTask = { id: task.id, title: task.title };
            updateFocusTaskUI();

            // Update timer if task has custom duration and not running
            if (task.duration && focusTimer.mode === 'pomodoro' && !focusTimer.isRunning) {
                focusTimer.totalTime = task.duration * 60;
                focusTimer.timeLeft = focusTimer.totalTime;
                updateTimerDisplay();
            }
        }
        closeModal('modal-focus-task');
    } else {
        // Null passed (Clear)
        focusTimer.currentTask = null;
        updateFocusTaskUI();
        closeModal('modal-focus-task');
    }
}

function saveFocusSession(duration) {
    const session = {
        id: Date.now().toString(),
        taskId: focusTimer.currentTask ? focusTimer.currentTask.id : null,
        taskTitle: focusTimer.currentTask ? focusTimer.currentTask.title : '未关联任务',
        startTime: Date.now() - duration * 1000,
        duration: duration, // seconds
        type: focusTimer.mode,
        createdAt: new Date().toISOString()
    };
    
    if (!appData.focusSessions) appData.focusSessions = [];
    appData.focusSessions.push(session);
    saveData();
    renderFocusStats();
    showToast(`专注 ${Math.floor(duration/60)} 分钟已记录`);
}

function renderFocusStats() {
    if (!appData.focusSessions) appData.focusSessions = [];
    
    const now = new Date();
    const todayStr = now.toDateString();
    
    // 1. Today Total
    const todaySessions = appData.focusSessions.filter(s => new Date(s.createdAt).toDateString() === todayStr);
    const todaySeconds = todaySessions.reduce((acc, s) => acc + s.duration, 0);
    document.getElementById('stats-today-total').textContent = formatDuration(todaySeconds, '--');
    
    // 2. Daily Avg
    // Group by date
    const sessionsByDate = {};
    appData.focusSessions.forEach(s => {
        const d = new Date(s.createdAt).toDateString();
        if (!sessionsByDate[d]) sessionsByDate[d] = 0;
        sessionsByDate[d] += s.duration;
    });
    const daysCount = Object.keys(sessionsByDate).length || 1;
    const totalAllSeconds = appData.focusSessions.reduce((acc, s) => acc + s.duration, 0);
    const avgSeconds = Math.floor(totalAllSeconds / daysCount);
    document.getElementById('stats-daily-avg').textContent = formatDuration(avgSeconds, '--');
    
    // 3. Rankings
    renderFocusRankings();
}

function renderFocusRankings() {
    const list = document.getElementById('focus-rankings-list');
    if (!list) return;
    const recentSessions = [...appData.focusSessions]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 3);

    if (recentSessions.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-6 text-stone-400">
                <div class="w-12 h-12 bg-stone-100 dark:bg-stone-700/50 rounded-full flex items-center justify-center mb-3">
                    <i class="fa-solid fa-mug-hot text-lg"></i>
                </div>
                <p class="text-xs">今天还没有记录，快来抢第一！</p>
            </div>
        `;
        return;
    }

    list.innerHTML = recentSessions.map(s => {
        const date = new Date(s.createdAt);
        const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const isToday = date.toDateString() === new Date().toDateString();
        const dateDisplay = isToday ? '今天' : (date.getMonth()+1) + '/' + date.getDate();
        return `
        <div class="flex items-center space-x-4 py-2 border-b border-stone-100 dark:border-stone-800 last:border-0">
            <div class="flex-shrink-0 w-10 text-center">
                <div class="text-[10px] text-stone-400 font-bold uppercase leading-none">${dateDisplay}</div>
                <div class="text-xs text-stone-500 font-mono mt-0.5">${timeStr}</div>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-stone-700 dark:text-stone-200 truncate">${s.taskTitle || '自由专注'}</p>
                <div class="flex items-center mt-0.5">
                    <span class="text-[10px] bg-stone-100 dark:bg-stone-700 text-stone-500 px-1.5 rounded mr-2">${s.type === 'pomodoro' ? '番茄钟' : '秒表'}</span>
                </div>
            </div>
            <div class="text-right">
                <span class="font-mono font-bold text-emerald-500 text-lg">${Math.floor(s.duration / 60)}</span>
                <span class="text-[10px] text-stone-400">分</span>
            </div>
        </div>
    `;
    }).join('');
}

function formatDuration(seconds, emptyText = '--') {
    if (!seconds) return emptyText;
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}分`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    if (remM === 0) return `${h}小时`;
    return `${h}小时 ${remM}分`;
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
            countUpMode: form.countUpMode.checked, // New Field
            bgImage: bgDataUrl,
            archived: false,
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
        list.innerHTML = '<p class="text-xs text-stone-400 text-center py-2">无子任务</p>';
        return;
    }
    
    list.innerHTML = subtasks.map(s => `
        <div class="flex items-center justify-between bg-white dark:bg-stone-800 p-2 rounded-lg border border-stone-100 dark:border-stone-600">
            <div class="flex items-center space-x-2 flex-1 min-w-0 cursor-pointer" onclick="toggleSubtask('${s.id}')">
                <div class="w-5 h-5 rounded border ${s.completed ? 'bg-secondary border-secondary' : 'border-stone-300 dark:border-stone-500'} flex items-center justify-center transition-colors">
                    ${s.completed ? '<i class="fa-solid fa-check text-white text-[10px]"></i>' : ''}
                </div>
                <span class="text-sm dark:text-stone-300 truncate ${s.completed ? 'line-through text-stone-400' : ''}">${s.content}</span>
            </div>
            <button onclick="deleteSubtask('${s.id}')" class="text-stone-400 hover:text-red-500 ml-2 px-2"><i class="fa-solid fa-xmark"></i></button>
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
            let color = 'bg-stone-200 text-stone-700';
            if (h.tag === 'Fix') color = 'bg-red-100 text-red-700';
            else if (h.tag === 'Feat') color = 'bg-green-100 text-green-700';
            else if (h.tag === 'Docs') color = 'bg-blue-100 text-blue-700';
            else if (h.tag === 'Refactor') color = 'bg-purple-100 text-purple-700';
            
            tagHtml = `<span class="text-[10px] px-1.5 py-0.5 rounded ${color} mr-2">${h.tag}</span>`;
        }
        
        return `
        <div class="relative pl-6 pb-4 border-l border-stone-200 dark:border-stone-600 last:pb-0">
            <div class="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-stone-300 dark:bg-stone-500"></div>
            <div class="text-xs text-stone-400 mb-1 flex items-center">
                ${new Date(h.date).toLocaleString()}
            </div>
            <div class="text-sm dark:text-stone-300 flex items-center">
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
        
        let colorClass = 'bg-stone-100 dark:bg-stone-700';
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

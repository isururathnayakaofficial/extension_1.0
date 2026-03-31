const REGISTERED_ID = '123';  // Must match the hardcoded ID in background.js

async function fetchTasks() {
    const taskListDiv = document.getElementById('taskList');
    const statusDiv = document.getElementById('statusMsg');
    taskListDiv.innerHTML = 'Loading...';
    try {
        const response = await fetch(`http://localhost:8081/api/todo/get/${REGISTERED_ID}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const tasks = await response.json();
        displayTasks(tasks);
        // Also show overall blocking status
        const isActive = isAnyTaskActiveNow(tasks);
        statusDiv.innerHTML = isActive ? '🔴 FOCUS MODE ACTIVE – Sites are blocked' : '🟢 No active tasks – All sites accessible';
        statusDiv.style.background = isActive ? '#ffe6e6' : '#e6ffe6';
    } catch (err) {
        taskListDiv.innerHTML = `<span style="color:red">Error: ${err.message}</span>`;
        statusDiv.innerHTML = '⚠️ Failed to fetch tasks';
        statusDiv.style.background = '#ffdddd';
    }
}

function displayTasks(tasks) {
    const taskListDiv = document.getElementById('taskList');
    if (!tasks.length) {
        taskListDiv.innerHTML = '<i>No tasks found</i>';
        return;
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const todayTasks = tasks.filter(task => task.date === todayStr);
    if (todayTasks.length === 0) {
        taskListDiv.innerHTML = '<i>No tasks scheduled for today</i>';
        return;
    }

    taskListDiv.innerHTML = '';
    todayTasks.forEach(task => {
        const div = document.createElement('div');
        div.className = 'task-item';
        const isActive = isTaskActiveNow(task);
        div.style.borderLeftColor = isActive ? '#FF0000' : '#4CAF50';
        div.innerHTML = `
      <strong>${task.title}</strong><br>
      <span class="task-time">${task.startTime} – ${task.endTime}</span><br>
      <span>Priority: ${task.priority} | Status: ${task.status}</span>
    `;
        taskListDiv.appendChild(div);
    });
}

function isTaskActiveNow(task) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (task.date !== todayStr) return false;

    const [startHour, startMin] = task.startTime.split(':').map(Number);
    const [endHour, endMin] = task.endTime.split(':').map(Number);
    const start = new Date(now);
    start.setHours(startHour, startMin, 0, 0);
    const end = new Date(now);
    end.setHours(endHour, endMin, 0, 0);
    return now >= start && now <= end;
}

function isAnyTaskActiveNow(tasks) {
    for (const task of tasks) {
        const status = (task.status || '').toUpperCase();
        if (status === 'COMPLETED' || status === 'DONE' || status === 'CANCELLED') continue;
        if (isTaskActiveNow(task)) return true;
    }
    return false;
}

// Initial load and refresh every 30 seconds (optional)
fetchTasks();
setInterval(fetchTasks, 30000);
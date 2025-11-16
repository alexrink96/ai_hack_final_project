
const STORAGE_KEY = "demo_state_v1";

async function pollActions() {
  try {
    const res = await fetch("/api/poll_actions");
    const data = await res.json();

    for (const action of data.actions) {
      if (action.type === "open_deposit") {
        const { name, amount, days } = action.payload;
        console.log("💬 Выполняем openDeposit из AI:", name, amount, days);
        openDeposit(name, amount, days);
      }
	  
	  if (action.type === "close_deposit") {
		const { id } = action.payload;
		closeDeposit(id);
	  }
	  
    }
  } catch (err) {
    console.error("Ошибка при poll_actions:", err);
  }
}


setInterval(pollActions, 3000);

let state = {
  user: { name: "Александр", card: "**** **** **** 4242", balance: 150000 },
  deposits: [],
  tx: []
};


function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const s = localStorage.getItem(STORAGE_KEY);
  if (s) {
    try {
      state = JSON.parse(s);
    } catch (e) {
      console.warn("Не удалось прочитать state:", e);
      saveState();
    }
  } else {
    saveState();
  }

  if (!state.user || !state.user.balance) {
    state.user = state.user || {};
    state.user.balance = 150000;
    state.user.name = state.user.name || "Александр";
    state.user.card = state.user.card || "**** **** **** 4242";
  }
  
  syncState();
}

function formatMoney(n) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
}

function formatDateISO(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU");
}


function renderProfile() {
  document.getElementById("userName").innerText = state.user.name;
  document.getElementById("cardNumber").innerText = state.user.card;
  document.getElementById("balance").innerText = formatMoney(state.user.balance);
  document.getElementById("depositsCount").innerText = state.deposits.length;
  const total = state.deposits.reduce((s, d) => s + d.amount, 0);
  document.getElementById("depositsTotal").innerText = formatMoney(total);
}

function renderDeposits() {
  const list = document.getElementById("depositsList");
  list.innerHTML = "";
  if (state.deposits.length === 0) {
    document.getElementById("noDeposits").style.display = "block";
  } else {
    document.getElementById("noDeposits").style.display = "none";
  }

  state.deposits.forEach(dep => {
    const endsAt = formatDateISO(dep.endsAtISO);
    const openedAt = formatDateISO(dep.openedAtISO);

    const item = document.createElement("div");
    item.className = "list-group-item d-flex justify-content-between align-items-start";

    const left = document.createElement("div");
    left.className = "ms-2 me-auto";
    left.innerHTML = `<div class="fw-bold">${escapeHtml(dep.name)}</div>
                      Открыт: ${openedAt} • Сумма: <strong>${formatMoney(dep.amount)}</strong>
                      <div class="text-muted small">Закрытие: ${endsAt}</div>`;

    const right = document.createElement("div");
    const btnClose = document.createElement("button");
    btnClose.className = "btn btn-sm btn-outline-danger";
    btnClose.innerText = "Закрыть";
    btnClose.addEventListener("click", () => closeDeposit(dep.id));
    right.appendChild(btnClose);

    item.appendChild(left);
    item.appendChild(right);

    list.appendChild(item);
  });
}

function renderTxHistory() {
  const el = document.getElementById("txHistory");
  if (!state.tx.length) {
    el.innerText = "Нет операций.";
    return;
  }
  el.innerHTML = state.tx.slice().reverse().map(t => {
    return `<div>${escapeHtml(t.text)} <span class="text-muted small">(${formatDateISO(t.when)})</span></div>`;
  }).join("");
}


function openDeposit(name, amount, days) {
  amount = Number(amount);
  days = Number(days);
  if (!name || !amount || amount <= 0 || !days || days <= 0) {
    alert("Некорректные параметры вклада.");
    return;
  }
  if (amount > state.user.balance) {
    alert("На карте недостаточно средств.");
    return;
  }
  const now = new Date();
  const ends = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const dep = {
    id: cryptoRandomId(),
    name,
    amount,
    openedAtISO: now.toISOString(),
    endsAtISO: ends.toISOString()
  };
  state.deposits.push(dep);
  state.user.balance -= amount;
  state.tx.push({ text: `Открыт вклад "${name}" на ${formatMoney(amount)}`, when: new Date().toISOString() });
  saveState();
  syncState();
  rerenderAll();

  const modal = bootstrap.Modal.getInstance(document.getElementById("openDepositModal"));
  if (modal) modal.hide();
}

function closeDeposit(id) {
  const idx = state.deposits.findIndex(d => d.id === id);
  if (idx === -1) return;
  const dep = state.deposits[idx];
  
  state.user.balance += dep.amount;
  state.tx.push({ text: `Закрыт вклад "${dep.name}" — возвращено ${formatMoney(dep.amount)}`, when: new Date().toISOString() });
  state.deposits.splice(idx, 1);
  saveState();
  syncState();
  rerenderAll();
}


function cryptoRandomId() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11)
    .replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    )
    .slice(-8);
}


function escapeHtml(str) {
  return (str + "").replace(/[&<>"'`]/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;'
  }[s]));
}

function rerenderAll() {
  renderProfile();
  renderDeposits();
  renderTxHistory();
}


document.addEventListener("DOMContentLoaded", () => {
  loadState();
  rerenderAll();

  const form = document.getElementById("openDepositForm");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = document.getElementById("depName").value.trim();
    const amount = Number(document.getElementById("depAmount").value);
    const days = Number(document.getElementById("depDays").value);
    openDeposit(name, amount, days);
    form.reset();
  });


  const chatToggle = document.getElementById("chatToggle");  
  const chatBox = document.getElementById("chatBox");        
  const chatClose = document.getElementById("chatClose");    
  const messagesDiv = document.getElementById("messages");
  const userInput = document.getElementById("userInput");
  const sendButton = document.getElementById("sendButton");


	function updateChatButtonVisibility() {
	  if (chatBox.classList.contains("open")) {
		chatToggle.style.display = "none";
	  } else {
		chatToggle.style.display = "block";
	  }
	}



  chatToggle.addEventListener("click", async () => {
    chatBox.classList.add("open");
    updateChatButtonVisibility();
    await loadHistory();
  });


  chatClose.addEventListener("click", () => {
    chatBox.classList.remove("open");
    updateChatButtonVisibility();
  });


  window.addEventListener("resize", updateChatButtonVisibility);


  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });

  sendButton.addEventListener("click", sendMessage);
});


async function sendMessage() {
  const userInput = document.getElementById("userInput");
  const text = userInput.value.trim();
  if (!text) return;

  addMessage(text, "user");
  userInput.value = "";


  saveChatHistoryEntry(text, "");

  const typingEl = addTypingIndicator();

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    const data = await response.json();
    typingEl.remove();

    if (!data.reply) {
      addMessage("Сервер не прислал поле reply.", "bot");
      return;
    }

    await typeMessage(data.reply, "bot");


    const chatKey = "chat_history_v1";
    let arr = JSON.parse(localStorage.getItem(chatKey) || "[]");
    if (arr.length) {
      arr[arr.length - 1].bot = data.reply;
      localStorage.setItem(chatKey, JSON.stringify(arr.slice(-100)));
    }

  } catch (err) {
    console.error("Ошибка fetch:", err);
    typingEl.remove();
    addMessage("Ошибка соединения с сервером.", "bot");
  }
}


async function loadHistory() {
  const chatKey = "chat_history_v1";
  const raw = localStorage.getItem(chatKey);
  const messagesDiv = document.getElementById("messages");
  messagesDiv.innerHTML = "";
  if (!raw) return;
  try {
    const hist = JSON.parse(raw);
    hist.forEach(entry => {
	  if (entry.user) addMessage(entry.user, "user");
	  if (entry.bot)  addMessage(entry.bot, "bot");
    });
  } catch (e) {
    console.warn("Не удалось загрузить историю чата:", e);
  }
}

function saveChatHistoryEntry(user, bot) {
  const chatKey = "chat_history_v1";
  let arr = [];
  try {
    arr = JSON.parse(localStorage.getItem(chatKey) || "[]");
  } catch (e) {}
  arr.push({ user, bot });
  localStorage.setItem(chatKey, JSON.stringify(arr.slice(-100)));
}

function addMessage(text, sender) {
  const messagesDiv = document.getElementById("messages");
  const wrapper = document.createElement("div");
  wrapper.classList.add("message-wrapper");
  if (sender === "user") wrapper.classList.add("user");

  const avatar = document.createElement("div");
  avatar.classList.add("avatar");
  avatar.innerText = sender === "user" ? "👤" : "🤖";

  const msg = document.createElement("div");
  msg.classList.add("message");
  msg.innerText = text;

  if (sender === "user") {
    wrapper.appendChild(msg);
    wrapper.appendChild(avatar);
  } else {
    wrapper.appendChild(avatar);
    wrapper.appendChild(msg);
  }

  messagesDiv.appendChild(wrapper);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}


function addTypingIndicator() {
  const messagesDiv = document.getElementById("messages");
  const wrapper = document.createElement("div");
  wrapper.classList.add("message-wrapper");

  const avatar = document.createElement("div");
  avatar.classList.add("avatar");
  avatar.innerText = "🤖";

  const msg = document.createElement("div");
  msg.classList.add("message");
  msg.innerHTML = `<em>Печатает</em><span class="typing-dots"></span>`;

  wrapper.appendChild(avatar);
  wrapper.appendChild(msg);
  messagesDiv.appendChild(wrapper);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return wrapper;
}

async function typeMessage(text, sender) {
  const messagesDiv = document.getElementById("messages");
  const wrapper = document.createElement("div");
  wrapper.classList.add("message-wrapper");

  const avatar = document.createElement("div");
  avatar.classList.add("avatar");
  avatar.innerText = "🤖";

  const msg = document.createElement("div");
  msg.classList.add("message");
  wrapper.appendChild(avatar);
  wrapper.appendChild(msg);
  messagesDiv.appendChild(wrapper);

  for (let i = 0; i < text.length; i++) {
    msg.innerText = text.substring(0, i + 1);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    await new Promise(r => setTimeout(r, 12));
  }

  saveChatHistoryEntry("", text);
}

// === Синхронизация состояния с сервером ===
function syncState() {
  fetch("/api/sync_state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state)
  }).catch(err => console.error("Ошибка sync:", err));
}

// index.js

// --- 1. STATE MANAGEMENT ---
const AppState = {
    auth: {
        key: localStorage.getItem('et_key') || null,
        deviceId: localStorage.getItem('et_device_id') || `dev_${Date.now()}_${Math.random().toString(36).substr(2)}`,
        isLoggedIn: false
    },
    settings: JSON.parse(localStorage.getItem('et_settings')) || {
        dialogueMode: "0", // 0:Off, 1:Inline, 2:Newline, 3:Dash
        replacements: [] // Array of {find: "", replace: ""}
    }
};

// Lưu Device ID nếu chưa có
if (!localStorage.getItem('et_device_id')) {
    localStorage.setItem('et_device_id', AppState.auth.deviceId);
}

const saveSettings = () => {
    localStorage.setItem('et_settings', JSON.stringify(AppState.settings));
    console.log("Settings Saved to LocalStorage");
};

// --- 2. AUTH & PAYMENT LOGIC ---
const API_BASE = ""; // Trống vì cùng domain Cloudflare

async function login(key) {
    const btn = document.getElementById('btn-login');
    const msg = document.getElementById('login-msg');
    
    btn.textContent = "Đang kiểm tra...";
    btn.disabled = true;
    msg.textContent = "";

    try {
        const res = await fetch(`${API_BASE}/api/auth`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ key: key.trim(), device_id: AppState.auth.deviceId })
        });
        const data = await res.json();

        if (data.valid) {
            AppState.auth.isLoggedIn = true;
            AppState.auth.key = key.trim();
            localStorage.setItem('et_key', key.trim());
            
            // UI Transition
            document.getElementById('landing-overlay').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            document.getElementById('expire-date').textContent = new Date(data.data.expires_at).toLocaleDateString('vi-VN');
        } else {
            msg.textContent = data.msg;
        }
    } catch (e) {
        msg.textContent = "Lỗi kết nối server!";
    } finally {
        btn.textContent = "KÍCH HOẠT & VÀO TOOL";
        btn.disabled = false;
    }
}

// Auto Login nếu có key
if (AppState.auth.key) {
    login(AppState.auth.key);
}

// Tính giá tự động
const updatePrice = () => {
    const type = document.getElementById('price-type').value;
    const days = parseInt(document.getElementById('price-days').value) || 1;
    
    // Logic JS tính trước để hiển thị, Server tính lại khi thanh toán
    let unit = (type === 'personal') ? 2200 : 4300;
    let minUnit = (type === 'personal') ? 1333 : 2666;
    
    let finalUnit = unit;
    if (days > 1) {
        const slope = (minUnit - unit) / 29;
        finalUnit = unit + (Math.min(days, 30) - 1) * slope;
    }
    const total = Math.floor(finalUnit * days);
    document.getElementById('display-price').textContent = total.toLocaleString('vi-VN');
    return total;
};

// Event Listeners cho Landing
document.getElementById('btn-login').onclick = () => login(document.getElementById('login-key').value);
document.getElementById('price-days').oninput = updatePrice;
document.getElementById('price-type').onchange = updatePrice;
document.getElementById('btn-get-qr').onclick = () => {
    const amount = updatePrice();
    const content = `HG${Math.floor(Math.random()*100000)}`;
    const qrUrl = `https://img.vietqr.io/image/MB-0917678211-compact2.jpg?amount=${amount}&addInfo=${content}`;
    
    document.getElementById('qr-img').src = qrUrl;
    document.getElementById('qr-content').textContent = content;
    document.getElementById('qr-area').classList.remove('hidden');
};

// --- 3. CORE LOGIC (VỐN GỐC) ---

// Chuẩn hóa Unicode
const normalize = (str) => str.normalize('NFC').replace(/[\u201C\u201D\u201E\u201F]/g, '"');

const performReplace = (text) => {
    let result = normalize(text);
    const mode = AppState.settings.dialogueMode;
    const pairs = AppState.settings.replacements.filter(p => p.find.trim());

    // A. FIND & REPLACE (Với Marker Protection)
    // Sắp xếp từ khóa dài lên đầu
    pairs.sort((a, b) => b.find.length - a.find.length);
    
    const MARKER = '\uE000';
    
    // Bước 1: Thay thành Marker
    pairs.forEach((p, idx) => {
        const regex = new RegExp(p.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); // Escape regex special chars
        result = result.replace(regex, `${MARKER}${idx}${MARKER}`);
    });

    // Bước 2: Restore từ Marker thành Text mới (có highlight HTML)
    pairs.forEach((p, idx) => {
        const regex = new RegExp(`${MARKER}${idx}${MARKER}`, 'g');
        result = result.replace(regex, `<mark class="hl-green">${p.replace}</mark>`);
    });

    // B. FORMAT HỘI THOẠI
    // Regex bắt: User: "Content"
    if (mode !== "0") {
        const dialogRegex = /(^|[\n])([^:\n]+):\s*([“"'])([\s\S]*?)([”"'])/gm;
        result = result.replace(dialogRegex, (match, p1, context, q1, content, q2) => {
            let newContent = content.trim();
            let prefix = "";
            
            if (mode === "1") prefix = `${context}: "${newContent}"`; // Inline
            if (mode === "2") prefix = `${context}:\n\n"${newContent}"`; // Newline
            if (mode === "3") prefix = `${context}:\n\n- ${newContent}`; // Dash
            
            return `${p1}<mark class="hl-blue">${prefix}</mark>`;
        });
    }

    return result;
};

// --- 4. APP UI LOGIC ---

// Render List Từ điển
const renderDict = () => {
    const container = document.getElementById('dictionary-list');
    container.innerHTML = '';
    AppState.settings.replacements.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'dict-item';
        div.innerHTML = `
            <input type="text" placeholder="Tìm" value="${item.find}" onchange="updateDict(${index}, 'find', this.value)">
            <input type="text" placeholder="Thay" value="${item.replace}" onchange="updateDict(${index}, 'replace', this.value)">
            <button class="btn btn-danger btn-sm" onclick="removeDict(${index})">×</button>
        `;
        container.appendChild(div);
    });
};

// Global functions cho HTML gọi
window.updateDict = (index, field, value) => {
    AppState.settings.replacements[index][field] = value;
    saveSettings(); // State-Driven: Lưu ngay
};
window.removeDict = (index) => {
    AppState.settings.replacements.splice(index, 1);
    saveSettings();
    renderDict();
};

// Event Listeners App
document.getElementById('btn-add-pair').onclick = () => {
    AppState.settings.replacements.unshift({ find: "", replace: "" });
    renderDict();
};
document.querySelectorAll('input[name="dialogue-mode"]').forEach(r => {
    r.onchange = (e) => {
        AppState.settings.dialogueMode = e.target.value;
        saveSettings();
    };
});

// Nút Thực hiện Thay thế
document.getElementById('btn-run-replace').onclick = () => {
    const raw = document.getElementById('input-text').value;
    if(!raw) return alert("Chưa có nội dung!");
    const html = performReplace(raw);
    document.getElementById('output-result').innerHTML = html.replace(/\n/g, '<br>');
};

// Chuyển Tab Sidebar
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-btn, .content-panel').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    };
});

// Logout
document.getElementById('btn-logout').onclick = () => {
    localStorage.removeItem('et_key');
    location.reload();
};

// Init load
renderDict();
// Set radio
const radio = document.querySelector(`input[name="dialogue-mode"][value="${AppState.settings.dialogueMode}"]`);
if(radio) radio.checked = true;

// Cấu hình chung
const API_URL = window.location.origin;
let currentPlan = 'personal';
let currentDays = 1;
let generatedHG = 'HG' + Math.floor(Math.random() * 90000 + 10000); // Default placeholder
let pollingInterval = null;

// HÀM TÍNH GIÁ (BẮT BUỘC)
function calcPrice(basePerDay, days, maxDays = 30) {
    const discountFactor = Math.min(days, maxDays) / maxDays;
    const discountRate = 0.4 * discountFactor;
    return Math.round(basePerDay * days * (1 - discountRate));
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Setup Pricing Widget
    renderPricingWidget();
    document.getElementById('transfer-content').innerText = generatedHG;
    updatePricing(); // Init price

    // 2. Event Listeners
    setupEvents();

    // 3. Check Session (Mock check)
    checkLoginState();
});

function setupEvents() {
    // Toggle Plan
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentPlan = e.target.dataset.plan;
            updatePricing();
        });
    });

    // Scroll Buy
    const btnBuy = document.getElementById('btnScrollBuy');
    if(btnBuy) btnBuy.addEventListener('click', () => {
        document.getElementById('pricing-section').scrollIntoView({behavior: 'smooth'});
    });

    // Login
    document.getElementById('btnLogin').addEventListener('click', handleLogin);

    // Logout
    document.getElementById('btnLogout').addEventListener('click', handleLogout);

    // App Navigation (Top Tabs)
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remove active nav
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // Show content
            const targetId = e.target.dataset.target;
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Sidebar Navigation (Settings)
    document.querySelectorAll('.settings-sidebar li').forEach(li => {
        li.addEventListener('click', (e) => {
            document.querySelectorAll('.settings-sidebar li').forEach(l => l.classList.remove('active'));
            e.target.classList.add('active');

            const viewId = e.target.dataset.view;
            document.querySelectorAll('.sub-view').forEach(v => v.classList.remove('active'));
            document.getElementById(viewId).classList.add('active');
        });
    });
}

function renderPricingWidget() {
    // Có thể render vào 2 chỗ: Landing và Tab Cài đặt > Mua key
    const container = document.getElementById('pricing-widget');
    if(!container) return;

    container.innerHTML = `
        <div class="slider-container">
            <label>Thời hạn: <span id="days-label">1</span> ngày</label>
            <input type="range" id="days-slider" min="1" max="30" value="1" style="width: 100%">
        </div>
        <div class="price-display" id="total-price">0 VND</div>
    `;

    document.getElementById('days-slider').addEventListener('input', (e) => {
        currentDays = parseInt(e.target.value);
        document.getElementById('days-label').innerText = currentDays;
        updatePricing();
    });
}

function updatePricing() {
    let basePrice = currentPlan === 'personal' ? 2200 : 4300;
    let total = calcPrice(basePrice, currentDays);
    
    // Update UI
    const priceEl = document.getElementById('total-price');
    if(priceEl) priceEl.innerText = total.toLocaleString('vi-VN') + ' VND';

    // Update QR Code
    // Format: HGxxxx-PLAN-DAYS (Gửi lên server check sau này nếu cần) nhưng nội dung CK chỉ là HGxxxx
    // HGxxxx được tạo random cho phiên Guest, hoặc lấy từ user nếu đã login
    
    // Tạo QR VietQR
    const bankBin = '970422'; // MB Bank
    const accNo = '0917678211';
    const amount = total;
    const msg = generatedHG;
    
    const qrUrl = `https://img.vietqr.io/image/MB-${accNo}-compact2.jpg?amount=${amount}&addInfo=${msg}&accountName=TRINH%20THI%20XUAN%20HUONG`;
    
    const imgEl = document.getElementById('vietqr-img');
    if(imgEl) imgEl.src = qrUrl;

    // Start Polling nếu chưa chạy
    if(!pollingInterval) {
        pollingInterval = setInterval(checkPaymentHG, 3000);
    }
}

// === API CALLS ===

async function handleLogin() {
    const key = document.getElementById('keyInput').value.trim();
    if(!key) return alert('Vui lòng nhập Key');

    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ key })
        });
        
        const data = await res.json();
        if(res.ok) {
            // Login Success
            localStorage.setItem('user_key', key);
            generatedHG = key; // Update HG để nếu gia hạn thì dùng đúng key đó
            toggleApp(true);
        } else {
            alert(data.error || 'Lỗi đăng nhập');
        }
    } catch (e) {
        alert('Lỗi kết nối server');
    }
}

async function handleLogout() {
    // Gọi API để clear cookie (optional)
    localStorage.removeItem('user_key');
    window.location.reload();
}

async function checkPaymentHG() {
    // Polling status
    // Logic: Gọi API /api/heartbeat hoặc check status của generatedHG
    // Demo trả về console
    console.log(`Checking payment for ${generatedHG}...`);
    
    // Trong thực tế sẽ gọi:
    /*
    const res = await fetch(`${API_URL}/api/status?hg=${generatedHG}`);
    const data = await res.json();
    if(data.status === 'active') {
        alert('Thanh toán thành công!');
        clearInterval(pollingInterval);
        handleLoginAuto(generatedHG);
    }
    */
}

function toggleApp(isLoggedIn) {
    if(isLoggedIn) {
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        // Load thông tin key vào tab cài đặt
        document.getElementById('display-key').innerText = localStorage.getItem('user_key');
    } else {
        document.getElementById('landing-page').style.display = 'block';
        document.getElementById('main-app').style.display = 'none';
    }
}

function checkLoginState() {
    const key = localStorage.getItem('user_key');
    if(key) {
        toggleApp(true);
    }
}

// Utility
function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Show Toast simple
        const toast = document.createElement('div');
        toast.innerText = 'Đã copy: ' + text;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.background = '#333';
        toast.style.color = '#fff';
        toast.style.padding = '10px 20px';
        toast.style.borderRadius = '5px';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    });
}

function toggleKeyVisibility() {
    const el = document.getElementById('display-key');
    el.classList.toggle('blur-text');
}

function switchToBuyKey() {
    // Switch to settings tab and buy sub-view
    // Logic đơn giản switch class
    document.querySelector('[data-view="set-buy"]').click();
}

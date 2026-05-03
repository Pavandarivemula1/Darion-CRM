// ============================================================
// BACKEND URL — local dev: http://localhost:8000 | prod: https://template-auto-production.up.railway.app
// ============================================================
const BACKEND_URL = 'https://template-auto-production.up.railway.app';

// ============================================================
// HAPTIC FEEDBACK (Vibration API + Ripple)
// ============================================================
function haptic(el, pattern = [8], clientX, clientY) {
    if (localStorage.getItem('darion_haptics') === 'disabled') return;
    if (navigator.vibrate) navigator.vibrate(pattern);
    if (!el) return;
    const ripple = document.createElement('span');
    ripple.className = 'cds--btn-ripple';
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    // Use pointer coords when available so ripple originates at tap/click point
    const x = (clientX != null ? clientX - rect.left : rect.width  / 2) - size / 2;
    const y = (clientY != null ? clientY - rect.top  : rect.height / 2) - size / 2;
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;`;
    el.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
}

// ============================================================
// AUTH GUARD & ROLE ENFORCEMENT
// ============================================================
const SUPABASE_URL = 'https://ajrtewupbfupxpwwvrcz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_92ZS2ML3dAMDN9inMpjwqA_her1Be4K';
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Roles: 'super_admin' | 'sales_manager'
window.currentUser = null;

(async function initAuth() {
    // Race against a 3s timeout so the app never hangs if Supabase auth is slow/unreachable
    const timeout = new Promise(resolve =>
        setTimeout(() => resolve({ data: { session: null } }), 3000)
    );
    const { data: { session } } = await Promise.race([_sb.auth.getSession(), timeout]);

    let role, fullName, email, userId;

    if (!session) {
        // No session — redirect to login. Timeout above ensures this is fast.
        window.location.replace('login.html');
        return;
    }

    // Fetch role from profiles table
    const { data: profile } = await _sb
        .from('profiles')
        .select('role, full_name, email')
        .eq('id', session.user.id)
        .single();

    role     = profile?.role      || 'super_admin';
    fullName = profile?.full_name || session.user.email.split('@')[0];
    email    = profile?.email     || session.user.email;
    userId   = session.user.id;

    window.currentUser = { id: userId, email, role, fullName };

    // ── Populate header ──────────────────────────────────────────────────────
    const displayName = document.getElementById('userDisplayName');
    const roleBadge   = document.getElementById('userRoleBadge');
    const avatar      = document.getElementById('userAvatar');

    if (displayName) displayName.textContent = fullName;
    if (avatar)      avatar.textContent       = fullName.charAt(0).toUpperCase();
    if (roleBadge) {
        roleBadge.textContent = role === 'super_admin' ? 'Super Admin' : 'Sales Manager';
        roleBadge.style.color = role === 'super_admin' ? '#8b5cf6' : '#6b7280';
    }

    // ── Role-based UI restrictions ──────────────────────────────────────────
    if (role !== 'super_admin') {
        const deleteBtn = document.getElementById('deleteSelectedBtn');
        const uploadBtn = document.getElementById('uploadBtn');
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (uploadBtn) uploadBtn.style.display  = 'none';
    }
})();

// Logout handler
async function handleLogout() {
    await _sb.auth.signOut();
    window.location.replace('login.html');
}

// ============================================================

let globalLeads = [];
let chartInstance = null;
let editingLeadId = null;
let lastDataFingerprint = '';

let currentSearch = '';
let currentCityFilter = 'All';
let currentStatusFilter = 'All';
let currentPriorityFilter = 'All';
let currentServiceFilter = 'All';
let dueTodayMode = false;

let visuallyFilteredLeads = [];
let currentPage = 1;
let selectedLeadIds = new Set();
const itemsPerPage = 20;

// === TOAST NOTIFICATIONS === //
function showToast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

// === ICON REFRESH === //
window.refreshIcons = function() {
    if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
    }
};

// === GLOBAL KEYBOARD SHORTCUTS === //
document.addEventListener('keydown', (e) => {
    // Prevent overriding inputs
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');

    // / or Ctrl+K for search
    if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && !isInputFocused) {
        e.preventDefault();
        const searchInput = document.getElementById('searchLeads');
        if (searchInput) searchInput.focus();
    }
    // N for new lead
    else if (e.key.toLowerCase() === 'n' && !isInputFocused) {
        e.preventDefault();
        if (typeof openNewLeadModal === 'function') openNewLeadModal();
    }
    // Esc to close modals or clear selection
    else if (e.key === 'Escape') {
        if (document.getElementById('leadModal')?.style.display === 'block') {
            closeModal();
        } else if (document.getElementById('newLeadModal')?.style.display === 'block') {
            closeNewLeadModal();
        } else if (document.getElementById('demoConfirmModal')?.style.display === 'block') {
            closeDemoConfirmModal();
        } else if (document.getElementById('regionActionModal')?.style.display === 'block') {
            closeRegionActionModal();
        } else if (selectedLeadIds.size > 0) {
            clearSelection();
        }
    }
});

// Open Google Search — native app on mobile, browser on desktop
window.openGoogleSearch = function(query) {
    const q = encodeURIComponent(query);
    const ua = navigator.userAgent || '';

    if (/android/i.test(ua)) {
        // Android: open in Google Search app; Chrome is the fallback
        const fallback = encodeURIComponent(`https://www.google.com/search?q=${q}`);
        window.location.href = `intent://www.google.com/search?q=${q}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;S.browser_fallback_url=${fallback};end`;

    } else if (/iphone|ipad|ipod/i.test(ua)) {
        // iOS: open in Chrome app (googlechromes://); falls back to Safari if Chrome not installed
        const chromeUrl = `googlechromes://www.google.com/search?q=${q}`;
        const safariFallback = `https://www.google.com/search?q=${q}`;
        // Attempt Chrome; if it fails (not installed), redirect to Safari after 500 ms
        const start = Date.now();
        window.location.href = chromeUrl;
        setTimeout(() => {
            if (Date.now() - start < 1000) {
                window.open(safariFallback, '_blank');
            }
        }, 500);

    } else {
        window.open(`https://www.google.com/search?q=${q}`, '_blank');
    }
};


document.addEventListener('DOMContentLoaded', () => {
    // Apply preferences on load
    const themePref = localStorage.getItem('darion_theme') || 'system';
    if (themePref === 'dark') document.body.classList.add('dark-mode');

    // Attach haptics globally — pointerdown fires instantly on mobile (no 300ms click delay)
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('button, a.btn-primary, a.btn-success, a.btn-outline, .btn-icon, .tmpl-card');
        if (btn) haptic(btn, [8], e.clientX, e.clientY);
    }, { passive: true });

    initNavigation();
    loadData(false);

    let _searchTimer;
    document.getElementById('searchLeads').addEventListener('input', (e) => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
            currentSearch = e.target.value.toLowerCase();
            dueTodayMode = false;
            applyFilters();
        }, 300);
    });

    document.getElementById('csvUploadInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        
        const btn = document.getElementById('uploadBtn');
        btn.innerText = 'Processing...';
        
        fetch('/api/upload', {
            method: 'POST',
            body: file,
            headers: { 'Content-Type': 'text/csv' }
        })
        .then(res => res.json())
        .then(data => {
            if(data.error) throw new Error(data.error);
            showToast(`Imported ${data.added} new leads successfully`, 'success');
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Upload CSV`;
            document.getElementById('csvUploadInput').value = '';
            loadData(false);
        })
        .catch(err => {
            showToast('Upload failed: ' + err, 'error');
            btn.innerHTML = 'Upload CSV';
        });
    });

    setInterval(() => loadData(true), 15000);
});

function initNavigation() {
    const dBtn = document.getElementById('navDashboardBtn');
    const pBtn = document.getElementById('navPipelineBtn');
    const aBtn = document.getElementById('navAnalyticsBtn');
    const cBtn = document.getElementById('navCalendarBtn');
    const prBtn = document.getElementById('navProfileBtn');
    if(!dBtn || !pBtn) return;

    function showView(view) {
        document.getElementById('dashboardView').style.display = view === 'dashboard' ? 'block' : 'none';
        document.getElementById('pipelineView').style.display  = view === 'pipeline'  ? 'flex'  : 'none';
        
        const analyticsView = document.getElementById('analyticsView');
        if (analyticsView) analyticsView.style.display = view === 'analytics' ? 'block' : 'none';

        const calendarView = document.getElementById('calendarView');
        if (calendarView) calendarView.style.display = view === 'calendar' ? 'block' : 'none';
        
        document.getElementById('profileView').style.display   = view === 'profile'   ? 'block' : 'none';
        
        // Header visibility: hide filters + actions in profile and analytics view
        const header = document.querySelector('header');
        const filters = document.getElementById('globalFilters');
        if (view === 'profile' || view === 'analytics' || view === 'calendar') {
            if (header)  header.style.display  = 'none';
            if (filters) filters.style.display = 'none';
        } else {
            if (header)  header.style.display  = '';
            if (filters) filters.style.display = '';
        }
        [dBtn, pBtn, aBtn, cBtn, prBtn].forEach(b => b && b.classList.remove('active'));
    }

    dBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showView('dashboard');
        dBtn.classList.add('active');
        applyFilters();
    });

    pBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showView('pipeline');
        pBtn.classList.add('active');
        applyFilters();
    });

    if (cBtn) {
        cBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showView('calendar');
            cBtn.classList.add('active');
            if (typeof renderCalendar === 'function') renderCalendar();
        });
    }

    if (aBtn) {
        aBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showView('analytics');
            aBtn.classList.add('active');
            if (typeof renderAnalytics === 'function') renderAnalytics();
        });
    }

    if (prBtn) {
        prBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showView('profile');
            prBtn.classList.add('active');
            loadProfileView();
        });
    }

    // Auto-load default view if none selected
    const defaultView = localStorage.getItem('darion_defaultView') || 'dashboard';
    if (defaultView === 'pipeline') {
        showView('pipeline');
        pBtn.classList.add('active');
    } else {
        showView('dashboard');
        dBtn.classList.add('active');
    }
}

function toggleMobileFilters() {
    const filters = document.getElementById('globalFilters');
    const toggleBtn = document.querySelector('.mobile-filter-toggle');
    if(!filters) return;
    
    if(filters.classList.contains('mobile-hidden')) {
        filters.classList.remove('mobile-hidden');
        if(toggleBtn) toggleBtn.classList.add('active');
    } else {
        filters.classList.add('mobile-hidden');
        if(toggleBtn) toggleBtn.classList.remove('active');
    }
}

function loadData(isSilentPolling = false) {
    const tbody = document.getElementById('tableBody');
    if(!isSilentPolling) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 40px;">Fetching records...</td></tr>';
    }
    
    // Bulletproof fetch: no `.order` on network layer to bypass SDK column-name-spacing bugs
    fetch('/api/leads')
    .then(res => res.json())
    .then(data => {
        if(data.error) throw new Error(data.error);
        
        const fingerprint = JSON.stringify(data);
        if(isSilentPolling && fingerprint === lastDataFingerprint) {
            return; 
        }
        lastDataFingerprint = fingerprint;

        globalLeads = Array.isArray(data) ? data : (data.data || data.leads || data.rows || []);
        // Local sort to avoid ".order('Lead ID')" syntax bugs that might break Supabase SDK
        globalLeads.sort((a,b) => {
            const numA = parseInt((a['Lead ID']||'').split('-')[1]) || 0;
            const numB = parseInt((b['Lead ID']||'').split('-')[1]) || 0;
            return numA - numB;
        });

        populateDynamicFilters(globalLeads); 
        applyFilters(); 
        renderPipeline(); 
        if (typeof renderAnalytics === 'function') renderAnalytics();
        if (typeof renderSchedulePanel === 'function') renderSchedulePanel();
        if (typeof renderCalendar === 'function') renderCalendar();
    })
    .catch(err => {
        console.error("SUPABASE FETCH ERROR:", err);
        if(!isSilentPolling) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 40px;">Connection failed. Error: <strong>${err.message || err.toString()}</strong></td></tr>`;
        }
    });
}

function populateDynamicFilters(leads) {
    const citySet = new Set();
    const userSet = new Set();
    leads.forEach(l => {
        let cityText = 'Unknown';
        if(l.Location) {
            const parts = l.Location.split(',');
            if(parts.length >= 2) {
                let pot = parts[parts.length - 2].trim();
                cityText = pot;
            } else {
                cityText = l.Location.trim();
            }
        }
        l._computedCity = cityText; 
        if(cityText.length > 2 && cityText.length < 50) {
            citySet.add(cityText);
        }

        const creator = _getLeadCreator(l);
        if (creator) {
            userSet.add(creator);
        }
        if (l['Assigned Salesperson']) {
            userSet.add(l['Assigned Salesperson'].trim());
        }
    });

    if (window.currentUser && window.currentUser.fullName) {
        userSet.add(window.currentUser.fullName);
    } else if (window.currentUser && window.currentUser.email) {
        userSet.add(window.currentUser.email.split('@')[0]);
    }

    const select = document.getElementById('filterCity');
    if(select) {
        const currentVal = select.value;
        select.innerHTML = '<option value="All">All Regions</option>';
        const sortedCities = Array.from(citySet).sort();
        sortedCities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.innerText = c;
            if(c === currentVal) opt.selected = true;
            select.appendChild(opt);
        });
    }

    const userSelect = document.getElementById('filterUser');
    if(userSelect) {
        const currentUserVal = userSelect.value;
        userSelect.innerHTML = '<option value="All">All Users</option>';
        const sortedUsers = Array.from(userSet).sort();
        sortedUsers.forEach(u => {
            if (u === 'Unknown User') return; // Skip unknown in filter
            const opt = document.createElement('option');
            opt.value = u;
            opt.innerText = u;
            if(u === currentUserVal) opt.selected = true;
            userSelect.appendChild(opt);
        });
        // Append Unknown at the end
        if (userSet.has('Unknown User')) {
            const uOpt = document.createElement('option');
            uOpt.value = 'Unknown User';
            uOpt.innerText = 'Legacy / System';
            if('Unknown User' === currentUserVal) uOpt.selected = true;
            userSelect.appendChild(uOpt);
        }
    }

    const bulkAssignSelect = document.getElementById('bulkAssignSelect');
    if (bulkAssignSelect) {
        bulkAssignSelect.innerHTML = '<option value="">Assign to...</option>';
        const sortedUsers = Array.from(userSet).sort();
        sortedUsers.forEach(u => {
            if (u === 'Unknown User') return;
            const opt = document.createElement('option');
            opt.value = u;
            opt.innerText = u;
            bulkAssignSelect.appendChild(opt);
        });
    }
}

window.toggleCustomDateInputs = function() {
    const filter = document.getElementById('filterDateRange');
    const wrap = document.getElementById('customDateWrap');
    if (filter && wrap) {
        wrap.style.display = filter.value === 'Custom' ? 'flex' : 'none';
    }
};

function _getLeadCreationDate(lead) {
    const notes = lead['Follow-Up Notes'] || '';
    const entries = notes.split('\n---\n').map(e => e.trim()).filter(Boolean);
    if (entries.length > 0) {
        // The last entry in the array is the oldest log entry
        const oldest = entries[entries.length - 1];
        const tsMatch = oldest.match(/^\[([^\]]+)\]/);
        if (tsMatch) {
            // ts string looks like "03/05/2026, 10:20 am"
            const datePart = tsMatch[1].split(',')[0].trim();
            const parts = datePart.split('/'); // DD/MM/YYYY
            if (parts.length === 3) {
                // Return a Date object at 00:00:00 local time
                return new Date(parts[2], parseInt(parts[1], 10) - 1, parts[0]);
            }
        }
    }
    return null;
}

function _getLeadCreator(lead) {
    const notes = lead['Follow-Up Notes'] || '';
    const entries = notes.split('\n---\n').map(e => e.trim()).filter(Boolean);
    for (let i = entries.length - 1; i >= 0; i--) {
        const userMatch = entries[i].match(/^\[.*?\]\s*\{([^\}]+)\}/);
        if (userMatch) return userMatch[1];
    }
    return 'Unknown User';
}

function applyFilters() {
    const citySelect     = document.getElementById('filterCity');
    const statusSelect   = document.getElementById('filterStatus');
    const prioritySelect = document.getElementById('filterPriority');
    const serviceSelect  = document.getElementById('filterService');
    const userSelect     = document.getElementById('filterUser');

    currentCityFilter     = citySelect     ? citySelect.value     : 'All';
    currentStatusFilter   = statusSelect   ? statusSelect.value   : 'All';
    currentPriorityFilter = prioritySelect ? prioritySelect.value : 'All';
    currentServiceFilter  = serviceSelect  ? serviceSelect.value  : 'All';
    currentUserFilter     = userSelect     ? userSelect.value     : 'All';

    // Date Filters
    const dateRangeSelect = document.getElementById('filterDateRange');
    const currentDateRange = dateRangeSelect ? dateRangeSelect.value : 'All';
    const customStart      = document.getElementById('filterStartDate') ? document.getElementById('filterStartDate').value : '';
    const customEnd        = document.getElementById('filterEndDate') ? document.getElementById('filterEndDate').value : '';

    // Helper: does this lead have any phone number?
    const hasPhone = lead => !!(lead.Phone && lead.Phone.trim());

    visuallyFilteredLeads = globalLeads.filter(lead => {
        // ── "No Contact" filter: ONLY show leads with no phone number ──
        if (currentPriorityFilter === 'NoContactIn') {
            return !hasPhone(lead);
        }

        // ── Default view: hide leads with no phone OR status = Not Interested ──
        if (!hasPhone(lead)) return false;
        if ((lead['Lead Status'] || '').trim() === 'Not Interested' && currentStatusFilter === 'All') {
            // Show Not Interested leads if explicitly filtering by Today's date, or if in Pipeline view
            const isPipeline = document.getElementById('pipelineView') && document.getElementById('pipelineView').style.display !== 'none';
            if (!isPipeline && currentDateRange !== 'Today') return false;
        }

        let matchSearch = true;
        if (currentSearch && currentSearch.trim() !== '') {
            matchSearch =
                (lead.Name  && lead.Name.toLowerCase().includes(currentSearch)) ||
                (lead.Phone && lead.Phone.toLowerCase().includes(currentSearch));
        }

        const matchCity   = (currentCityFilter === 'All') || (lead._computedCity === currentCityFilter);
        const leadStatus  = lead['Lead Status'] || 'New';
        const matchStatus = (currentStatusFilter === 'All') || (leadStatus === currentStatusFilter);

        let matchPriority = true;
        if (currentPriorityFilter !== 'All') {
            let priority     = lead['Follow-Up Priority (Auto)'] || 'Low';
            let cleanPriority = priority.replace(/[^a-zA-Z]/g, '').trim();
            if (cleanPriority === '') cleanPriority = 'Scheduled';
            matchPriority = (cleanPriority === currentPriorityFilter);
        }

        let matchService = true;
        if (currentServiceFilter === 'Needs Website') {
            matchService = (lead['Is Website Poor'] === 'True' || lead['Is Website Poor'] === 'true' || !lead['Website']);
        } else if (currentServiceFilter === 'Has WhatsApp') {
            matchService = (lead['Has WhatsApp'] === 'True' || lead['Has WhatsApp'] === 'true');
        }

        let matchDate = true;
        if (currentDateRange !== 'All') {
            const creationDate = _getLeadCreationDate(lead);
            if (!creationDate) {
                matchDate = false; // Cannot filter by date if unknown
            } else {
                const today = new Date();
                today.setHours(0,0,0,0);
                
                if (currentDateRange === 'Today') {
                    matchDate = (creationDate.getTime() === today.getTime());
                } else if (currentDateRange === 'Yesterday') {
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    matchDate = (creationDate.getTime() === yesterday.getTime());
                } else if (currentDateRange === 'Last 7 Days') {
                    const sevenDaysAgo = new Date(today);
                    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                    matchDate = (creationDate.getTime() >= sevenDaysAgo.getTime() && creationDate.getTime() <= today.getTime());
                } else if (currentDateRange === 'Last 30 Days') {
                    const thirtyDaysAgo = new Date(today);
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    matchDate = (creationDate.getTime() >= thirtyDaysAgo.getTime() && creationDate.getTime() <= today.getTime());
                } else if (currentDateRange === 'Custom') {
                    let dMatchStart = true;
                    let dMatchEnd = true;
                    if (customStart) {
                        const sDate = new Date(customStart);
                        sDate.setHours(0,0,0,0);
                        dMatchStart = (creationDate.getTime() >= sDate.getTime());
                    }
                    if (customEnd) {
                        const eDate = new Date(customEnd);
                        eDate.setHours(0,0,0,0);
                        dMatchEnd = (creationDate.getTime() <= eDate.getTime());
                    }
                    matchDate = dMatchStart && dMatchEnd;
                }
            }
        }

        let matchUser = true;
        if (currentUserFilter !== 'All') {
            matchUser = (_getLeadCreator(lead) === currentUserFilter);
        }

        return matchSearch && matchCity && matchStatus && matchPriority && matchService && matchDate && matchUser;
    });

    const maxPage = Math.ceil(visuallyFilteredLeads.length / itemsPerPage);
    if (currentPage > maxPage) currentPage = maxPage;
    if (currentPage < 1)       currentPage = 1;

    updateDashboard(visuallyFilteredLeads);
    renderChart(visuallyFilteredLeads);
    renderTable();

    if (document.getElementById('pipelineView').style.display !== 'none') {
        renderPipeline();
    }
}

function updateDashboard(leads) {
    document.getElementById('totalLeads').innerText = leads.length.toLocaleString();
    const highPriority = leads.filter(l => l['Follow-Up Priority (Auto)'] && l['Follow-Up Priority (Auto)'].includes('High')).length;
    document.getElementById('highPriorityLeads').innerText = highPriority;
    const hotStr = new Date().toISOString().split('T')[0];
    const dueTodayCount = globalLeads.filter(l => {
        let flag = l['Reminder Flag (Auto)'] || '';
        let nextD = l['Next Follow-Up Date'] || '';
        return flag.includes('DUE TODAY') || nextD.startsWith(hotStr);
    }).length;
    document.getElementById('dueTodayLeads').innerText = dueTodayCount;
    // Update the Due Today badge in filter bar
    const badge = document.getElementById('dueTodayBadge');
    if (badge) {
        badge.textContent = dueTodayCount;
        badge.style.display = dueTodayCount > 0 ? 'inline' : 'none';
    }
    let closedLeads = leads.filter(l => l['Lead Status'] === 'Closed').length;
    let rate = '0%';
    if(leads.length > 0) rate = ((closedLeads / leads.length) * 100).toFixed(1) + '%';
    document.getElementById('conversionRate').innerText = rate;
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    if(visuallyFilteredLeads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 40px;">No leads exactly match your filters.</td></tr>';
        updatePagination(1, 1, 0);
        return;
    }

    const totalPages = Math.ceil(visuallyFilteredLeads.length / itemsPerPage);
    updatePagination(currentPage, totalPages, visuallyFilteredLeads.length);

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageLeads = visuallyFilteredLeads.slice(startIndex, endIndex);

    pageLeads.forEach(lead => { 
        let tr = document.createElement('tr');
        tr.setAttribute('ondblclick', `viewLead('${lead['Lead ID']}')`);
        
        let priorityText = lead['Follow-Up Priority (Auto)'] || 'Low';
        let badgeClass = 'low';
        if(priorityText.includes('High')) badgeClass = 'high';
        if(priorityText.includes('Medium')) badgeClass = 'medium';

        let cleanPriority = priorityText.replace(/[^a-zA-Z]/g, '').trim();
        if(cleanPriority === '') cleanPriority = 'Scheduled';

        let statusText = lead['Lead Status'] || 'New';
        let region = lead._computedCity || 'Unknown';
        if(region.length > 15) region = region.substring(0, 15) + '..';

        // ── Overdue / Due Today badge ─────────────────────────────────
        let dueBadge = '';
        const followUpDateStr = lead['Next Follow-Up Date'] || lead['Last Contacted Date'] || '';
        if (followUpDateStr) {
            const followUpMs = new Date(followUpDateStr).setHours(0, 0, 0, 0);
            const todayMs    = new Date().setHours(0, 0, 0, 0);
            if (followUpMs < todayMs) {
                dueBadge = `<span style="margin-left:6px; padding:2px 6px; background:#fee2e2; color:#dc2626; border-radius:4px; font-size:10px; font-weight:700; vertical-align:middle; white-space:nowrap; display:inline-flex; align-items:center; gap:2px;"><i data-lucide="alarm-clock" class="icon-sm"></i> OVERDUE</span>`;
            } else if (followUpMs === todayMs) {
                dueBadge = `<span style="margin-left:6px; padding:2px 6px; background:#fef9c3; color:#92400e; border-radius:4px; font-size:10px; font-weight:700; vertical-align:middle; white-space:nowrap; display:inline-flex; align-items:center; gap:2px;"><i data-lucide="calendar" class="icon-sm"></i> TODAY</span>`;
            }
        }
        // ─────────────────────────────────────────────────────────────

        let actionsHtml = `<button class="btn-primary" onclick="viewLead('${lead['Lead ID']}')">Edit</button>`;
        if (lead['Demo Site URL']) {
            actionsHtml += `<button class="btn-outline" onclick="window.open('${lead['Demo Site URL']}','_blank')" style="margin-left:8px; border-color:#8b5cf6; color:#8b5cf6; font-weight:600;" title="View live demo site">View Demo</button>`;
            actionsHtml += `<button class="btn-send-demo" onclick="sendDemo('${lead['Lead ID']}')" style="margin-left:8px;" title="Send demo link via WhatsApp">Send Demo</button>`;
            actionsHtml += `<button onclick="copyDemoMessages('${lead['Lead ID']}')" style="margin-left:8px; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:5px 10px; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Copy both messages to clipboard"><i data-lucide="clipboard" class="icon-sm"></i> Copy Msgs</button>`;
        } else if (window._pendingDeployMap && window._pendingDeployMap[lead['Lead ID']]) {
            actionsHtml += `<button onclick="deployLive('${lead['Lead ID']}', this)" style="margin-left:8px; background:#7c3aed; color:#fff; border:none; border-radius:6px; padding:5px 12px; font-size:12px; font-weight:700; cursor:pointer; animation: pulse 1.5s infinite; display:inline-flex; align-items:center; gap:4px;" title="Deploy the previewed site and save URL to database"><i data-lucide="rocket" class="icon-sm"></i> Deploy &amp; Save</button>`;
        } else if (lead['Lead Status'] === 'Demo Requested') {
            const isAdmin = window.currentUser?.role === 'super_admin';
            actionsHtml += isAdmin
                ? `<button class="btn-outline" onclick="confirmDemoGeneration('${lead['Lead ID']}')" style="margin-left:8px; border-color:#8b5cf6; color:#8b5cf6; font-weight:600;" title="Customize and generate demo website">Generate Demo</button>`
                : `<span style="margin-left:8px; padding:5px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:12px; color:#9ca3af; font-weight:500;">Awaiting Demo</span>`;
        }
        if(lead.Phone && lead.Phone.trim().length >= 4) {
             let cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
             actionsHtml += `<a href="tel:${cleanPhone}" class="btn-success" style="text-decoration:none; margin-left:8px;">Call</a>`;
             actionsHtml += `<a href="https://wa.me/${cleanPhone}" target="_blank" class="btn-outline" style="text-decoration:none; margin-left:8px; color:#25D366; border-color:#25D366;" title="WhatsApp">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366" stroke="none"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
             </a>`;
        }

        const isChecked = selectedLeadIds.has(lead['Lead ID']) ? 'checked' : '';
        const safeName = (lead.Name || 'Unnamed Lead').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="lead-checkbox" value="${lead['Lead ID']}" ${isChecked} onchange="toggleLeadSelection(this)" style="cursor:pointer;"></td>
            <td data-label="ID"><span style="font-size:12.5px; color:var(--text-muted); font-family:monospace; font-weight:600;">${lead['Lead ID']}</span></td>
            <td data-label="Lead Name" onclick="copyTitleAndOpen('${safeName}', '${lead['Lead ID']}'); event.stopPropagation();" style="cursor:pointer;" title="Click to copy name and view lead">
                <strong style="color:var(--brand-primary);">${lead.Name || 'Unnamed Lead'}</strong>${dueBadge}
                <span class="keyboard-shortcut" style="display:none; pointer-events:none;">double-click to open</span>
            </td>
            <td data-label="Contact">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span onclick="copyPhone('${(lead.Phone || lead.Email || '').replace(/'/g,"\\'").replace(/"/g,'&quot;')}'); event.stopPropagation();" title="Click to copy" style="font-size:13px; cursor:pointer; padding:2px 6px; border-radius:4px; transition:background 0.15s; display:inline-flex; align-items:center; gap:4px;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''"><i data-lucide="clipboard" class="icon-sm"></i> ${lead.Phone || lead.Email || 'No info'}</span>
                </div>
            </td>
            <td data-label="Region"><span style="color:var(--text-muted); font-size: 13px;">${region}</span></td>
            <td data-label="Priority"><span class="badge ${badgeClass}">${cleanPriority}</span></td>
            <td data-label="Status">
                <select class="inline-select" onchange="quickUpdateStatus('${lead['Lead ID']}', this.value)">
                    ${['New','Contacted','Interested','Demo Requested','Not Interested','Closed','Duplicate'].map(s =>
                        `<option value="${s}" ${s===statusText?'selected':''}>${s}</option>`
                    ).join('')}
                </select>
            </td>
            <td data-label="Manage" style="display:flex; justify-content:flex-end;">${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
    refreshIcons();
}

function updatePagination(curr, total, totalCount) {
    const el = document.getElementById('pageIndicator');
    if(!el) return;
    el.innerText = `Page ${curr} of ${total} (${totalCount} hits)`;
    
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (prevBtn) prevBtn.disabled = curr <= 1;
    if (nextBtn) nextBtn.disabled = curr >= total;
}

function changePage(offset) {
    const totalPages = Math.ceil(visuallyFilteredLeads.length / itemsPerPage);
    const newPage = currentPage + offset;
    
    if(newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderTable();
    }
}

// === KANBAN PIPELINE LOGIC === //
function renderPipeline() {
    const board = document.getElementById('kanbanBoard');
    if(!board) return;
    if(document.getElementById('pipelineView').style.display === 'none') return;
    board.innerHTML = '';

    const funnelContainer = document.getElementById('pipelineFunnel');
    const columns = [
        { id: 'New', title: 'New', color: 'var(--brand-primary)' },
        { id: 'Contacted', title: 'Contacted', color: '#eab308' },
        { id: 'Interested', title: 'Interested', color: '#84cc16' },
        { id: 'Demo Requested', title: 'Demo Requested', color: '#0ea5e9' },
        { id: 'Not Interested', title: 'Not Interested', color: 'var(--accent-red)' },
        { id: 'Closed', title: 'Closed', color: '#10b981' },
        { id: 'Duplicate', title: 'Duplicate', color: '#8b5cf6' }
    ];

    let counts = {};
    columns.forEach(c => counts[c.id] = 0);
    
    visuallyFilteredLeads.forEach(lead => {
        let st = lead['Lead Status'] || 'New';
        if(counts[st] !== undefined) counts[st]++;
    });

    if(funnelContainer) {
        let funnelHTML = `<div class="pipeline-roadmap">`;
        columns.forEach(c => {
            funnelHTML += `
                <div class="roadmap-step" style="border-top: 3px solid ${c.color};">
                    <span class="roadmap-count">${counts[c.id]}</span>
                    <span class="roadmap-label">${c.id}</span>
                </div>
            `;
        });
        funnelHTML += `</div>`;
        funnelContainer.innerHTML = funnelHTML;
    }
    
    columns.forEach(c => {
        let status = c.id;
        let col = document.createElement('div');
        col.className = 'kanban-column';
        col.setAttribute('ondrop', `dropLead(event, '${status}')`);
        col.setAttribute('ondragover', 'allowDrop(event)');
        
        // Very important bugfix: sync kanban dragging accurately against filters!
        let leadsInStatus = visuallyFilteredLeads.filter(l => (l['Lead Status'] || 'New') === status);
        if(status === 'New') col.classList.add('expanded');
        
        col.innerHTML = `
            <div class="kanban-column-header" onclick="this.parentElement.classList.toggle('expanded')" style="cursor:pointer; user-select:none; border-left: 4px solid ${c.color};">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color: ${c.color};">${c.title}</span>
                    <span class="kanban-count" style="background: ${c.color}; color: #ffffff;">${leadsInStatus.length}</span>
                </div>
                <div class="mobile-chevron">▼</div>
            </div>
            <div class="kanban-cards" id="kcol_${status.replace(' ', '_')}"></div>
        `;
        
        let container = col.querySelector('.kanban-cards');
        
        leadsInStatus.slice(0, 100).forEach(lead => {
            let card = document.createElement('div');
            card.className = 'kanban-card';
            card.draggable = true;
            card.id = `kc_${lead['Lead ID']}`;
            card.setAttribute('ondragstart', `dragLead(event, '${lead['Lead ID']}')`);
            
            let priorityText = lead['Follow-Up Priority (Auto)'] || 'Low';
            let cleanPriority = priorityText.replace(/[^a-zA-Z]/g, '').trim();
            if(cleanPriority === '') cleanPriority = 'Scheduled';
            let badgeClass =  cleanPriority.includes('High') ? 'high' : (cleanPriority.includes('Medium') ? 'medium' : 'low');
            
            let callLink = '';
            let waLink = '';
            if(lead.Phone && lead.Phone.trim().length >= 4) {
                let cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
                callLink = `<a href="tel:${cleanPhone}" title="Call" style="color:var(--accent-green); text-decoration:none; display:flex; align-items:center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                </a>`;
                waLink = `<a href="https://wa.me/${cleanPhone}" target="_blank" title="WhatsApp" style="color:#25D366; text-decoration:none; display:flex; align-items:center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366" stroke="none"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </a>`;
            }

            let searchQuery = lead.Name || lead.Phone || lead.Email || '';
            let searchLink = `<button onclick="openGoogleSearch('${searchQuery.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" title="Search Google" style="color:var(--brand-primary); background:#eff6ff; border:none; padding: 4px 8px; border-radius: 4px; cursor:pointer; display:flex; align-items:center; font-size: 11px; font-weight: 600;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                Search
            </button>`;

            const safeName = (lead.Name || 'Unnamed').replace(/'/g, "\\'").replace(/"/g, '&quot;');

            card.innerHTML = `
                <div class="kc-title" onclick="copyTitleAndOpen('${safeName}', '${lead['Lead ID']}'); event.stopPropagation();" style="cursor: pointer;" title="Tap to copy name and view lead">${lead.Name || 'Unnamed'}</div>
                <div class="kc-meta" style="margin-bottom: 12px; border-bottom: 1px solid #f3f4f6; padding-bottom: 8px;">${lead.Phone || lead.Email || 'No contact'}</div>
                <div class="kc-footer" style="border-top: none; padding-top: 0;">
                    <span class="badge ${badgeClass}">${cleanPriority}</span>
                    <div style="display:flex; gap:5px; align-items:center; flex-wrap: wrap;">
                        ${lead['Demo Site URL']
                            ? `<button onclick="window.open('${lead['Demo Site URL']}','_blank'); return false;" style="background:#8b5cf6; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:12px; font-weight:600; cursor:pointer;" title="View live demo site">View Demo</button>
                               <button onclick="sendDemo('${lead['Lead ID']}'); return false;" style="background:#059669; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:12px; font-weight:600; cursor:pointer;" title="Send demo link">Send</button>`
                            : lead['Lead Status'] === 'Demo Requested'
                                ? (window.currentUser?.role === 'super_admin'
                                    ? `<button onclick="confirmDemoGeneration('${lead['Lead ID']}'); return false;" style="background:#8b5cf6; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:12px; font-weight:600; cursor:pointer;" title="Customize and generate demo">Generate Demo</button>`
                                    : `<span style="padding:3px 8px; border:1px solid #d1d5db; border-radius:4px; font-size:11px; color:#9ca3af;">Awaiting Demo</span>`)
                                : ''
                        }
                        ${searchLink}
                        ${waLink}
                        ${callLink}
                        <button onclick="viewLead('${lead['Lead ID']}'); return false;" style="background:var(--brand-primary); color:#fff; border:none; border-radius:4px; padding:4px 12px; font-size:12px; font-weight:600; cursor:pointer;">Edit</button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
        
        if(leadsInStatus.length > 100) {
            let limitNotice = document.createElement('div');
            limitNotice.style.textAlign = 'center';
            limitNotice.style.fontSize = '11px';
            limitNotice.style.color = 'var(--text-muted)';
            limitNotice.innerText = `+${leadsInStatus.length - 100} more hidden`;
            container.appendChild(limitNotice);
        }

        board.appendChild(col);
    });
    refreshIcons();
}

function allowDrop(ev) {
    ev.preventDefault();
}

function dragLead(ev, id) {
    ev.dataTransfer.setData("leadId", id);
}

function dropLead(ev, targetStatus) {
    ev.preventDefault();
    var leadId = ev.dataTransfer.getData("leadId");
    
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if(!lead || lead['Lead Status'] === targetStatus) return; // Ignore drops into same column

    const oldStatus = lead['Lead Status'] || 'New';
    lead['Lead Status'] = targetStatus; // optimistic

    const logMsg = `Status changed: ${oldStatus} → ${targetStatus} (pipeline drag)`;
    const newNotes = _buildLogEntry(lead, logMsg);

    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'Lead ID': leadId, 'Lead Status': targetStatus, 'Follow-Up Notes': newNotes })
    })
    .then(() => { lead['Follow-Up Notes'] = newNotes; showToast('Status updated', 'success'); })
    .catch(e => showToast('Network error updating status', 'error'));
}

// ═══════════════════════════════════════════════════
//  ACTIVITY TIMELINE HELPERS
// ═══════════════════════════════════════════════════

function _renderActivityTimeline(rawNotes, initialLimit, filterCategory = 'all', filterDate = '') {
    if (!rawNotes || !rawNotes.trim()) {
        return `<p style="font-size:13px; color:var(--text-muted); text-align:center; padding:20px 0;">No activity yet.</p>`;
    }

    let entries = rawNotes.split('\n---\n').map(e => e.trim()).filter(Boolean);

    // Apply Filters
    if (filterCategory !== 'all' || filterDate) {
        entries = entries.filter(entry => {
            const isAuto   = /^\[.*?\]\s*(?:\{.*?\}\s*)?(\[SYS\]|✏️|⚡)/.test(entry);
            const isNote   = /^\[.*?\]\s*(?:\{.*?\}\s*)?(\[NOTE\]|📝)/.test(entry);
            const isDeploy = /^\[.*?\]\s*(?:\{.*?\}\s*)?(\[DEPLOY\]|🚀)/.test(entry);
            const isSched  = /^\[.*?\]\s*(?:\{.*?\}\s*)?(\[SCHED\]|📅|✅)/.test(entry);
            
            let catMatch = true;
            if (filterCategory === 'note') catMatch = isNote;
            else if (filterCategory === 'sys') catMatch = isAuto;
            else if (filterCategory === 'deploy') catMatch = isDeploy;
            else if (filterCategory === 'sched') catMatch = isSched;
            
            let dateMatch = true;
            if (filterDate) {
                const parts = filterDate.split('-');
                if (parts.length === 3) {
                    const formattedFilterDate1 = `${parts[2]}/${parts[1]}/${parts[0]}`; // e.g. 03/05/2026
                    const formattedFilterDate2 = `${parseInt(parts[2],10)}/${parseInt(parts[1],10)}/${parts[0]}`; // e.g. 3/5/2026
                    const tsMatch = entry.match(/^\[([^\]]+)\]/);
                    if (tsMatch) {
                        const ts = tsMatch[1];
                        const entryDate = ts.split(',')[0].trim();
                        dateMatch = (entryDate === formattedFilterDate1 || entryDate === formattedFilterDate2);
                    } else {
                        dateMatch = false;
                    }
                }
            }
            return catMatch && dateMatch;
        });
    }

    if (entries.length === 0) {
        return `<p style="font-size:13px; color:var(--text-muted); text-align:center; padding:20px 0;">No activity matches the filters.</p>`;
    }

    const isFiltered = (filterCategory !== 'all' || filterDate !== '');
    const limit = isFiltered ? entries.length : initialLimit;
    const total   = entries.length;
    const shown   = entries.slice(0, limit);

    function renderCard(entry) {
        const isAuto   = /^\[.*?\]\s*(?:\{.*?\}\s*)?(\[SYS\]|✏️|⚡)/.test(entry);
        const isNote   = /^\[.*?\]\s*(?:\{.*?\}\s*)?(\[NOTE\]|📝)/.test(entry);
        const isDeploy = /^\[.*?\]\s*(?:\{.*?\}\s*)?(\[DEPLOY\]|🚀)/.test(entry);
        const isSched  = /^\[.*?\]\s*(?:\{.*?\}\s*)?(\[SCHED\]|📅|✅)/.test(entry);

        // Extract timestamp if present
        const tsMatch = entry.match(/^\[([^\]]+)\]/);
        const ts      = tsMatch ? tsMatch[1] : '';
        let body      = tsMatch ? entry.slice(tsMatch[0].length).trim() : entry;

        // Extract username if present
        let user = '';
        const userMatch = body.match(/^\{([^\}]+)\}/);
        if (userMatch) {
            user = userMatch[1];
            body = body.slice(userMatch[0].length).trim();
        }

        // Strip structural tags and legacy emojis
        body = body.replace(/^(\[SYS\]|\[NOTE\]|\[DEPLOY\]|\[SCHED\]|✏️|⚡|🚀|📝|📅|✅)\s*/, '');

        let iconHtml = '';
        if (isDeploy) iconHtml = '<i data-lucide="rocket" class="icon-sm"></i>';
        else if (isSched) iconHtml = '<i data-lucide="calendar" class="icon-sm"></i>';
        else if (isNote) iconHtml = '<i data-lucide="file-text" class="icon-sm"></i>';
        else if (isAuto) iconHtml = '<i data-lucide="zap" class="icon-sm"></i>';

        const bg     = isDeploy ? '#f5f3ff' : isNote ? '#f0fdf4' : '#f9fafb';
        const border = isDeploy ? '#8b5cf6'  : isNote ? '#16a34a'  : '#e5e7eb';
        const color  = isDeploy ? '#5b21b6'  : isNote ? '#15803d'  : '#6b7280';

        const headerElements = [];
        if (ts) headerElements.push(ts);
        if (user) headerElements.push(`<span style="font-weight:600; color:var(--text-color);">${user}</span>`);
        const headerHtml = headerElements.length > 0 ? `<div style="font-size:10px; color:#9ca3af; margin-bottom:4px; display:flex; gap:6px;">${headerElements.join(' &bull; ')}</div>` : '';

        return `
            <div style="background:${bg}; border-left:3px solid ${border}; border-radius:4px; padding:9px 12px; margin-bottom:8px;">
                ${headerHtml}
                <div style="font-size:12px; color:${color}; white-space:pre-wrap; display:flex; align-items:flex-start;">
                    ${iconHtml ? `<div style="margin-top:2px; margin-right:6px; flex-shrink:0;">${iconHtml}</div>` : ''}
                    <div style="flex:1; min-width:0;">${body}</div>
                </div>
            </div>`;
    }

    let html = shown.map(renderCard).join('');

    if (total > limit) {
        const hidden = entries.slice(limit);
        html += `
            <div id="activityExtra" style="display:none;">${hidden.map(renderCard).join('')}</div>
            <button onclick="_toggleActivityFull(this, ${total - limit})"
                style="width:100%; padding:8px; background:none; border:1px dashed var(--border-color); border-radius:4px; font-size:12px; color:var(--text-muted); cursor:pointer; margin-top:2px;">
                Show all ${total} entries ▼
            </button>`;
    }

    return html;
}

window.applyActivityFilters = function() {
    const lead = globalLeads.find(l => l['Lead ID'] === editingLeadId);
    if (!lead) return;
    
    const cat = document.getElementById('activityCategoryFilter').value;
    const date = document.getElementById('activityDateFilter').value;
    const container = document.getElementById('activityTimelineContainer');
    
    if (container) {
        container.innerHTML = _renderActivityTimeline(lead['Follow-Up Notes'] || '', 4, cat, date);
        if (typeof refreshIcons === 'function') refreshIcons();
    }
};

window._switchTab = function(tab) {
    const panels = { notes: 'panelNotes', activity: 'panelActivity', schedule: 'panelSchedule' };
    const tabs   = { notes: 'tabNotes',   activity: 'tabActivity',   schedule: 'tabSchedule'   };
    Object.keys(panels).forEach(key => {
        const p = document.getElementById(panels[key]);
        const t = document.getElementById(tabs[key]);
        if (!p || !t) return;
        const isActive = key === tab;
        p.style.display = isActive ? '' : 'none';
        t.style.cssText = t.style.cssText.replace(/color:[^;]+;|font-weight:[^;]+;|border-bottom:[^;]+;/g, '');
        t.style.cssText += isActive
            ? 'color:var(--brand-primary); font-weight:700; border-bottom:2px solid var(--brand-primary);'
            : 'color:var(--text-muted); font-weight:600; border-bottom:2px solid transparent;';
    });
};

window._toggleActivityFull = function(btn, hiddenCount) {
    const extra = document.getElementById('activityExtra');
    if (!extra) return;
    const expanded = extra.style.display !== 'none';
    extra.style.display = expanded ? 'none' : '';
    btn.textContent = expanded ? `Show all entries ▼` : `Show less ▲`;
};

// === MODAL === //
function viewLead(id) {
    editingLeadId = id;
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if(!lead) return;

    let searchQ = lead.Name || lead.Phone || '';
    document.getElementById('modalName').innerHTML = `
        <span style="vertical-align: middle;">${lead.Name || 'Unnamed Lead'}</span>
        <button onclick="openGoogleSearch('${searchQ.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" style="margin-left:12px; font-size:13px; font-weight:600; padding:6px 12px; background:#eff6ff; color:var(--brand-primary); border:none; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; vertical-align: middle;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>Google Search
        </button>
        <button onclick="shareLead('${id}')" style="margin-left:8px; font-size:13px; font-weight:600; padding:6px 12px; background:#f0fdf4; color:#16a34a; border:none; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; vertical-align: middle;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>Share
        </button>
    `;
    const body = document.getElementById('modalBody');
    
    body.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><span class="label">Phone Number</span><input id="editPhone" class="modal-input" value="${lead.Phone || ''}" /></div>
            <div class="detail-item"><span class="label">Email Address</span><input id="editEmail" class="modal-input" value="${lead.Email || ''}" /></div>
            <div class="detail-item"><span class="label">Lead Status</span>
                <select id="editStatus" class="modal-input">
                    <option value="New" ${lead['Lead Status']=='New'?'selected':''}>New</option>
                    <option value="Contacted" ${lead['Lead Status']=='Contacted'?'selected':''}>Contacted</option>
                    <option value="Interested" ${lead['Lead Status']=='Interested'?'selected':''}>Interested</option>
                    <option value="Demo Requested" ${lead['Lead Status']=='Demo Requested'?'selected':''}>Demo Requested</option>
                    <option value="Not Interested" ${lead['Lead Status']=='Not Interested'?'selected':''}>Not Interested</option>
                    <option value="Closed" ${lead['Lead Status']=='Closed'?'selected':''}>Closed/Won</option>
                    <option value="Hold" ${lead['Lead Status']=='Hold'?'selected':''}>Hold</option>
                    <option value="Duplicate" ${lead['Lead Status']=='Duplicate'?'selected':''}>Duplicate</option>
                </select>
            </div>
            <div class="detail-item"><span class="label">Priority</span>
                <select id="editPriority" class="modal-input">
                    <option value="High" ${lead['Follow-Up Priority (Auto)'] && lead['Follow-Up Priority (Auto)'].includes('High')?'selected':''}>High</option>
                    <option value="Medium" ${lead['Follow-Up Priority (Auto)'] && lead['Follow-Up Priority (Auto)'].includes('Medium')?'selected':''}>Medium</option>
                    <option value="Low" ${!lead['Follow-Up Priority (Auto)'] || lead['Follow-Up Priority (Auto)'].includes('Low')?'selected':''}>Low</option>
                </select>
            </div>
        </div>
        </div>
        
        <!-- ── Quick Outreach ─────────────────────────── -->
        <div class="divider"></div>
        <div style="margin-top:16px;">
            <span class="label" style="display:block; margin-bottom:10px;">Quick Outreach (Zero-Cost Client-Side)</span>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <select id="whatsappTemplate" class="modal-input" style="width:160px; margin-bottom:0; min-height:34px;">
                    <option value="welcome">Intro / Welcome</option>
                    <option value="demo">Demo Follow-up</option>
                    <option value="checkin">Check-in</option>
                </select>
                <button type="button" onclick="sendWhatsAppTemplate('${id}')" style="background:#22c55e; color:#fff; border:none; border-radius:6px; padding:0 14px; height:34px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> WhatsApp
                </button>
                
                <span style="border-left:1px solid var(--border-color); margin:0 4px; height:34px;"></span>

                <select id="emailTemplate" class="modal-input" style="width:160px; margin-bottom:0; min-height:34px;">
                    <option value="welcome">Intro / Welcome</option>
                    <option value="demo">Demo Follow-up</option>
                    <option value="checkin">Check-in</option>
                </select>
                <button type="button" onclick="sendEmailTemplate('${id}')" style="background:#3b82f6; color:#fff; border:none; border-radius:6px; padding:0 14px; height:34px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Email
                </button>
            </div>
        </div>

        <!-- ── Notes / Activity / Schedule Tabs ─────────────────────────── -->
        <div class="divider"></div>
        <div style="margin-top:4px;">
            <!-- Tab strip -->
            <div style="display:flex; border-bottom:2px solid var(--border-color); margin-bottom:14px; gap:0;">
                <button id="tabNotes" onclick="_switchTab('notes')" style="background:none; border:none; padding:8px 16px; font-size:13px; font-weight:700; color:var(--brand-primary); border-bottom:2px solid var(--brand-primary); margin-bottom:-2px; cursor:pointer; display:flex; align-items:center; gap:6px;"><i data-lucide="file-text" class="icon-sm"></i> Notes</button>
                <button id="tabActivity" onclick="_switchTab('activity')" style="background:none; border:none; padding:8px 16px; font-size:13px; font-weight:600; color:var(--text-muted); border-bottom:2px solid transparent; margin-bottom:-2px; cursor:pointer; display:flex; align-items:center; gap:6px;"><i data-lucide="clock" class="icon-sm"></i> Activity</button>
                <button id="tabSchedule" onclick="_switchTab('schedule')" style="background:none; border:none; padding:8px 16px; font-size:13px; font-weight:600; color:var(--text-muted); border-bottom:2px solid transparent; margin-bottom:-2px; cursor:pointer; display:flex; align-items:center; gap:6px;"><i data-lucide="calendar" class="icon-sm"></i> Schedule</button>
            </div>

            <!-- Notes panel -->
            <div id="panelNotes">
                <textarea id="editNotes" class="modal-input" placeholder="Add a new note — it will be timestamped and saved to the activity log..." style="height:80px; resize:vertical;"></textarea>
            </div>

            <!-- Activity timeline panel -->
            <div id="panelActivity" style="display:none;">
                <div style="display:flex; gap:10px; margin-bottom:12px; align-items:center;">
                    <select id="activityCategoryFilter" onchange="applyActivityFilters()" class="modal-input" style="padding: 4px 8px; font-size:12px; min-height: 28px; width: 140px; margin-bottom:0;">
                        <option value="all">All Logs</option>
                        <option value="note">Notes Only</option>
                        <option value="sys">System Activity</option>
                        <option value="deploy">Deployments</option>
                        <option value="sched">Schedules</option>
                    </select>
                    <input type="date" id="activityDateFilter" onchange="applyActivityFilters()" class="modal-input" style="padding: 4px 8px; font-size:12px; min-height: 28px; width: 140px; margin-bottom:0;" />
                    <button type="button" onclick="document.getElementById('activityCategoryFilter').value='all'; document.getElementById('activityDateFilter').value=''; applyActivityFilters();" style="background:none; border:none; color:var(--brand-primary); font-size:12px; cursor:pointer; padding:4px;">Clear</button>
                </div>
                <div id="activityTimelineContainer">
                    ${_renderActivityTimeline(lead['Follow-Up Notes'] || '', 4)}
                </div>
            </div>

            <!-- Schedule panel -->
            <div id="panelSchedule" style="display:none;">
                ${_renderScheduleTab(lead)}
            </div>
        </div>
        <div class="divider"></div>
        <div style="margin-top:16px; padding-bottom: 4px;">
            <span class="label" style="display:block; margin-bottom:10px;">Demo Website</span>
            ${lead['Demo Site URL'] ? `
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span style="font-size:12px; color:var(--text-muted); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${lead['Demo Site URL']}">${lead['Demo Site URL']}</span>
                    <button type="button" onclick="window.open('${lead['Demo Site URL']}','_blank')" style="background:#8b5cf6; color:#fff; border:none; border-radius:6px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;">View Demo</button>
                    <button type="button" class="btn-send-demo" onclick="sendDemo('${lead['Lead ID']}')" style="padding:7px 14px; font-size:13px;">Send Demo</button>
                    <button type="button" onclick="copyDemoMessages('${lead['Lead ID']}')" style="background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:6px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px;" title="Copy both messages to clipboard"><i data-lucide="clipboard" class="icon-sm"></i> Copy Msgs</button>
                    ${window.currentUser?.role === 'super_admin'
                        ? `<button type="button" onclick="requestDemoSite('${lead['Lead ID']}', this, true)" style="background:#f3f4f6; color:#6b7280; border:1px solid #e5e7eb; border-radius:6px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;" title="Regenerate the demo site">Regenerate</button>
                           <button type="button" onclick="deleteDemoSite('${lead['Lead ID']}', this)" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; border-radius:6px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;" title="Delete this demo site permanently">Delete Site</button>`
                        : ''}

                </div>
            ` : `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:12px; color:var(--text-muted);">No demo site deployed yet.</span>
                    <button type="button" id="generateDemoBtn"
                        onclick="confirmDemoGeneration('${lead['Lead ID']}', true)"
                        style="${window.currentUser?.role === 'super_admin'
                            ? 'background:#8b5cf6; color:#fff; border:none; cursor:pointer;'
                            : 'background:#f3f4f6; color:#9ca3af; border:1px solid #e5e7eb; cursor:not-allowed;'}
                               border-radius:6px; padding:7px 16px; font-size:13px; font-weight:600;"
                        ${window.currentUser?.role !== 'super_admin' ? 'disabled title="Only Super Admins can generate demos"' : ''}>
                        ${window.currentUser?.role === 'super_admin' ? 'Generate &amp; Deploy' : 'Awaiting Demo'}
                    </button>
                </div>
            `}
        </div>
        <div style="margin-top: 24px; padding-bottom: 30px; display:flex; justify-content: flex-end;">
            <button type="button" class="btn-primary" id="saveLeadBtn" onclick="saveLead()" ontouchstart="saveLead()">Save Changes</button>
        </div>
    `;

    document.getElementById('leadModal').style.display = 'block';
    refreshIcons();
}

function saveLead() {
    if(!editingLeadId) return;
    const btn = document.getElementById('saveLeadBtn');
    btn.innerText = 'Saving...';

    const lead = globalLeads.find(l => l['Lead ID'] === editingLeadId);
    const newStatus   = document.getElementById('editStatus').value;
    const newPriority = document.getElementById('editPriority').value;
    const newNoteText = (document.getElementById('editNotes').value || '').trim();

    // Build auto-change summary
    const changes = [];
    if (lead && lead['Lead Status']               !== newStatus)   changes.push(`Status: ${lead['Lead Status'] || 'New'} → ${newStatus}`);
    if (lead && lead['Follow-Up Priority (Auto)'] !== newPriority) changes.push(`Priority: ${lead['Follow-Up Priority (Auto)'] || '-'} → ${newPriority}`);
    if (lead && document.getElementById('editPhone').value !== (lead.Phone || '')) changes.push('Phone updated');
    if (lead && document.getElementById('editEmail').value !== (lead.Email || '')) changes.push('Email updated');

    let combinedNotes = lead ? (lead['Follow-Up Notes'] || '') : '';
    const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    if (changes.length) {
        const autoEntry = `[${ts}] [SYS] ${changes.join(' | ')}`;
        combinedNotes = combinedNotes ? `${autoEntry}\n---\n${combinedNotes}` : autoEntry;
    }
    if (newNoteText) {
        const noteEntry = `[${ts}] [NOTE] ${newNoteText}`;
        combinedNotes = combinedNotes ? `${noteEntry}\n---\n${combinedNotes}` : noteEntry;
    }

    const leadUpdate = {
        'Lead ID': editingLeadId,
        'Phone': document.getElementById('editPhone').value,
        'Email': document.getElementById('editEmail').value,
        'Lead Status': newStatus,
        'Follow-Up Priority (Auto)': newPriority,
        'Follow-Up Notes': combinedNotes
    };

    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadUpdate)
    })
    .then(r => r.json())
    .then(data => {
        if(data.status === 'success') {
            showToast('Lead saved successfully', 'success');
            closeModal();
            loadData(); 
        } else {
            showToast('Error: ' + data.error, 'error');
            btn.innerText = 'Save Changes';
        }
    })
    .catch(e => {
        showToast('Network error — could not save', 'error');
        btn.innerText = 'Save Changes';
    });
}

function closeModal() {
    document.getElementById('leadModal').style.display = 'none';
}

window.onclick = function(event) {
    if (event.target == document.getElementById('leadModal')) {
        closeModal();
    }
}

function renderChart(leads) {
    const sources = {};
    leads.forEach(l => {
        let cat = l['Category (Pitch Angle)'] || 'General';
        if(cat.length > 25) cat = cat.substring(0, 25) + '...';
        if(cat.trim() !== '') {
             sources[cat] = (sources[cat] || 0) + 1;
        }
    });

    const sorted = Object.entries(sources).sort((a,b) => b[1]-a[1]).slice(0, 5);
    const labels = sorted.map(i => i[0]);
    const data = sorted.map(i => i[1]);

    const canvasEl = document.getElementById('sourceChart');
    if (!canvasEl) return;   // chart panel removed — skip silently
    const ctx = canvasEl.getContext('2d');
    if(chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#e0f2fe'],
                borderWidth: 1,
                borderColor: '#ffffff',
                hoverOffset: 4
            }]
        },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15, font: {family: '-apple-system'} } } }, cutout: '0%', layout: { padding: 10 } }
    });
}

function toggleLeadSelection(cb) {
    if(cb.checked) selectedLeadIds.add(cb.value);
    else selectedLeadIds.delete(cb.value);
    updateDeleteBtnVisibility();
}

function toggleSelectAll(cb) {
    const checkboxes = document.querySelectorAll('.lead-checkbox');
    checkboxes.forEach(c => {
        c.checked = cb.checked;
        if(cb.checked) selectedLeadIds.add(c.value);
        else selectedLeadIds.delete(c.value);
    });
    updateDeleteBtnVisibility();
}

function updateDeleteBtnVisibility() {
    const bar        = document.getElementById('bulkActionBar');
    const countLabel = document.getElementById('bulkCountLabel');
    const countSpan  = document.getElementById('selectedCount');
    const deleteBtn  = document.getElementById('deleteSelectedBtn');
    const n = selectedLeadIds.size;

    if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
    if (countLabel) countLabel.textContent = `${n} lead${n !== 1 ? 's' : ''} selected`;
    if (countSpan)  countSpan.textContent  = n;
    if (deleteBtn)  deleteBtn.style.display = n > 0 ? 'flex' : 'none';

    if (n === 0) {
        const selectAll = document.getElementById('selectAllLeads');
        if (selectAll) selectAll.checked = false;
        const bulkSel = document.getElementById('bulkStatusSelect');
        if (bulkSel) bulkSel.value = '';
    }
}

function deleteSelectedLeads() {
    if(selectedLeadIds.size === 0) return;
    if(!confirm(`Are you sure you want to permanently delete ${selectedLeadIds.size} leads?`)) return;
    
    const btn = document.getElementById('deleteSelectedBtn');
    btn.innerHTML = 'Deleting...';
    
    fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedLeadIds) })
    })
    .then(r => r.json())
    .then(data => {
        if(data.error) throw new Error(data.error);
        showToast(`Deleted ${selectedLeadIds.size} leads`, 'success');
        selectedLeadIds.clear();
        updateDeleteBtnVisibility();
        loadData(false);
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span class="btn-text">Delete (<span id="selectedCount">0</span>)</span>`;
    })
    .catch(e => {
        showToast('Delete failed: ' + e, 'error');
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span class="btn-text">Delete (<span id="selectedCount">${selectedLeadIds.size}</span>)</span>`;
    });
}

// ── Export current filtered view as CSV ──────────────────────────────────────
window.exportCSV = function() {
    if (!visuallyFilteredLeads || visuallyFilteredLeads.length === 0) {
        showToast('No leads to export.', 'warning');
        return;
    }
    const cols = ['Lead ID','Name','Phone','Email','Location','Lead Status',
                  'Follow-Up Priority (Auto)','Source','Website','Has WhatsApp',
                  'Budget','Expected Value','Probability (%)','Demo Site URL'];
    const escape = v => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? `"${s}"` : s;
    };
    const rows = [cols.join(',')];
    visuallyFilteredLeads.forEach(lead => rows.push(cols.map(c => escape(lead[c])).join(',')));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
        href: url, download: `darion-leads-${new Date().toISOString().split('T')[0]}.csv`
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${visuallyFilteredLeads.length} leads as CSV.`, 'success');
};

// ── Bulk-update status for selected leads ────────────────────────────────────
window.bulkUpdateSelectedStatus = async function() {
    const newStatus = document.getElementById('bulkStatusSelect')?.value;
    if (!newStatus) { showToast('Please choose a status first.', 'warning'); return; }
    if (selectedLeadIds.size === 0) return;
    const n = selectedLeadIds.size;
    if (!confirm(`Change status of ${n} lead${n !== 1 ? 's' : ''} to "${newStatus}"?`)) return;
    showToast(`Updating ${n} leads...`, 'info');
    try {
        const leadIds = Array.from(selectedLeadIds);
        const res = await fetch('/api/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadIds, fields: { 'Lead Status': newStatus } })
        });
        if (!res.ok) throw new Error(`Bulk update failed: ${res.status}`);
        const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
        const logLine = `[${ts}] [SYS] Status → ${newStatus} (bulk selection)`;
        globalLeads.forEach(l => {
            if (selectedLeadIds.has(l['Lead ID'])) {
                l['Lead Status'] = newStatus;
                const existing = l['Follow-Up Notes'] || '';
                l['Follow-Up Notes'] = existing ? `${logLine}\n---\n${existing}` : logLine;
            }
        });
        leadIds.forEach(id => {
            const l = globalLeads.find(x => x['Lead ID'] === id);
            if (l) fetch('/api/update', { method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ 'Lead ID': id, 'Follow-Up Notes': l['Follow-Up Notes'] })
            }).catch(() => {});
        });
        selectedLeadIds.clear();
        updateDeleteBtnVisibility();
        lastDataFingerprint = '';
        applyFilters();
        showToast(`${n} leads updated to "${newStatus}".`, 'success');
    } catch (err) {
        showToast('Bulk update failed: ' + err.message, 'error');
    }
};

// ── Clear all selections ─────────────────────────────────────────────────────
window.clearSelection = function() {
    selectedLeadIds.clear();
    document.querySelectorAll('.lead-checkbox').forEach(c => c.checked = false);
    updateDeleteBtnVisibility();
};

window.copyTitleAndOpen = function(text, id) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            viewLead(id);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            viewLead(id);
        });
    } else {
        let ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
        viewLead(id);
    }
};

// === DEMO CONFIRM MODAL === //
let _demoConfirmLeadId  = null;   // lead being confirmed
let _demoConfirmFromModal = false; // came from lead modal?

window.confirmDemoGeneration = function(leadId, fromModal = false) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead) return;

    _demoConfirmLeadId   = leadId;
    _demoConfirmFromModal = fromModal;

    const name = lead.Name || '';

    // Pre-fill all fields from lead data
    document.getElementById('dm_title').value   = name;
    document.getElementById('dm_contact').value = lead.Phone    || '';
    document.getElementById('dm_email').value   = lead.Email    || '';
    document.getElementById('dm_location').value = lead.Location || '';
    document.getElementById('dm_details').value = lead['Category (Pitch Angle)'] || lead.Notes || '';
    document.getElementById('dm_logo').value    = name.substring(0, 2).toUpperCase();
    buildTemplateCards('4');

    const modal = document.getElementById('demoConfirmModal');
    modal.style.display = 'flex';
};

const TEMPLATE_LABELS = {
    '1':    'Template 1 — Classic',
    '2':    'Template 2 — Modern',
    '3':    'Template 3 — Bold',
    '4':    'Template 4 — Horizon Dream',
    '5':    'Template 5 — Minimal',
    'r-6':  'r-6 — Real Estate A',
    'r-7':  'r-7 — Real Estate B',
    'r-8':  'r-8 — Interior Studio',
    'r-9':  'r-9 — Furniture',
    'r-10': 'r-10 — Premium Buyers',
};

function buildTemplateCards(defaultSelected = '4') {
    const grid = document.getElementById('templateCardGrid');
    if (!grid) return;
    grid.innerHTML = '';

    Object.entries(TEMPLATE_LABELS).forEach(([id, label]) => {
        const card = document.createElement('div');
        card.className = 'tmpl-card' + (id === defaultSelected ? ' selected' : '');
        card.dataset.templateId = id;
        card.onclick = () => selectTemplateCard(id);

        card.innerHTML = `
            <div class="tmpl-preview">
                <iframe src="${BACKEND_URL}/template/preview/${id}"
                    loading="lazy" sandbox="allow-same-origin allow-scripts"
                    title="${label}"></iframe>
            </div>
            <div class="tmpl-name">${label}</div>
            <div class="tmpl-badge">✓</div>
        `;
        grid.appendChild(card);
    });

    document.getElementById('dm_template').value = defaultSelected;
}

function selectTemplateCard(id) {
    document.querySelectorAll('.tmpl-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.tmpl-card[data-template-id="${id}"]`);
    if (card) card.classList.add('selected');
    document.getElementById('dm_template').value = id;
}

window.closeDemoConfirmModal = function() {
    document.getElementById('demoConfirmModal').style.display = 'none';
    _demoConfirmLeadId = null;
};

window.submitDemoGeneration = async function(isAuto = false) {
    if (!_demoConfirmLeadId) return;

    const leadId = _demoConfirmLeadId;
    const fromModal = _demoConfirmFromModal;
    closeDemoConfirmModal();

    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead) return;

    // If auto: use lead data as-is. If custom: read form values.
    const payload = isAuto ? {
        title:     lead.Name      || 'Business',
        contact:   lead.Phone     || lead.Email || 'N/A',
        email:     lead.Email     || '',
        location:  lead.Location  || '',
        address:   lead.Location  || 'India',
        details:   lead['Category (Pitch Angle)'] || lead.Notes || 'Professional services business.',
        logo_text: (lead.Name || 'XX').substring(0, 2).toUpperCase(),
    } : {
        title:     document.getElementById('dm_title').value.trim()   || lead.Name || 'Business',
        contact:   document.getElementById('dm_contact').value.trim() || lead.Phone || lead.Email || 'N/A',
        email:     document.getElementById('dm_email').value.trim()   || lead.Email || '',
        location:  document.getElementById('dm_location').value.trim() || lead.Location || '',
        address:   document.getElementById('dm_location').value.trim() || lead.Location || 'India',
        details:   document.getElementById('dm_details').value.trim() || lead['Category (Pitch Angle)'] || 'Professional services business.',
        logo_text: document.getElementById('dm_logo').value.trim().toUpperCase() || (lead.Name || 'XX').substring(0, 2).toUpperCase(),
    };

    const template = document.getElementById('dm_template')?.value || DEFAULT_TEMPLATE;

    await requestDemoSite(leadId, null, fromModal, payload, template);
};

// Stores leadId -> clientId for previews that have been opened but not yet deployed+saved
window._pendingDeployMap = window._pendingDeployMap || {};

// === DEMO SITE GENERATION === //
const DEFAULT_TEMPLATE = '4';   // Template 4 = Horizon Dream Home


window.requestDemoSite = async function(id, btn, fromModal = false, customPayload = null, template = null) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead) return;

    const origText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Preparing...'; }

    const name = lead.Name || 'Unnamed Lead';
    const clientPayload = customPayload || {
        title:     name || 'Business',
        contact:   (lead.Phone && lead.Phone.trim()) || (lead.Email && lead.Email.trim()) || 'N/A',
        email:     lead.Email    || '',
        location:  lead.Location || '',
        address:   (lead.Location && lead.Location.trim()) || 'India',
        details:   (lead['Category (Pitch Angle)'] && lead['Category (Pitch Angle)'].trim()) ||
                   (lead.Notes && lead.Notes.trim()) ||
                   (lead['Category'] && lead['Category'].trim()) ||
                   'Professional services business.',
        logo_text: name.substring(0, 2).toUpperCase() || 'BZ'
    };
    const chosenTemplate = template || DEFAULT_TEMPLATE;

    try {
        // ── Step 1: Create client record ──────────────────────────────────
        showToast('Step 1/2 — Creating client record...', 'info');
        const createRes = await fetch('/api/proxy-backend', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ path: '/client/create', payload: clientPayload })
        });
        if (!createRes.ok) throw new Error(`Client create failed: ${createRes.status}`);
        const clientData = await createRes.json();
        const clientId   = clientData.id;

        // ── Step 2: Apply selected template ──────────────────────────────
        showToast('Step 2/2 — Applying template...', 'info');
        const tplRes = await fetch('/api/proxy-backend', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ path: '/template/select', payload: { client_id: clientId, template_name: chosenTemplate } })
        });
        if (!tplRes.ok) throw new Error(`Template apply failed: ${tplRes.status}`);

        // ── Step 3: Open Railway preview page — user reviews then clicks Deploy & Save in CRM ──
        const previewUrl = `${BACKEND_URL}/preview/${clientId}?source=crm&leadId=${id}`;
        window.open(previewUrl, '_blank');

        // Store clientId so deployLive() can deploy + save URL after user reviews
        window._pendingDeployMap[id] = clientId;
        renderTable();   // re-render immediately to show the Deploy & Save button

        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
        showToast('Preview opened! Review it, then click \"Deploy & Save\" on this lead.', 'success');

    } catch (err) {
        console.error('requestDemoSite error:', err);
        showToast('Demo generation failed: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
};

// ═══════════════════════════════════════════════════
//  FOLLOW-UP SCHEDULER
// ═══════════════════════════════════════════════════

let _firedNotifications = new Set();
let _notificationPermGranted = false;

if ("Notification" in window && Notification.permission === "granted") {
    _notificationPermGranted = true;
}

window.requestNotificationPermission = function() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        _notificationPermGranted = true;
        showToast('Notifications are already enabled', 'info');
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                _notificationPermGranted = true;
                showToast('Notifications enabled successfully', 'success');
            }
        });
    } else {
        showToast('Notification permission was denied in browser settings', 'warning');
    }
}

window.checkNotifications = function() {
    if (!_notificationPermGranted) return;
    
    const now = new Date();
    
    globalLeads.forEach(lead => {
        const dtStr = lead['Next Follow-Up Date'];
        if (!dtStr || !dtStr.includes('T')) return; 
        
        const schedTime = new Date(dtStr);
        if (isNaN(schedTime.getTime())) return;
        
        const diffMs = schedTime.getTime() - now.getTime();
        
        // If scheduled time is within the next 60 seconds or just passed (up to 1 min ago)
        if (diffMs >= -60000 && diffMs <= 60000) {
            const leadId = lead['Lead ID'];
            if (!_firedNotifications.has(leadId)) {
                _firedNotifications.add(leadId);
                
                const title = `Darion CRM 🔔`;
                const options = {
                    body: `Follow up with ${lead.Name || 'Lead'}!\nDue Now`,
                };
                
                const notif = new Notification(title, options);
                notif.onclick = function() {
                    window.focus();
                    viewLead(leadId);
                    this.close();
                };
            }
        }
    });
}
setInterval(checkNotifications, 60000);

window._renderScheduleTab = function(lead) {
    let dtStr = lead['Next Follow-Up Date'] || '';
    let dVal = '';
    let tVal = '';
    if (dtStr && dtStr.includes('T')) {
        const parts = dtStr.split('T');
        dVal = parts[0];
        tVal = parts[1].substring(0,5);
    } else if (dtStr) {
        dVal = dtStr;
    }
    
    // Try to extract note from Activity log
    let note = '';
    const notes = lead['Follow-Up Notes'] || '';
    const match = notes.match(/📅 Scheduled follow-up for .*? - "(.*?)"/);
    if (match) {
        note = match[1];
    }

    return `
        <div style="padding:4px 0;">
            <div class="detail-item">
                <span class="label">Date</span>
                <input type="date" id="schedDate" class="modal-input" value="${dVal}">
            </div>
            <div class="detail-item" style="margin-top:10px;">
                <span class="label">Time</span>
                <input type="time" id="schedTime" class="modal-input" value="${tVal}">
            </div>
            <div class="detail-item" style="margin-top:10px;">
                <span class="label">Note (optional)</span>
                <input type="text" id="schedNote" class="modal-input" value="${note}" placeholder="e.g. Discuss pricing for website">
            </div>
            
            <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center;">
                <button type="button" class="btn-outline" onclick="requestNotificationPermission()" style="padding:6px 12px; font-size:12px;">🔔 Enable Notifications</button>
                <button type="button" class="btn-primary" onclick="saveSchedule('${lead['Lead ID']}', this)" style="background:#7c3aed; padding:6px 16px;">Save Schedule</button>
            </div>
        </div>
    `;
}

window.saveSchedule = function(leadId, btn) {
    const dVal = document.getElementById('schedDate').value;
    const tVal = document.getElementById('schedTime').value;
    const nVal = document.getElementById('schedNote').value.trim();
    
    if (!dVal || !tVal) {
        showToast('Please select both date and time', 'warning');
        return;
    }
    const isoString = `${dVal}T${tVal}:00`;
    
    const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    let logLine = `[${ts}] [SCHED] Scheduled follow-up for ${dVal} at ${tVal}`;
    if (nVal) logLine += ` - "${nVal}"`;
    
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    let combinedNotes = lead ? (lead['Follow-Up Notes'] || '') : '';
    combinedNotes = combinedNotes ? `${logLine}\n---\n${combinedNotes}` : logLine;
    
    const payload = {
        'Lead ID': leadId,
        'Next Follow-Up Date': isoString,
        'Follow-Up Notes': combinedNotes
    };
    
    const origText = btn.innerText;
    btn.innerText = 'Saving...';
    
    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
        if(data.status === 'success') {
            if(lead) {
                lead['Next Follow-Up Date'] = isoString;
                lead['Follow-Up Notes'] = combinedNotes;
            }
            showToast('Schedule saved', 'success');
            _firedNotifications.delete(leadId);
            
            document.getElementById('panelSchedule').innerHTML = _renderScheduleTab(lead);
            renderSchedulePanel();
        } else {
            showToast('Error: ' + data.error, 'error');
            btn.innerText = origText;
        }
    })
    .catch(e => {
        showToast('Network error', 'error');
        btn.innerText = origText;
    });
}

window.renderSchedulePanel = function() {
    const wrap = document.getElementById('schedulePanelWrap');
    const body = document.getElementById('schedulePanelBody');
    const countBadge = document.getElementById('schedulePanelCount');
    
    if (!wrap || !body) return;
    
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    
    const scheduledLeads = globalLeads.filter(l => {
        const dtStr = l['Next Follow-Up Date'];
        return dtStr && dtStr.startsWith(todayStr) && dtStr.includes('T');
    });
    
    scheduledLeads.sort((a,b) => {
        return new Date(a['Next Follow-Up Date']).getTime() - new Date(b['Next Follow-Up Date']).getTime();
    });
    
    if (scheduledLeads.length === 0) {
        wrap.style.display = 'none';
        return;
    }
    
    wrap.style.display = 'block';
    countBadge.innerText = scheduledLeads.length;
    
    body.innerHTML = scheduledLeads.map(lead => {
        const dtStr = lead['Next Follow-Up Date'];
        const parts = dtStr.split('T');
        if (parts.length < 2) return '';
        const tVal = parts[1].substring(0,5);
        
        const [h,m] = tVal.split(':');
        const ampm = +h >= 12 ? 'PM' : 'AM';
        const h12 = (+h % 12) || 12;
        const timeStr = `${h12}:${m} ${ampm}`;
        
        let note = '';
        const notes = lead['Follow-Up Notes'] || '';
        const match = notes.match(/\[SCHED\] Scheduled follow-up for .*? - "(.*?)"/);
        if (match) {
            note = match[1];
        }
        
        let callLink = '';
        if(lead.Phone && lead.Phone.trim().length >= 4) {
            let cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
            callLink = `<a href="tel:${cleanPhone}" title="Call" style="color:var(--accent-green); text-decoration:none; margin-right:8px; font-weight:600; font-size:12px;">Call</a>`;
        }
        
        return `
            <div style="background:#fff; border:1px solid #e5e7eb; border-radius:6px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:13px; font-weight:700; color:var(--text-main);">
                        <span style="color:#d97706; margin-right:6px;">${timeStr}</span>
                        ${lead.Name || 'Unnamed'}
                    </div>
                    ${note ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;">"${note}"</div>` : ''}
                </div>
                <div style="display:flex; align-items:center;">
                    ${callLink}
                    <button onclick="viewLead('${lead['Lead ID']}')" style="background:none; border:none; color:#3b82f6; font-size:12px; font-weight:600; cursor:pointer; margin-right:8px;">Edit</button>
                    <button onclick="markScheduleDone('${lead['Lead ID']}', this)" style="background:#f0fdf4; border:1px solid #bbf7d0; color:#16a34a; font-size:12px; font-weight:600; padding:4px 8px; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:4px;">Mark Done</button>
                </div>
            </div>
        `;
    }).join('');
};

window._toggleSchedulePanel = function() {
    const body = document.getElementById('schedulePanelBody');
    const chevron = document.getElementById('schedulePanelChevron');
    if (body.style.display === 'none') {
        body.style.display = 'flex';
        chevron.innerText = '▼';
    } else {
        body.style.display = 'none';
        chevron.innerText = '▲';
    }
};

window.markScheduleDone = function(leadId, btn) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead) return;
    
    if (btn) btn.innerText = '...';
    
    const logLine = `[SYS] Scheduled follow-up completed`;
    const newNotes = _buildLogEntry(lead, logLine);
    
    const payload = {
        'Lead ID': leadId,
        'Next Follow-Up Date': '', 
        'Follow-Up Notes': newNotes
    };
    
    const doStatusUpdate = confirm("Update lead status to 'Contacted'?");
    if (doStatusUpdate) {
        payload['Lead Status'] = 'Contacted';
    }
    
    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
        if(data.status === 'success') {
            if(lead) {
                lead['Next Follow-Up Date'] = '';
                lead['Follow-Up Notes'] = newNotes;
                if (doStatusUpdate) lead['Lead Status'] = 'Contacted';
            }
            showToast('Follow-up marked as done', 'success');
            renderSchedulePanel();
            if(editingLeadId === leadId) {
                viewLead(leadId); 
            }
        } else {
            showToast('Error: ' + data.error, 'error');
            if (btn) btn.innerText = 'Mark Done';
        }
    })
    .catch(e => {
        showToast('Network error', 'error');
        if (btn) btn.innerText = 'Mark Done';
    });
};
// Poll /api/leads every 5 s (up to 5 min) until Demo Site URL appears for this lead
function _startDemoUrlPoller(leadId) {
    const already = globalLeads.find(l => l['Lead ID'] === leadId);
    if (already && already['Demo Site URL']) return; // already have it

    const MAX_MS   = 5 * 60 * 1000; // 5 minutes
    const INTERVAL = 5000;           // 5 seconds
    const started  = Date.now();

    const poll = setInterval(async () => {
        if (Date.now() - started > MAX_MS) {
            clearInterval(poll);
            showToast('Demo URL not detected after 5 min — please refresh the page.', 'warning');
            return;
        }
        try {
            const res  = await fetch('/api/leads');
            const data = await res.json();
            if (!Array.isArray(data)) return;
            const freshLead = data.find(l => l['Lead ID'] === leadId);
            if (freshLead && freshLead['Demo Site URL']) {
                clearInterval(poll);
                _applyDemoUrl(leadId, freshLead['Demo Site URL']);
            }
        } catch(e) { /* network blip – keep polling */ }
    }, INTERVAL);
}

// Apply a newly-discovered Demo Site URL into memory + re-render UI
function _applyDemoUrl(leadId, url) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (lead) {
        lead['Demo Site URL'] = url;
        renderTable();
        if (document.getElementById('pipelineView').style.display !== 'none') renderPipeline();
        const modal = document.getElementById('leadModal');
        if (modal && modal.style.display === 'block' && editingLeadId === leadId) viewLead(leadId);
    }
    lastDataFingerprint = '';
    showToast('Demo deployed! View Demo and Send Demo buttons are now active.', 'success');
}

// Listen for DEMO_DEPLOYED postMessage from the preview page (fast path)
window.addEventListener('message', async function(event) {
    if (!event.data || event.data.type !== 'DEMO_DEPLOYED') return;
    const { leadId, url } = event.data;
    if (!url || !leadId) return;

    // Update in-memory + UI immediately via shared helper
    _applyDemoUrl(leadId, url);

    // Persist to Supabase in case the preview page hasn't done so yet
    try {
        await fetch('/api/update', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ 'Lead ID': leadId, 'Demo Site URL': url })
        });
        lastDataFingerprint = '';
        loadData(true);
    } catch(e) {
        console.error('Failed to save Demo Site URL:', e);
        showToast('Demo live but could not save URL — please refresh.', 'warning');
    }
});

// Called when user clicks "Deploy & Save" after reviewing the preview tab.
window.deployLive = async function(leadId, btn) {
    const clientId = window._pendingDeployMap && window._pendingDeployMap[leadId];
    if (!clientId) {
        showToast('No pending preview found. Please generate the demo again.', 'warning');
        return;
    }
    const origText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Deploying...'; }
    showToast('Deploying to Vercel — this may take ~30 s...', 'info');

    try {
        const deployRes = await fetch('/api/deploy', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ client_id: clientId })
        });
        if (!deployRes.ok) {
            const e = await deployRes.json().catch(() => ({}));
            throw new Error(e.error || `Deploy failed: ${deployRes.status}`);
        }
        const { url: siteUrl } = await deployRes.json();
        if (!siteUrl) throw new Error('No URL returned from deploy');

        const demoLead  = globalLeads.find(l => l['Lead ID'] === leadId);
        const demoNotes = demoLead ? _buildLogEntry(demoLead, `[DEPLOY] Demo deployed: ${siteUrl}`) : '';
        await fetch('/api/update', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ 'Lead ID': leadId, 'Demo Site URL': siteUrl, ...(demoNotes ? { 'Follow-Up Notes': demoNotes } : {}) })
        });
        if (demoLead && demoNotes) demoLead['Follow-Up Notes'] = demoNotes;

        delete window._pendingDeployMap[leadId];
        _applyDemoUrl(leadId, siteUrl);
        window.open(siteUrl, '_blank');

    } catch (err) {
        console.error('deployLive error:', err);
        showToast('Deploy failed: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
};

window.deleteDemoSite = async function(leadId, btn) {
    if (!confirm('Delete this demo site? The Vercel deployment will remain but the link will be removed from this lead.')) return;

    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead) return;

    const origText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Deleting...'; }

    try {
        // Extract client_id from the stored URL (darion-demo-{id}.vercel.app)
        // Try to call the delete endpoint if we have the client ID
        // We'll just clear from Supabase since we don't store client_id separately
        await fetch('/api/update', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ 'Lead ID': leadId, 'Demo Site URL': null })
        });

        lead['Demo Site URL'] = null;
        delete lead['Demo Site URL'];

        showToast('Demo site removed from this lead.', 'success');
        viewLead(leadId);   // refresh modal
        renderTable();
        if (document.getElementById('pipelineView').style.display !== 'none') renderPipeline();
    } catch (err) {
        console.error('deleteDemoSite error:', err);
        showToast('Failed to delete: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
};

window.sendDemo = function(leadId) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead || !lead['Demo Site URL']) {
        showToast('No deployed demo site found for this lead.', 'warning');
        return;
    }
    const demoUrl  = lead['Demo Site URL'];

    const msgTelugu = `నమస్కారం సర్,\n\nమన చర్చను అనుసరించి, మీ ప్లాట్‌ఫారమ్ కోసం ప్రతిపాదిత దిశను ప్రదర్శించడానికి మేము ఒక లైవ్ ప్రోటోటైప్‌ను సృష్టించాము:\n\n${demoUrl}\n\nఇది వినియోగదారు అనుభవం, నిర్మాణం మరియు స్కేలబిలిటీ విధానాన్ని ప్రదర్శిస్తుంది.\n\nఫీచర్లు, బ్రాండింగ్ మరియు ఆప్టిమైజేషన్లతో సహా, తుది ఉత్పత్తి మీ అవసరాలకు అనుగుణంగా పూర్తిగా అనుకూలీకరించబడుతుంది.\n\nపూర్తిస్థాయి అభివృద్ధిలోకి వెళ్లే ముందు దీనిని మరింత మెరుగుపరచడానికి మీ అభిప్రాయాన్ని మేము అభినందిస్తాము.\n\nధన్యవాదాలు,\nవిజయ్ కళ్యాణ్ ఎన్\nస్ట్రాటజీ కన్సల్టెంట్ | డారియన్ టెక్నాలజీస్\nఫోన్: (929) 136-3204\ntech.darion.in`;

    const msgEnglish = `Hi Sir,\n\nFollowing our discussion, we've created a live prototype to present the proposed direction for your platform:\n\n${demoUrl}\n\nThis showcases the user experience, structure, and scalability approach.\n\nThe final product will be fully customized to your requirements, including features, branding, and optimizations.\n\nWe would appreciate your feedback to refine this further before moving into full development.\n\nRegards,\nVijay Kalyan N\nStrategy Consultant | Darion Technologies\nP: (929) 136-3204\ntech.darion.in`;

    if (lead.Phone && lead.Phone.trim().length >= 4) {
        const cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
        // Open Telugu message first, English message 300 ms later
        // (small delay prevents browsers from blocking the second popup)
        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msgTelugu)}`, '_blank');
        setTimeout(() => {
            window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msgEnglish)}`, '_blank');
        }, 300);
        showToast('Opening WhatsApp — Telugu & English messages sent!', 'success');
    } else {
        // No phone — copy both messages to clipboard
        const combined = msgTelugu + '\n\n---\n\n' + msgEnglish;
        navigator.clipboard.writeText(combined).then(() => {
            showToast('Both messages copied to clipboard (no phone on record).', 'success');
        }).catch(() => {
            let ta = document.createElement('textarea');
            ta.value = combined;
            ta.style.position = 'fixed';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
            showToast('Both messages copied to clipboard.', 'success');
        });
    }
};

// Copy both Telugu + English demo messages to clipboard
window.copyDemoMessages = function(leadId) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead || !lead['Demo Site URL']) {
        showToast('No deployed demo site found for this lead.', 'warning');
        return;
    }
    const demoUrl = lead['Demo Site URL'];

    const msgTelugu = `నమస్కారం సర్,\n\nమన చర్చను అనుసరించి, మీ ప్లాట్‌ఫారమ్ కోసం ప్రతిపాదిత దిశను ప్రదర్శించడానికి మేము ఒక లైవ్ ప్రోటోటైప్‌ను సృష్టించాము:\n\n${demoUrl}\n\nఇది వినియోగదారు అనుభవం, నిర్మాణం మరియు స్కేలబిలిటీ విధానాన్ని ప్రదర్శిస్తుంది.\n\nఫీచర్లు, బ్రాండింగ్ మరియు ఆప్టిమైజేషన్లతో సహా, తుది ఉత్పత్తి మీ అవసరాలకు అనుగుణంగా పూర్తిగా అనుకూలీకరించబడుతుంది.\n\nపూర్తిస్థాయి అభివృద్ధిలోకి వెళ్లే ముందు దీనిని మరింత మెరుగుపరచడానికి మీ అభిప్రాయాన్ని మేము అభినందిస్తాము.\n\nధన్యవాదాలు,\nవిజయ్ కళ్యాణ్ ఎన్\nస్ట్రాటజీ కన్సల్టెంట్ | డారియన్ టెక్నాలజీస్\nఫోన్: (929) 136-3204\ntech.darion.in`;

    const msgEnglish = `Hi Sir,\n\nFollowing our discussion, we've created a live prototype to present the proposed direction for your platform:\n\n${demoUrl}\n\nThis showcases the user experience, structure, and scalability approach.\n\nThe final product will be fully customized to your requirements, including features, branding, and optimizations.\n\nWe would appreciate your feedback to refine this further before moving into full development.\n\nRegards,\nVijay Kalyan N\nStrategy Consultant | Darion Technologies\nP: (929) 136-3204\ntech.darion.in`;

    const combined = msgTelugu + '\n\n---\n\n' + msgEnglish;
    navigator.clipboard.writeText(combined).then(() => {
        showToast('Both messages copied to clipboard!', 'success');
    }).catch(() => {
        let ta = document.createElement('textarea');
        ta.value = combined;
        ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
        showToast('Both messages copied to clipboard!', 'success');
    });
};

// Copy phone number to clipboard
window.copyPhone = function(phone) {
    if (!phone || phone === 'No info') return;
    navigator.clipboard.writeText(phone).then(() => {
        showToast('Phone copied: ' + phone, 'success');
    }).catch(() => {
        let ta = document.createElement('textarea');
        ta.value = phone;
        ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
        showToast('Phone copied!', 'success');
    });
};
window.viewDemoWeb = async function(id) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead) return;
    showToast('Initializing Demo Website...', 'info');

    const name = lead.Name || 'Unnamed Lead';
    const payload = {
        title:     name,
        contact:   lead.Phone    || 'N/A',
        email:     lead.Email    || '',
        location:  lead.Location || '',
        address:   lead.Location || '',
        details:   lead['Category (Pitch Angle)'] || lead.Notes || '',
        logo_text: name.substring(0, 2).toUpperCase()
    };

    try {
        const res = await fetch(`${BACKEND_URL}/client/create`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const data = await res.json();
        const clientId = data.id;

        showToast('Demo site ready! Opening...', 'success');
        window.open(`${BACKEND_URL}/select/${clientId}?lead=${id}`, '_blank', 'noopener=0,noreferrer=0,opener');
    } catch (err) {
        console.error('Demo Web error:', err);
        showToast(`Failed to create demo site: ${err.message}`, 'error');
    }
};

window.shareLead = function(id) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead) return;

    const name = lead.Name || 'Unnamed Lead';
    const phone = lead.Phone || '';
    const email = lead.Email || '';
    const status = lead['Lead Status'] || 'New';
    const priority = (lead['Follow-Up Priority (Auto)'] || 'Low').replace(/[^a-zA-Z ]/g, '').trim();
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(name)}`;

    const shareText = [
        `Lead: ${name}`,
        phone   ? `Phone: ${phone}`  : '',
        email   ? `Email: ${email}`  : '',
        `Status: ${status}`,
        `Priority: ${priority}`,
        `Search: ${searchUrl}`
    ].filter(Boolean).join('\n');

    if (navigator.share) {
        navigator.share({ title: name, text: shareText })
            .catch(() => {}); // user cancelled – ignore
    } else {
        navigator.clipboard.writeText(shareText).then(() => {
            const btn = document.activeElement;
            const orig = btn.innerHTML;
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>Copied!`;
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        }).catch(() => {
            // Final fallback: textarea copy
            let ta = document.createElement('textarea');
            ta.value = shareText;
            ta.style.position = 'fixed';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
        });
    }
};

// === EXPORT CSV === //
window.exportFilteredCSV = function() {
    if (!visuallyFilteredLeads.length) {
        showToast('No leads to export', 'warning');
        return;
    }
    const keys = Object.keys(visuallyFilteredLeads[0]).filter(k => !k.startsWith('_'));
    const rows = [
        keys.map(k => `"${k}"`).join(','),
        ...visuallyFilteredLeads.map(l =>
            keys.map(k => `"${(l[k] || '').replace(/"/g, '""')}"`).join(',')
        )
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leads_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Exported ${visuallyFilteredLeads.length} leads`, 'success');
};

// === DUE TODAY FILTER === //
window.filterDueToday = function() {
    const today = new Date().toISOString().split('T')[0];
    dueTodayMode = true;
    visuallyFilteredLeads = globalLeads.filter(l =>
        (l['Reminder Flag (Auto)'] || '').includes('DUE TODAY') ||
        (l['Next Follow-Up Date'] || '').startsWith(today)
    );
    currentPage = 1;
    renderTable();
    showToast(`${visuallyFilteredLeads.length} leads due today`, visuallyFilteredLeads.length > 0 ? 'warning' : 'info');
};

// === INLINE STATUS UPDATE === //
window.quickUpdateStatus = function(id, status) {
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if (!lead || lead['Lead Status'] === status) return;
    const oldStatus = lead['Lead Status'] || 'New';
    lead['Lead Status'] = status; // Optimistic update
    const logMsg  = `Status changed: ${oldStatus} → ${status} (quick update)`;
    const newNotes = _buildLogEntry(lead, logMsg);
    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'Lead ID': id, 'Lead Status': status, 'Follow-Up Notes': newNotes })
    })
    .then(() => { lead['Follow-Up Notes'] = newNotes; showToast(`Status updated to ${status}`, 'success'); })
    .catch(() => showToast('Failed to update status', 'error'));
};

// === NEW LEAD MODAL === //
window.openNewLeadModal = function() {
    // Clear fields
    ['nlName','nlPhone','nlEmail','nlLocation','nlCategory','nlNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const p = document.getElementById('nlPriority');
    if (p) p.value = 'Medium';
    document.getElementById('newLeadModal').style.display = 'block';
    setTimeout(() => document.getElementById('nlName').focus(), 100);
};

window.closeNewLeadModal = function() {
    document.getElementById('newLeadModal').style.display = 'none';
};

window.saveNewLead = function() {
    const name = (document.getElementById('nlName').value || '').trim();
    if (!name) { showToast('Lead name is required.', 'warning'); return; }
    
    const btn = document.getElementById('saveNewLeadBtn');
    btn.innerText = 'Creating...';
    btn.disabled = true;

    const lastIdNum = globalLeads.reduce((max, lead) => {
        if (!lead['Lead ID']) return max;
        const parts = lead['Lead ID'].split('-');
        if(parts.length > 1 && !isNaN(parts[1])) return Math.max(max, parseInt(parts[1]));
        return max;
    }, 1000);
    const newId = `L-${lastIdNum + 1}`;

    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    const notes = document.getElementById('nlNotes').value.trim();
    const initialNote = notes ? `[${timestamp}] ${notes}` : '';
    const phone = document.getElementById('nlPhone').value.trim();

    const payload = {
        'Lead ID': newId,
        'Name':     name,
        'Phone':    phone,
        'Email':    document.getElementById('nlEmail').value.trim(),
        'Source':   'Manual Entry',
        'Location': document.getElementById('nlLocation').value.trim(),
        'Lead Status': 'New',
        'Combined Score': '',
        'Category (Pitch Angle)': document.getElementById('nlCategory').value.trim(),
        'Website': '',
        'Has WhatsApp': '',
        'Is Website Poor': '',
        'Budget': '',
        'Requirement Type': '',
        'Urgency Level': '',
        'Last Contacted Date': '',
        'Next Follow-Up Date': '',
        'Follow-Up Count': '0',
        'Follow-Up Notes': initialNote,
        'Preferred Contact': phone ? 'Phone' : 'Email',
        'Stage': 'New',
        'Assigned Salesperson': '',
        'Expected Value': '',
        'Probability (%)': '',
        'Days Since Contact': '',
        'Follow-Up Priority (Auto)': document.getElementById('nlPriority').value,
        'Reminder Flag (Auto)': 'Scheduled'
    };

    fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        showToast(`Lead "${name}" created (${newId})`, 'success');
        closeNewLeadModal();
        loadData(false);
    })
    .catch(e => {
        showToast('Failed to create lead: ' + e.message, 'error');
    })
    .finally(() => {
        btn.innerText = 'Create Lead';
        btn.disabled = false;
    });
};

// Close new lead modal on outside click
window.addEventListener('click', function(event) {
    const m = document.getElementById('newLeadModal');
    if (event.target === m) closeNewLeadModal();
});


// ============================================================
// PROFILE PAGE
// ============================================================

function loadProfileView() {
    const user = window.currentUser;
    if (!user) return;

    // Avatar & header chip
    const initial = (user.fullName || user.email || '?').charAt(0).toUpperCase();
    const avatar = document.getElementById('profileAvatar');
    const nameDisplay = document.getElementById('profileNameDisplay');
    const emailDisplay = document.getElementById('profileEmailDisplay');
    const roleDisplay = document.getElementById('profileRoleDisplay');

    if (avatar)      avatar.textContent      = initial;
    if (nameDisplay) nameDisplay.textContent  = user.fullName || user.email;
    if (emailDisplay) emailDisplay.textContent = user.email;
    if (roleDisplay) {
        roleDisplay.textContent = user.role === 'super_admin' ? 'Super Admin' : 'Sales Manager';
        roleDisplay.style.background = user.role === 'super_admin' ? '#f3e8ff' : '#e0f2fe';
        roleDisplay.style.color      = user.role === 'super_admin' ? '#7e22ce' : '#0369a1';
    }

    // Fill editable fields
    const fullNameInput = document.getElementById('profileFullName');
    const phoneInput    = document.getElementById('profilePhone');
    const jobTitleInput = document.getElementById('profileJobTitle');
    const emailInput    = document.getElementById('profileEmail');
    const roleInput     = document.getElementById('profileRole');
    const sinceInput    = document.getElementById('profileMemberSince');

    if (fullNameInput) fullNameInput.value = user.fullName || '';
    if (phoneInput)    phoneInput.value    = localStorage.getItem('profile_phone_' + user.id) || '';
    if (jobTitleInput) jobTitleInput.value = localStorage.getItem('profile_jobTitle_' + user.id) || '';
    if (emailInput)    emailInput.value    = user.email    || '';
    if (roleInput)     roleInput.value     = user.role === 'super_admin' ? 'Super Admin' : 'Sales Manager';

    // Load App Preferences
    const prefTheme = document.getElementById('prefTheme');
    const prefDefaultView = document.getElementById('prefDefaultView');
    const prefHaptics = document.getElementById('prefHaptics');

    if (prefTheme) prefTheme.value = localStorage.getItem('darion_theme') || 'system';
    if (prefDefaultView) prefDefaultView.value = localStorage.getItem('darion_defaultView') || 'dashboard';
    if (prefHaptics) prefHaptics.value = localStorage.getItem('darion_haptics') || 'enabled';


    // Fetch member since from Supabase auth metadata
    _sb.auth.getUser().then(({ data }) => {
        if (data?.user?.created_at && sinceInput) {
            const d = new Date(data.user.created_at);
            sinceInput.value = d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
        }
    });

    // Password strength listener
    const passInput = document.getElementById('profileNewPass');
    if (passInput) {
        passInput.removeEventListener('input', _passStrengthHandler);
        passInput.addEventListener('input', _passStrengthHandler);
    }
}

function _passStrengthHandler(e) {
    const val = e.target.value;
    const bar  = document.getElementById('passStrengthBar');
    const fill = document.getElementById('passStrengthFill');
    const lbl  = document.getElementById('passStrengthLabel');
    if (!bar || !fill || !lbl) return;

    if (!val) {
        bar.style.display = 'none';
        lbl.style.display = 'none';
        return;
    }
    bar.style.display = 'block';
    lbl.style.display = 'block';

    let score = 0;
    if (val.length >= 8)  score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const levels = [
        { width: '20%', color: '#ef4444', label: 'Very Weak' },
        { width: '40%', color: '#f97316', label: 'Weak' },
        { width: '65%', color: '#eab308', label: 'Moderate' },
        { width: '85%', color: '#22c55e', label: 'Strong' },
        { width: '100%',color: '#10b981', label: 'Very Strong' },
    ];
    const lvl = levels[Math.min(score, 4)];
    fill.style.width      = lvl.width;
    fill.style.background = lvl.color;
    lbl.textContent       = `Password strength: ${lvl.label}`;
    lbl.style.color       = lvl.color;
}

window.saveProfileInfo = async function() {
    const btn  = document.getElementById('saveProfileBtn');
    const name = (document.getElementById('profileFullName').value || '').trim();
    const phone = (document.getElementById('profilePhone').value || '').trim();
    const jobTitle = (document.getElementById('profileJobTitle').value || '').trim();
    if (!name) { showToast('Full name is required.', 'warning'); return; }

    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const { error } = await _sb
            .from('profiles')
            .update({ full_name: name })
            .eq('id', window.currentUser.id);

        if (error) throw error;

        // Update local cache & header chip
        window.currentUser.fullName = name;
        localStorage.setItem('profile_phone_' + window.currentUser.id, phone);
        localStorage.setItem('profile_jobTitle_' + window.currentUser.id, jobTitle);
        const disp = document.getElementById('userDisplayName');
        const av   = document.getElementById('userAvatar');
        const pnm  = document.getElementById('profileNameDisplay');
        const pav  = document.getElementById('profileAvatar');
        if (disp) disp.textContent = name;
        if (av)   av.textContent   = name.charAt(0).toUpperCase();
        if (pnm)  pnm.textContent  = name;
        if (pav)  pav.textContent  = name.charAt(0).toUpperCase();
        showToast('Profile updated successfully.', 'success');
    } catch (err) {
        showToast('Failed to save: ' + err.message, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = origHtml;
    }
};

window.savePreferences = function() {
    const prefTheme = document.getElementById('prefTheme');
    const prefDefaultView = document.getElementById('prefDefaultView');
    const prefHaptics = document.getElementById('prefHaptics');

    if (prefTheme) {
        localStorage.setItem('darion_theme', prefTheme.value);
        if (prefTheme.value === 'dark') {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    }
    if (prefDefaultView) {
        localStorage.setItem('darion_defaultView', prefDefaultView.value);
    }
    if (prefHaptics) {
        localStorage.setItem('darion_haptics', prefHaptics.value);
        if (prefHaptics.value === 'enabled') {
            triggerHaptic('success');
        }
    }
    showToast('Preferences saved.', 'success');
};

window.changePassword = async function() {
    const btn      = document.getElementById('changePassBtn');
    const newPass  = (document.getElementById('profileNewPass').value  || '');
    const confPass = (document.getElementById('profileConfirmPass').value || '');

    if (!newPass)  { showToast('Please enter a new password.', 'warning'); return; }
    if (newPass.length < 8) { showToast('Password must be at least 8 characters.', 'warning'); return; }
    if (newPass !== confPass) { showToast('Passwords do not match.', 'error'); return; }

    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
        const { error } = await _sb.auth.updateUser({ password: newPass });
        if (error) throw error;
        document.getElementById('profileNewPass').value   = '';
        document.getElementById('profileConfirmPass').value = '';
        // Reset strength bar
        const bar = document.getElementById('passStrengthBar');
        const lbl = document.getElementById('passStrengthLabel');
        if (bar) bar.style.display = 'none';
        if (lbl) lbl.style.display = 'none';
        showToast('Password updated successfully.', 'success');
    } catch (err) {
        showToast('Failed to update password: ' + err.message, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = origHtml;
    }
};

window.togglePassVis = function(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    // Swap icon svg between eye and eye-off
    btn.innerHTML = isPass
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
};

// ═══════════════════════════════════════════════════
//  ACTIVITY LOG HELPER
// ═══════════════════════════════════════════════════

/**
 * Prepends a timestamped log line to a lead's Follow-Up Notes (in memory only).
 * Call this before any fetch('/api/update') to include the new notes in the payload.
 * Returns the new combined notes string.
 */
function _buildLogEntry(lead, message) {
    const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    const user = window.currentUser ? (window.currentUser.fullName || window.currentUser.email || 'System') : 'System';
    const entry = `[${ts}] {${user}} ${message}`;
    const existing = lead ? (lead['Follow-Up Notes'] || '') : '';
    return existing ? `${entry}\n---\n${existing}` : entry;
}

// ═══════════════════════════════════════════════════
//  REGION BULK ACTION
// ═══════════════════════════════════════════════════

window.openRegionActionModal = function() {
    const citySelect = document.getElementById('regionActionCity');
    if (!citySelect) return;

    // Populate from all distinct _computedCity values in globalLeads
    const cities = [...new Set(globalLeads.map(l => l._computedCity).filter(Boolean))].sort();
    citySelect.innerHTML = '<option value="">-- Select Region --</option>';
    cities.forEach(c => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = c;
        citySelect.appendChild(opt);
    });

    // Reset count chip + disable apply btn
    const countEl = document.getElementById('regionLeadCount');
    const applyBtn = document.getElementById('applyRegionActionBtn');
    if (countEl) { countEl.style.display = 'none'; countEl.textContent = ''; }
    if (applyBtn) applyBtn.disabled = true;

    document.getElementById('regionActionModal').style.display = 'block';
};

window.closeRegionActionModal = function() {
    document.getElementById('regionActionModal').style.display = 'none';
};

window.updateRegionCount = function() {
    const city    = document.getElementById('regionActionCity').value;
    const countEl = document.getElementById('regionLeadCount');
    const applyBtn = document.getElementById('applyRegionActionBtn');

    if (!city) {
        if (countEl) { countEl.style.display = 'none'; }
        if (applyBtn) applyBtn.disabled = true;
        return;
    }

    const count = globalLeads.filter(l => l._computedCity === city).length;
    if (countEl) {
        countEl.textContent = `${count} lead${count !== 1 ? 's' : ''} in "${city}" will be updated.`;
        countEl.style.display = 'block';
    }
    if (applyBtn) {
        applyBtn.disabled = (count === 0);
        applyBtn.textContent = `Apply to All ${count} Lead${count !== 1 ? 's' : ''}`;
    }
};

window.applyRegionAction = async function() {
    const city      = document.getElementById('regionActionCity').value;
    const newStatus = document.getElementById('regionActionStatus').value;
    const applyBtn  = document.getElementById('applyRegionActionBtn');
    if (!city || !newStatus) return;

    const affected = globalLeads.filter(l => l._computedCity === city);
    if (affected.length === 0) return;

    const confirmed = confirm(
        `Mark all ${affected.length} leads in "${city}" as "${newStatus}"?\n\nThis cannot be undone easily.`
    );
    if (!confirmed) return;

    applyBtn.disabled = true;
    applyBtn.textContent = 'Updating...';
    showToast(`Updating ${affected.length} leads in ${city}...`, 'info');

    try {
        const leadIds = affected.map(l => l['Lead ID']);

        // Build a shared log note for the region closure
        const ts      = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
        const logLine = `[SYS] Region bulk update: "${city}" → ${newStatus}`;

        const res = await fetch('/api/bulk-update', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ leadIds, fields: { 'Lead Status': newStatus } })
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || `Bulk update failed: ${res.status}`);
        }

        // Update in-memory state + prepend log entry per lead
        globalLeads.forEach(l => {
            if (l._computedCity === city) {
                l['Lead Status']    = newStatus;
                l['Follow-Up Notes'] = _buildLogEntry(l, logLine);
            }
        });

        // Persist the updated notes for each affected lead (fire-and-forget)
        affected.forEach(l => {
            fetch('/api/update', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ 'Lead ID': l['Lead ID'], 'Follow-Up Notes': l['Follow-Up Notes'] })
            }).catch(() => {});
        });

        // Re-render
        lastDataFingerprint = '';
        applyFilters();

        closeRegionActionModal();
        showToast(`${affected.length} leads in "${city}" marked as "${newStatus}".`, 'success');

    } catch (err) {
        console.error('applyRegionAction error:', err);
        showToast('Bulk update failed: ' + err.message, 'error');
        applyBtn.disabled = false;
        applyBtn.textContent = `Apply to All ${affected.length} Leads`;
    }

};

// ============================================================
// ANALYTICS
// ============================================================
let leadsTimelineChartInstance = null;

window.renderAnalytics = function() {
    const analyticsView = document.getElementById('analyticsView');
    if (!analyticsView || analyticsView.style.display === 'none') return;

    const leads = globalLeads;

    let totalLeads = leads.length;
    let activeLeads = 0;
    let dealsClosed = 0;

    const salespersonCounts = {};
    const timelineCounts = {}; // YYYY-MM-DD -> count

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0,0,0,0);

    leads.forEach(l => {
        const status = (l['Lead Status'] || '').trim();
        if (status !== 'Closed' && status !== 'Not Interested' && status !== 'Duplicate') {
            activeLeads++;
        }
        if (status === 'Closed') {
            dealsClosed++;
            const creator = _getLeadCreator(l);
            salespersonCounts[creator] = (salespersonCounts[creator] || 0) + 1;
        }

        const createDateObj = _getLeadCreationDate(l); // returns Date object
        if (createDateObj) {
            if (createDateObj >= thirtyDaysAgo) {
                const createDateStr = new Date(createDateObj.getTime() - (createDateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                timelineCounts[createDateStr] = (timelineCounts[createDateStr] || 0) + 1;
            }
        }
    });

    const conversionRate = totalLeads > 0 ? ((dealsClosed / totalLeads) * 100).toFixed(1) : '0.0';

    // Update DOM
    document.getElementById('metricTotalLeads').textContent = totalLeads;
    document.getElementById('metricActiveLeads').textContent = activeLeads;
    document.getElementById('metricDealsClosed').textContent = dealsClosed;
    document.getElementById('metricConversion').textContent = conversionRate + '%';

    // Render Timeline Chart
    const timelineLabels = [];
    const timelineData = [];
    // Generate last 30 days array to ensure 0s are filled
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        timelineLabels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        timelineData.push(timelineCounts[dateStr] || 0);
    }

    const canvasEl = document.getElementById('leadsTimelineChart');
    if (canvasEl) {
        const ctx = canvasEl.getContext('2d');
        if (leadsTimelineChartInstance) leadsTimelineChartInstance.destroy();

        leadsTimelineChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timelineLabels,
                datasets: [{
                    label: 'New Leads',
                    data: timelineData,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    pointBackgroundColor: '#2563eb',
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    // Render Leaderboard
    const lbContainer = document.getElementById('leaderboardContainer');
    if (lbContainer) {
        lbContainer.innerHTML = '';
        const sortedSales = Object.entries(salespersonCounts).sort((a,b) => b[1] - a[1]);
        if (sortedSales.length === 0) {
            lbContainer.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">No closed deals yet.</div>';
        } else {
            const maxDeals = sortedSales[0][1];
            sortedSales.forEach(([name, count], index) => {
                if (name === 'Unknown User') name = 'Legacy / System';
                const percent = (count / maxDeals) * 100;
                
                let rankBadge = '';
                if (index === 0) rankBadge = '<span style="background:#fef08a; color:#854d0e; padding:2px 6px; border-radius:12px; font-size:10px; font-weight:700;">#1</span>';
                else if (index === 1) rankBadge = '<span style="background:#e5e7eb; color:#374151; padding:2px 6px; border-radius:12px; font-size:10px; font-weight:700;">#2</span>';
                else if (index === 2) rankBadge = '<span style="background:#fed7aa; color:#9a3412; padding:2px 6px; border-radius:12px; font-size:10px; font-weight:700;">#3</span>';

                lbContainer.innerHTML += `
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <div style="display:flex; justify-content:space-between; font-size:13px;">
                            <span style="font-weight:600; color:var(--text-main); display:flex; align-items:center; gap:6px;">${name} ${rankBadge}</span>
                            <span style="font-weight:700; color:var(--brand-primary);">${count} deals</span>
                        </div>
                        <div style="height:6px; background:var(--border-color); border-radius:3px; overflow:hidden;">
                            <div style="height:100%; width:${percent}%; background:var(--brand-primary); border-radius:3px;"></div>
                        </div>
                    </div>
                `;
            });
        }
    }
};

window.bulkAssignSelectedLeads = async function() {
    const assignTo = document.getElementById('bulkAssignSelect').value;
    if (!assignTo) {
        showToast('Please select a salesperson to assign.', 'warning');
        return;
    }

    if (selectedLeadIds.size === 0) return;

    const confirmed = confirm(`Assign ${selectedLeadIds.size} leads to ${assignTo}?`);
    if (!confirmed) return;

    const ids = Array.from(selectedLeadIds);
    showToast(`Assigning ${ids.length} leads...`, 'info');

    try {
        const logLine = `[SYS] Assigned to ${assignTo}`;

        const res = await fetch('/api/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadIds: ids, fields: { 'Assigned Salesperson': assignTo } })
        });

        if (!res.ok) throw new Error('Failed to bulk assign leads.');

        // Update in memory and logs
        globalLeads.forEach(l => {
            if (ids.includes(l['Lead ID'])) {
                l['Assigned Salesperson'] = assignTo;
                l['Follow-Up Notes'] = _buildLogEntry(l, logLine);
            }
        });

        // Fire-and-forget logs
        ids.forEach(id => {
            const l = globalLeads.find(x => x['Lead ID'] === id);
            if (l) {
                fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 'Lead ID': id, 'Follow-Up Notes': l['Follow-Up Notes'] })
                }).catch(() => {});
            }
        });

        clearSelection();
        applyFilters();
        showToast(`${ids.length} leads assigned to ${assignTo}.`, 'success');
        document.getElementById('bulkAssignSelect').value = '';

    } catch (err) {
        console.error('bulkAssign error:', err);
        showToast(err.message, 'error');
    }
};

window.sendWhatsAppTemplate = function(leadId) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead || !lead.Phone) {
        showToast('This lead does not have a valid phone number.', 'warning');
        return;
    }

    const template = document.getElementById('whatsappTemplate').value;
    const name = lead.Name || 'there';
    
    let text = '';
    if (template === 'welcome') {
        text = `Hi ${name},\n\nI'm ${window.currentUser?.fullName || 'reaching out'} from Darion CRM. I'd love to connect and see how we can help your business grow. Do you have 5 minutes to chat?`;
    } else if (template === 'demo') {
        text = `Hi ${name},\n\nFollowing up on the demo we prepared for you! Have you had a chance to check it out? Let me know if you have any questions.\n\n${lead['Demo Site URL'] || ''}`;
    } else if (template === 'checkin') {
        text = `Hi ${name},\n\nJust checking in to see how things are going. Let me know if you need anything from our end!`;
    }

    // Clean phone number (remove spaces, plus, hyphens)
    const phoneClean = lead.Phone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${phoneClean}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
};

window.sendEmailTemplate = function(leadId) {
    const lead = globalLeads.find(l => l['Lead ID'] === leadId);
    if (!lead || !lead.Email) {
        showToast('This lead does not have a valid email address.', 'warning');
        return;
    }

    const template = document.getElementById('emailTemplate').value;
    const name = lead.Name || 'there';
    
    let subject = '';
    let body = '';
    
    if (template === 'welcome') {
        subject = `Introduction: Helping ${name} grow!`;
        body = `Hi ${name},\n\nI'm ${window.currentUser?.fullName || 'reaching out'} from Darion CRM. I wanted to formally introduce myself and see how we can align our services to help your business reach the next level.\n\nWould you be open to a brief introductory call next week?\n\nBest regards,\n${window.currentUser?.fullName || 'Sales Team'}`;
    } else if (template === 'demo') {
        subject = `Your Custom Demo is Ready!`;
        body = `Hi ${name},\n\nGreat news! The custom demo site we discussed is now ready for your review.\n\nYou can access it here: ${lead['Demo Site URL'] || '(Link Pending)'}\n\nPlease let me know your thoughts or if you'd like to schedule a walkthrough call.\n\nBest regards,\n${window.currentUser?.fullName || 'Sales Team'}`;
    } else if (template === 'checkin') {
        subject = `Checking in from Darion CRM`;
        body = `Hi ${name},\n\nI hope you're having a great week.\n\nJust floating this to the top of your inbox to see if you had any updates on our previous conversation. Let me know if there's anything I can assist with!\n\nBest regards,\n${window.currentUser?.fullName || 'Sales Team'}`;
    }

    const url = `mailto:${lead.Email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank');
};

// ============================================================
// CALENDAR VIEW
// ============================================================
let currentCalendarDate = new Date(); // Represents the currently viewed month

window.changeCalendarMonth = function(offset) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + offset);
    renderCalendar();
};

window.resetCalendarMonth = function() {
    currentCalendarDate = new Date();
    renderCalendar();
};

window.renderCalendar = function() {
    const calendarView = document.getElementById('calendarView');
    if (!calendarView || calendarView.style.display === 'none') return;

    const monthLabel = document.getElementById('calendarMonthLabel');
    const grid = document.getElementById('calendarGrid');
    if (!monthLabel || !grid) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    // Update Header Label
    monthLabel.textContent = currentCalendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Calculate Grid Dates
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    
    // Day of week for 1st of month (0 = Sun, 1 = Mon...)
    const startOffset = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();

    // Collect all leads with a scheduled date
    const tasks = [];
    globalLeads.forEach(l => {
        if (l['Lead Status'] === 'Closed' || l['Lead Status'] === 'Duplicate' || l['Lead Status'] === 'Not Interested') return;
        const dateStr = l['Next Follow-Up Date'];
        if (!dateStr) return;
        
        const d = new Date(dateStr);
        // Normalize time to compare
        d.setHours(0,0,0,0);
        
        tasks.push({
            leadId: l['Lead ID'],
            name: l.Name || 'Unnamed',
            priority: l['Follow-Up Priority (Auto)'] || '',
            date: d.getTime()
        });
    });

    let html = '';
    const todayMs = new Date().setHours(0,0,0,0);

    // Render cells
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7; // Always full rows
    for (let i = 0; i < totalCells; i++) {
        // Calculate the actual date for this cell
        const cellDate = new Date(year, month, 1 - startOffset + i);
        cellDate.setHours(0,0,0,0);
        const cellMs = cellDate.getTime();

        const isCurrentMonth = cellDate.getMonth() === month;
        const isToday = cellMs === todayMs;

        // Find tasks for this day
        const dayTasks = tasks.filter(t => t.date === cellMs);

        // Build task HTML
        let tasksHtml = '';
        dayTasks.forEach(t => {
            const isHigh = t.priority.includes('High');
            tasksHtml += `
                <div class="calendar-task ${isHigh ? 'high-priority' : ''}" onclick="event.stopPropagation(); viewLead('${t.leadId}')" title="${t.name}">
                    ${t.name}
                </div>
            `;
        });

        html += `
            <div class="calendar-day ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''}">
                <div class="day-number">${cellDate.getDate()}</div>
                <div style="flex:1; display:flex; flex-direction:column; gap:4px; overflow-y:auto;">
                    ${tasksHtml}
                </div>
            </div>
        `;
    }

    grid.innerHTML = html;
};

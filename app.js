let globalLeads = [];
let chartInstance = null;
let editingLeadId = null;
let lastDataFingerprint = '';

let currentSearch = '';
let currentCityFilter = 'All';
let currentStatusFilter = 'All';
let currentPriorityFilter = 'All';
let currentServiceFilter = 'All';

let visuallyFilteredLeads = [];
let currentPage = 1;
const itemsPerPage = 20;

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    loadData(false);

    document.getElementById('searchLeads').addEventListener('input', (e) => {
        currentSearch = e.target.value.toLowerCase();
        applyFilters();
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
            alert(`Successfully imported ${data.added} new leads.`);
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Upload CSV Data`;
            document.getElementById('csvUploadInput').value = '';
            loadData(false);
        })
        .catch(err => {
            alert('Upload failed: ' + err);
            btn.innerHTML = 'Upload CSV Data';
        });
    });

    setInterval(() => loadData(true), 1500); 
});

function initNavigation() {
    const dBtn = document.getElementById('navDashboardBtn');
    const pBtn = document.getElementById('navPipelineBtn');
    if(!dBtn || !pBtn) return;
    
    dBtn.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('dashboardView').style.display = 'block';
        document.getElementById('pipelineView').style.display = 'none';
        dBtn.classList.add('active');
        pBtn.classList.remove('active');
    });

    pBtn.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('dashboardView').style.display = 'none';
        document.getElementById('pipelineView').style.display = 'flex';
        dBtn.classList.remove('active');
        pBtn.classList.add('active');
        renderPipeline();
    });
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
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">Fetching records...</td></tr>';
    }
    
    fetch('/api/leads')
    .then(res => res.json())
    .then(data => {
        if(data.error) throw new Error(data.error);
        
        const fingerprint = JSON.stringify(data);
        if(isSilentPolling && fingerprint === lastDataFingerprint) {
            return; 
        }
        lastDataFingerprint = fingerprint;

        globalLeads = data;
        populateCityFilter(globalLeads); 
        applyFilters(); 
        renderPipeline(); 
    })
    .catch(err => {
        console.error(err);
        if(!isSilentPolling) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 40px;">Connection failed. Is the server running?</td></tr>`;
        }
    });
}

function populateCityFilter(leads) {
    const citySet = new Set();
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
    });

    const select = document.getElementById('filterCity');
    if(!select) return;
    
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

function applyFilters() {
    const citySelect = document.getElementById('filterCity');
    const statusSelect = document.getElementById('filterStatus');
    const prioritySelect = document.getElementById('filterPriority');
    const serviceSelect = document.getElementById('filterService');
    
    currentCityFilter = citySelect ? citySelect.value : 'All';
    currentStatusFilter = statusSelect ? statusSelect.value : 'All';
    currentPriorityFilter = prioritySelect ? prioritySelect.value : 'All';
    currentServiceFilter = serviceSelect ? serviceSelect.value : 'All';

    visuallyFilteredLeads = globalLeads.filter(lead => {
        const matchSearch = 
            (lead.Name && lead.Name.toLowerCase().includes(currentSearch)) || 
            (lead.Phone && lead.Phone.toLowerCase().includes(currentSearch));
            
        const matchCity = (currentCityFilter === 'All') || (lead._computedCity === currentCityFilter);
        
        const leadStatus = lead['Lead Status'] || 'New';
        const matchStatus = (currentStatusFilter === 'All') || (leadStatus === currentStatusFilter);
        
        let priority = lead['Follow-Up Priority (Auto)'] || 'Low';
        let cleanPriority = priority.replace(/[^a-zA-Z]/g, '').trim();
        if(cleanPriority === '') cleanPriority = 'Scheduled';
        const matchPriority = (currentPriorityFilter === 'All') || (cleanPriority === currentPriorityFilter);

        let matchService = true;
        if(currentServiceFilter === 'Needs Website') {
            matchService = (lead['Is Website Poor'] === 'True' || lead['Is Website Poor'] === 'true' || !lead['Website']);
        } else if (currentServiceFilter === 'Has WhatsApp') {
            matchService = (lead['Has WhatsApp'] === 'True' || lead['Has WhatsApp'] === 'true');
        }

        return matchSearch && matchCity && matchStatus && matchPriority && matchService;
    });

    const maxPage = Math.ceil(visuallyFilteredLeads.length / itemsPerPage);
    if(currentPage > maxPage) currentPage = maxPage;
    if(currentPage < 1) currentPage = 1;

    updateDashboard(visuallyFilteredLeads);
    renderChart(visuallyFilteredLeads);
    renderTable();
    
    // Automatically redraw Pipeline Graphics & Cards if matching filters
    if(document.getElementById('pipelineView').style.display !== 'none') {
        renderPipeline();
    }
}

function updateDashboard(leads) {
    document.getElementById('totalLeads').innerText = leads.length.toLocaleString();
    const highPriority = leads.filter(l => l['Follow-Up Priority (Auto)'] && l['Follow-Up Priority (Auto)'].includes('High')).length;
    document.getElementById('highPriorityLeads').innerText = highPriority;
    const hotStr = new Date().toISOString().split('T')[0];
    const dueToday = leads.filter(l => {
        let flag = l['Reminder Flag (Auto)'] || '';
        let nextD = l['Next Follow-Up Date'] || '';
        return flag.includes('DUE TODAY') || nextD.startsWith(hotStr);
    }).length;
    document.getElementById('dueTodayLeads').innerText = dueToday;
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
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">No leads exactly match your filters.</td></tr>';
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
        
        let priorityText = lead['Follow-Up Priority (Auto)'] || 'Low';
        let badgeClass = 'low';
        if(priorityText.includes('High')) badgeClass = 'high';
        if(priorityText.includes('Medium')) badgeClass = 'medium';

        let cleanPriority = priorityText.replace(/[^a-zA-Z]/g, '').trim();
        if(cleanPriority === '') cleanPriority = 'Scheduled';

        let statusText = lead['Lead Status'] || 'New';
        let region = lead._computedCity || 'Unknown';
        if(region.length > 15) region = region.substring(0, 15) + '..';
        
        let actionsHtml = `<button class="btn-primary" onclick="viewLead('${lead['Lead ID']}')">Edit</button>`;
        if(lead.Phone && lead.Phone.trim().length >= 4) {
             let cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
             actionsHtml += `<a href="tel:${cleanPhone}" class="btn-success" style="text-decoration:none; margin-left:8px;">Call</a>`;
        }

        tr.innerHTML = `
            <td data-label="Lead Name" onclick="viewLead('${lead['Lead ID']}')" style="cursor:pointer;" title="Click to view/edit lead">
                <strong style="color:var(--brand-primary);">${lead.Name || 'Unnamed Lead'}</strong>
            </td>
            <td data-label="Contact"><div style="font-size:13px;">${lead.Phone || lead.Email || 'No info'}</div></td>
            <td data-label="Region"><span style="color:var(--text-muted); font-size: 13px;">${region}</span></td>
            <td data-label="Priority"><span class="badge ${badgeClass}">${cleanPriority}</span></td>
            <td data-label="Status"><span class="badge new">${statusText}</span></td>
            <td data-label="Manage" style="display:flex; justify-content:flex-end;">${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function updatePagination(curr, total, totalCount) {
    const el = document.getElementById('pageIndicator');
    if(!el) return;
    el.innerText = `Page ${curr} of ${total} (${totalCount} hits)`;
    
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    prevBtn.disabled = curr <= 1;
    nextBtn.disabled = curr >= total;
    
    prevBtn.style.opacity = curr <= 1 ? '0.4' : '1';
    prevBtn.style.cursor = curr <= 1 ? 'not-allowed' : 'pointer';
    
    nextBtn.style.opacity = curr >= total ? '0.4' : '1';
    nextBtn.style.cursor = curr >= total ? 'not-allowed' : 'pointer';
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
        { id: 'Not Interested', title: 'Not Interested', color: 'var(--accent-red)' },
        { id: 'Closed', title: 'Closed', color: '#10b981' },
        { id: 'Duplicate', title: 'Duplicate', color: '#6b7280' }
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
            if(lead.Phone && lead.Phone.trim().length >= 4) {
                let cleanPhone = lead.Phone.replace(/[^0-9+]/g, '');
                callLink = `<a href="tel:${cleanPhone}" title="Call" style="color:var(--accent-green); text-decoration:none; display:flex; align-items:center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                </a>`;
            }

            card.innerHTML = `
                <div class="kc-title">${lead.Name || 'Unnamed'}</div>
                <div class="kc-meta" style="margin-bottom: 12px; border-bottom: 1px solid #f3f4f6; padding-bottom: 8px;">${lead.Phone || lead.Email || 'No contact'}</div>
                <div class="kc-footer" style="border-top: none; padding-top: 0;">
                    <span class="badge ${badgeClass}">${cleanPriority}</span>
                    <div style="display:flex; gap:16px; align-items:center;">
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

    const leadUpdate = { 'Lead ID': leadId, 'Lead Status': targetStatus };

    // Fire network request. Polling automatically repaints. 
    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadUpdate)
    })
    .catch(e => alert('Network Error updating Database!'));
}

// === MODAL === //
function viewLead(id) {
    editingLeadId = id;
    const lead = globalLeads.find(l => l['Lead ID'] === id);
    if(!lead) return;

    document.getElementById('modalName').innerText = lead.Name || 'Unnamed Lead';
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
                    <option value="Not Interested" ${lead['Lead Status']=='Not Interested'?'selected':''}>Not Interested</option>
                    <option value="Closed" ${lead['Lead Status']=='Closed'?'selected':''}>Closed/Won</option>
                    <option value="Duplicate" ${lead['Lead Status']=='Duplicate'?'selected':''}>Duplicate</option>
                </select>
            </div>
            <div class="detail-item"><span class="label">Priority</span>
                <select id="editPriority" class="modal-input">
                    <option value="🔴 High" ${lead['Follow-Up Priority (Auto)'] && lead['Follow-Up Priority (Auto)'].includes('High')?'selected':''}>High</option>
                    <option value="🟡 Medium" ${lead['Follow-Up Priority (Auto)'] && lead['Follow-Up Priority (Auto)'].includes('Medium')?'selected':''}>Medium</option>
                    <option value="🟢 Low" ${!lead['Follow-Up Priority (Auto)'] || lead['Follow-Up Priority (Auto)'].includes('Low')?'selected':''}>Low</option>
                </select>
            </div>
        </div>
        <div class="divider"></div>
        <div class="detail-item" style="grid-column: 1 / -1;"><span class="label">Notes / Next Steps</span>
            <textarea id="editNotes" class="modal-input" placeholder="Type notes here..." style="height: 80px; resize: vertical;">${lead['Follow-Up Notes'] || ''}</textarea>
        </div>
        <div style="margin-top: 24px; display:flex; justify-content: flex-end;">
            <button class="btn-primary" id="saveLeadBtn" onclick="saveLead()">Save Changes</button>
        </div>
    `;

    document.getElementById('leadModal').style.display = 'block';
}

function saveLead() {
    if(!editingLeadId) return;
    const btn = document.getElementById('saveLeadBtn');
    btn.innerText = 'Saving...';
    
    const leadUpdate = {
        'Lead ID': editingLeadId,
        'Phone': document.getElementById('editPhone').value,
        'Email': document.getElementById('editEmail').value,
        'Lead Status': document.getElementById('editStatus').value,
        'Follow-Up Priority (Auto)': document.getElementById('editPriority').value,
        'Follow-Up Notes': document.getElementById('editNotes').value
    };

    fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadUpdate)
    })
    .then(r => r.json())
    .then(data => {
        if(data.status === 'success') {
            closeModal();
            loadData(); 
        } else {
            alert('Error updating: ' + data.error);
            btn.innerText = 'Save Changes';
        }
    })
    .catch(e => {
        alert('Network Error');
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

    const ctx = document.getElementById('sourceChart').getContext('2d');
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

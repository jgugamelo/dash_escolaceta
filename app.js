// State Management
let rawData = { matriculas: [], metas: [] };
let filteredData = [];
let currentTab = 'geral';
let customMeta = null; // Stores manually adjusted meta

// Active Charts Instances
let charts = {};

// Date Helpers
const ptMonths = {
    'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5,
    'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11
};
const ptMonthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Excel serial date converter
function excelDateToDate(excelNum) {
    // Excel base epoch: Dec 30, 1899
    const epoch = new Date(1899, 11, 30);
    const days = parseFloat(excelNum);
    const date = new Date(epoch.getTime() + days * 24 * 60 * 60 * 1000);
    return date;
}

// Robust Date Parser
function parseDate(dateStr) {
    if (!dateStr) return null;
    dateStr = dateStr.trim();
    
    // Check if Excel serial number
    if (/^\d+(\.\d+)?$/.test(dateStr)) {
        return excelDateToDate(dateStr);
    }
    
    // Check if ISO format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return new Date(dateStr + 'T00:00:00');
    }
    
    // Check if Portuguese string format: e.g., '2-jan.-2024' or '15-mar-2025' or '05/10/2024'
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            // DD/MM/YYYY
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        }
    }
    
    const cleanStr = dateStr.toLowerCase().replace(/\./g, '');
    const parts = cleanStr.split('-');
    if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const monthStr = parts[1];
        let year = parseInt(parts[2]);
        if (year < 100) year += 2000; // handle 2-digit years
        
        const month = ptMonths[monthStr];
        if (month !== undefined && !isNaN(day) && !isNaN(year)) {
            return new Date(year, month, day);
        }
    }
    
    return null;
}

// Financial parsing helpers
function parseMoney(valStr) {
    if (!valStr) return 0;
    let clean = valStr.toString().trim().replace('R$', '').replace(/\s/g, '');
    if (clean.includes(',')) {
        // e.g. 2.900,00 -> 2900.00
        clean = clean.replace(/\./g, '').replace(',', '.');
    }
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
}

function parsePercent(valStr) {
    if (!valStr) return 0;
    let clean = valStr.toString().trim().replace('%', '');
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
}

// Simple CSV Parser
function parseCSV(text) {
    let lines = [];
    let row = [""];
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        let c = text[i];
        let next = text[i+1];
        
        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') { i++; }
            lines.push(row);
            row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        lines.push(row);
    }
    return lines;
}

// Default monthly goal for Escola Ceta (Managers can edit this value directly here)
const DEFAULT_MONTHLY_GOAL = 80;
const TEAM_GOAL_1 = 35;
const TEAM_GOAL_2 = 42;

// App Initialization
window.addEventListener('load', async () => {
    await loadData();
    populateFilters();
    setQuickPeriod('current'); // Definição padrão de visualização (Mês Atual)
    
    // Setup date filter change listeners
    document.getElementById('filter-start-date').addEventListener('change', () => {
        clearQuickPeriodActiveState();
        applyFilters();
    });
    document.getElementById('filter-end-date').addEventListener('change', () => {
        clearQuickPeriodActiveState();
        applyFilters();
    });
    document.getElementById('filter-curso').addEventListener('change', applyFilters);
    document.getElementById('filter-consultor').addEventListener('change', applyFilters);
    document.getElementById('filter-turno').addEventListener('change', applyFilters);
    document.getElementById('filter-origem').addEventListener('change', applyFilters);

    // Auto-sync every 5 minutes (300000ms) silently in the background
    setInterval(async () => {
        console.log("Iniciando sincronização automática em segundo plano...");
        await loadData(false);
        applyFilters();
    }, 300000);
});

// Load data (Try Live Google Sheet first, fallback to data.j// Helper to process CSV string and populate rawData
function processCSVData(csvText) {
    const csvData = parseCSV(csvText);
    
    // Find header row in CSV (usually the third line in our data, or searching for '#')
    let headerIndex = -1;
    for (let i = 0; i < csvData.length; i++) {
        if (csvData[i] && csvData[i][0] === '#') {
            headerIndex = i;
            break;
        }
    }
    
    if (headerIndex === -1) throw new Error("Formato de cabeçalho da planilha inválido");
    
    const header = csvData[headerIndex];
    const rows = csvData.slice(headerIndex + 1);
    
    rawData.matriculas = [];
    rows.forEach(r => {
        if (r.length < 13) return;
        const id = r[0].trim();
        const aluno = r[1].trim();
        if (!aluno || aluno.toLowerCase().startsWith('aluno') || id === '#') return;
        
        const dateObj = parseDate(r[6]);
        if (!dateObj) return;
        
        let turno = r[4].trim();
        if (turno === 'Sãbado') turno = 'Sábado';
        if (turno === 'Semanal M') turno = 'Semanal';
        
        rawData.matriculas.push({
            id: id,
            aluno: aluno,
            curso: r[2].trim(),
            consultor: r[3].trim(),
            turno: turno,
            modulo: r[5].trim(),
            data: dateObj.toISOString().split('T')[0],
            origem: r[7].trim(),
            telefone: r[9].trim(),
            mensalidade1: parseMoney(r[10]),
            bolsa: parsePercent(r[11]),
            mensalidade_demais: parseMoney(r[12])
        });
    });
    
    // Load default metas since we only get sheet 1 from standard export?format=csv
    rawData.metas = [
        { mes: 'Jan', quantidade: 80 },
        { mes: 'Fev', quantidade: 80 },
        { mes: 'Mar', quantidade: 80 }
    ];
}

// Load data (Try Live Google Sheet first, fallback to data.json)
async function loadData(showOverlay = true) {
    const statusEl = document.getElementById('data-source-status');
    const loadingStatusEl = document.getElementById('loading-status');
    const googleSheetUrl = 'https://docs.google.com/spreadsheets/d/1U3wHuWiCkZfMaZ8B_-cZrlb3SjxAViHHCa0dVvyDyPw/export?format=csv';

    if (showOverlay && document.getElementById('loading-overlay')) {
        document.getElementById('loading-overlay').classList.remove('hidden');
    }

    try {
        // Attempt 1: Live Google Sheets CSV
        try {
            if (showOverlay && loadingStatusEl) {
                loadingStatusEl.innerText = "Baixando dados em tempo real da planilha...";
            }
            const response = await fetch(googleSheetUrl);
            if (!response.ok) throw new Error("Erro na rede ou CORS ao buscar a planilha");
            
            const csvText = await response.text();
            processCSVData(csvText);
            
            if (statusEl) {
                statusEl.className = "status-badge live";
                statusEl.innerHTML = "Sincronizado Planilha";
            }
            console.log("Successfully loaded live data from Google Sheet");
            return; // Exit on success
        } catch (error) {
            console.warn("Could not load live Google Sheet data. Error: ", error.message);
        }

        // Attempt 2: Fallback preprocessed data.json
        try {
            if (showOverlay && loadingStatusEl) {
                loadingStatusEl.innerText = "Carregando banco de dados local alternativo...";
            }
            const response = await fetch('data.json');
            if (!response.ok) throw new Error("Erro ao carregar data.json local");
            const localData = await response.json();
            rawData = localData;
            
            if (statusEl) {
                statusEl.className = "status-badge fallback";
                statusEl.innerHTML = "Banco de Dados Local";
            }
            console.log("Successfully loaded fallback data.json");
        } catch (localError) {
            console.error("Critical error: fallback database failed to load: ", localError.message);
            if (showOverlay) {
                alert("Erro crítico: Não foi possível carregar os dados locais ou da nuvem.");
            }
        }
    } finally {
        if (showOverlay && document.getElementById('loading-overlay')) {
            document.getElementById('loading-overlay').classList.add('hidden');
        }
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
}

// Sync button handler (fallback/silent manual force)
async function syncData() {
    await loadData(true);
    populateFilters();
    applyFilters();
}

// Populate filter select options dynamically based on raw data
function populateFilters() {
    const courses = new Set();
    const consultants = new Set();
    const shifts = new Set();
    const origins = new Set();
    
    rawData.matriculas.forEach(m => {
        if (m.curso) courses.add(m.curso);
        if (m.consultor) consultants.add(m.consultor);
        if (m.turno) shifts.add(m.turno);
        if (m.origem) origins.add(m.origem);
    });
    
    updateSelectOptions('filter-curso', courses, "Todos os Cursos");
    updateSelectOptions('filter-consultor', consultants, "Todos os Consultores");
    updateSelectOptions('filter-turno', shifts, "Todos os Turnos");
    updateSelectOptions('filter-origem', origins, "Todas as Origens");
}

function updateSelectOptions(elementId, setValues, defaultText) {
    const select = document.getElementById(elementId);
    // Preserve default first option
    select.innerHTML = `<option value="all">${defaultText}</option>`;
    
    const sortedVals = Array.from(setValues).sort();
    sortedVals.forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.innerText = val;
        select.appendChild(opt);
    });
}

// Set initial date range values
function setDefaultDates() {
    if (rawData.matriculas.length === 0) return;
    
    const dates = rawData.matriculas.map(m => new Date(m.data));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    
    // Format to YYYY-MM-DD for input value
    const minStr = minDate.toISOString().split('T')[0];
    const maxStr = maxDate.toISOString().split('T')[0];
    
    document.getElementById('filter-start-date').value = minStr;
    document.getElementById('filter-end-date').value = maxStr;
    
    document.getElementById('filter-start-date').min = minStr;
    document.getElementById('filter-start-date').max = maxStr;
    document.getElementById('filter-end-date').min = minStr;
    document.getElementById('filter-end-date').max = maxStr;
}

// Clear active styling from quick period selectors
function clearQuickPeriodActiveState() {
    const currentBtn = document.getElementById('btn-quick-current');
    const previousBtn = document.getElementById('btn-quick-previous');
    if (currentBtn) currentBtn.classList.remove('active');
    if (previousBtn) previousBtn.classList.remove('active');
}

// Reset filters to defaults
function resetFilters() {
    document.getElementById('filter-curso').value = 'all';
    document.getElementById('filter-consultor').value = 'all';
    document.getElementById('filter-turno').value = 'all';
    document.getElementById('filter-origem').value = 'all';
    setDefaultDates();
    clearQuickPeriodActiveState();
    applyFilters();
}

// Quick Period Filter Handler (Current Month / Previous Month)
function setQuickPeriod(type) {
    const now = new Date(2026, 5, 18); // Simulated current local time: June 18, 2026
    let start, end;
    
    const currentBtn = document.getElementById('btn-quick-current');
    const previousBtn = document.getElementById('btn-quick-previous');
    
    if (currentBtn && previousBtn) {
        currentBtn.classList.remove('active');
        previousBtn.classList.remove('active');
        if (type === 'current') {
            currentBtn.classList.add('active');
        } else if (type === 'previous') {
            previousBtn.classList.add('active');
        }
    }
    
    if (type === 'current') {
        const year = now.getFullYear();
        const month = now.getMonth();
        start = new Date(year, month, 1);
        end = new Date(year, month + 1, 0); // last day of month
    } else if (type === 'previous') {
        const year = now.getFullYear();
        const month = now.getMonth();
        start = new Date(year, month - 1, 1);
        end = new Date(year, month, 0); // last day of previous month
    }
    
    // Set inputs
    document.getElementById('filter-start-date').value = start.toISOString().split('T')[0];
    document.getElementById('filter-end-date').value = end.toISOString().split('T')[0];
    
    applyFilters();
}

// Apply Selected Filters to Data and Redraw Dashboard
function applyFilters() {
    const startDateVal = document.getElementById('filter-start-date').value;
    const endDateVal = document.getElementById('filter-end-date').value;
    const cursoVal = document.getElementById('filter-curso').value;
    const consultorVal = document.getElementById('filter-consultor').value;
    const turnoVal = document.getElementById('filter-turno').value;
    const origemVal = document.getElementById('filter-origem').value;
    
    const start = startDateVal ? new Date(startDateVal + 'T00:00:00') : new Date(0);
    const end = endDateVal ? new Date(endDateVal + 'T23:59:59') : new Date();
    
    // Update period subtitle text
    const formatBrazDate = (d) => {
        return d.toLocaleDateString('pt-BR');
    };
    document.getElementById('current-period-text').innerText = `Período selecionado: ${formatBrazDate(start)} a ${formatBrazDate(end)}`;
    
    // Filter array
    filteredData = rawData.matriculas.filter(m => {
        const mDate = new Date(m.data + 'T00:00:00');
        if (mDate < start || mDate > end) return false;
        if (cursoVal !== 'all' && m.curso !== cursoVal) return false;
        if (consultorVal !== 'all' && m.consultor !== consultorVal) return false;
        if (turnoVal !== 'all' && m.turno !== turnoVal) return false;
        if (origemVal !== 'all' && m.origem !== origemVal) return false;
        return true;
    });
    
    calculateKPIs(start, end);
    renderCharts();
    
    if (currentTab === 'equipe') {
        renderTeamPerformanceTable(start, end);
    }
}

// Calculate Goals, Total Sales, and Achievement Rate
function calculateKPIs(start, end) {
    const totalSales = filteredData.length;
    document.getElementById('kpi-matriculas-feitas').innerText = totalSales;
    
    // Calculate registrations in the previous comparison period of equal length
    const duration = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - duration - 1000 * 60 * 60 * 24);
    const prevEnd = new Date(start.getTime() - 1000 * 60 * 60 * 24);
    
    const cursoVal = document.getElementById('filter-curso').value;
    const consultorVal = document.getElementById('filter-consultor').value;
    const turnoVal = document.getElementById('filter-turno').value;
    const origemVal = document.getElementById('filter-origem').value;
    
    const prevFiltered = rawData.matriculas.filter(m => {
        const mDate = new Date(m.data + 'T00:00:00');
        if (mDate < prevStart || mDate > prevEnd) return false;
        if (cursoVal !== 'all' && m.curso !== cursoVal) return false;
        if (consultorVal !== 'all' && m.consultor !== consultorVal) return false;
        if (turnoVal !== 'all' && m.turno !== turnoVal) return false;
        if (origemVal !== 'all' && m.origem !== origemVal) return false;
        return true;
    });
    
    const prevSales = prevFiltered.length;
    const trendBadge = document.getElementById('kpi-matriculas-trend');
    
    if (trendBadge) {
        if (prevSales > 0 || totalSales > 0) {
            const diffSales = totalSales - prevSales;
            const pctChange = prevSales > 0 ? Math.round((diffSales / prevSales) * 100) : 100;
            const sign = diffSales > 0 ? '+' : '';
            
            trendBadge.style.display = 'inline-flex';
            
            if (diffSales > 0) {
                trendBadge.className = 'trend-badge up';
                trendBadge.innerHTML = `<i data-lucide="trending-up" style="width:14px;height:14px;"></i> ${sign}${pctChange}%`;
            } else if (diffSales < 0) {
                trendBadge.className = 'trend-badge down';
                trendBadge.innerHTML = `<i data-lucide="trending-down" style="width:14px;height:14px;"></i> ${pctChange}%`;
            } else {
                trendBadge.className = 'trend-badge neutral';
                trendBadge.innerHTML = `<i data-lucide="minus" style="width:14px;height:14px;"></i> 0%`;
            }
        } else {
            trendBadge.style.display = 'none';
        }
    }
    
    // Calculate Goal (Meta) dynamically by summing monthly goals for the period
    let goal = 0;
    const monthsInPeriod = getMonthsInPeriod(start, end);
    monthsInPeriod.forEach(m => {
        goal += getGoalForMonthYear(m.name, m.year);
    });
    
    document.getElementById('kpi-meta').innerText = goal;
    
    // Calculate Achievement (Atingimento)
    const diff = totalSales - goal;
    const sign = diff >= 0 ? '+' : '';
    document.getElementById('kpi-atingimento').innerText = `${sign}${diff}`;
    
    // Percentage
    const percent = goal > 0 ? Math.round((totalSales / goal) * 100) : 0;
    document.getElementById('kpi-percentual').innerText = `${percent}%`;
    
    // Update progress bar
    const progressEl = document.getElementById('kpi-progress-bar');
    const capPercent = Math.min(percent, 100);
    progressEl.style.width = `${capPercent}%`;
    
    // Update avatar bubble message dynamically based on achievement if element exists
    const msgEl = document.getElementById('avatar-message');
    if (msgEl) {
        if (percent < 50) {
            msgEl.innerText = "Trabalho pela frente! Foco total nas conversões. 💪";
        } else if (percent < 100) {
            msgEl.innerText = "Excelente ritmo! Faltam poucas matrículas para bater a meta. 🚀";
        } else {
            msgEl.innerText = `Parabéns! Meta superada em ${percent - 100}%! Equipe campeã! 🎉🏆`;
        }
    }
    
    // Style progress bar and cards based on achievement status
    const achIconEl = document.getElementById('achievement-icon-container');
    if (diff >= 0) {
        progressEl.style.background = 'linear-gradient(90deg, var(--accent-cyan), var(--accent-green))';
        progressEl.style.boxShadow = '0 0 10px rgba(112, 224, 0, 0.6)';
        achIconEl.innerHTML = "<i data-lucide='award' class='text-neon'></i>";
    } else {
        progressEl.style.background = 'linear-gradient(90deg, var(--accent-gold), var(--accent-red))';
        progressEl.style.boxShadow = '0 0 10px rgba(255, 0, 84, 0.4)';
        achIconEl.innerHTML = "<i data-lucide='award' class='text-gold'></i>";
    }
    lucide.createIcons();
}

// Persistent Monthly Metas Helpers
function getGoalForMonthYear(monthStr, yearNum) {
    return DEFAULT_MONTHLY_GOAL;
}

function getMonthsInPeriod(start, end) {
    const months = [];
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (d <= last) {
        months.push({
            name: ptMonthNames[d.getMonth()],
            year: d.getFullYear(),
            key: `${ptMonthNames[d.getMonth()]}/${d.getFullYear().toString().substring(2)}`
        });
        d.setMonth(d.getMonth() + 1);
    }
    return months;
}

// Tab Switching Mechanism
function switchTab(tabId) {
    currentTab = tabId;
    
    // Toggle active state in buttons
    document.getElementById('tab-geral-btn').classList.toggle('active', tabId === 'geral');
    document.getElementById('tab-equipe-btn').classList.toggle('active', tabId === 'equipe');
    
    // Toggle content views
    document.getElementById('tab-geral-content').classList.toggle('active', tabId === 'geral');
    document.getElementById('tab-equipe-content').classList.toggle('active', tabId === 'equipe');
    
    // Apply filters again to load the correct tab layout and trigger table generation
    applyFilters();
}

// Render all charts based on current filtered dataset
function renderCharts() {
    if (currentTab === 'geral') {
        renderGeralCharts();
    } else if (currentTab === 'equipe') {
        renderEquipeCharts();
    }
}

// --- TAB 1: GENERAL DASHBOARD CHARTS ---
function renderGeralCharts() {
    // 1. Matrículas por Curso
    const cursoCounts = {};
    filteredData.forEach(m => {
        if (m.curso) cursoCounts[m.curso] = (cursoCounts[m.curso] || 0) + 1;
    });
    const cursoSorted = Object.entries(cursoCounts).sort((a, b) => b[1] - a[1]);
    const cursoCategories = cursoSorted.map(x => x[0]);
    const cursoValues = cursoSorted.map(x => x[1]);
    
    const cursoOptions = {
        series: [{
            name: 'Matrículas',
            data: cursoValues
        }],
        chart: {
            type: 'bar',
            height: 320,
            toolbar: { show: false },
            foreColor: '#94a3b8',
            fontFamily: 'inherit',
            events: {
                dataPointSelection: function(event, chartContext, config) {
                    const idx = config.dataPointIndex;
                    if (idx === undefined || idx === -1) return;
                    const cat = config.w.config.xaxis.categories[idx];
                    const el = document.getElementById('filter-curso');
                    if (el) {
                        el.value = (el.value === cat) ? 'all' : cat;
                        el.dispatchEvent(new Event('change'));
                    }
                }
            }
        },
        colors: ['#70e000'],
        plotOptions: {
            bar: {
                horizontal: true,
                borderRadius: 4,
                barHeight: '65%',
                dataLabels: { position: 'top' } // Place values at the end (outside) of the bar
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)',
            xaxis: { lines: { show: true } },
            yaxis: { lines: { show: false } },
            padding: { right: 40 } // Extra padding to prevent right-edge clipping
        },
        xaxis: {
            categories: cursoCategories,
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        dataLabels: {
            enabled: true,
            offsetX: 30, // Shift text value outside the bar
            style: {
                fontSize: '11px',
                colors: ['#ffffff'], // High-readability white font
                fontWeight: 700
            }
        },
        tooltip: { theme: 'dark' }
    };
    updateChart('chart-curso', cursoOptions);

    // 2. Matrículas por Turno
    const turnoCounts = {};
    filteredData.forEach(m => {
        if (m.turno) turnoCounts[m.turno] = (turnoCounts[m.turno] || 0) + 1;
    });
    const shiftLabels = Object.keys(turnoCounts);
    const shiftValues = Object.values(turnoCounts);
    
    const turnoOptions = {
        series: shiftValues,
        chart: {
            type: 'donut',
            height: 320,
            fontFamily: 'inherit',
            foreColor: '#94a3b8',
            events: {
                dataPointSelection: function(event, chartContext, config) {
                    const idx = config.dataPointIndex;
                    if (idx === undefined || idx === -1) return;
                    const label = config.w.config.labels[idx];
                    const el = document.getElementById('filter-turno');
                    if (el) {
                        el.value = (el.value === label) ? 'all' : label;
                        el.dispatchEvent(new Event('change'));
                    }
                }
            }
        },
        labels: shiftLabels,
        colors: ['#70e000', '#00f5d4', '#ffbe0b', '#3a86ff'],
        stroke: { show: false },
        plotOptions: {
            pie: {
                donut: {
                    size: '72%',
                    labels: {
                        show: true,
                        name: { show: true },
                        value: {
                            show: true,
                            fontSize: '22px',
                            fontWeight: 800,
                            color: '#f8fafc',
                            formatter: function (val) { return val; }
                        },
                        total: {
                            show: true,
                            label: 'Total',
                            color: '#94a3b8',
                            formatter: function (w) {
                                return w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                            }
                        }
                    }
                }
            }
        },
        legend: {
            position: 'bottom',
            horizontalAlign: 'center',
            markers: { radius: 12 }
        },
        tooltip: { theme: 'dark' }
    };
    updateChart('chart-turno', turnoOptions);

    // 3. Matrículas por Consultor
    const consCounts = {};
    filteredData.forEach(m => {
        if (m.consultor) consCounts[m.consultor] = (consCounts[m.consultor] || 0) + 1;
    });
    const consSorted = Object.entries(consCounts).sort((a, b) => b[1] - a[1]);
    
    const consOptions = {
        series: [{
            name: 'Matrículas',
            data: consSorted.map(x => x[1])
        }],
        chart: {
            type: 'bar',
            height: 320,
            toolbar: { show: false },
            foreColor: '#94a3b8',
            fontFamily: 'inherit',
            events: {
                dataPointSelection: function(event, chartContext, config) {
                    const idx = config.dataPointIndex;
                    if (idx === undefined || idx === -1) return;
                    const cat = config.w.config.xaxis.categories[idx];
                    const el = document.getElementById('filter-consultor');
                    if (el) {
                        el.value = (el.value === cat) ? 'all' : cat;
                        el.dispatchEvent(new Event('change'));
                    }
                }
            }
        },
        colors: ['#00f5d4'],
        plotOptions: {
            bar: {
                columnWidth: '50%',
                borderRadius: 6,
                dataLabels: { position: 'top' }
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)',
            xaxis: { lines: { show: false } },
            yaxis: { lines: { show: true } }
        },
        xaxis: {
            categories: consSorted.map(x => x[0]),
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        dataLabels: {
            enabled: true,
            offsetY: -20,
            style: {
                fontSize: '11px',
                colors: ['#f8fafc'],
                fontWeight: 700
            }
        },
        tooltip: { theme: 'dark' }
    };
    updateChart('chart-consultor', consOptions);

    // 4. Matrículas por Origem
    const origCounts = {};
    filteredData.forEach(m => {
        if (m.origem) origCounts[m.origem] = (origCounts[m.origem] || 0) + 1;
    });
    const origSorted = Object.entries(origCounts).sort((a, b) => b[1] - a[1]).slice(0, 8); // Top 8
    
    const origOptions = {
        series: [{
            name: 'Matrículas',
            data: origSorted.map(x => x[1])
        }],
        chart: {
            type: 'bar',
            height: 320,
            toolbar: { show: false },
            foreColor: '#94a3b8',
            fontFamily: 'inherit',
            events: {
                dataPointSelection: function(event, chartContext, config) {
                    const idx = config.dataPointIndex;
                    if (idx === undefined || idx === -1) return;
                    const cat = config.w.config.xaxis.categories[idx];
                    const el = document.getElementById('filter-origem');
                    if (el) {
                        el.value = (el.value === cat) ? 'all' : cat;
                        el.dispatchEvent(new Event('change'));
                    }
                }
            }
        },
        colors: ['#ffbe0b'],
        plotOptions: {
            bar: {
                horizontal: true,
                borderRadius: 4,
                barHeight: '60%',
                dataLabels: { position: 'top' } // Place values at the end (outside) of the bar
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)',
            xaxis: { lines: { show: true } },
            yaxis: { lines: { show: false } },
            padding: { right: 40 } // Extra padding to prevent right-edge clipping
        },
        xaxis: {
            categories: origSorted.map(x => x[0]),
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        dataLabels: {
            enabled: true,
            offsetX: 30, // Shift text value outside the bar
            style: {
                fontSize: '11px',
                colors: ['#ffffff'], // High-readability white font
                fontWeight: 700
            }
        },
        tooltip: { theme: 'dark' }
    };
    updateChart('chart-origem', origOptions);

    // 5. Matrículas por Dia (Over time Area chart with brush)
    // We group by date
    const dateCounts = {};
    filteredData.forEach(m => {
        dateCounts[m.data] = (dateCounts[m.data] || 0) + 1;
    });
    
    // Sort dates
    const sortedDates = Object.keys(dateCounts).sort();
    
    // If empty data
    if (sortedDates.length === 0) {
        document.getElementById('chart-dia').innerHTML = "<div class='no-data-msg'>Sem dados no período</div>";
        return;
    }
    
    // Fill in missing dates to make a smooth timeline
    const timelineData = [];
    const minD = new Date(sortedDates[0]);
    const maxD = new Date(sortedDates[sortedDates.length - 1]);
    
    for (let d = new Date(minD); d <= maxD; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const val = dateCounts[dateStr] || 0;
        // Output date as timestamp for ApexCharts datetime axis
        timelineData.push([d.getTime(), val]);
    }

    const diaOptions = {
        series: [{
            name: 'Matrículas no Dia',
            data: timelineData
        }],
        chart: {
            type: 'area',
            height: 340,
            foreColor: '#94a3b8',
            fontFamily: 'inherit',
            zoom: {
                type: 'x',
                enabled: true,
                autoScaleYaxis: true
            },
            toolbar: {
                autoSelected: 'zoom',
                show: true,
                tools: {
                    download: false,
                    selection: true,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            }
        },
        dataLabels: { enabled: false },
        colors: ['#70e000'],
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.45,
                opacityTo: 0.05,
                stops: [0, 90, 100]
            }
        },
        stroke: {
            curve: 'smooth',
            width: 2
        },
        markers: {
            size: 0,
            hover: { size: 5 }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)'
        },
        xaxis: {
            type: 'datetime',
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            min: 0,
            labels: {
                formatter: function (val) { return Math.round(val); }
            }
        },
        tooltip: {
            theme: 'dark',
            x: { format: 'dd MMM yyyy' }
        }
    };
    updateChart('chart-dia', diaOptions);
}

// --- TAB 2: TEAM DASHBOARD CHARTS ---
function renderEquipeCharts() {
    // Determine unique monthly categories in filtered range
    // Group sales by Month-Year and Consultant
    const monthlyConsSales = {};
    const monthsSet = new Set();
    
    filteredData.forEach(m => {
        const dateObj = new Date(m.data + 'T00:00:00');
        // Portuguese naming Month/Year: e.g. "01/2026" or "Jan/26"
        const mKey = `${ptMonthNames[dateObj.getMonth()]}/${dateObj.getFullYear().toString().substring(2)}`;
        const mSortVal = dateObj.getFullYear() * 12 + dateObj.getMonth();
        
        monthsSet.add(JSON.stringify({ key: mKey, sort: mSortVal }));
        
        const consultor = m.consultor || 'Sem Consultor';
        if (!monthlyConsSales[consultor]) {
            monthlyConsSales[consultor] = {};
        }
        monthlyConsSales[consultor][mKey] = (monthlyConsSales[consultor][mKey] || 0) + 1;
    });
    
    // Sort month list chronologically
    const sortedMonths = Array.from(monthsSet)
        .map(x => JSON.parse(x))
        .sort((a, b) => a.sort - b.sort);
    
    const categories = sortedMonths.map(x => x.key);
    
    // Series structure: { name: 'Edson Jr', data: [10, 12, 14] }
    const series = [];
    const consultants = Object.keys(monthlyConsSales);
    
    consultants.forEach(c => {
        const data = categories.map(mKey => monthlyConsSales[c][mKey] || 0);
        series.push({ name: c, data: data });
    });
    
    // 6. Comparative performance trend
    const trendOptions = {
        series: series,
        chart: {
            type: 'line',
            height: 320,
            toolbar: { show: false },
            foreColor: '#94a3b8',
            fontFamily: 'inherit'
        },
        colors: ['#70e000', '#00f5d4', '#ffbe0b', '#3a86ff'],
        stroke: {
            curve: 'smooth',
            width: 3
        },
        markers: { size: 4 },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)'
        },
        xaxis: {
            categories: categories,
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        tooltip: { theme: 'dark' }
    };
    updateChart('chart-team-trend', trendOptions);

    // 7. Stacked Sales Origin per Consultant
    // Map origins and consultants
    const consOrigins = {};
    const originsSet = new Set();
    
    filteredData.forEach(m => {
        const c = m.consultor || 'Sem Consultor';
        const o = m.origem || 'Outro';
        originsSet.add(o);
        
        if (!consOrigins[o]) consOrigins[o] = {};
        consOrigins[o][c] = (consOrigins[o][c] || 0) + 1;
    });
    
    // Find unique consultants in selection
    const activeCons = Array.from(new Set(filteredData.map(m => m.consultor || 'Sem Consultor'))).sort();
    
    const originsSeries = [];
    const activeOrigins = Array.from(originsSet).sort();
    
    activeOrigins.forEach(o => {
        const data = activeCons.map(c => consOrigins[o][c] || 0);
        originsSeries.push({ name: o, data: data });
    });
    
    const originOptions = {
        series: originsSeries,
        chart: {
            type: 'bar',
            height: 320,
            stacked: true,
            toolbar: { show: false },
            foreColor: '#94a3b8',
            fontFamily: 'inherit'
        },
        colors: ['#70e000', '#00f5d4', '#ffbe0b', '#3a86ff', '#ff0054', '#8338ec', '#ff006e', '#fb5607', '#00b4d8', '#ff70a6'],
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '45%'
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)'
        },
        xaxis: {
            categories: activeCons,
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        legend: {
            position: 'bottom',
            markers: { radius: 12 }
        },
        tooltip: { theme: 'dark' }
    };
    updateChart('chart-team-origin', originOptions);

    // 8. Stacked Course registration per Consultant
    const consCourses = {};
    const coursesSet = new Set();
    
    filteredData.forEach(m => {
        const c = m.consultor || 'Sem Consultor';
        const cr = m.curso || 'Outro';
        coursesSet.add(cr);
        
        if (!consCourses[cr]) consCourses[cr] = {};
        consCourses[cr][c] = (consCourses[cr][c] || 0) + 1;
    });
    
    const coursesSeries = [];
    const activeCourses = Array.from(coursesSet).sort();
    
    activeCourses.forEach(cr => {
        const data = activeCons.map(c => consCourses[cr][c] || 0);
        coursesSeries.push({ name: cr, data: data });
    });
    
    const courseOptions = {
        series: coursesSeries,
        chart: {
            type: 'bar',
            height: 320,
            stacked: true,
            toolbar: { show: false },
            foreColor: '#94a3b8',
            fontFamily: 'inherit'
        },
        colors: ['#70e000', '#00f5d4', '#ffbe0b', '#3a86ff', '#ff0054', '#8338ec', '#fb5607'],
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '45%'
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)'
        },
        xaxis: {
            categories: activeCons,
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        legend: {
            position: 'bottom',
            markers: { radius: 12 }
        },
        tooltip: { theme: 'dark' }
    };
    updateChart('chart-team-course', courseOptions);
}

// Draw/Update an ApexCharts instance inside a container
function updateChart(containerId, options) {
    if (charts[containerId]) {
        charts[containerId].updateOptions(options);
    } else {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = ''; // clear any message
            const chart = new ApexCharts(container, options);
            chart.render();
            charts[containerId] = chart;
        }
    }
}

// Render Tab 2: Detailed team table rows dynamically
function renderTeamPerformanceTable(start, end) {
    const tableBody = document.querySelector('#team-performance-table tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    // Group metrics by Consultant
    const consData = {};
    
    // Find all consultants in rawData to show them even if they have 0 sales in filters
    const allConsultants = Array.from(new Set(rawData.matriculas.map(m => m.consultor))).sort();
    
    allConsultants.forEach(c => {
        consData[c] = {
            sales: 0,
            revenue1: 0,
            bolsaSum: 0,
            bolsaCount: 0,
            semanalCount: 0,
            sabadoCount: 0
        };
    });
    
    // Calculate for filtered dataset
    filteredData.forEach(m => {
        const c = m.consultor || 'Sem Consultor';
        if (!consData[c]) {
            consData[c] = { sales: 0, revenue1: 0, bolsaSum: 0, bolsaCount: 0, semanalCount: 0, sabadoCount: 0 };
        }
        consData[c].sales += 1;
        consData[c].revenue1 += m.mensalidade1 || 0;
        
        if (m.bolsa !== undefined) {
            consData[c].bolsaSum += m.bolsa;
            consData[c].bolsaCount += 1;
        }
        
        if (m.turno === 'Semanal') {
            consData[c].semanalCount += 1;
        } else if (m.turno === 'Sábado') {
            consData[c].sabadoCount += 1;
        }
    });
    
    // Calculate scale multiplier based on date range
    const monthsInPeriod = getMonthsInPeriod(start, end);
    const numMonths = monthsInPeriod.length || 1;
    
    // Scale individual goals 1 and 2
    const indGoal1 = numMonths * TEAM_GOAL_1;
    const indGoal2 = numMonths * TEAM_GOAL_2;
    
    // Find top seller to highlight (gamification)
    let maxSales = -1;
    let topSeller = null;
    Object.entries(consData).forEach(([name, metrics]) => {
        if (metrics.sales > maxSales) {
            maxSales = metrics.sales;
            topSeller = name;
        }
    });
    
    Object.entries(consData).forEach(([name, metrics]) => {
        if (metrics.sales === 0) return; // Mostrar apenas colaboradores que matricularam no período
        
        const atingimento1 = indGoal1 > 0 ? Math.round((metrics.sales / indGoal1) * 100) : 0;
        const atingimento2 = indGoal2 > 0 ? Math.round((metrics.sales / indGoal2) * 100) : 0;
        const avgBolsa = metrics.bolsaCount > 0 ? Math.round(metrics.bolsaSum / metrics.bolsaCount) : 0;
        
        const totalTurnos = metrics.semanalCount + metrics.sabadoCount;
        const semanalPct = totalTurnos > 0 ? Math.round((metrics.semanalCount / totalTurnos) * 100) : 0;
        
        const tr = document.createElement('tr');
        const isLeader = name === topSeller && metrics.sales > 0;
        if (isLeader) {
            tr.classList.add('leader-row');
        }
        
        // Progress bar HTML for achievement rate 1
        let badgeClass1 = 'text-red';
        if (atingimento1 >= 100) badgeClass1 = 'text-neon';
        else if (atingimento1 >= 75) badgeClass1 = 'text-gold';
        
        // Progress bar HTML for achievement rate 2
        let badgeClass2 = 'text-red';
        if (atingimento2 >= 100) badgeClass2 = 'text-neon';
        else if (atingimento2 >= 75) badgeClass2 = 'text-gold';
        
        const displayName = isLeader ? `${name} <span class="leader-crown" title="Líder de Vendas 👑">👑</span>` : name;
        
        tr.innerHTML = `
            <td style="font-weight: 700; display: flex; align-items: center; gap: 8px;">${displayName}</td>
            <td style="font-size: 1.1rem; font-weight: 700;">${metrics.sales}</td>
            <td style="color: var(--text-secondary);">${indGoal1}</td>
            <td class="${badgeClass1}" style="font-weight: 700; font-size: 1rem;">${atingimento1}%</td>
            <td style="color: var(--text-secondary);">${indGoal2}</td>
            <td class="${badgeClass2}" style="font-weight: 700; font-size: 1rem;">${atingimento2}%</td>
            <td>${avgBolsa}%</td>
            <td style="color: var(--text-secondary);">${semanalPct}% Semanal <span style="font-size:0.75rem; color:var(--text-muted);">(${100-semanalPct}% Sábado)</span></td>
        `;
        
        tableBody.appendChild(tr);
    });
}

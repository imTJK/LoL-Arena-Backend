// app.js - Simplified frontend logic
class ArenaTracker {
    constructor() {
        this.apiUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000' 
            : 'https://lol-arena-backend-production.up.railway.app';
        
        this.champions = [];
        this.masteryData = {};
        this.wins = new Set();
        this.currentLang = localStorage.getItem('language') || 'en';
        this.translations = {};
        this.currentFilter = 'all';
        this.currentSort = 'alphabetical';
        this.userIdentifier = localStorage.getItem('userIdentifier') || this.generateUserId();
        
        this.init();
    }

    async init() {
        // Load translations
        await this.loadTranslations();
        
        // Load champions from backend
        await this.loadChampions();
        
        // Load user wins
        await this.loadUserWins();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initial render
        this.render();
    }

    generateUserId() {
        const id = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('userIdentifier', id);
        return id;
    }

    async loadTranslations() {
        try {
            const response = await fetch(`${this.apiUrl}/api/translations/${this.currentLang}`);
            this.translations = await response.json();
            this.applyTranslations();
        } catch (error) {
            console.error('Failed to load translations:', error);
            // Fallback translations
            this.translations = this.getDefaultTranslations();
            this.applyTranslations();
        }
    }

    getDefaultTranslations() {
        const translations = {
            en: {
                title: "LoL Arena Win Tracker",
                connect_account: "Connect Riot Account",
                riot_id_placeholder: "Summoner Name#TAG",
                load_mastery: "Load Mastery",
                mastery_loaded: "Mastery data loaded!",
                arena_wins: "Arena Wins",
                champions: "Champions",
                progress: "Progress",
                all: "All",
                arena_wins_filter: "Arena Wins",
                pending: "Pending",
                high_mastery: "High Mastery (50k+)",
                assassin: "Assassin",
                fighter: "Fighter",
                mage: "Mage",
                marksman: "Marksman",
                support: "Support",
                tank: "Tank",
                sort_by: "Sort by:",
                alphabetical: "Alphabetical",
                mastery_points: "Mastery Points",
                mastery_level: "Mastery Level",
                last_played: "Last Played",
                loading: "Loading mastery data...",
                reset_progress: "Reset Arena Progress",
                load_demo: "Load Demo Data",
                level: "Level",
                points: "Points",
                last: "Last",
                reset_confirm: "Do you really want to reset your Arena progress?",
                error: "Error",
                riot_id_format: "Riot ID must have format 'Name#TAG'"
            },
            de: {
                title: "LoL Arena Win Tracker",
                connect_account: "Riot Account verbinden",
                riot_id_placeholder: "Beschwörername#TAG",
                load_mastery: "Mastery laden",
                mastery_loaded: "Mastery Daten geladen!",
                arena_wins: "Arena Siege",
                champions: "Champions",
                progress: "Fortschritt",
                all: "Alle",
                arena_wins_filter: "Arena Siege",
                pending: "Offen",
                high_mastery: "Hohe Mastery (50k+)",
                assassin: "Assassine",
                fighter: "Kämpfer",
                mage: "Magier",
                marksman: "Schütze",
                support: "Unterstützer",
                tank: "Tank",
                sort_by: "Sortierung:",
                alphabetical: "Alphabetisch",
                mastery_points: "Mastery Punkte",
                mastery_level: "Mastery Level",
                last_played: "Zuletzt gespielt",
                loading: "Lade Mastery Daten...",
                reset_progress: "Arena Fortschritt zurücksetzen",
                load_demo: "Demo Daten laden",
                level: "Level",
                points: "Punkte",
                last: "Zuletzt",
                reset_confirm: "Willst du wirklich den Arena Fortschritt zurücksetzen?",
                error: "Fehler",
                riot_id_format: "Riot ID muss Format 'Name#TAG' haben"
            }
        };
        return translations[this.currentLang] || translations.en;
    }

    async loadChampions() {
        try {
            const response = await fetch(`${this.apiUrl}/api/champions`);
            this.champions = await response.json();
        } catch (error) {
            console.error('Failed to load champions:', error);
            this.showError('Failed to load champions data');
        }
    }

    async loadUserWins() {
        try {
            const response = await fetch(`${this.apiUrl}/api/wins/${this.userIdentifier}`);
            const data = await response.json();
            this.wins = new Set(data.wins);
            const stats = document.getElementById('mastery-count').parentElement;
        stats.style.display = 'none';  // Hide mastery count stat
        
        this.updateStats();
        } catch (error) {
            console.error('Failed to load wins:', error);
        }
    }

    async toggleWin(championKey) {
        try {
            const response = await fetch(
                `${this.apiUrl}/api/wins/${this.userIdentifier}/${championKey}`,
                { method: 'POST' }
            );
            const data = await response.json();
            
            if (data.won) {
                this.wins.add(championKey);
            } else {
                this.wins.delete(championKey);
            }
            
            this.updateStats();
            this.render();
        } catch (error) {
            console.error('Failed to toggle win:', error);
        }
    }

    async fetchRiotData() {
        const riotId = document.getElementById('riot-id').value.trim();
        const region = document.getElementById('region').value;
        
        if (!riotId || !riotId.includes('#')) {
            this.showError(this.translate('riot_id_format'));
            return;
        }

        const [gameName, tagLine] = riotId.split('#');
        this.showLoading(true);

        try {
            const response = await fetch(
                `${this.apiUrl}/api/player/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}/${region}`
            );
            
            if (!response.ok) throw new Error(await response.text());
            
            const data = await response.json();
            
            // Process mastery data
            this.masteryData = {};
            data.masteries.forEach(mastery => {
                this.masteryData[mastery.championId] = mastery;
            });
            
            // Show player info
            document.getElementById('player-name').textContent = `${data.account.gameName}#${data.account.tagLine}`;
            document.getElementById('player-level').textContent = data.summoner.summonerLevel;
            document.getElementById('player-info').style.display = 'block';
            
            localStorage.setItem('masteryData', JSON.stringify(this.masteryData));
            
            this.render();
        } catch (error) {
            this.showError(error.message);
        } finally {
            this.showLoading(false);
        }
    }

    render() {
        const grid = document.getElementById('champions-grid');
        const searchTerm = document.getElementById('search-input').value.toLowerCase();
        
        let filtered = this.champions.filter(champion => {
            const mastery = this.masteryData[champion.key];
            const matchesSearch = champion.name.toLowerCase().includes(searchTerm);
            const matchesFilter = this.currentFilter === 'all' || 
                                (this.currentFilter === 'completed' && this.wins.has(champion.key)) ||
                                (this.currentFilter === 'pending' && !this.wins.has(champion.key)) ||
                                (this.currentFilter === 'high-mastery' && mastery && mastery.championPoints >= 50000) ||
                                champion.role === this.currentFilter;
            
            return matchesSearch && matchesFilter;
        });

        // Apply sorting
        filtered = this.sortChampions(filtered);

        // Render champion cards
        grid.innerHTML = filtered.map(champion => this.createChampionCard(champion)).join('');
        
        this.updateStats();
    }

    sortChampions(champions) {
        return champions.sort((a, b) => {
            const masteryA = this.masteryData[a.key];
            const masteryB = this.masteryData[b.key];
            
            switch (this.currentSort) {
                case 'mastery-points':
                    return (masteryB?.championPoints || 0) - (masteryA?.championPoints || 0);
                case 'mastery-level':
                    return (masteryB?.championLevel || 0) - (masteryA?.championLevel || 0);
                case 'last-played':
                    return (masteryB?.lastPlayTime || 0) - (masteryA?.lastPlayTime || 0);
                default:
                    return a.name.localeCompare(b.name);
            }
        });
    }

    createChampionCard(champion) {
        const isCompleted = this.wins.has(champion.key);
        const mastery = this.masteryData[champion.key];
        const hasHighMastery = mastery && mastery.championPoints >= 50000;
        
        let masteryBadge = '';
        let masteryInfo = '';
        
        if (mastery) {
            const level = mastery.championLevel;
            const points = mastery.championPoints.toLocaleString();
            
            masteryBadge = `<div class="mastery-badge level-${level}">${level}</div>`;
            masteryInfo = `
                <div class="mastery-info">
                    ${this.translate('level')} ${level}<br>
                    <span class="mastery-points">${points} ${this.translate('points')}</span>
                </div>
            `;
        }
        
        // Capitalize first letter of role for display
        const roleDisplay = champion.role ? champion.role.charAt(0).toUpperCase() + champion.role.slice(1) : '';
        
        return `
            <div class="champion-card ${isCompleted ? 'completed' : ''} ${hasHighMastery ? 'high-mastery' : ''}" 
                 data-champion="${champion.key}">
                <div class="champion-image">
                    <img src="${champion.image_url || `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/${champion.id || champion.name}.png`}" 
                         alt="${champion.name}" 
                         loading="lazy"
                         onerror="this.style.display='none'; this.parentNode.innerHTML='${champion.name.substring(0, 3).toUpperCase()}';">
                    ${masteryBadge}
                </div>
                <div class="champion-name">${champion.name}</div>
                <div class="champion-role">
                    ${this.translate(champion.role) || roleDisplay}
                </div>
                ${masteryInfo}
                <label class="win-checkbox">
                    <input type="checkbox" ${isCompleted ? 'checked' : ''} 
                           onchange="tracker.toggleWin('${champion.key}')">
                    <span class="checkmark"></span>
                </label>
            </div>
        `;
    }

    updateStats() {
        const completed = this.wins.size;
        const total = this.champions.length;
        const percentage = Math.round((completed / total) * 100);
        
        document.getElementById('completed-count').textContent = completed;
        document.getElementById('total-count').textContent = total;
        document.getElementById('completion-percentage').textContent = percentage + '%';
        
        // Update Arena God Challenge
        this.updateArenaGodChallenge(completed);
    }

    updateArenaGodChallenge(wins) {
        const maxWins = 60;
        const percentage = Math.min((wins / maxWins) * 100, 100);
        
        document.getElementById('arena-god-counter').textContent = `${wins}/60`;
        document.getElementById('arena-god-fill').style.width = percentage + '%';
        
        // Update milestones
        document.querySelectorAll('.milestone').forEach(milestone => {
            const required = parseInt(milestone.dataset.count);
            const marker = milestone.querySelector('.milestone-marker');
            
            if (wins >= required) {
                marker.style.background = '#00ff00';
                marker.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.8)';
            }
        });
    }

    translate(key) {
        return this.translations[key] || key;
    }

    applyTranslations() {
        document.querySelectorAll('[data-translate]').forEach(element => {
            const key = element.getAttribute('data-translate');
            element.textContent = this.translate(key);
        });
        
        document.querySelectorAll('[data-translate-placeholder]').forEach(element => {
            const key = element.getAttribute('data-translate-placeholder');
            element.placeholder = this.translate(key);
        });
    }

    setupEventListeners() {
        // Language toggle
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                this.currentLang = e.target.dataset.lang;
                localStorage.setItem('language', this.currentLang);
                
                await this.loadTranslations();
                this.render();
            });
        });

        // Search
        document.getElementById('search-input').addEventListener('input', () => this.render());

        // Filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.currentFilter = e.currentTarget.dataset.filter;
                this.render();
            });
        });

        // Sort
        document.getElementById('sort-select').addEventListener('change', (e) => {
            this.currentSort = e.target.value;
            this.render();
        });
    }

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
        document.getElementById('fetch-btn').disabled = show;
    }

    showError(message) {
        const errorEl = document.getElementById('error');
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        setTimeout(() => errorEl.style.display = 'none', 5000);
    }

    resetProgress() {
        if (confirm(this.translate('reset_confirm'))) {
            this.wins.clear();
            // Clear from backend
            this.champions.forEach(champion => {
                fetch(`${this.apiUrl}/api/wins/${this.userIdentifier}/${champion.key}`, {
                    method: 'DELETE'
                }).catch(console.error);
            });
            this.render();
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.tracker = new ArenaTracker();
});

// Global functions for onclick handlers
window.fetchRiotData = () => tracker.fetchRiotData();
window.resetProgress = () => tracker.resetProgress();
window.loadDemoData = () => {
    // Demo implementation
    const demoMastery = {
        "157": { championLevel: 7, championPoints: 234567, lastPlayTime: Date.now() },
        "103": { championLevel: 6, championPoints: 156789, lastPlayTime: Date.now() },
        "84": { championLevel: 5, championPoints: 89234, lastPlayTime: Date.now() }
    };
    
    tracker.masteryData = demoMastery;
    localStorage.setItem('masteryData', JSON.stringify(demoMastery));
    
    document.getElementById('player-name').textContent = 'DemoPlayer#EUW';
    document.getElementById('player-level').textContent = '156';
    document.getElementById('player-info').style.display = 'block';
    
    tracker.render();
};
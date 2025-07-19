// app.js - Fixed with complete translations
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
        this.summonerProfile = null;
        
        this.init();
    }

    async init() {
        // Load translations
        await this.loadTranslations();
        
        // Load champions from backend
        await this.loadChampions();
        
        // Load saved summoner data
        await this.loadSavedSummonerData();
        
        // Load user wins
        await this.loadUserWins();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initial render
        this.render();
    }

    // New: Clear summoner data
    clearSummonerData() {
        if (confirm(this.translate('clear_confirm') || 'Clear all summoner data?')) {
            localStorage.removeItem('summonerProfile');
            localStorage.removeItem('masteryData');
            this.summonerProfile = null;
            this.masteryData = {};
            
            document.getElementById('player-info').style.display = 'none';
            document.getElementById('riot-id').value = '';
            
            this.render();
            console.log('🗑️ Summoner data cleared');
        }
    }

    showChampionDetails(championKey) {
        const champion = this.champions.find(c => c.key === championKey);
        if (!champion) return;

        const mastery = this.masteryData[championKey];
        const isCompleted = this.wins.has(championKey);

        // Create modal HTML
        const modalHtml = `
            <div class="champion-modal-overlay" onclick="tracker.closeChampionModal()">
                <div class="champion-modal" onclick="event.stopPropagation();">
                    <button class="modal-close" onclick="tracker.closeChampionModal()">×</button>
                    
                    <div class="modal-header">
                        <div class="modal-champion-image">
                            <img src="${champion.splash_art_url || champion.image_url || `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champion.name}_0.jpg`}" 
                                 alt="${champion.name}"
                                 onerror="this.src='${champion.image_url || `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/${champion.name}.png`}'">
                        </div>
                        <div class="modal-champion-info">
                            <h2>${champion.name}</h2>
                            <h3>${champion.title || 'The Champion'}</h3>
                            <div class="modal-role">${this.translate(champion.role) || champion.role}</div>
                            ${isCompleted ? '<div class="modal-won-badge">✅ Arena Won!</div>' : '<div class="modal-pending-badge">⏳ Pending</div>'}
                        </div>
                    </div>

                    <div class="modal-content">
                        ${mastery ? `
                            <div class="modal-section">
                                <h4>${this.translate('mastery_info') || 'Mastery Information'}</h4>
                                <div class="mastery-details">
                                    <div class="mastery-stat">
                                        <span class="label">${this.translate('level')}:</span>
                                        <span class="value level-${mastery.championLevel}">${mastery.championLevel}</span>
                                    </div>
                                    <div class="mastery-stat">
                                        <span class="label">${this.translate('points')}:</span>
                                        <span class="value">${mastery.championPoints.toLocaleString()}</span>
                                    </div>
                                    <div class="mastery-stat">
                                        <span class="label">${this.translate('last_played') || 'Last Played'}:</span>
                                        <span class="value">${new Date(mastery.lastPlayTime).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                        ` : ''}

                        ${champion.stats ? `
                            <div class="modal-section">
                                <h4>${this.translate('base_stats') || 'Base Stats'}</h4>
                                <div class="stats-grid">
                                    <div class="stat-item">
                                        <span class="stat-label">HP</span>
                                        <span class="stat-value">${Math.round(champion.stats.hp || 0)}</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">MP</span>
                                        <span class="stat-value">${Math.round(champion.stats.mp || 0)}</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">AD</span>
                                        <span class="stat-value">${Math.round(champion.stats.attackdamage || 0)}</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">AS</span>
                                        <span class="stat-value">${(champion.stats.attackspeed || 0).toFixed(2)}</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">Armor</span>
                                        <span class="stat-value">${Math.round(champion.stats.armor || 0)}</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">MR</span>
                                        <span class="stat-value">${Math.round(champion.stats.spellblock || 0)}</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">MS</span>
                                        <span class="stat-value">${Math.round(champion.stats.movespeed || 0)}</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">Range</span>
                                        <span class="stat-value">${Math.round(champion.stats.attackrange || 0)}</span>
                                    </div>
                                </div>
                            </div>
                        ` : ''}

                        ${champion.lore ? `
                            <div class="modal-section">
                                <h4>${this.translate('lore') || 'Lore'}</h4>
                                <div class="lore-text">
                                    ${champion.lore}
                                </div>
                            </div>
                        ` : ''}

                        ${champion.passive_name ? `
                            <div class="modal-section">
                                <h4>${this.translate('passive') || 'Passive Ability'}</h4>
                                <div class="ability-info">
                                    <strong>${champion.passive_name}</strong>
                                    <p>${champion.passive_description || 'No description available'}</p>
                                </div>
                            </div>
                        ` : ''}

                        <div class="modal-actions">
                            <button class="win-toggle-btn ${isCompleted ? 'completed' : ''}" 
                                    onclick="tracker.toggleWinFromModal('${championKey}')">
                                ${isCompleted ? '✅ Mark as Pending' : '🏆 Mark as Won'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.body.style.overflow = 'hidden';
    }

    closeChampionModal() {
        const modal = document.querySelector('.champion-modal-overlay');
        if (modal) {
            modal.remove();
            document.body.style.overflow = '';
        }
    }

    async toggleWinFromModal(championKey) {
        await this.toggleWin(championKey);
        this.closeChampionModal();
        this.render();
    }

    generateUserId() {
        const id = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('userIdentifier', id);
        return id;
    }

    // New: Create persistent summoner code
    createSummonerCode(gameName, tagLine, region) {
        const rawCode = `${gameName}#${tagLine}@${region}`;
        return btoa(rawCode).replace(/[+/=]/g, '').substring(0, 12).toUpperCase();
    }

    // New: Decode summoner code
    decodeSummonerCode(code) {
        try {
            // Add padding if needed
            let padded = code.toLowerCase();
            while (padded.length % 4 !== 0) {
                padded += '=';
            }
            const decoded = atob(padded);
            const [riotId, region] = decoded.split('@');
            const [gameName, tagLine] = riotId.split('#');
            return { gameName, tagLine, region };
        } catch (error) {
            console.error('Invalid summoner code:', error);
            return null;
        }
    }

    // New: Save summoner data persistently
    async saveSummonerData(accountData, summonerData, masteryData, region) {
        const summonerCode = this.createSummonerCode(accountData.gameName, accountData.tagLine, region);
        
        const profileData = {
            code: summonerCode,
            account: accountData,
            summoner: summonerData,
            region: region,
            lastUpdated: Date.now(),
            masteryCount: masteryData.length,
            totalMasteryPoints: masteryData.reduce((sum, m) => sum + m.championPoints, 0)
        };

        // Save to localStorage
        localStorage.setItem('summonerProfile', JSON.stringify(profileData));
        localStorage.setItem('masteryData', JSON.stringify(masteryData));
        
        // Save to backend for cross-device sync
        try {
            await fetch(`${this.apiUrl}/api/summoner-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summonerCode,
                    profileData,
                    masteryData
                })
            });
            console.log('✅ Summoner data saved to cloud');
        } catch (error) {
            console.log('⚠️ Cloud save failed, using local storage only');
        }

        this.summonerProfile = profileData;
        return summonerCode;
    }

    // New: Load saved summoner data
    async loadSavedSummonerData() {
        // Try loading from localStorage first
        const savedProfile = localStorage.getItem('summonerProfile');
        const savedMastery = localStorage.getItem('masteryData');

        if (savedProfile && savedMastery) {
            try {
                this.summonerProfile = JSON.parse(savedProfile);
                this.masteryData = {};
                
                const masteryArray = JSON.parse(savedMastery);
                masteryArray.forEach(mastery => {
                    this.masteryData[mastery.championId] = mastery;
                });

                // Show saved profile
                this.displaySummonerProfile(this.summonerProfile);
                
                console.log(`✅ Loaded saved data for: ${this.summonerProfile.account.gameName}#${this.summonerProfile.account.tagLine}`);
                
                // Try to sync from cloud if available
                this.syncFromCloud(this.summonerProfile.code);
                
            } catch (error) {
                console.error('Error loading saved data:', error);
            }
        }
    }

    // New: Sync data from cloud
    async syncFromCloud(summonerCode) {
        try {
            const response = await fetch(`${this.apiUrl}/api/summoner-profile/${summonerCode}`);
            if (response.ok) {
                const cloudData = await response.json();
                
                // Check if cloud data is newer
                if (cloudData.profileData.lastUpdated > this.summonerProfile.lastUpdated) {
                    console.log('☁️ Syncing newer data from cloud');
                    
                    this.summonerProfile = cloudData.profileData;
                    this.masteryData = {};
                    
                    cloudData.masteryData.forEach(mastery => {
                        this.masteryData[mastery.championId] = mastery;
                    });
                    
                    // Update localStorage
                    localStorage.setItem('summonerProfile', JSON.stringify(this.summonerProfile));
                    localStorage.setItem('masteryData', JSON.stringify(cloudData.masteryData));
                    
                    this.displaySummonerProfile(this.summonerProfile);
                    this.render();
                }
            }
        } catch (error) {
            console.log('Cloud sync not available');
        }
    }

    // New: Display summoner profile
    displaySummonerProfile(profile) {
        document.getElementById('player-name').textContent = `${profile.account.gameName}#${profile.account.tagLine}`;
        document.getElementById('player-level').textContent = profile.summoner.summonerLevel;
        document.getElementById('summoner-code').textContent = profile.code;
        document.getElementById('last-updated').textContent = new Date(profile.lastUpdated).toLocaleDateString();
        document.getElementById('player-info').style.display = 'block';
        
        // Update input field for easy re-fetch
        document.getElementById('riot-id').value = `${profile.account.gameName}#${profile.account.tagLine}`;
        document.getElementById('region').value = profile.region;
    }

    // New: Get mastery tier class for styling
    getMasteryTierClass(points) {
        if (points >= 1000000) return 'points-1000000-plus';
        if (points >= 500000) return 'points-500000-999999';
        if (points >= 200000) return 'points-200000-499999';
        if (points >= 100000) return 'points-100000-199999';
        if (points >= 50000) return 'points-50000-99999';
        if (points >= 25000) return 'points-25000-49999';
        if (points >= 10000) return 'points-10000-24999';
        return 'points-0-9999';
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
                with_mastery: "With Mastery",
                progress: "Progress",
                all: "All",
                completed: "Won",
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
                riot_id_format: "Riot ID must have format 'Name#TAG'",
                search_placeholder: "Search champion...",
                arena_god_challenge: "Arena God Challenge",
                bronze_milestone: "10 Wins - Bronze Arena God",
                silver_milestone: "25 Wins - Silver Arena God", 
                gold_milestone: "45 Wins - Gold Arena God",
                ultimate_milestone: "60 Wins - ULTIMATE ARENA GOD!",
                mastery_info: "Mastery Information",
                base_stats: "Base Stats",
                lore: "Lore",
                passive: "Passive Ability",
                summoner_code: "Code",
                last_updated: "Updated",
                refresh_data: "Refresh Data",
                clear_data: "Clear Data",
                clear_confirm: "Clear all summoner data?"
            },
            de: {
                title: "LoL Arena Win Tracker",
                connect_account: "Riot Account verbinden",
                riot_id_placeholder: "Beschwörername#TAG",
                load_mastery: "Mastery laden",
                mastery_loaded: "Mastery Daten geladen!",
                arena_wins: "Arena Siege",
                champions: "Champions",
                with_mastery: "Mit Mastery",
                progress: "Fortschritt",
                all: "Alle",
                completed: "Gewonnen",
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
                riot_id_format: "Riot ID muss Format 'Name#TAG' haben",
                search_placeholder: "Champion suchen...",
                arena_god_challenge: "Arena Gott Herausforderung",
                bronze_milestone: "10 Siege - Bronze Arena Gott",
                silver_milestone: "25 Siege - Silber Arena Gott",
                gold_milestone: "45 Siege - Gold Arena Gott", 
                ultimate_milestone: "60 Siege - ULTIMATIVER ARENA GOTT!",
                mastery_info: "Mastery Informationen",
                base_stats: "Grundwerte",
                lore: "Geschichte",
                passive: "Passive Fähigkeit",
                summoner_code: "Code",
                last_updated: "Aktualisiert",
                refresh_data: "Daten Aktualisieren",
                clear_data: "Daten Löschen",
                clear_confirm: "Alle Beschwörerdaten löschen?"
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
            if (data.masteries && Array.isArray(data.masteries)) {
                data.masteries.forEach(mastery => {
                    this.masteryData[mastery.championId] = mastery;
                });
            } else {
                console.warn('No mastery data received or invalid format');
            }
            
            // Show player info
            document.getElementById('player-name').textContent = `${data.account.gameName}#${data.account.tagLine}`;
            document.getElementById('player-level').textContent = data.summoner.summonerLevel;
            document.getElementById('player-info').style.display = 'block';
            
            // Save summoner data persistently
            const summonerCode = await this.saveSummonerData(data.account, data.summoner, data.masteries, region);
            document.getElementById('summoner-code').textContent = summonerCode;
            document.getElementById('last-updated').textContent = new Date().toLocaleDateString();
            
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

    async updateChampions() {
    try {
        this.showLoading(true);
        console.log('🔄 Triggering champion update...');
        
        const response = await fetch(`${this.apiUrl}/api/update-champions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`Update failed: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('✅ Champions updated:', result.message);
        
        // Reload champions data
        await this.loadChampions();
        this.render();
        
        // Show success message
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 255, 0, 0.2);
            color: #00ff00;
            padding: 15px 20px;
            border-radius: 10px;
            border: 1px solid #00ff00;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        successDiv.textContent = result.message;
        document.body.appendChild(successDiv);
        
        setTimeout(() => successDiv.remove(), 5000);
        
        } catch (error) {
            console.error('❌ Update failed:', error);
            this.showError(`Champion update failed: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async searchChampion(name) {
    try {
        const response = await fetch(`${this.apiUrl}/api/champions/search/${encodeURIComponent(name)}`);
        const result = await response.json();
        
        console.log(`🔍 Search results for "${name}":`, result);
        return result;
        } catch (error) {
            console.error('Search failed:', error);
            return null;
        }
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
            const tierClass = this.getMasteryTierClass(mastery.championPoints);
            
            // Show mastery as border glow instead of badge
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
            <div class="champion-card ${isCompleted ? 'completed' : ''} ${hasHighMastery ? 'high-mastery' : ''} ${mastery ? this.getMasteryTierClass(mastery.championPoints) : ''}" 
                 data-champion="${champion.key}"
                 oncontextmenu="tracker.showChampionDetails('${champion.key}'); return false;">
                <div class="champion-image">
                    <img src="${champion.image_url || `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/${champion.id || champion.name}.png`}" 
                         alt="${champion.name}" 
                         loading="lazy"
                         onerror="this.style.display='none'; this.parentNode.innerHTML='${champion.name.substring(0, 3).toUpperCase()}';">
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
        // Translate text content
        document.querySelectorAll('[data-translate]').forEach(element => {
            const key = element.getAttribute('data-translate');
            element.textContent = this.translate(key);
        });
        
        // Translate placeholders
        document.querySelectorAll('[data-translate-placeholder]').forEach(element => {
            const key = element.getAttribute('data-translate-placeholder');
            element.placeholder = this.translate(key);
        });
        
        // Translate select options
        document.querySelectorAll('select option[data-translate]').forEach(option => {
            const key = option.getAttribute('data-translate');
            option.textContent = this.translate(key);
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
        
        // Apply translations after all event listeners are set
        this.applyTranslations();
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

const updateButton = `
<div style="text-align: center; margin: 20px 0;">
    <button class="fetch-btn" onclick="updateChampions()" style="background: rgba(200, 155, 60, 0.7);">
        🔄 Update Champions Database
    </button>
    <button class="fetch-btn" onclick="searchYunaara()" style="background: rgba(100, 150, 255, 0.7); margin-left: 10px;">
        🔍 Search Yunaara
    </button>
</div>
`;
// Neon Bay — save / load through localStorage. Persists the player
// position, cash, mission progress, wanted level and owned weapons.
// Every storage access is guarded: if localStorage is missing or throws
// (private mode, disabled storage), the game keeps running and the
// functions report failure instead of crashing. Self-contained: no
// sibling imports, all data from the shared state object.

export function createSave(state) {
  const KEY = 'neon-bay-save-v1';
  const save = {
    // True when a storage object was found at factory time.
    available: false,
    // Last error message from a failed storage operation, or null.
    lastError: null,

    _storage() {
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          save.available = true;
          return localStorage;
        }
      } catch (err) {
        save.lastError = err && err.message ? err.message : String(err);
      }
      save.available = false;
      return null;
    },

    // Collect the serializable snapshot from the shared state.
    _snapshot() {
      const p = state && state.player ? state.player : null;
      const missions = state && state.missions ? state.missions : null;
      const weapons = [];
      if (p && Array.isArray(p.weapons)) {
        for (let i = 0; i < p.weapons.length; i++) {
          const w = p.weapons[i];
          if (!w) continue;
          weapons.push({
            name: w.name || 'Pistol',
            ammoInMag: typeof w.ammoInMag === 'number' ? w.ammoInMag : 0,
            reserveAmmo: typeof w.reserveAmmo === 'number' ? w.reserveAmmo : 0,
          });
        }
      }
      // Misi: state.missions adalah objek internal M (missions.js) —
      // current = INDEX angka, list[i].status = 'done'|'available'|...
      const missionState = {
        index: 0,
        completed: [],
        currentObjective: null,
      };
      if (missions) {
        if (Array.isArray(missions.list)) {
          missions.list.forEach(function (m, i) {
            if (m && m.status === 'done') missionState.completed.push(i);
          });
          const firstOpen = missions.list.findIndex(function (m) {
            return m && m.status !== 'done';
          });
          missionState.index = typeof missions.current === 'number' && missions.current >= 0
            ? missions.current
            : (firstOpen >= 0 ? firstOpen : 0);
        } else if (typeof missions.index === 'number') {
          missionState.index = missions.index;
        }
        if (missions.objective && missions.objective.label) {
          missionState.currentObjective = String(missions.objective.label);
        }
      }
      // Wanted tinggal di state.wanted (police.js), bukan di player.
      const wanted = state && typeof state.wanted === 'number' ? state.wanted : 0;
      return {
        version: 1,
        savedAt: Date.now(),
        player: {
          x: p && typeof p.x === 'number' ? p.x : 0,
          y: p && typeof p.y === 'number' ? p.y : 0,
          angle: p && typeof p.angle === 'number' ? p.angle : 0,
          health: p && typeof p.health === 'number' ? p.health : 100,
          armor: p && typeof p.armor === 'number' ? p.armor : 0,
          cash: p && typeof p.cash === 'number' ? p.cash : 0,
          wanted: wanted,
          weapons: weapons,
          weaponIndex: p && typeof p.weaponIndex === 'number' ? p.weaponIndex : 0,
        },
        missions: missionState,
        seed: state && typeof state.seed === 'number' ? state.seed : null,
        playMinutes: state && typeof state.playMinutes === 'number'
          ? state.playMinutes : 0,
      };
    },

    // Validate a parsed save object before it is applied.
    _valid(data) {
      if (!data || typeof data !== 'object') return false;
      if (data.version !== 1) return false;
      if (!data.player || typeof data.player !== 'object') return false;
      if (typeof data.player.x !== 'number' || typeof data.player.y !== 'number') {
        return false;
      }
      return true;
    },

    save() {
      const store = save._storage();
      if (!store) return false;
      try {
        store.setItem(KEY, JSON.stringify(save._snapshot()));
        save.lastError = null;
        return true;
      } catch (err) {
        save.lastError = err && err.message ? err.message : String(err);
        return false;
      }
    },

    load() {
      const store = save._storage();
      if (!store) return null;
      let raw = null;
      try {
        raw = store.getItem(KEY);
      } catch (err) {
        save.lastError = err && err.message ? err.message : String(err);
        return null;
      }
      if (!raw) return null;
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        save.lastError = 'save data is corrupt';
        return null;
      }
      if (!save._valid(data)) {
        save.lastError = 'save data failed validation';
        return null;
      }
      save.lastError = null;
      return data;
    },

    // Apply a loaded save object back onto the shared state.
    apply(data) {
      if (!save._valid(data)) return false;
      const p = state && state.player ? state.player : null;
      if (p) {
        p.x = data.player.x;
        p.y = data.player.y;
        if (typeof data.player.angle === 'number') p.angle = data.player.angle;
        if (typeof data.player.health === 'number') p.health = data.player.health;
        if (typeof data.player.armor === 'number') p.armor = data.player.armor;
        if (typeof data.player.cash === 'number') p.cash = data.player.cash;
        // wanted dipulihkan ke state.wanted (di bawah), bukan p.wanted.
        if (Array.isArray(data.player.weapons)) {
          p.weapons = data.player.weapons.map(function (w) {
            return {
              name: w.name || 'Pistol',
              ammoInMag: typeof w.ammoInMag === 'number' ? w.ammoInMag : 0,
              reserveAmmo: typeof w.reserveAmmo === 'number' ? w.reserveAmmo : 0,
              magSize: w.name === 'Shotgun' ? 6 : 12,
              reloading: false,
            };
          });
          if (p.weapons.length > 0) {
            const idx = typeof data.player.weaponIndex === 'number'
              ? data.player.weaponIndex : 0;
            p.weaponIndex = Math.max(0, Math.min(p.weapons.length - 1, idx));
            p.weapon = p.weapons[p.weaponIndex];
          }
        }
      }
      const missions = state && state.missions ? state.missions : null;
      if (missions && data.missions) {
        // Pulihkan status rantai misi: yang selesai -> 'done', misi
        // berikutnya -> 'available', sisanya 'locked'. Misi aktif
        // dimulai ulang oleh integrator (main.js) dari index ini.
        if (Array.isArray(missions.list)) {
          missions.list.forEach(function (m, i) {
            if (!m) return;
            m.status = (data.missions.completed || []).indexOf(i) !== -1 ? 'done' : 'locked';
          });
          const next = typeof data.missions.index === 'number' ? data.missions.index : 0;
          if (missions.list[next] && missions.list[next].status !== 'done') {
            missions.list[next].status = 'available';
          }
          missions.current = -1;
          missions.status = 'idle';
          missions.objective = null;
          missions.marker = null;
        } else {
          if (typeof data.missions.index === 'number') missions.index = data.missions.index;
          if (Array.isArray(data.missions.completed)) {
            missions.completed = data.missions.completed.slice();
          }
        }
        if (state) state.missionIndex = typeof data.missions.index === 'number'
          ? data.missions.index : 0;
      }
      if (typeof data.player.wanted === 'number' && state) {
        state.wanted = Math.max(0, Math.min(5, Math.round(data.player.wanted)));
      }
      if (typeof data.playMinutes === 'number' && state) {
        state.playMinutes = data.playMinutes;
      }
      return true;
    },

    // Summary for the title screen's Continue entry (cash, mission,
    // timestamp) without applying the save. Returns null when no save.
    info() {
      const data = save.load();
      if (!data) return null;
      return {
        savedAt: data.savedAt || 0,
        cash: data.player ? data.player.cash : 0,
        missionIndex: data.missions ? data.missions.index : 0,
        wanted: data.player ? data.player.wanted : 0,
      };
    },

    hasSave() {
      const store = save._storage();
      if (!store) return false;
      try {
        return store.getItem(KEY) != null;
      } catch (err) {
        save.lastError = err && err.message ? err.message : String(err);
        return false;
      }
    },

    clearSave() {
      const store = save._storage();
      if (!store) return false;
      try {
        store.removeItem(KEY);
        save.lastError = null;
        return true;
      } catch (err) {
        save.lastError = err && err.message ? err.message : String(err);
        return false;
      }
    },
  };
  // Probe storage once so `available` is meaningful right away.
  save._storage();
  return save;
}

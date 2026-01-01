// src/utils/priorityStore.js
"use strict";

const fs = require("fs");
const path = require("path");

/**
 * PriorityStore
 * - Tracks when users last attended a session + how many times attended
 * - Persists to JSON on disk (debounced writes)
 * - Safe on first boot / missing file / bad JSON
 */
class PriorityStore {
  /**
   * @param {string=} filePath Optional absolute/relative path for the JSON file
   */
  constructor(filePath) {
    // Default: <projectRoot>/src/data/priority.json
    this.filePath =
      filePath && String(filePath).trim().length > 0
        ? String(filePath).trim()
        : path.join(process.cwd(), "src", "data", "priority.json");

    this.data = { users: {} };

    this._saveTimer = null;
    this._dirty = false;
    this._saving = false;
  }

  /**
   * Loads JSON from disk into memory.
   * Never throws; falls back to { users: {} } if invalid.
   */
  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);

      if (parsed && typeof parsed === "object") {
        // Ensure minimum shape
        if (!parsed.users || typeof parsed.users !== "object") parsed.users = {};
        this.data = parsed;
      } else {
        this.data = { users: {} };
      }
    } catch {
      this.data = { users: {} };
    }
  }

  /**
   * Forces an immediate save (rarely needed).
   * Useful if you want to save on shutdown.
   */
  saveNow() {
    try {
      const dir = path.dirname(this.filePath);
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}

      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      this._dirty = false;
    } catch (err) {
      console.error("[PRIORITY] saveNow failed:", err);
    }
  }

  /**
   * Marks store dirty + schedules a debounced write.
   * Debounce prevents lag when many users are recorded at once.
   */
  _markDirty() {
    this._dirty = true;
    if (this._saveTimer) return;

    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;

      // If nothing changed, skip
      if (!this._dirty) return;

      // Avoid overlapping saves
      if (this._saving) return;

      this._saving = true;
      this._dirty = false;

      const dir = path.dirname(this.filePath);
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}

      fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), (err) => {
        this._saving = false;
        if (err) {
          console.error("[PRIORITY] Save failed:", err);
          // Mark dirty again so it retries on next change
          this._dirty = true;
        }
      });
    }, 800);
  }

  /**
   * Records attendance for a list of Discord user IDs.
   * @param {string[]} userIds
   * @param {object=} meta Optional metadata about the session
   */
  recordAttendance(userIds, meta = {}) {
    if (!Array.isArray(userIds) || userIds.length === 0) return;

    const now = Date.now();

    if (!this.data || typeof this.data !== "object") this.data = { users: {} };
    if (!this.data.users || typeof this.data.users !== "object") this.data.users = {};

    for (const id of userIds) {
      if (!id) continue;

      const key = String(id);

      if (!this.data.users[key] || typeof this.data.users[key] !== "object") {
        this.data.users[key] = {};
      }

      this.data.users[key].lastAttendedAt = now;
      this.data.users[key].attendedCount = (this.data.users[key].attendedCount || 0) + 1;
      this.data.users[key].lastSessionMeta = meta;
    }

    this._markDirty();
  }

  /**
   * Returns epoch ms of last attendance or 0 if never.
   * @param {string} userId
   */
  getLastAttendedAt(userId) {
    const key = String(userId || "");
    return this.data?.users?.[key]?.lastAttendedAt || 0;
  }

  /**
   * Returns attended count or 0 if never.
   * @param {string} userId
   */
  getAttendedCount(userId) {
    const key = String(userId || "");
    return this.data?.users?.[key]?.attendedCount || 0;
  }
}

module.exports = PriorityStore;

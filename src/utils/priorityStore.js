// src/utils/priorityStore.js
const fs = require("fs");
const path = require("path");

class PriorityStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(process.cwd(), "src", "data", "priority.json");
    this.data = { users: {} };
    this._saveTimer = null;
    this._dirty = false;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") this.data = parsed;
      if (!this.data.users) this.data.users = {};
    } catch {
      this.data = { users: {} };
    }
  }

  _markDirty() {
    this._dirty = true;
    if (this._saveTimer) return;

    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (!this._dirty) return;
      this._dirty = false;

      const dir = path.dirname(this.filePath);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}

      fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), (err) => {
        if (err) console.error("[PRIORITY] Save failed:", err);
      });
    }, 800);
  }

  recordAttendance(userIds, meta = {}) {
    const now = Date.now();
    for (const id of userIds) {
      if (!id) continue;
      if (!this.data.users[id]) this.data.users[id] = {};
      this.data.users[id].lastAttendedAt = now;
      this.data.users[id].attendedCount = (this.data.users[id].attendedCount || 0) + 1;
      this.data.users[id].lastSessionMeta = meta;
    }
    this._markDirty();
  }

  getLastAttendedAt(userId) {
    return this.data.users?.[userId]?.lastAttendedAt || 0;
  }
}

module.exports = PriorityStore;

/*
 * Force Chamber — progress storage
 * Everything lives in one localStorage record. Storage can be unavailable
 * (private windows, sandboxed previews), so every access is guarded and the
 * game keeps working from memory.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const KEY = 'force-chamber.v1';

  function fresh(seed) {
    return {
      version: 1,
      seed: seed != null ? seed : Math.floor(Math.random() * 0x7fffffff),
      started: Date.now(),
      current: null,
      rooms: {},
      notebook: [],
      settings: { sound: true, theme: 'system', reducedMotion: false },
    };
  }

  const Save = {
    data: null,
    load() {
      let d = null;
      try {
        const raw = root.localStorage ? root.localStorage.getItem(KEY) : null;
        if (raw) d = JSON.parse(raw);
      } catch (e) { d = null; }
      if (!d || d.version !== 1) d = fresh();
      d.rooms = d.rooms || {};
      d.notebook = d.notebook || [];
      d.settings = Object.assign(fresh(0).settings, d.settings || {});
      this.data = d;
      return d;
    },
    write() {
      try {
        if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch (e) { /* storage unavailable: progress stays in memory */ }
    },
    reset(keepSettings = true) {
      const settings = this.data ? this.data.settings : null;
      this.data = fresh();
      if (keepSettings && settings) this.data.settings = settings;
      this.write();
      return this.data;
    },
    room(id) {
      const r = (this.data.rooms[id] = this.data.rooms[id] || {});
      r.locks = r.locks || {};
      r.state = r.state || {};
      r.hints = r.hints || 0;
      r.time = r.time || 0;
      r.attempts = r.attempts || 0;
      return r;
    },
    note(entry) {
      const nb = this.data.notebook;
      const i = nb.findIndex((n) => n.key === entry.key);
      if (i >= 0) nb[i] = entry; else nb.push(entry);
      this.write();
    },
  };

  Lab.Save = Save;
})(typeof window !== 'undefined' ? window : globalThis);

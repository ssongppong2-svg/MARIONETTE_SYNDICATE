/*
 * Force Chamber — game state (DOM-free)
 * Owns the save record, the laboratory constants shared by every chamber,
 * chamber progression and the fixed-step clock.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Mathx, Room, Chambers, Save } = Lab;

  const DT = 1 / 240;
  const GLYPHS = ['△', '○', '□', '◇', '☆', '⬡', '▽', '◎', '▣', '◈', '⬠', '✕', '⊕'];

  /**
   * Gravity of this laboratory. Deliberately not Earth's, so it has to be
   * measured in chamber 01 and carried through the rest of the facility.
   */
  function labConstants(seed) {
    const rng = Mathx.makeRng(Mathx.hashString('lab:' + seed));
    let g;
    do { g = rng.step(6.2, 12.4, 0.01); } while (g > 9.2 && g < 10.4);
    return { seed, g };
  }

  class Game {
    constructor(saveData) {
      this.data = saveData;
      this.lab = labConstants(saveData.seed);
      this.room = null;
      this.timeScale = 1;
      this.paused = false;
      this.strobe = false;
      this.showForces = false;
      this.acc = 0;
      this.listeners = {};
    }

    get chambers() { return Chambers; }
    chamber(id) { return Chambers.find((c) => c.id === id); }
    saveRoom(id) { return Save.room(id); }
    persist() { Save.write(); }
    note(entry) { Save.note(entry); this.emit('notebook'); }

    isCleared(def) { const r = this.data.rooms[def.id]; return !!(r && r.cleared); }
    isAvailable(def) {
      if (def.no === 1) return true;
      const prev = Chambers.find((c) => c.no === def.no - 1);
      return !prev || this.isCleared(prev) || this.isCleared(def);
    }
    get clearedCount() { return Chambers.filter((c) => this.isCleared(c)).length; }

    /** Code fragment revealed when chamber `no` is cleared (used by the final door). */
    fragment(no) {
      const h = Mathx.hashString('frag:' + this.lab.seed + ':' + no);
      return { no, glyph: GLYPHS[(no - 1) % GLYPHS.length], digit: h % 10 };
    }

    enter(id) {
      const def = this.chamber(id);
      if (!def) return null;
      if (this.room) this.room.persistState();
      this.room = new Room(this, def);
      this.data.current = id;
      this.acc = 0;
      this.paused = false;
      this.persist();
      this.emit('enter', this.room);
      return this.room;
    }

    resetRoom() {
      if (!this.room) return;
      this.room.reset();
      this.acc = 0;
      this.emit('reset', this.room);
    }

    onRoomCleared(room) {
      const r = this.saveRoom(room.id);
      const wasCleared = !!r.cleared;
      r.cleared = true;
      if (!r.clearedAt) r.clearedAt = Date.now();
      r.stars = Math.max(r.stars || 0, Math.max(1, 3 - (r.hints || 0)));
      if (!wasCleared && room.def.no < 14) {
        const f = this.fragment(room.def.no);
        this.note({ key: 'frag' + room.def.no, room: room.def.no, kind: 'fragment',
          text: `격실 ${String(room.def.no).padStart(2, '0')} 조각`, value: `${f.glyph} = ${f.digit}` });
      }
      this.persist();
      this.emit('cleared', room);
    }

    onRoomEvent(room, evt, ...args) { this.emit('room:' + evt, room, ...args); }

    /** Advance simulated time by real seconds; returns steps taken. */
    advance(realDt) {
      if (!this.room || this.paused) return 0;
      this.acc += Math.min(realDt, 0.1) * this.timeScale;
      let steps = 0;
      const maxSteps = 24;
      while (this.acc >= DT && steps < maxSteps) {
        this.room.step(DT);
        this.acc -= DT;
        steps++;
      }
      if (steps === maxSteps) this.acc = 0;
      return steps;
    }
    /** Interpolation factor between the last two physics states. */
    get alpha() { return this.paused ? 1 : Math.min(1, this.acc / DT); }

    on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
    emit(evt, ...args) { for (const fn of this.listeners[evt] || []) fn(...args); }
  }

  Lab.DT = DT;
  Lab.GLYPHS = GLYPHS;
  Lab.labConstants = labConstants;
  Lab.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * ΣF — rules (DOM-free).
 * The tow line, water bookkeeping, the glass, the trap hatch and its spring
 * latch, the cradle, the door's guide friction and governor, weighing, and an
 * event log for the HUD.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Sigma = (Lab.Sigma = Lab.Sigma || {});

  const SNAP_TIME = 0.08;   // s the line may be blocked before it snaps
  const PICK_RADIUS = 0.14; // m around the cursor that still catches a small object

  /**
   * The tow line: a damped spring from the cursor to a point on a body,
   * F = k·(cursor − p) + c·(v_cursor − v_p), never more than F_MAX.
   */
  class Tether {
    constructor(lv) {
      this.lv = lv;
      const T = lv.L.TETHER;
      this.k = T.k; this.fMax = T.fMax; this.zeta = T.zeta;
      this.body = null;
      this.local = null;
      this.hand = new Vec2(8, 6);
      this.handVel = new Vec2();
      this.F = new Vec2();
      this.stretch = 0;
      this.maxed = false;
      this.blocked = 0;
      this.peak = 0;
    }
    get point() { return this.body ? this.body.worldPoint(this.local) : null; }
    attach(body, p) {
      this.body = body;
      this.local = body.localPoint(p);
      this.vSmooth = new Vec2();
      this.blocked = 0;
      this.peak = 0;
    }
    detach() {
      const b = this.body;
      this.body = null;
      this.F = new Vec2();
      this.Fshow = 0;
      this.stretch = 0;
      this.maxed = false;
      return b;
    }
    apply(dt) {
      const b = this.body;
      if (!b) return;
      const p = b.worldPoint(this.local), v = b.velocityAt(p);
      const d = this.hand.sub(p);
      const c = 2 * this.zeta * Math.sqrt(this.k * b.mass);
      // Mouse events arrive unevenly; the line feels the hand's speed through a short low-pass.
      this.vSmooth = this.vSmooth || new Vec2();
      this.vSmooth = this.vSmooth.add(this.handVel.sub(this.vSmooth).scale(Math.min(1, dt / 0.06)));
      let F = d.scale(this.k).add(this.vSmooth.sub(v).scale(c));
      const f = F.len();
      this.maxed = f > this.fMax;
      if (this.maxed) F = F.scale(this.fMax / f);
      b.applyForce(F, p);
      // Tame the spin of an object hanging off-centre.
      b.torque -= b.I * 3 * b.angVel;
      this.F = F;
      this.Fshow = (this.Fshow || 0) + (F.len() - (this.Fshow || 0)) * Math.min(1, dt / 0.06);
      this.stretch = d.len();
      this.peak = Math.max(this.peak, F.len());
    }
  }

  class Rules {
    constructor(lv) {
      this.lv = lv;
      this.L = lv.L;
      this.tether = new Tether(lv);
      lv.world.addForce(this.tether);
      this.time = 0;
      this.events = [];
      this.log = [];
      this.motion = null;          // cursor motion over the current frame
      this.flows = { main: 0, needle: 0, over: 0 };
      this.totals = { main: 0, needle: 0, over: 0 };
      this.hatchLoad = 0;
      this.hatchOpen = 0;          // s left with the flaps down
      this.hatchDrops = 0;
      this.cradled = true;
      this.lockout = false;
      this.doorOpen = false;
      this.doorV = 0;
      this.doorVmax = 0;
      this.glassBroken = false;
      this.lastImpact = null;
      this.done = false;
      this.stats = { throws: 0, impacts: 0, peakTether: 0, glassHit: 0, snaps: 0 };
      this.history = [];           // sampled traces for the scope
      this.sampleT = 0;
      lv.world.onImpact = (arb, P) => this.impact(arb, P);
      this.note('sys', '세션 시작 · 견인줄 k ' + lv.L.TETHER.k + ' N/m · F_max ' + lv.L.TETHER.fMax + ' N');
    }

    /* ---------------- cursor and the line ---------------- */

    /** Move the hand to p over `duration` seconds of simulated time. */
    moveCursor(p, duration) {
      const t = this.tether;
      const d = Math.max(duration, 1e-3);
      this.motion = { to: p.clone(), left: d, vel: p.sub(t.hand).scale(1 / d) };
    }
    setCursor(p) {
      this.tether.hand = p.clone();
      this.tether.handVel = new Vec2();
      this.motion = null;
    }

    /** Places the hand cannot reach: rock, sealed rooms. */
    sealed(p) {
      const lv = this.lv, L = this.L, C = L.CABINET, SH = L.SHAFT, V = L.VAULT, T = L.TANK;
      const inBox = (x0, y0, x1, y1) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1;
      if (!this.glassBroken && inBox(C.x0, C.y0, C.x1, C.y1)) return '밀폐된 캐비닛';
      if (inBox(SH.x0, 0, SH.x1, L.DECK)) return '수직갱 내부';
      if (lv.doorRise() < 0.9 && inBox(V.x0 - 0.3, L.DECK, V.x1, V.y1)) return '금고 내부';
      if (inBox(T.x0, T.y0, T.x1, T.y1 + 0.3)) return '수조 내부';
      if (inBox(L.HEADER.x0, L.HEADER.y0, L.HEADER.x1, L.HEADER.y1)) return '보조 수조';
      for (const b of lv.world.bodiesAt(p, (b) => b.isStatic && b.shapes[0].category !== 0)) return b.tag ? b.kname || b.tag : '암반';
      return null;
    }

    /** Is the straight line from the hand to p clear of rock, glass, flaps and the door? */
    lineClear(from, to, ignore) {
      const hit = this.lv.world.raycast(from, to, (b) => b !== ignore && (b.isStatic || b.role === 'door') && b.shapes[0].category !== 0);
      return !hit;
    }

    /** The grabbable body under (or right next to) p. */
    pick(p) {
      const lv = this.lv;
      const under = lv.world.bodiesAt(p, (b) => b.grab);
      if (under.length) return { body: under[0], point: p.clone() };
      let best = null, bd = PICK_RADIUS;
      for (const b of lv.world.bodies) {
        if (!b.grab) continue;
        for (const s of b.shapes) {
          if (s.type !== 'polygon') continue;
          const v = s.wv;
          for (let i = 0; i < v.length; i++) {
            const q = Lab.Geom.closestPointOnSegment(p, v[i], v[(i + 1) % v.length]);
            const d = q.dist(p);
            if (d < bd) { bd = d; best = { body: b, point: q }; }
          }
        }
      }
      return best;
    }

    grab(p) {
      const t = this.tether;
      this.setCursor(p);
      const why = this.sealed(p);
      if (why) { this.note('warn', `견인 불가 · ${why}`); return null; }
      const hit = this.pick(p);
      if (!hit) return null;
      if (!this.lineClear(p, hit.point, hit.body)) { this.note('warn', `견인 불가 · ${hit.body.tag} 시야 차단`); return null; }
      t.attach(hit.body, hit.point);
      this.events.push({ type: 'grab', body: hit.body });
      return hit.body;
    }

    release() {
      const t = this.tether;
      const b = t.detach();
      if (!b) return null;
      const sp = b.vel.len();
      if (sp > 2 && !b.isKnob) {
        this.stats.throws++;
        this.note('throw', `${b.tag} 투척 · v ${sp.toFixed(2)} m/s · m ${b.mass.toFixed(1)} kg`);
      }
      this.events.push({ type: 'release', body: b });
      return b;
    }

    /* ---------------- events and the log ---------------- */
    note(kind, text) {
      this.log.push({ t: this.time, kind, text });
      if (this.log.length > 80) this.log.shift();
    }

    impact(arb, P) {
      const a = arb.a, b = arb.b;
      const tau = this.L.GLASS.tau;
      const F = P / tau;
      const glass = a.role === 'glass' ? a : b.role === 'glass' ? b : null;
      const other = glass ? (glass === a ? b : a) : null;
      if (glass && other && other.isDynamic && !this.glassBroken) {
        this.stats.glassHit++;
        this.lastImpact = { F, t: this.time, tag: other.tag };
        const th = this.L.GLASS.threshold;
        this.note(F >= th ? 'alert' : 'impact', `${other.tag} → GL-A 충격력 ${F.toFixed(1)} N (Δp ${P.toFixed(2)} N·s ÷ ${tau.toFixed(3)} s) ${F >= th ? '≥' : '<'} ${th} N`);
        this.events.push({ type: 'glassHit', F, p: arb.contacts[0].p, ok: F >= th });
        if (F >= th) this.breakGlass(other);
        return;
      }
      if (F < 120) return;
      const dyn = a.isDynamic ? a : b, oth = dyn === a ? b : a;
      if (!dyn.tag || dyn.role === 'bucket' || dyn.role === 'door' || dyn.isKnob) return;
      this.stats.impacts++;
      this.note('impact', `${dyn.tag} ↔ ${oth.tag || (oth.isStatic ? '암반' : '?')} 충격력 ${F.toFixed(1)} N`);
      this.events.push({ type: 'impact', F, p: arb.contacts[0].p });
    }

    breakGlass(by) {
      const lv = this.lv;
      this.glassBroken = true;
      lv.world.remove(lv.glass);
      this.events.push({ type: 'glass', p: lv.glass.pos.clone(), by });
      this.note('alert', 'GL-A 파괴 · 주 밸브 V-1 노출');
    }

    /* ---------------- step ---------------- */
    step(dt) {
      const lv = this.lv, L = this.L, t = this.tether, w = lv.world;

      // Hand motion across the frame, so the line feels the cursor's speed.
      if (this.motion) {
        const m = this.motion;
        const h = Math.min(dt, m.left);
        t.hand = t.hand.add(m.vel.scale(h));
        t.handVel = m.vel.clone();
        m.left -= dt;
        if (m.left <= 0) { t.hand = m.to.clone(); t.handVel = new Vec2(); this.motion = null; }
      } else t.handVel = new Vec2();

      // The line snaps when something solid comes between, or the hand enters rock.
      if (t.body) {
        const blocked = this.sealed(t.hand) || !this.lineClear(t.hand, t.point, t.body);
        t.blocked = blocked ? t.blocked + dt : 0;
        if (t.blocked > SNAP_TIME) {
          const b = t.body;
          this.release();
          this.stats.snaps++;
          this.note('warn', `견인줄 차단 · ${b.tag} 해제`);
          this.events.push({ type: 'snap', body: b });
        }
      }

      this.water(dt);
      this.doorFriction();
      this.trapSpring();
      w.step(dt);
      this.time += dt;
      if (t.body) this.stats.peakTether = Math.max(this.stats.peakTether, t.F.len());

      this.hatch(dt);
      this.weigh(dt);
      this.cradle();
      this.door(dt);
      if (!this.done && lv.core.pos.x < L.GOAL_X) {
        this.done = true;
        this.doneAt = this.time;
        this.note('alert', `C-0 회수 완료 · 경과 ${this.time.toFixed(1)} s`);
        this.events.push({ type: 'done', p: lv.core.pos.clone() });
      }
      this.sample(dt);
    }

    water(dt) {
      const lv = this.lv, L = this.L, S = L.SUMP;
      // Tank → sump through the main valve.
      const qm = lv.tankWater > 0 ? L.MAIN_Q * lv.mainOpen() : 0;
      const dm = Math.min(lv.tankWater, qm * dt);
      lv.tankWater -= dm;
      lv.sumpWater += dm;
      this.totals.main += dm;
      this.flows.main = dm / dt;
      // Above the overflow line the sump spills down a pipe into the bucket.
      const cap = (S.overflow - S.floor) * (S.x1 - S.x0) * 100;
      let over = 0;
      if (lv.sumpWater > cap) { over = lv.sumpWater - cap; lv.sumpWater = cap; }
      this.flows.over += (over / dt - this.flows.over) * Math.min(1, dt / 0.15);
      this.totals.over += over;
      if (over > 1e-6 && !this.overNoted) { this.overNoted = true; this.note('alert', '월류 시작 · 침수 구역 → 버킷 CW'); }
      // Header tank → bucket through the needle valve.
      const qn = lv.headerWater > 0 ? L.NEEDLE_Q * lv.needleOpen() : 0;
      const dn = Math.min(lv.headerWater, qn * dt);
      lv.headerWater -= dn;
      this.totals.needle += dn;
      this.flows.needle = dn / dt;
      const into = over + dn;
      if (into > 0) {
        const room = Math.max(0, L.BUCKET.capacity - lv.bucketWater);
        const kept = Math.min(room, into);
        lv.bucketWater += kept;
        lv.spilled += into - kept;
        lv.bucket.setMass(L.BUCKET.mass + lv.bucketWater);
      }
      lv.sumpFluid.surface = lv.sumpLevel();
    }

    /** Guide friction: up to f_s holds the door still; once it slides, f_k resists. */
    doorFriction() {
      const lv = this.lv, Dr = this.L.DOOR, m = lv.doorRail.motor;
      if (this.lockout) { m.maxForce = 1e7; return; }
      m.maxForce = Math.abs(lv.door.vel.y) < 0.004 ? Dr.fs : Dr.fk;
    }

    /** Trap lever spring, the load cell under the flaps, and the flaps themselves. */
    hatch(dt) {
      const lv = this.lv, H = this.L.HATCH, T = this.L.TRAP;
      // Load on the closed flaps (what rests on the hatch).
      let load = 0;
      if (this.hatchOpen <= 0) {
        for (const arb of lv.world.arbiters.values()) {
          const flap = lv.hatch.includes(arb.a) ? arb.a : lv.hatch.includes(arb.b) ? arb.b : null;
          if (!flap) continue;
          let P = 0;
          for (const c of arb.contacts) P += c.Pn;
          load += (P * Math.abs(arb.normal.y)) / lv.world.dt;
        }
      }
      this.hatchLoad += (load - this.hatchLoad) * Math.min(1, dt / 0.12);
      // The latch trips once the lever has been pulled far enough.
      const x = lv.trapTravel();
      if (this.hatchOpen <= 0 && x >= T.trip && !this.trapArmed) {
        this.trapArmed = true;
        for (const f of lv.hatch) lv.world.remove(f);
        this.hatchOpen = H.open;
        this.hatchDrops++;
        this.note('alert', `T-1 걸쇠 해제 · H-1 개방 · 직전 하중 ${this.hatchLoad.toFixed(1)} N`);
        this.events.push({ type: 'hatch', load: this.hatchLoad });
      }
      if (x < 0.05) this.trapArmed = false;
      if (this.hatchOpen > 0) {
        this.hatchOpen -= dt;
        if (this.hatchOpen <= 0) {
          // Close only when nothing is in the way of the flaps.
          const blocked = lv.hatch.some((f) => lv.world.shapeOverlapsAny(f.shapes[0], (b) => !b.isDynamic || b.isKnob));
          if (blocked) this.hatchOpen = 0.1;
          else {
            for (const f of lv.hatch) lv.world.add(f);
            this.events.push({ type: 'hatchClose' });
          }
        }
      }
    }

    /** The latch spring pulls the trap lever home: F = F0 + k·x. */
    trapSpring() {
      const lv = this.lv, T = this.L.TRAP, x = Math.max(0, lv.trapTravel());
      const F = x > 1e-4 || lv.trap.vel.x > 0 ? T.f0 + T.k * x : 0;
      lv.trap.applyForce(new Vec2(-F, 0));
      this.trapForce = F;
    }

    /** Objects whose mass the sensors miss reveal it once weighed: still on the line, or alone on the hatch. */
    weigh(dt) {
      const lv = this.lv, t = this.tether, b = t.body;
      let cand = null, W = 0;
      if (b && b.unknown && !b.weighed && lv.world.contactsOf(b).length === 0 && b.vel.len() < 0.03) { cand = b; W = t.F.len(); }
      if (!cand && this.hatchOpen <= 0) {
        const on = new Set();
        for (const arb of lv.world.arbiters.values()) {
          if (lv.hatch.includes(arb.a)) on.add(arb.b);
          else if (lv.hatch.includes(arb.b)) on.add(arb.a);
        }
        if (on.size === 1) {
          const o = [...on][0];
          if (o.unknown && !o.weighed && o.vel.len() < 0.01 && lv.world.contactsOf(o).length === 1) { cand = o; W = this.hatchLoad; }
        }
      }
      if (!cand || cand !== this.weighing) { this.weighing = cand; this.weighT = 0; return; }
      this.weighT += dt;
      if (this.weighT > 0.8) {
        cand.weighed = true;
        this.note('alert', `${cand.tag} 계량 · W ${W.toFixed(1)} N → m = W/g = ${(W / lv.G).toFixed(2)} kg`);
        this.events.push({ type: 'weighed', body: cand });
        this.weighing = null;
      }
    }

    cradle() {
      const lv = this.lv;
      if (!this.cradled || lv.pinTravel() < this.L.PIN.release) return;
      this.cradled = false;
      for (const c of lv.cradle) lv.world.remove(c);
      this.releasedAt = this.time;
      this.note('alert', `거치대 해제 · W_CW ${this.bucketWeight().toFixed(1)} N`);
      this.events.push({ type: 'cradle' });
    }

    door(dt) {
      const lv = this.lv, Dr = this.L.DOOR;
      const v = lv.door.vel.y;
      this.doorV = v;
      // A governor's flyweights answer sustained speed, not a single jolt: filter over 0.1 s.
      this.doorVf = (this.doorVf || 0) + (v - (this.doorVf || 0)) * Math.min(1, dt / 0.1);
      if (!this.cradled) this.doorVmax = Math.max(this.doorVmax, this.doorVf);
      if (!this.lockout && this.doorVf > Dr.vMax) {
        this.lockout = true;
        this.lockAt = this.time;
        this.note('alert', `조속기 작동 · v ${this.doorVf.toFixed(3)} m/s > ${Dr.vMax} m/s · LOCKOUT`);
        this.events.push({ type: 'lockout' });
      }
      if (!this.doorOpen && lv.doorRise() > Dr.rise - 0.02) {
        this.doorOpen = true;
        this.note('alert', `D-1 완전 개방 · 최고 속도 ${this.doorVmax.toFixed(3)} m/s`);
        this.events.push({ type: 'open' });
      }
      if (!this.moving && !this.cradled && v > 0.01) { this.moving = true; this.note('sys', `D-1 출발 · ΣF > 0`); }
    }

    /* ---------------- readouts ---------------- */
    bucketWeight() {
      return this.bucketMass() * this.lv.G;
    }
    /** Bucket plus everything resting in it. */
    bucketMass() {
      const lv = this.lv;
      let m = lv.bucket.mass;
      for (const b of this.bucketContents()) m += b.mass;
      return m;
    }
    /** Everything resting in the bucket, or stacked on what rests in it. */
    bucketContents() {
      const lv = this.lv, out = new Set(), queue = [lv.bucket];
      while (queue.length) {
        const base = queue.shift();
        for (const arb of lv.world.arbiters.values()) {
          if (arb.a !== base && arb.b !== base) continue;
          const other = arb.a === base ? arb.b : arb.a;
          if (!other.grab || other.isKnob || out.has(other)) continue;
          // The other body must sit on top of `base` (contact normal pointing up into it).
          const n = arb.b === other ? arb.normal : arb.normal.neg();
          let P = 0;
          for (const c of arb.contacts) P += c.Pn;
          if (n.y < 0.3 || P <= 0) continue;
          out.add(other);
          queue.push(other);
        }
      }
      return [...out];
    }

    /** Forces on a body this step, for the free-body readout. */
    analyze(body) {
      const lv = this.lv, w = lv.world, dt = w.dt, g = lv.G;
      const out = { W: body.mass * g, N: 0, fr: 0, frMax: 0, mus: 0, muk: 0, B: 0, tether: null, contacts: [], sliding: false };
      for (const arb of w.arbiters.values()) {
        if (arb.a !== body && arb.b !== body) continue;
        const sign = arb.b === body ? 1 : -1;
        // Normal pointing into this body; along the tangent (n.y, −n.x) the friction on it is Pt either way round.
        const n = arb.normal.scale(sign);
        let Pn = 0, Pt = 0, slide = false;
        for (const c of arb.contacts) { Pn += c.Pn; Pt += c.Pt; if (!c.sticking) slide = true; }
        const fn = Pn / dt, ft = Pt / dt;
        if (fn < 1e-3) continue;
        const other = arb.a === body ? arb.b : arb.a;
        out.contacts.push({ other, n, fn, ft, p: arb.contacts[0].p, mus: arb.mus, muk: arb.muk, slide });
        // Support from below: the floor-like contacts carry the normal force the friction rule uses.
        if (n.y > 0.5) {
          out.N += fn * n.y;
          out.fr += Math.abs(ft);
          out.frMax += arb.mus * fn;
          out.mus = arb.mus; out.muk = arb.muk;
          if (slide) out.sliding = true;
        }
      }
      if (body.buoyancy) for (const q of body.buoyancy) out.B += q.F.y;
      if (this.tether.body === body) out.tether = this.tether.F.clone();
      return out;
    }

    sample(dt) {
      this.sampleT += dt;
      if (this.sampleT < 1 / 60) return;
      this.sampleT = 0;
      const lv = this.lv;
      const W = this.bucketWeight(), Dr = this.L.DOOR, Wd = Dr.mass * lv.G;
      this.history.push({
        t: this.time,
        F: this.tether.body ? this.tether.F.len() : 0,
        sum: W - Wd - (this.moving ? Dr.fk : Dr.fs),
        h: lv.sumpLevel(),
        v: this.doorV,
      });
      if (this.history.length > 600) this.history.shift();
    }

    drainEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }
  }

  Sigma.Rules = Rules;
  Sigma.Tether = Tether;
})(typeof window !== 'undefined' ? window : globalThis);

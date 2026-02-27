// ═══════════════════════════════════════════════════════
//  NECRO BOSS MONITOR — app.js
//  Alt1 screen reading: buffs, HP, prayer, stacks
// ═══════════════════════════════════════════════════════

// Don't run outside Alt1
if (!window.alt1) {
  document.getElementById('footer-status').textContent = 'OPEN IN ALT1';
  document.getElementById('not-alt1-banner').style.display = 'block';
} else {
  startMonitor();
}

function startMonitor() {
  document.getElementById('footer-status').textContent = 'SCANNING...';

  const buffReader   = new alt1.BuffReader();
  const statusReader = new alt1.StatusBars();

  let buffPos  = null;
  let lastFinger = 0;
  let lastVolley = 0;

  // Buff names as RS3 reports them (lowercase for matching)
  // These are the buff bar names Alt1 reads — may need minor tweaks
  // once tested in-game
  const BUFF_MAP = {
    'overload':          'ovl',
    'prayer renewal':    'prayrenew',
    'weapon poison':     'weapon',
    'antifire':          'antifire',
    'darkness':          'darkness',
    'quick prayers':     'quickpray',
    'animate dead':      'animdead',
    'soul drain':        'souldrain',
    'ritual shard':      'riteshard',
    'living death':      'livingdeath',
    'scriptural aura':   'aura',
    'vampyrism aura':    'aura',
    'mahjarrat aura':    'aura',
    'berserker aura':    'aura',
    'maniacal aura':     'aura',
    'scripture of ful':  'book',
    'scripture of jas':  'book',
    'scripture of bik':  'book',
    'book of war':       'book',
    'pack yak':          'familiar',
    'nihil':             'familiar',
    'ripper demon':      'familiar',
    'aggression potion': 'aggro',
    'smoke cloud':       'smokecloud',
    'excalibur':         'excal',
    'super summoning':   'sumrenew',
    'vulnerability':     'vuln',
  };

  // Stack buff names
  const NECRO_BUFF = 'necrosis';
  const SOUL_BUFF  = 'residual souls';

  function matchBuff(rawName) {
    const lower = rawName.toLowerCase();
    for (const key in BUFF_MAP) {
      if (lower.includes(key)) return BUFF_MAP[key];
    }
    return null;
  }

  function mainLoop() {
    try {
      const img = alt1.captureHold();
      if (!img) return;

      // Find buff bar position on first run
      if (!buffPos) {
        buffPos = buffReader.find(img);
        if (!buffPos) {
          document.getElementById('footer-status').textContent = 'BUFF BAR NOT FOUND';
          return;
        }
        document.getElementById('footer-status').textContent = 'READING BUFFS';
      }

      // Read buffs
      const buffs = buffReader.read(img, buffPos);
      if (!buffs) return;

      tickDot();

      // Track which of our monitored buffs are currently active
      const activeMappedIds = new Set();
      let newNecro = 0;
      let newSouls = 0;

      buffs.forEach(b => {
        if (!b || !b.name) return;
        const lower = b.name.toLowerCase();

        // Necrosis stacks
        if (lower.includes(NECRO_BUFF)) {
          newNecro = b.stacks || b.count || 0;
          return;
        }
        // Residual soul stacks
        if (lower.includes(SOUL_BUFF)) {
          newSouls = b.stacks || b.count || 0;
          return;
        }

        // Map to our buff IDs
        const id = matchBuff(b.name);
        if (id) activeMappedIds.add(id);
      });

      // Update stacks
      const prevNecro = window.APP_STATE.necrosis;
      const prevSouls = window.APP_STATE.souls;
      window.APP_STATE.necrosis = newNecro;
      window.APP_STATE.souls    = newSouls;

      if (newNecro !== prevNecro || newSouls !== prevSouls) {
        renderDots();
        checkStackAlerts(prevNecro, prevSouls, newNecro, newSouls);
      }

      // Read HP and prayer from status bars
      const status = statusReader.read(img);
      if (status) {
        if (status.hp)     window.APP_STATE.hpPct    = status.hp.percent     ?? 100;
        if (status.prayer) window.APP_STATE.prayerPct = status.prayer.percent ?? 100;
      }

      // Fire buff alerts — a buff is "alert" if it's ENABLED and NOT active on bar
      // (i.e. it ran out or was never applied)
      // For timers (ovl, prayrenew, book, aura etc) — use time remaining vs timebuffer
      if (window.APP_STATE.master) {
        checkBuffAlerts(buffs, activeMappedIds);
        checkVitalAlerts();
      }

    } catch(e) {
      if (window.CFG.debug) console.error('mainLoop error:', e);
    }
  }

  function checkBuffAlerts(buffs, activeMappedIds) {
    const timeBuf = window.CFG.timeBuf; // seconds buffer

    // Build a time map for buffs that have timers
    const buffTimes = {};
    buffs.forEach(b => {
      if (!b || !b.name) return;
      const id = matchBuff(b.name);
      if (id && b.time !== undefined) buffTimes[id] = b.time;
    });

    // Check each enabled buff
    const timedBuffs = ['ovl','prayrenew','weapon','antifire','animdead','aura','book','excal','sumrenew','darkness'];
    const presenceBuffs = ['quickpray','souldrain','riteshard','livingdeath','aggro','smokecloud','vuln','familiar'];

    timedBuffs.forEach(id => {
      if (!isEnabled(id)) return;
      if (buffTimes[id] !== undefined) {
        // Active — alert if below time buffer
        setTriggered(id, buffTimes[id] <= timeBuf);
      } else {
        // Not on bar at all — definitely alert
        setTriggered(id, true);
      }
    });

    presenceBuffs.forEach(id => {
      if (!isEnabled(id)) return;
      setTriggered(id, !activeMappedIds.has(id));
    });
  }

  function checkVitalAlerts() {
    if (isEnabled('lowhp')) {
      const t = window.APP_STATE.hpPct <= window.CFG.hpWarnPct;
      if (t && !window.APP_STATE.triggered.has('lowhp')) {
        playSound('danger'); flashBorder('#e03030');
      }
      setTriggered('lowhp', t);
    }
    if (isEnabled('lowpray')) {
      const t = window.APP_STATE.prayerPct <= window.CFG.prayWarnPct;
      if (t && !window.APP_STATE.triggered.has('lowpray')) {
        playSound('warning'); flashBorder('#8040c0');
      }
      setTriggered('lowpray', t);
    }
  }

  function checkStackAlerts(prevNecro, prevSouls, newNecro, newSouls) {
    const now = Date.now();

    // FINGER at 6 or 12 necrosis stacks
    if ((newNecro === 6 || newNecro === 12) && newNecro !== prevNecro) {
      if (now - lastFinger > 2500) {
        lastFinger = now;
        showAction('FINGER', 'finger');
        playSound('finger');
        flashBorder('#c040ff');
      }
    }

    // VOLLEY at 5 soul stacks
    if (newSouls === 5 && prevSouls < 5) {
      if (now - lastVolley > 2500) {
        lastVolley = now;
        showAction('VOLLEY', 'volley');
        playSound('volley');
        flashBorder('#40d0ff');
      }
    }
  }

  // Start the loop
  const intervalId = setInterval(mainLoop, window.CFG.refreshMs);

  // Allow refresh rate changes to update the loop
  window._restartLoop = function() {
    clearInterval(intervalId);
    setInterval(mainLoop, window.CFG.refreshMs);
  };
}

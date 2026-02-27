// ═══════════════════════════════════════════════════════
//  NECRO BOSS MONITOR — app.js
//  Alt1 screen reading: buffs, HP, prayer, stacks
// ═══════════════════════════════════════════════════════

// Don't run outside Alt1
if (!window.alt1) {
  document.getElementById('footer-status').textContent = 'OPEN IN ALT1';
  document.getElementById('not-alt1-banner').style.display = 'block';
} else {
  // This triggers the yellow "Add App" button in Alt1's browser toolbar
  alt1.identifyAppUrl('./appconfig.json');
  startMonitor();
}

function startMonitor() {
  document.getElementById('footer-status').textContent = 'SCANNING...';

  // Use a1lib (loaded from alt1lib.js) for buff and status bar reading
  const buffReader = new alt1.BuffReader();

  let buffPos   = null;
  let lastFinger = 0;
  let lastVolley = 0;

  // Map from RS3 buff bar names (lowercase, partial match) to our internal IDs
  const BUFF_MAP = {
    'overload':          'ovl',
    'prayer renewal':    'prayrenew',
    'weapon poison':     'weapon',
    'antifire':          'antifire',
    'darkness':          'darkness',
    'quick prayers':     'quickpray',
    'quick prayer':      'quickpray',
    'animate dead':      'animdead',
    'soul drain':        'souldrain',
    'ritual shard':      'riteshard',
    'living death':      'livingdeath',
    'scriptural':        'aura',
    'vampyrism':         'aura',
    'mahjarrat':         'aura',
    'berserker':         'aura',
    'maniacal':          'aura',
    'inspiration':       'aura',
    'scripture of ful':  'book',
    'scripture of jas':  'book',
    'scripture of bik':  'book',
    'scripture of wen':  'book',
    'book of':           'book',
    'pack yak':          'familiar',
    'nihil':             'familiar',
    'ripper':            'familiar',
    'aggression':        'aggro',
    'smoke cloud':       'smokecloud',
    'excalibur':         'excal',
    'super summoning':   'sumrenew',
    'vulnerability':     'vuln',
  };

  const NECRO_BUFF = 'necrosis';
  const SOUL_BUFF  = 'residual soul';

  function matchBuff(rawName) {
    const lower = rawName.toLowerCase();
    for (const key in BUFF_MAP) {
      if (lower.includes(key)) return BUFF_MAP[key];
    }
    return null;
  }

  function mainLoop() {
    try {
      // Capture the full RS3 window
      const img = alt1.captureHold(0, 0, alt1.rsWidth, alt1.rsHeight);
      if (!img) return;

      // Find buff bar on first run
      if (!buffPos) {
        buffPos = buffReader.find(img);
        if (!buffPos) {
          document.getElementById('footer-status').textContent = 'BUFF BAR NOT FOUND — focus RS3';
          return;
        }
        document.getElementById('footer-status').textContent = 'READING BUFFS';
      }

      // Read all active buffs
      const buffs = buffReader.read(img, buffPos) || [];

      // Debug: enable in Settings to log all buff names to browser console
      if (window.CFG.debug) {
        console.log('[NecroMon] Buffs:', buffs.map(b => b.name + ' t=' + b.time + ' stacks=' + (b.stacks || b.count || 0)));
        document.getElementById('footer-status').textContent = buffs.length + ' buffs found';
      }

      tickDot();

      const activeMappedIds = new Set();
      let newNecro = 0;
      let newSouls = 0;

      buffs.forEach(b => {
        if (!b || !b.name) return;
        const lower = b.name.toLowerCase();

        // Necrosis stacks
        if (lower.includes(NECRO_BUFF)) {
          newNecro = b.stacks || b.count || parseInt(b.name.replace(/\D/g,'')) || 0;
          return;
        }
        // Residual soul stacks
        if (lower.includes(SOUL_BUFF)) {
          newSouls = b.stacks || b.count || parseInt(b.name.replace(/\D/g,'')) || 0;
          return;
        }

        const id = matchBuff(b.name);
        if (id) activeMappedIds.add(id);
      });

      // Update stacks if changed
      const prevNecro = window.APP_STATE.necrosis;
      const prevSouls = window.APP_STATE.souls;
      window.APP_STATE.necrosis = newNecro;
      window.APP_STATE.souls    = newSouls;

      if (newNecro !== prevNecro || newSouls !== prevSouls) {
        renderDots();
        checkStackAlerts(prevNecro, prevSouls, newNecro, newSouls);
      }

      // Read HP/Prayer from orbs
      try {
        const hpData = alt1.getHpBar ? alt1.getHpBar() : null;
        if (hpData !== null && hpData >= 0) window.APP_STATE.hpPct = hpData;
        const prayData = alt1.getPrayerBar ? alt1.getPrayerBar() : null;
        if (prayData !== null && prayData >= 0) window.APP_STATE.prayerPct = prayData;
      } catch(e) {}

      if (window.APP_STATE.master) {
        checkBuffAlerts(buffs, activeMappedIds);
        checkVitalAlerts();
      }

    } catch(e) {
      if (window.CFG.debug) console.error('[NecroMon] Error:', e);
      // If buff bar lost (e.g. interface changed), reset so it searches again
      buffPos = null;
    }
  }

  function checkBuffAlerts(buffs, activeMappedIds) {
    const timeBuf = window.CFG.timeBuf;

    // Build time remaining map for timed buffs
    const buffTimes = {};
    buffs.forEach(b => {
      if (!b || !b.name) return;
      const id = matchBuff(b.name);
      if (id && b.time !== undefined && b.time !== null) buffTimes[id] = b.time;
    });

    // Timed buffs — alert if missing or about to expire
    const timedBuffs = ['ovl','prayrenew','weapon','antifire','animdead','aura','book','excal','sumrenew','darkness'];
    timedBuffs.forEach(id => {
      if (!window.isEnabled(id)) return;
      if (buffTimes[id] !== undefined) {
        const wasOk = !window.APP_STATE.triggered.has(id);
        const nowAlert = buffTimes[id] <= timeBuf;
        if (nowAlert && wasOk) { playSound('warning'); flashBorder('#c8a030'); }
        setTriggered(id, nowAlert);
      } else {
        // Not on bar at all
        if (!window.APP_STATE.triggered.has(id)) { playSound('warning'); flashBorder('#c8a030'); }
        setTriggered(id, true);
      }
    });

    // Presence buffs — alert if not on bar
    const presenceBuffs = ['quickpray','souldrain','riteshard','livingdeath','aggro','smokecloud','vuln','familiar'];
    presenceBuffs.forEach(id => {
      if (!window.isEnabled(id)) return;
      const missing = !activeMappedIds.has(id);
      if (missing && !window.APP_STATE.triggered.has(id)) { playSound('warning'); flashBorder('#c8a030'); }
      setTriggered(id, missing);
    });
  }

  function checkVitalAlerts() {
    if (window.isEnabled('lowhp')) {
      const t = window.APP_STATE.hpPct <= window.CFG.hpWarnPct;
      if (t && !window.APP_STATE.triggered.has('lowhp')) { playSound('danger'); flashBorder('#e03030'); }
      setTriggered('lowhp', t);
    }
    if (window.isEnabled('lowpray')) {
      const t = window.APP_STATE.prayerPct <= window.CFG.prayWarnPct;
      if (t && !window.APP_STATE.triggered.has('lowpray')) { playSound('warning'); flashBorder('#8040c0'); }
      setTriggered('lowpray', t);
    }
  }

  function checkStackAlerts(prevNecro, prevSouls, newNecro, newSouls) {
    const now = Date.now();
    if ((newNecro === 6 || newNecro === 12) && newNecro !== prevNecro) {
      if (now - lastFinger > 2500) {
        lastFinger = now;
        showAction('FINGER', 'finger');
        playSound('finger');
        flashBorder('#c040ff');
      }
    }
    if (newSouls === 5 && prevSouls < 5) {
      if (now - lastVolley > 2500) {
        lastVolley = now;
        showAction('VOLLEY', 'volley');
        playSound('volley');
        flashBorder('#40d0ff');
      }
    }
  }

  // Start the main loop
  setInterval(mainLoop, window.CFG.refreshMs);
}

/* Pont de papier : marché du matériel pour le défi du pont en papier.
   Tout l'état est dans `state` et sauvegardé dans le navigateur (localStorage).
   Les soldes, stocks et possessions sont recalculés à partir du journal des
   opérations (`state.tx`), ce qui rend l'annulation fiable.
   Les montants sont stockés en centimes pour éviter les erreurs d'arrondi. */
(function () {
  'use strict';

  var KEY = 'pont-papier-v1';
  var COLORS = ['#2f6fdf', '#e8590c', '#2f9e44', '#9c36b5', '#e03131', '#0c8599',
    '#d08700', '#6741d9', '#c2255c', '#4c6ef5', '#5c940d', '#5f6b7a'];

  var seq = Date.now();
  function uid() { return (seq++).toString(36); }

  function defaults() {
    var groups = [];
    for (var i = 0; i < 6; i++) groups.push({ id: uid(), name: 'Groupe ' + (i + 1), color: COLORS[i] });
    return {
      settings: { budget: 500, sellRatio: 50, span: '', target: '' },
      groups: groups,
      items: [
        { id: uid(), name: 'Feuille A4', unit: 'feuille', base: 50, stock: 50, rise: 150, resell: true },
        { id: uid(), name: 'Scotch 5 cm', unit: 'bout', base: 15, stock: 60, rise: 100, resell: true },
        { id: uid(), name: 'Scotch 10 cm', unit: 'bout', base: 30, stock: 40, rise: 100, resell: true },
        { id: uid(), name: 'Coup de ciseaux', unit: 'coup', base: 40, stock: null, rise: 0, resell: false }
      ],
      tx: [],
      weights: {},
      ui: { view: 'market', theme: 'auto', scale: 1 }
    };
  }

  function load() {
    var d = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return d;
      var s = JSON.parse(raw);
      return {
        settings: Object.assign(d.settings, s.settings),
        groups: Array.isArray(s.groups) ? s.groups : d.groups,
        items: Array.isArray(s.items) ? s.items : d.items,
        tx: Array.isArray(s.tx) ? s.tx : [],
        weights: s.weights || {},
        ui: Object.assign(d.ui, s.ui)
      };
    } catch (e) {
      return d;
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* stockage indisponible */ }
  }

  var state = load();
  var till = { gid: null, qty: {}, msg: '', msgType: '' };
  var prev = { price: {}, bal: {} };

  /* ---------- Utilitaires ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function eur(cents) {
    var neg = cents < 0;
    var v = (Math.abs(cents) / 100).toFixed(2).replace('.', ',');
    return (neg ? '−' : '') + v + ' €';
  }
  function parseEuros(str) {
    var v = parseFloat(String(str).replace(',', '.').replace(/[^\d.\-]/g, ''));
    return isNaN(v) ? null : Math.round(v * 100);
  }
  function centsToInput(c) { return (c / 100).toFixed(2).replace('.', ','); }
  function plural(n, word) {
    if (n > 1 && !/[sx]$/.test(word)) {
      return word.split(' ').map(function (w, i) { return i === 0 ? w + 's' : w; }).join(' ');
    }
    return word;
  }
  function groupById(id) { return state.groups.find(function (g) { return g.id === id; }); }
  function itemById(id) { return state.items.find(function (it) { return it.id === id; }); }
  function groupIndex(id) { return state.groups.findIndex(function (g) { return g.id === id; }); }

  /* ---------- Calculs du marché ---------- */
  function unlimited(item) { return item.stock == null || item.stock <= 0; }

  function stockOf(item) {
    if (unlimited(item)) return Infinity;
    var s = item.stock;
    state.tx.forEach(function (t) {
      if (t.item !== item.id) return;
      if (t.type === 'buy') s -= t.qty;
      else if (t.type === 'sell') s += t.qty;
    });
    return s;
  }

  // Prix d'une unité quand il en reste `s` en stock.
  // Le prix monte de façon linéaire : prix de départ quand le stock est plein,
  // prix de départ × (1 + hausse) quand le stock est vide.
  function priceAt(item, s) {
    if (unlimited(item)) return item.base;
    var used = 1 - clamp(s, 0, item.stock) / item.stock;
    return Math.round(item.base * (1 + (item.rise / 100) * used));
  }

  function sellUnit(item, s) {
    return Math.round(priceAt(item, s) * state.settings.sellRatio / 100);
  }

  // Coût total pour acheter `qty` unités (chaque unité achetée fait monter le prix de la suivante).
  function buyQuote(item, qty) {
    var s = stockOf(item), total = 0;
    for (var i = 0; i < qty; i++) {
      if (s <= 0) return null;
      total += priceAt(item, s);
      s--;
    }
    return total;
  }

  // Gain total pour revendre `qty` unités (chaque unité revendue fait baisser le prix de la suivante).
  function sellQuote(item, qty) {
    var s = stockOf(item), total = 0;
    for (var i = 0; i < qty; i++) {
      total += sellUnit(item, s);
      s++;
    }
    return total;
  }

  function balanceOf(gid) {
    var b = state.settings.budget;
    state.tx.forEach(function (t) {
      if (t.g !== gid) return;
      if (t.type === 'buy') b -= t.cents;
      else b += t.cents; // revente (positive) ou ajustement (signé)
    });
    return b;
  }

  function ownedOf(gid, iid) {
    var n = 0;
    state.tx.forEach(function (t) {
      if (t.g !== gid || t.item !== iid) return;
      if (t.type === 'buy') n += t.qty;
      else if (t.type === 'sell') n -= t.qty;
    });
    return n;
  }

  function hasTx(pred) { return state.tx.some(pred); }

  function costOf(gid) { return state.settings.budget - balanceOf(gid); }

  function weightOf(gid) {
    var w = state.weights[gid];
    if (w === '' || w == null) return null;
    w = parseFloat(String(w).replace(',', '.'));
    return isNaN(w) ? null : w;
  }

  function scoreOf(gid) {
    var w = weightOf(gid);
    if (w == null) return null;
    var c = Math.max(costOf(gid), 1);
    return w / (c / 100);
  }

  /* ---------- Opérations ---------- */
  function describe(t) {
    var g = groupById(t.g), it = itemById(t.item);
    var gname = g ? g.name : 'Groupe supprimé';
    var iname = it ? it.name : 'article supprimé';
    if (t.type === 'buy') return gname + ' achète ' + t.qty + ' × ' + iname + ' (' + eur(-t.cents) + ')';
    if (t.type === 'sell') return gname + ' revend ' + t.qty + ' × ' + iname + ' (+' + eur(t.cents) + ')';
    return gname + ' : ' + (t.cents >= 0 ? 'bonus +' + eur(t.cents) : 'pénalité ' + eur(t.cents)) +
      (t.note ? ' · ' + t.note : '');
  }

  function commit(t) {
    t.id = uid();
    t.t = Date.now();
    state.tx.push(t);
    save();
    setTillMsg(describe(t), 'ok');
    renderAll();
    toast(describe(t));
  }

  function fail(msg) {
    setTillMsg(msg, 'err');
    renderTill();
    toast(msg, null, null, true);
  }

  function buy(gid, iid, qty) {
    var item = itemById(iid);
    if (!item || qty < 1) return;
    var cost = buyQuote(item, qty);
    if (cost == null) return fail('Stock insuffisant : il reste ' + stockOf(item) + ' ' + plural(stockOf(item), item.unit) + '.');
    var bal = balanceOf(gid);
    if (cost > bal) return fail('Pas assez d’argent : il faut ' + eur(cost) + ', le groupe a ' + eur(bal) + '.');
    commit({ type: 'buy', g: gid, item: iid, qty: qty, cents: cost });
  }

  function sell(gid, iid, qty) {
    var item = itemById(iid);
    if (!item || qty < 1) return;
    if (!item.resell) return fail(item.name + ' ne peut pas être revendu.');
    var owned = ownedOf(gid, iid);
    if (owned < qty) return fail('Le groupe ne possède que ' + owned + ' ' + plural(owned, item.unit) + '.');
    commit({ type: 'sell', g: gid, item: iid, qty: qty, cents: sellQuote(item, qty) });
  }

  function undo() {
    var t = state.tx.pop();
    if (!t) { toast('Aucune opération à annuler.'); return; }
    save();
    setTillMsg('Annulé : ' + describe(t), 'ok');
    renderAll();
    toast('Annulé : ' + describe(t), 'Rétablir', function () {
      state.tx.push(t);
      save();
      setTillMsg('Rétabli : ' + describe(t), 'ok');
      renderAll();
      toast('Rétabli : ' + describe(t));
    });
  }

  /* ---------- Rendu : en-tête ---------- */
  function renderHeader() {
    var s = state.settings;
    function fact(label, value, unit) {
      var known = String(value).trim() !== '';
      return '<div class="fact"><span class="fact-label">' + label + '</span>' +
        '<span class="fact-value' + (known ? '' : ' unknown') + '">' +
        (known ? esc(value) + (unit ? ' ' + unit : '') : '?') + '</span></div>';
    }
    $('#facts').innerHTML =
      fact('Distance', s.span, 'cm') +
      fact('Poids à tenir', s.target, 'g') +
      fact('Budget', eur(s.budget).replace(' €', '') , '€ / groupe');

    document.querySelectorAll('.tab').forEach(function (b) {
      if (b.dataset.view === state.ui.view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    ['market', 'results', 'settings'].forEach(function (v) {
      $('#view-' + v).hidden = v !== state.ui.view;
    });
    $('#theme-btn').textContent = { auto: 'Thème auto', light: 'Thème clair', dark: 'Thème sombre' }[state.ui.theme];
  }

  function applyPrefs() {
    var root = document.documentElement;
    if (state.ui.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.ui.theme);
    root.style.setProperty('--scale', state.ui.scale);
  }

  /* ---------- Rendu : marché ---------- */
  function renderMarket() {
    var flashes = [];

    $('#board-list').innerHTML = state.items.map(function (item) {
      var inf = unlimited(item);
      var s = stockOf(item);
      var out = !inf && s <= 0;
      var p = priceAt(item, s);
      var pct = Math.round((p / item.base - 1) * 100);
      var low = !inf && !out && s / item.stock <= 0.25;
      if (prev.price[item.id] != null && prev.price[item.id] !== p) flashes.push('q-' + item.id);
      prev.price[item.id] = p;

      var stockHtml = inf
        ? '<span class="stock-text">Quantité illimitée</span>'
        : '<span class="stock-bar"><i style="width:' + clamp(s / item.stock * 100, 0, 100) + '%"></i></span>' +
          '<span class="stock-text"><b>' + Math.max(s, 0) + '</b> / ' + item.stock + ' en stock</span>';

      var trend = inf || pct === 0
        ? '<span class="trend flat">prix fixe</span>'
        : '<span class="trend up">▲ +' + pct + ' %</span>';
      if (!inf && pct === 0) trend = '<span class="trend flat">prix de départ</span>';

      var resell = item.resell
        ? ' · <span class="resell">revente <b>' + eur(sellUnit(item, s)) + '</b></span>'
        : ' · <span class="resell">non revendable</span>';

      return '<article class="quote' + (out ? ' out' : low ? ' low' : '') + '" id="q-' + item.id + '">' +
        '<div class="quote-name">' + esc(item.name) + '</div>' +
        (out
          ? '<div class="quote-price out-label">Épuisé</div>'
          : '<div class="quote-price">' + eur(p).replace(' €', '') + '<small> € / ' + esc(item.unit) + '</small></div>') +
        '<div class="quote-stock">' + stockHtml + '</div>' +
        '<div class="quote-trend">' + trend + resell + '</div>' +
        '</article>';
    }).join('') || '<p class="hint">Aucun article. Ajoutez-en dans Réglages.</p>';

    $('#board-note').textContent = 'Plus un article se fait rare, plus il coûte cher. Revente au marché : ' +
      state.settings.sellRatio + ' % du prix actuel.';

    var budget = state.settings.budget;
    $('#group-grid').innerHTML = state.groups.map(function (g, i) {
      var bal = balanceOf(g.id);
      if (prev.bal[g.id] != null && prev.bal[g.id] !== bal) flashes.push('g-' + g.id);
      prev.bal[g.id] = bal;
      var chips = state.items.map(function (it) {
        var n = ownedOf(g.id, it.id);
        return n > 0 ? '<span class="chip"><b>' + n + '</b> × ' + esc(it.name) + '</span>' : '';
      }).join('');
      return '<button type="button" class="gcard" id="g-' + g.id + '" data-action="open-till" data-g="' + g.id + '" style="--gc:' + esc(g.color) + '">' +
        '<span class="gcard-head"><span class="gbadge">' + (i + 1) + '</span><span class="gname">' + esc(g.name) + '</span></span>' +
        '<span class="gbal' + (bal < 0 ? ' neg' : '') + '">' + eur(bal).replace(' €', '') + '<small>€</small></span>' +
        '<span class="gbar"><i style="width:' + (budget > 0 ? clamp(bal / budget * 100, 0, 100) : 0) + '%"></i></span>' +
        '<span class="ginv">' + (chips || '<span class="empty">Rien acheté</span>') + '</span>' +
        '</button>';
    }).join('') || '<p class="hint">Aucun groupe. Ajoutez-en dans Réglages.</p>';

    flashes.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    });
  }

  /* ---------- Rendu : bandeau ---------- */
  function renderTicker() {
    var last = state.tx.slice(-4).reverse();
    var html = '<span class="ticker-label">Dernières opérations</span>';
    if (!last.length) html += '<span class="ticker-item">Le marché est ouvert. Aucune opération pour l’instant.</span>';
    last.forEach(function (t, i) {
      var g = groupById(t.g);
      html += '<span class="ticker-item' + (i === 0 ? ' latest' : '') + '"><span class="ticker-dot" style="--gc:' + esc(g ? g.color : '#888') + '"></span>' + esc(describe(t)) + '</span>';
    });
    $('#ticker').innerHTML = html;
  }

  /* ---------- Rendu : caisse ---------- */
  function setTillMsg(msg, type) { till.msg = msg; till.msgType = type; }

  function openTill(gid) {
    till.gid = gid;
    till.qty = {};
    setTillMsg('', '');
    renderTill();
    var d = $('#till');
    if (!d.open) {
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    }
  }

  function closeTill() {
    var d = $('#till');
    if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); }
    till.gid = null;
  }

  function renderTill() {
    var d = $('#till');
    if (!till.gid) return;
    var g = groupById(till.gid);
    if (!g) { closeTill(); return; }
    var bal = balanceOf(g.id);

    var rows = state.items.map(function (item) {
      var q = till.qty[item.id] || 1;
      var inf = unlimited(item);
      var s = stockOf(item);
      var owned = ownedOf(g.id, item.id);
      var cost = buyQuote(item, q);
      var canBuy = cost != null && cost <= bal;
      var buyTitle = cost == null ? 'Stock insuffisant' : cost > bal ? 'Pas assez d’argent' : '';
      var gain = item.resell ? sellQuote(item, q) : 0;
      var canSell = item.resell && owned >= q;
      var sellTitle = !item.resell ? 'Non revendable' : owned < q ? 'Le groupe n’en possède pas assez' : '';
      return '<tr>' +
        '<td><span class="item-name">' + esc(item.name) + '</span><span class="sub">' +
          (inf ? 'illimité' : Math.max(s, 0) + ' en stock') + ' · ' + eur(priceAt(item, s)) + ' / ' + esc(item.unit) + '</span></td>' +
        '<td class="r num">' + owned + '</td>' +
        '<td><span class="stepper">' +
          '<button type="button" data-action="qty" data-item="' + item.id + '" data-d="-1" aria-label="Moins">−</button>' +
          '<output>' + q + '</output>' +
          '<button type="button" data-action="qty" data-item="' + item.id + '" data-d="1" aria-label="Plus">+</button>' +
        '</span></td>' +
        '<td><button type="button" class="btn btn-buy" data-action="buy" data-item="' + item.id + '"' +
          (canBuy ? '' : ' disabled title="' + buyTitle + '"') + '>Acheter <span class="num">' +
          (cost == null ? '—' : eur(cost)) + '</span></button></td>' +
        '<td>' + (item.resell
          ? '<button type="button" class="btn btn-sell" data-action="sell" data-item="' + item.id + '"' +
            (canSell ? '' : ' disabled title="' + sellTitle + '"') + '>Revendre <span class="num">+' + eur(gain) + '</span></button>'
          : '<span class="sub">non revendable</span>') + '</td>' +
        '</tr>';
    }).join('');

    var focusId = document.activeElement && document.activeElement.id;
    var adjAmount = $('#adj-amount') ? $('#adj-amount').value : '';
    var adjNote = $('#adj-note') ? $('#adj-note').value : '';

    d.innerHTML = '<div class="till-inner" style="--gc:' + esc(g.color) + '">' +
      '<div class="till-head">' +
        '<span class="gbadge">' + (groupIndex(g.id) + 1) + '</span>' +
        '<h2 class="till-title" id="till-title">' + esc(g.name) + '</h2>' +
        '<div class="till-bal"><span>Solde</span><b class="' + (bal < 0 ? 'neg' : '') + '">' + eur(bal) + '</b></div>' +
        '<button type="button" class="close" data-action="close-till">Fermer ✕</button>' +
      '</div>' +
      '<div class="table-wrap"><table class="data">' +
        '<thead><tr><th>Article</th><th class="r">Possédé</th><th>Quantité</th><th>Acheter</th><th>Revendre</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
      '<form class="adjust" id="adj-form">' +
        '<label for="adj-amount">Ajustement</label>' +
        '<input class="field money" id="adj-amount" inputmode="decimal" placeholder="0,50" autocomplete="off" value="' + esc(adjAmount) + '">' +
        '<span>€</span>' +
        '<input class="field wide" id="adj-note" placeholder="Motif (ex. : bonus de propreté)" autocomplete="off" value="' + esc(adjNote) + '">' +
        '<button type="button" class="btn btn-sell" data-action="adj" data-sign="1">+ Donner</button>' +
        '<button type="button" class="btn btn-danger" data-action="adj" data-sign="-1">− Retirer</button>' +
      '</form>' +
      '<div class="till-foot">' +
        '<p class="msg ' + till.msgType + '" role="status">' + esc(till.msg) + '</p>' +
        '<button type="button" class="btn btn-ghost" data-action="undo">↶ Annuler la dernière opération</button>' +
      '</div>' +
    '</div>';

    if (focusId) { var f = document.getElementById(focusId); if (f) f.focus(); }
  }

  /* ---------- Rendu : résultats ---------- */
  function renderResults() {
    var target = parseFloat(String(state.settings.target).replace(',', '.'));
    $('#weigh-table').innerHTML =
      '<thead><tr><th>Groupe</th><th class="r">Dépensé</th><th class="r">Poids tenu</th></tr></thead><tbody>' +
      state.groups.map(function (g, i) {
        var w = state.weights[g.id];
        return '<tr><td><span class="rank-name" style="--gc:' + esc(g.color) + '"><span class="gbadge">' + (i + 1) + '</span>' + esc(g.name) + '</span></td>' +
          '<td class="r num">' + eur(costOf(g.id)) + '</td>' +
          '<td class="r"><input class="field weight-input" id="w-' + g.id + '" data-weight="' + g.id + '" inputmode="decimal" placeholder="—" autocomplete="off" value="' + esc(w == null ? '' : w) + '"> g</td></tr>';
      }).join('') + '</tbody>';
    renderRanking(isNaN(target) ? null : target);
  }

  function renderRanking(target) {
    if (target === undefined) {
      target = parseFloat(String(state.settings.target).replace(',', '.'));
      if (isNaN(target)) target = null;
    }
    var rows = state.groups.map(function (g, i) {
      return { g: g, i: i, score: scoreOf(g.id), w: weightOf(g.id), cost: costOf(g.id) };
    });
    rows.sort(function (a, b) {
      if (a.score == null && b.score == null) return a.i - b.i;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });
    var pos = 0, lastScore = null;
    $('#ranking').innerHTML = rows.map(function (r, idx) {
      if (r.score == null) {
        return '<li class="rank pending"><span class="rank-pos">–</span>' +
          '<span class="rank-name" style="--gc:' + esc(r.g.color) + '"><span class="gbadge">' + (r.i + 1) + '</span><span>' + esc(r.g.name) +
          '<span class="rank-detail">' + eur(r.cost) + ' dépensés</span></span></span>' +
          '<span class="rank-score">pas encore pesé</span></li>';
      }
      if (lastScore === null || Math.abs(r.score - lastScore) > 1e-9) pos = idx + 1;
      lastScore = r.score;
      var badge = target != null
        ? (r.w >= target ? ' <span class="badge-ok">objectif atteint</span>' : ' <span class="badge-ko">sous l’objectif</span>')
        : '';
      return '<li class="rank' + (pos <= 3 && r.score > 0 ? ' p' + pos : '') + '"><span class="rank-pos">' + pos + '</span>' +
        '<span class="rank-name" style="--gc:' + esc(r.g.color) + '"><span class="gbadge">' + (r.i + 1) + '</span><span>' + esc(r.g.name) + badge +
        '<span class="rank-detail">' + fmtNum(r.w) + ' g tenus · ' + eur(r.cost) + ' dépensés</span></span></span>' +
        '<span class="rank-score">' + fmtNum(r.score, 1) + '<small>g / €</small></span></li>';
    }).join('') || '<li class="hint">Aucun groupe.</li>';
  }

  function fmtNum(n, digits) {
    return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: digits == null ? 1 : digits, minimumFractionDigits: 0 });
  }

  /* ---------- Rendu : réglages ---------- */
  function renderSettings() {
    var s = state.settings;
    var started = state.tx.length > 0;

    var groupRows = state.groups.map(function (g, i) {
      return '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td><input class="field" id="gn-' + g.id + '" data-group="' + g.id + '" data-field="name" value="' + esc(g.name) + '" aria-label="Nom du groupe ' + (i + 1) + '"></td>' +
        '<td><input type="color" class="color-input" id="gc-' + g.id + '" data-group="' + g.id + '" data-field="color" value="' + esc(g.color) + '" aria-label="Couleur"></td>' +
        '<td class="r"><button type="button" class="btn btn-danger" data-action="del-group" data-g="' + g.id + '" data-confirm="1">Supprimer</button></td>' +
        '</tr>';
    }).join('');

    var itemRows = state.items.map(function (it) {
      var maxPrice = unlimited(it) ? it.base : Math.round(it.base * (1 + it.rise / 100));
      return '<tr>' +
        '<td><input class="field" id="in-' + it.id + '" data-item="' + it.id + '" data-field="name" value="' + esc(it.name) + '" aria-label="Nom"></td>' +
        '<td><input class="field short" id="iu-' + it.id + '" data-item="' + it.id + '" data-field="unit" value="' + esc(it.unit) + '" aria-label="Unité"></td>' +
        '<td><input class="field money" id="ib-' + it.id + '" data-item="' + it.id + '" data-field="base" inputmode="decimal" value="' + centsToInput(it.base) + '" aria-label="Prix de départ"></td>' +
        '<td><input class="field money" id="is-' + it.id + '" data-item="' + it.id + '" data-field="stock" inputmode="numeric" placeholder="illimité" value="' + (it.stock == null ? '' : it.stock) + '" aria-label="Stock initial"></td>' +
        '<td><input class="field money" id="ir-' + it.id + '" data-item="' + it.id + '" data-field="rise" inputmode="numeric" value="' + it.rise + '" aria-label="Hausse maximale"' + (unlimited(it) ? ' disabled' : '') + '></td>' +
        '<td><input type="checkbox" id="iv-' + it.id + '" data-item="' + it.id + '" data-field="resell"' + (it.resell ? ' checked' : '') + ' aria-label="Revendable"></td>' +
        '<td class="r num">' + eur(maxPrice) + '</td>' +
        '<td class="r"><button type="button" class="btn btn-danger" data-action="del-item" data-item="' + it.id + '" data-confirm="1">Supprimer</button></td>' +
        '</tr>';
    }).join('');

    var journal = state.tx.slice().reverse().map(function (t) {
      var d = new Date(t.t);
      return '<tr><td class="num">' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') +
        '</td><td>' + esc(describe(t)) + '</td></tr>';
    }).join('');

    $('#view-settings').innerHTML =
      '<div class="panel">' +
        '<h2 class="section-title">Défi</h2>' +
        '<div class="form-grid">' +
          formRow('set-span', 'Distance à franchir (cm)', esc(s.span), 'Laisser vide pour afficher « ? »', 'span', 'decimal') +
          formRow('set-target', 'Poids à tenir (g)', esc(s.target), 'Laisser vide pour afficher « ? »', 'target', 'decimal') +
          formRow('set-budget', 'Budget par groupe (€)', centsToInput(s.budget), 'Les soldes se mettent à jour aussitôt', 'budget', 'decimal') +
          formRow('set-ratio', 'Prix de revente (% du prix du marché)', s.sellRatio, '50 = moitié prix', 'sellRatio', 'numeric') +
        '</div>' +
      '</div>' +

      '<div class="panel">' +
        '<h2 class="section-title">Groupes <small>' + state.groups.length + ' groupes</small></h2>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>N°</th><th>Nom</th><th>Couleur</th><th></th></tr></thead><tbody>' +
          groupRows + '</tbody></table></div>' +
        '<div class="panel-actions"><button type="button" class="btn btn-buy" data-action="add-group">+ Ajouter un groupe</button></div>' +
      '</div>' +

      '<div class="panel full">' +
        '<h2 class="section-title">Articles du marché</h2>' +
        '<p class="hint">Le prix monte à chaque achat. Quand le stock est plein, l’article coûte son prix de départ ; quand il est vide, il coûte prix de départ × (1 + hausse). ' +
          'Exemple : 50 feuilles à 0,50 € avec une hausse de 150 % → 0,50 € au début, 1,10 € quand il en reste 10, 1,23 € pour la dernière. Stock vide = quantité illimitée et prix fixe.</p>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Article</th><th>Unité</th><th>Prix de départ (€)</th><th>Stock initial</th><th>Hausse max (%)</th><th>Revendable</th><th class="r">Prix max</th><th></th></tr></thead><tbody>' +
          itemRows + '</tbody></table></div>' +
        '<div class="panel-actions"><button type="button" class="btn btn-buy" data-action="add-item">+ Ajouter un article</button></div>' +
      '</div>' +

      '<div class="panel">' +
        '<h2 class="section-title">Journal <small>' + state.tx.length + ' opération' + (state.tx.length > 1 ? 's' : '') + '</small></h2>' +
        (journal ? '<div class="journal"><table class="data"><tbody>' + journal + '</tbody></table></div>' : '<p class="hint">Aucune opération.</p>') +
      '</div>' +

      '<div class="panel">' +
        '<h2 class="section-title">Remise à zéro</h2>' +
        '<p class="hint">« Nouvelle séance » efface les achats, les ventes et les pesées, mais garde les groupes et les articles. ' +
          '« Tout réinitialiser » revient aux réglages d’origine.</p>' +
        '<div class="panel-actions">' +
          '<button type="button" class="btn btn-danger" data-action="new-session" data-confirm="1"' + (started || Object.keys(state.weights).length ? '' : ' disabled') + '>Nouvelle séance</button>' +
          '<button type="button" class="btn btn-danger" data-action="factory-reset" data-confirm="1">Tout réinitialiser</button>' +
        '</div>' +
      '</div>';
  }

  function formRow(id, label, value, help, key, mode) {
    return '<div class="form-row"><label for="' + id + '">' + label + '</label>' +
      '<input class="field" id="' + id + '" data-setting="' + key + '" inputmode="' + mode + '" autocomplete="off" value="' + value + '">' +
      '<span class="help">' + help + '</span></div>';
  }

  /* ---------- Rendu global ---------- */
  function renderAll() {
    applyPrefs();
    renderHeader();
    renderTicker();
    if (state.ui.view === 'market') renderMarket();
    else if (state.ui.view === 'results') renderResults();
    else if (state.ui.view === 'settings') renderSettings();
    if (till.gid) renderTill();
  }

  // Après une modification de réglage : reconstruire la vue sans perdre le champ actif.
  function renderKeepFocus() {
    setTimeout(function () {
      var id = document.activeElement && document.activeElement.id;
      renderAll();
      if (id) { var el = document.getElementById(id); if (el) el.focus(); }
    }, 0);
  }

  function setView(v) {
    state.ui.view = v;
    save();
    renderAll();
  }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg, actionLabel, action, isErr) {
    var el = $('#toast');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button type="button" id="toast-action">' + esc(actionLabel) + '</button>' : '');
    el.hidden = false;
    if (actionLabel) {
      $('#toast-action').addEventListener('click', function () { el.hidden = true; action(); }, { once: true });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, actionLabel ? 7000 : 3500);
  }

  /* ---------- Confirmation en deux clics ---------- */
  function confirmed(btn) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = 'Cliquer encore pour confirmer';
    btn.classList.add('armed');
    setTimeout(function () {
      if (!btn.isConnected) return;
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.label;
      btn.classList.remove('armed');
    }, 3500);
    return false;
  }

  /* ---------- Événements ---------- */
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (tab) { setView(tab.dataset.view); return; }

    var btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    var a = btn.dataset.action;
    if (btn.dataset.confirm && !confirmed(btn)) return;

    switch (a) {
      case 'undo': undo(); break;
      case 'zoom-in': state.ui.scale = Math.min(1.8, Math.round((state.ui.scale + 0.1) * 10) / 10); save(); applyPrefs(); break;
      case 'zoom-out': state.ui.scale = Math.max(0.6, Math.round((state.ui.scale - 0.1) * 10) / 10); save(); applyPrefs(); break;
      case 'theme':
        state.ui.theme = { auto: 'light', light: 'dark', dark: 'auto' }[state.ui.theme];
        save(); renderAll(); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'open-till': openTill(btn.dataset.g); break;
      case 'close-till': closeTill(); break;
      case 'qty': {
        var id = btn.dataset.item;
        till.qty[id] = clamp((till.qty[id] || 1) + Number(btn.dataset.d), 1, 99);
        renderTill();
        break;
      }
      case 'buy': buy(till.gid, btn.dataset.item, till.qty[btn.dataset.item] || 1); break;
      case 'sell': sell(till.gid, btn.dataset.item, till.qty[btn.dataset.item] || 1); break;
      case 'adj': {
        var cents = parseEuros($('#adj-amount').value);
        if (!cents || cents <= 0) { fail('Saisir un montant positif, par exemple 0,50.'); break; }
        var note = $('#adj-note').value.trim();
        $('#adj-amount').value = '';
        $('#adj-note').value = '';
        commit({ type: 'adj', g: till.gid, cents: cents * Number(btn.dataset.sign), note: note });
        break;
      }
      case 'add-group': {
        var n = state.groups.length;
        state.groups.push({ id: uid(), name: 'Groupe ' + (n + 1), color: COLORS[n % COLORS.length] });
        save(); renderAll(); break;
      }
      case 'del-group': {
        var gid = btn.dataset.g;
        state.groups = state.groups.filter(function (g) { return g.id !== gid; });
        state.tx = state.tx.filter(function (t) { return t.g !== gid; });
        delete state.weights[gid];
        save(); renderAll(); toast('Groupe supprimé, ses achats sont retournés au stock.'); break;
      }
      case 'add-item':
        state.items.push({ id: uid(), name: 'Nouvel article', unit: 'unité', base: 20, stock: 20, rise: 100, resell: true });
        save(); renderAll(); break;
      case 'del-item': {
        var iid = btn.dataset.item;
        if (hasTx(function (t) { return t.item === iid; })) {
          toast('Impossible : cet article a déjà été acheté. Annulez ces opérations ou lancez une nouvelle séance.', null, null, true);
          break;
        }
        state.items = state.items.filter(function (it) { return it.id !== iid; });
        save(); renderAll(); break;
      }
      case 'new-session':
        state.tx = []; state.weights = {}; prev = { price: {}, bal: {} };
        save(); renderAll(); toast('Nouvelle séance : budgets et stocks remis à zéro.'); break;
      case 'factory-reset': {
        var ui = state.ui;
        state = defaults(); state.ui = ui; state.ui.view = 'settings'; prev = { price: {}, bal: {} };
        save(); renderAll(); toast('Réglages d’origine rétablis.'); break;
      }
    }
  });

  // Les modifications de réglages s'appliquent à la sortie du champ (événement change).
  document.addEventListener('change', function (e) {
    var el = e.target;

    if (el.dataset.setting) {
      var key = el.dataset.setting;
      if (key === 'budget') {
        var c = parseEuros(el.value);
        if (c != null && c >= 0) state.settings.budget = c;
      } else if (key === 'sellRatio') {
        var r = parseInt(el.value, 10);
        if (!isNaN(r)) state.settings.sellRatio = clamp(r, 0, 100);
      } else {
        state.settings[key] = el.value.trim();
      }
      save(); renderKeepFocus(); return;
    }

    if (el.dataset.group) {
      var g = groupById(el.dataset.group);
      if (g) g[el.dataset.field] = el.dataset.field === 'name' ? (el.value.trim() || g.name) : el.value;
      save(); renderKeepFocus(); return;
    }

    if (el.dataset.item && el.dataset.field) {
      var it = itemById(el.dataset.item);
      if (!it) return;
      var f = el.dataset.field;
      if (f === 'name' || f === 'unit') it[f] = el.value.trim() || it[f];
      else if (f === 'base') { var b = parseEuros(el.value); if (b != null && b > 0) it.base = b; }
      else if (f === 'stock') {
        var v = el.value.trim();
        if (v === '') it.stock = null;
        else { var n = parseInt(v, 10); if (!isNaN(n) && n > 0) it.stock = n; }
      }
      else if (f === 'rise') { var rr = parseInt(el.value, 10); if (!isNaN(rr) && rr >= 0) it.rise = rr; }
      else if (f === 'resell') it.resell = el.checked;
      save(); renderKeepFocus(); return;
    }
  });

  // Les poids se mettent à jour pendant la saisie, sans reconstruire le tableau (pour garder le curseur).
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.weight) {
      state.weights[el.dataset.weight] = el.value.trim();
      save();
      renderRanking();
    }
  });

  document.addEventListener('submit', function (e) { e.preventDefault(); });

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo();
    }
  });

  $('#till').addEventListener('close', function () { till.gid = null; });
  $('#till').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeTill(); // clic sur le fond
  });

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) {
        var p = document.documentElement.requestFullscreen();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) { /* plein écran indisponible */ }
  }

  // Empêche l'écran (et donc le vidéoprojecteur) de se mettre en veille.
  var wakeLock = null;
  function keepAwake() {
    if (wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }
  document.addEventListener('click', keepAwake, { once: true });
  document.addEventListener('visibilitychange', keepAwake);

  // Synchronise plusieurs onglets ouverts sur le même ordinateur.
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    state = load();
    renderAll();
  });

  renderAll();
})();

// Astreinte planning + monthly remuneration for the Team Task Log.
// Data lives in Firestore, collection "astreinte", one document per month (id "YYYY-MM").
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
  var escA = function (s) { return esc(s).replace(/"/g, "&quot;"); };

  // ---------- Team, rules, constants (edit here when the team changes) ----------
  var TEAM = [
    { first: "Abdelmajid", full: "Abdelmajid JIYADI", alias: [] },
    { first: "Anas", full: "Anas SAFOUH", alias: [] },
    { first: "Houssam", full: "Houssam JIHAZ", alias: ["houssaam"] },
    { first: "Innocent", full: "Innocent KOFFI", alias: ["innoncent"] },
    { first: "Mouad", full: "Mouad ABOUSSIBER", alias: [] },
    { first: "Soulaymane", full: "Soulaymane BOURAS", alias: ["soulymane", "soulaimane", "soulayman"] }
  ];
  // Mouad is at the office on Monday and Tuesday, so he cannot be on night astreinte those days (Mon = 0).
  var RULES = [{ name: "Mouad", noNight: [0, 1], why: "is at the office on Monday and Tuesday" }];
  var DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  var MFR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  var CUR = "MAD";
  // Only this account can edit the planning and see the remuneration. Amounts are NOT stored in this file:
  // they live in the admin-only Firestore collection "astreinte_admin".
  var ADMIN_EMAIL = "mouad.aboussiber@vpscorp.ma";

  // ---------- Tabs (work even if Firebase is not configured) ----------
  var view = "tasks";
  function setTab(v) {
    view = v;
    $("view-tasks").hidden = v !== "tasks";
    $("view-astreinte").hidden = v !== "astreinte";
    if ($("view-hr")) $("view-hr").hidden = v !== "hr";
    $("t-tasks").setAttribute("aria-pressed", v === "tasks" ? "true" : "false");
    $("t-astr").setAttribute("aria-pressed", v === "astreinte" ? "true" : "false");
    if ($("t-hr")) $("t-hr").setAttribute("aria-pressed", v === "hr" ? "true" : "false");
    try { history.replaceState(null, "", v === "astreinte" ? "#astreinte" : v === "hr" ? "#hr" : location.pathname + location.search); } catch (e) {}
    if (v === "hr" && window.renderHR) window.renderHR();
  }
  $("t-tasks").addEventListener("click", function () { setTab("tasks"); });
  $("t-astr").addEventListener("click", function () { setTab("astreinte"); });
  if ($("t-hr")) $("t-hr").addEventListener("click", function () { setTab("hr"); });
  if (location.hash === "#astreinte") setTab("astreinte");
  if (location.hash === "#hr") setTab("hr");

  if (!window.firebase || !firebase.apps || !firebase.apps.length) { var an = $("astr-now"); if (an) an.innerHTML = "<h2>Astreinte this week</h2><p class=\"note\">Astreinte data is not available (Firebase not initialised).</p>"; return; }
  var fs = firebase.firestore(), auth = firebase.auth();

  // ---------- Dates ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function D(y, m, d) { return new Date(y, m, d, 12); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseIso(s) { var p = s.split("-"); return D(+p[0], +p[1] - 1, +p[2]); }
  function addD(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function keyLabel(k) { var p = k.split("-"); return MFR[+p[1] - 1] + " " + p[0]; }
  function shiftKey(k, n) { var p = k.split("-"); return keyOf(D(+p[0], +p[1] - 1 + n, 1)); }
  // Week 1 of a month starts on the Monday of the week containing the month's first Thursday.
  function firstStart(key) {
    var p = key.split("-"), f = D(+p[0], +p[1] - 1, 1);
    var thu = addD(f, (4 - f.getDay() + 7) % 7);
    return addD(thu, -3);
  }
  // A week counts in the month that contains its Thursday.
  function natMonth(startIso) { return keyOf(addD(parseIso(startIso), 3)); }
  function weekStartsFor(key) {
    var s = firstStart(key), out = [];
    while (natMonth(iso(s)) === key) { out.push(iso(s)); s = addD(s, 7); }
    return out;
  }
  function shortDate(d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); }
  function longRange(startIso) {
    var a = parseIso(startIso), b = addD(a, 6);
    return shortDate(a) + " - " + shortDate(b) + "/" + b.getFullYear();
  }

  // ---------- Names ----------
  function lev(a, b) {
    var m = [], i, j;
    for (i = 0; i <= a.length; i++) { m[i] = [i]; }
    for (j = 1; j <= b.length; j++) { m[0][j] = j; }
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  }
  function canon(tok) {
    var t = String(tok == null ? "" : tok).trim();
    if (!t) return "";
    var k = t.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    var i, m;
    for (i = 0; i < TEAM.length; i++) {
      m = TEAM[i];
      if (k === m.first.toLowerCase() || m.alias.indexOf(k) >= 0) return m.first;
    }
    if (k.length >= 4) for (i = 0; i < TEAM.length; i++) {
      if (lev(k, TEAM[i].first.toLowerCase()) <= 2) return TEAM[i].first;
    }
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function names(s) {
    var out = [];
    String(s == null ? "" : s).split(/[,;\/&+]/).forEach(function (x) {
      var c = canon(x);
      if (c && out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }
  function fullName(first) {
    for (var i = 0; i < TEAM.length; i++) if (TEAM[i].first === first) return TEAM[i].full;
    return first;
  }
  function fmt(n) {
    var s = (Math.round(n * 100) / 100).toFixed(2).split(".");
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return s.join(",");
  }

  // ---------- State + persistence ----------
  var docs = {}, adminDocs = {}, isAdmin = false, cur = keyOf(new Date()), sub = "plan", unsub = null, unsubA = null, queue = Promise.resolve();
  function msg(t) { var e = $("a-msg"); if (e) e.textContent = t || ""; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function stable(o) {
    return JSON.stringify(o, function (k, v) {
      if (v && typeof v === "object" && !Array.isArray(v)) { var s = {}; Object.keys(v).sort().forEach(function (x) { s[x] = v[x]; }); return s; }
      return v;
    });
  }
  function blankWeek(start) {
    var days = [];
    for (var i = 0; i < 7; i++) days.push({ jour: "", nuit: "" });
    return { start: start, payMonth: natMonth(start), absent: [], days: days };
  }
  // When a week already exists in another month's document, reuse it (boundary weeks).
  function existingWeek(start, exceptKey) {
    var best = null;
    Object.keys(docs).forEach(function (k) {
      if (k === exceptKey) return;
      (docs[k].weeks || []).forEach(function (w) {
        if (w.start === start && (!best || (docs[k].updated || 0) >= best.upd)) best = { w: w, upd: docs[k].updated || 0 };
      });
    });
    return best ? clone(best.w) : null;
  }
  function newWeek(start, key) { return existingWeek(start, key) || blankWeek(start); }
  function ensureDoc(key) {
    if (!docs[key]) docs[key] = { month: key, weeks: [], updated: Date.now() };
    return docs[key];
  }
  function save(key) {
    docs[key].updated = Date.now();
    var data = clone(docs[key]);
    queue = queue.then(function () { return fs.collection("astreinte").doc(key).set(data); })
      .then(function () { msg(""); }, function () { msg("Could not save. Check your connection and the Firestore rules, then try again."); });
  }

  // Day team Mon-Fri = everybody except the night person and anyone marked absent that week.
  function restOf(w, j) {
    var night = names(w.days[j] && w.days[j].nuit), off = (w.absent || []).map(canon);
    return TEAM.map(function (m) { return m.first; }).filter(function (n) { return night.indexOf(n) < 0 && off.indexOf(n) < 0; }).join(", ");
  }
  function refillDays(w, only) {
    for (var j = 0; j < 5; j++) if (only == null || only === j) w.days[j].jour = restOf(w, j);
  }
  function selOptions(val) {
    var v = names(val).join(", "), h = '<option value=""></option>', found = false;
    TEAM.forEach(function (m) { var sel = m.first === v; if (sel) found = true; h += '<option value="' + m.first + '"' + (sel ? " selected" : "") + ">" + m.first + "</option>"; });
    if (v && !found) h += '<option value="' + escA(v) + '" selected>' + esc(v) + "</option>";
    return h;
  }

  function saveAdmin(key, rates) {
    adminDocs[key] = { month: key, rates: rates, updated: Date.now() };
    var data = clone(adminDocs[key]);
    queue = queue.then(function () { return fs.collection("astreinte_admin").doc(key).set(data); })
      .then(function () { msg(""); }, function () { msg("Could not save the amounts. Publish the updated Firestore rules (see README)."); });
  }
  // Amounts come from the admin-only data; a month without its own amounts inherits the latest earlier month.
  function ratesFor(key) {
    var ks = Object.keys(adminDocs).filter(function (k) { return k <= key && adminDocs[k].rates; }).sort();
    if (!ks.length) return { week: 0, weekend: 0, unset: true, own: false, from: "" };
    var last = ks[ks.length - 1], r = adminDocs[last].rates;
    return { week: +r.week || 0, weekend: +r.weekend || 0, unset: false, own: last === key, from: last };
  }

  // ---------- Business rules ----------
  function weekWarnings(w) {
    var out = [];
    for (var j = 0; j < 7; j++) {
      var n = names(w.days[j] && w.days[j].nuit);
      RULES.forEach(function (r) {
        if (n.indexOf(r.name) >= 0 && r.noNight.indexOf(j) >= 0) out.push({ day: j, text: r.name + " " + r.why });
      });
    }
    return out;
  }
  function calcWeek(w, rates) {
    var perNight = rates.week / 5, perSlot = rates.weekend / 3;
    var res = { start: w.start, end: iso(addD(parseIso(w.start), 6)), nights: {}, slots: [], missing: [], amt: {}, det: {} };
    function add(name, kind, amount) {
      var a = res.amt[name] || (res.amt[name] = { week: 0, weekend: 0, nights: 0, slots: 0 });
      a[kind] += amount;
    }
    function det(name) { return res.det[name] || (res.det[name] = { nights: 0, slots: [] }); }
    var j;
    for (j = 0; j < 5; j++) {
      var n = names(w.days[j] && w.days[j].nuit);
      if (!n.length) { res.missing.push(DAYS[j] + " night"); continue; }
      n.forEach(function (x) {
        res.nights[x] = (res.nights[x] || 0) + 1 / n.length;
        add(x, "week", perNight / n.length);
        res.amt[x].nights += 1 / n.length;
        det(x).nights += 1 / n.length;
      });
    }
    var slotDefs = [["Samedi jour", 5, "jour", "Sam. jour"], ["Samedi nuit", 5, "nuit", "Sam. nuit"], ["Dimanche jour", 6, "jour", "Dim. jour"]];
    slotDefs.forEach(function (sd) {
      var nn = names(w.days[sd[1]] && w.days[sd[1]][sd[2]]);
      res.slots.push(nn);
      if (!nn.length) { res.missing.push(sd[0]); return; }
      nn.forEach(function (x) {
        add(x, "weekend", perSlot / nn.length); res.amt[x].slots += 1 / nn.length;
        det(x).slots.push(sd[3] + " " + shortDate(addD(parseIso(w.start), sd[1])));
      });
    });
    return res;
  }
  function paidWeeks(key) {
    var best = {};
    Object.keys(docs).forEach(function (k) {
      (docs[k].weeks || []).forEach(function (w) {
        var upd = docs[k].updated || 0;
        if (!best[w.start] || upd >= best[w.start].upd) best[w.start] = { w: w, upd: upd };
      });
    });
    return Object.keys(best).map(function (s) { return best[s].w; })
      .filter(function (w) { return (w.payMonth || natMonth(w.start)) === key; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  }
  function payReport(key) {
    var rates = ratesFor(key);
    var weeks = paidWeeks(key).map(function (w) { return calcWeek(w, rates); });
    var totals = {};
    weeks.forEach(function (r) {
      Object.keys(r.amt).forEach(function (n) {
        var t = totals[n] || (totals[n] = { week: 0, weekend: 0, nights: 0, slots: 0, det: [] });
        t.week += r.amt[n].week; t.weekend += r.amt[n].weekend; t.nights += r.amt[n].nights; t.slots += r.amt[n].slots;
        var d = r.det[n];
        if (d && d.nights > 0) {
          var nn = Math.round(d.nights * 10) / 10;
          t.det.push(nn === 5 ? "Nuit " + shortDate(parseIso(r.start)) + "-" + shortDate(parseIso(r.end)) : "Nuit x" + nn + " (sem. " + shortDate(parseIso(r.start)) + ")");
        }
        if (d) d.slots.forEach(function (x) { t.det.push(x); });
      });
    });
    var list = Object.keys(totals).map(function (n) { return { name: n, t: totals[n], total: totals[n].week + totals[n].weekend }; })
      .sort(function (a, b) { return b.total - a.total; });
    var sum = list.reduce(function (a, p) { return a + p.total; }, 0);
    return { key: key, rates: rates, weeks: weeks, people: list, sum: sum };
  }
  // "1 semaine" for a full Sun-Fri shift, otherwise the number of nights.
  function nightsTxt(n) {
    n = Math.round(n * 10) / 10;
    if (!n) return "-";
    if (n % 5 === 0) return (n / 5) + (n / 5 > 1 ? " semaines" : " semaine");
    return n + (n > 1 ? " nuits" : " nuit");
  }
  function slotsTxt(n) { n = Math.round(n * 10) / 10; return n ? n + " week-end" : "-"; }
  function weekdayLabel(r) {
    var ks = Object.keys(r.nights);
    if (!ks.length) return "-";
    if (ks.length === 1) return fullName(ks[0]);
    return ks.map(function (k) { return fullName(k) + " (" + (Math.round(r.nights[k] * 10) / 10) + " n.)"; }).join(" + ");
  }
  function slotLabel(nn) { return nn.length ? nn.map(fullName).join(" + ") : "-"; }

  // ---------- Rendering ----------
  function keepFocus(fn) {
    var a = document.activeElement, sel = null;
    if (a && a.dataset && a.dataset.act) sel = '[data-act="' + a.dataset.act + '"][data-w="' + (a.dataset.w || "") + '"][data-d="' + (a.dataset.d || "") + '"]';
    fn();
    if (sel) { var n = document.querySelector("#view-astreinte " + sel); if (n && n.focus) n.focus(); }
  }
  function teamOptions(selected) {
    var h = '<option value=""></option>';
    TEAM.forEach(function (m) { h += '<option value="' + m.first + '"' + (m.first === selected ? " selected" : "") + ">" + m.first + "</option>"; });
    return h;
  }
  function renderAll() {
    if (!isAdmin) sub = "plan";
    $("a-month").textContent = keyLabel(cur);
    $("a-tab-pay").hidden = !isAdmin;
    $("a-tab-plan").setAttribute("aria-pressed", sub === "plan" ? "true" : "false");
    $("a-tab-pay").setAttribute("aria-pressed", sub === "pay" ? "true" : "false");
    $("a-plan").hidden = sub !== "plan";
    $("a-pay").hidden = sub !== "pay";
    renderNow();
    keepFocus(function () { if (sub === "plan") renderPlan(); else renderPay(); });
  }
  function renderPlan() {
    var d = docs[cur], h = "", ro = !isAdmin, dis = ro ? " disabled" : "";
    if (!ro) {
      h += '<div class="bar"><button class="btn" data-act="import" type="button">Import Excel</button>' +
        '<input type="file" id="a-file" accept=".xlsx,.xls" hidden>';
      if (d) h += '<button class="btn alt" data-act="export" type="button">Export Excel</button><button class="btn alt" data-act="addwk" type="button">Add week</button>';
      else h += '<button class="btn alt" data-act="create" type="button">Create empty planning</button>';
      h += "</div>";
    }
    if (!d || !(d.weeks || []).length) {
      h += '<section class="panel"><p class="empty">' + (ro ? "No astreinte planning has been published for " + esc(keyLabel(cur)) + " yet."
        : "No astreinte planning for " + esc(keyLabel(cur)) + " yet. Import your Excel planning (columns: week, day, day team, night astreinte) or create an empty one.") + "</p></section>";
      $("a-plan").innerHTML = h;
      return;
    }
    if (!ro) h += '<p class="note">Pick the night person for each week. The day team (Mon-Fri) fills itself with everybody else; mark people as absent to leave them out.</p>';
    var nWarn = 0;
    d.weeks.forEach(function (w) { nWarn += weekWarnings(w).length; });
    if (nWarn && !ro) h += '<p class="alert" role="alert">' + nWarn + " rule conflict" + (nWarn > 1 ? "s" : "") + " in this planning. See the rows marked Conflict.</p>";
    d.weeks.forEach(function (w, i) {
      var warns = weekWarnings(w);
      var nat = natMonth(w.start), pm = w.payMonth || nat, off = (w.absent || []).map(canon);
      var payOpts = [shiftKey(nat, -1), nat, shiftKey(nat, 1)].map(function (k) {
        return '<option value="' + k + '"' + (k === pm ? " selected" : "") + ">" + keyLabel(k) + "</option>";
      }).join("");
      var chips = TEAM.map(function (m) {
        var on = off.indexOf(m.first) >= 0;
        return '<button type="button" class="pick" data-act="absent" data-w="' + i + '" data-n="' + m.first + '" aria-pressed="' + (on ? "true" : "false") + '">' + m.first + "</button>";
      }).join("");
      h += '<section class="panel wk"><div class="wkhead"><h2>S' + (i + 1) + " &middot; " + esc(longRange(w.start)) + "</h2>" +
        (ro ? "" : '<label class="inl">Night Mon-Fri<select data-act="bulk" data-w="' + i + '">' + selOptions("") + "</select></label>" +
          '<label class="inl">Paid in<select data-act="pay" data-w="' + i + '">' + payOpts + "</select></label>" +
          '<button class="btn ghost" data-act="delwk" data-w="' + i + '" type="button">Remove week</button>') + "</div>" +
        (ro ? (off.length ? '<p class="note">Absent: ' + esc(off.join(", ")) + "</p>" : "") : '<div class="absent"><span class="note">Absent this week:</span>' + chips + "</div>") +
        '<div class="tablewrap"><table class="days"><thead><tr><th>Day</th><th>Jour (day team)</th><th>Astreinte nuit</th><th></th></tr></thead><tbody>';
      for (var j = 0; j < 7; j++) {
        var day = w.days[j] || { jour: "", nuit: "" };
        var wj = warns.filter(function (x) { return x.day === j; })[0];
        var jourCell = j >= 5
          ? '<select data-act="jour" data-w="' + i + '" data-d="' + j + '"' + dis + ' aria-label="' + DAYS[j] + ' day duty">' + selOptions(day.jour) + "</select>"
          : '<input data-act="jour" data-w="' + i + '" data-d="' + j + '" value="' + escA(day.jour) + '"' + dis + ' aria-label="' + DAYS[j] + ' day team">';
        h += '<tr class="' + (j >= 5 ? "we" : "") + '"><td class="dn">' + DAYS[j] + '<br><span class="note">' + shortDate(addD(parseIso(w.start), j)) + "</span></td>" +
          "<td>" + jourCell + "</td>" +
          '<td><select data-act="nuit" data-w="' + i + '" data-d="' + j + '"' + dis + ' aria-label="' + DAYS[j] + ' night">' + selOptions(day.nuit) + "</select></td>" +
          "<td>" + (wj && !ro ? '<span class="chip High" title="' + escA(wj.text) + '">Conflict</span> <span class="note">' + esc(wj.text) + "</span>" : "") + "</td></tr>";
      }
      h += "</tbody></table></div></section>";
    });
    $("a-plan").innerHTML = h;
  }
  function renderPay() {
    var rep = payReport(cur), h = "";
    var inherited = !rep.rates.unset && !rep.rates.own;
    h += '<div class="bar"><label class="inl">Weekday shift (Sun night to Fri)<input type="number" min="0" step="50" data-act="rate" data-r="week" value="' + (rep.rates.unset ? "" : rep.rates.week) + '" placeholder="amount"></label>' +
      '<label class="inl">Weekend pool (3 slots)<input type="number" min="0" step="50" data-act="rate" data-r="weekend" value="' + (rep.rates.unset ? "" : rep.rates.weekend) + '" placeholder="amount"></label>' +
      '<span class="note">' + CUR + '</span>' +
      (rep.weeks.length && !rep.rates.unset ? '<button class="btn" data-act="xlsx" type="button">Download Excel</button><button class="btn alt" data-act="pdf" type="button">Download PDF</button>' : "") + "</div>";
    if (rep.rates.unset) h += '<p class="alert" role="alert">Enter the weekday shift and weekend pool amounts to calculate the remuneration. They are saved in the admin-only data, and later months reuse them.</p>';
    else if (inherited) h += '<p class="note">Amounts carried over from ' + esc(keyLabel(rep.rates.from)) + ". Change them here to set different amounts for " + esc(keyLabel(cur)) + ".</p>";
    if (!rep.weeks.length) {
      h += '<section class="panel"><p class="empty">No weeks are paid in ' + esc(keyLabel(cur)) + ' yet. Add the planning first.</p></section>';
      $("a-pay").innerHTML = h; return;
    }
    var miss = [];
    rep.weeks.forEach(function (r, i) { if (r.missing.length) miss.push("S" + (i + 1) + ": " + r.missing.join(", ")); });
    if (miss.length) h += '<p class="alert" role="alert">Unassigned slots are not paid: ' + esc(miss.join(" | ")) + "</p>";
    h += '<section class="panel"><h2>Astreinte remuneration - ' + esc(keyLabel(cur)) + '</h2><div class="tablewrap"><table class="pay"><thead><tr><th rowspan="2">Du</th><th rowspan="2">Au</th>' +
      "<th>Shift semaine (nuit)</th><th>Samedi jour</th><th>Samedi nuit</th><th>Dimanche jour</th></tr>" +
      '<tr class="amts"><th>' + fmt(rep.rates.week) + "</th><th>" + fmt(rep.rates.weekend / 3) + "</th><th>" + fmt(rep.rates.weekend / 3) + "</th><th>" + fmt(rep.rates.weekend / 3) + "</th></tr></thead><tbody>";
    rep.weeks.forEach(function (r) {
      h += "<tr><td class=\"date\">" + shortDate(parseIso(r.start)) + '</td><td class="date">' + shortDate(parseIso(r.end)) + "</td><td>" + esc(weekdayLabel(r)) + "</td>" +
        "<td>" + esc(slotLabel(r.slots[0])) + "</td><td>" + esc(slotLabel(r.slots[1])) + "</td><td>" + esc(slotLabel(r.slots[2])) + "</td></tr>";
    });
    h += "</tbody></table></div><p class=\"note\">Sunday night is covered by the following week's shift. A week is paid in the month that contains its Thursday, unless you change \"Paid in\" on the planning page.</p></section>";
    h += '<section class="panel"><h2>Detail per person</h2><div class="tablewrap"><table class="pay"><thead><tr><th>Name</th><th>Astreinte semaine</th><th>Week-end</th><th>Detail</th><th class="num">Total ' + CUR + "</th></tr></thead><tbody>";
    rep.people.forEach(function (p) {
      h += "<tr><td>" + esc(fullName(p.name)) + "</td><td>" + esc(nightsTxt(p.t.nights)) + "</td><td>" + esc(slotsTxt(p.t.slots)) + '</td><td class="note">' + esc(p.t.det.join(" · ")) +
        '</td><td class="num"><b>' + fmt(p.total) + "</b></td></tr>";
    });
    h += '<tr class="sum"><td>Total</td><td></td><td></td><td></td><td class="num"><b>' + fmt(rep.sum) + "</b></td></tr></tbody></table></div></section>";
    $("a-pay").innerHTML = h;
  }
  // ---------- "This week" card on the main dashboard ----------
  var DAY_START = 8, DAY_END = 17; // duty window 08:00-17:00, night on-call 17:00-08:00
  function weekFor(day) {
    var t = iso(day), best = null;
    Object.keys(docs).forEach(function (k) {
      (docs[k].weeks || []).forEach(function (w) {
        if (w.start <= t && t <= iso(addD(parseIso(w.start), 6)) && (!best || (docs[k].updated || 0) >= best.upd)) best = { w: w, key: k, upd: docs[k].updated || 0 };
      });
    });
    return best;
  }
  function currentWeek() { return weekFor(new Date()); }
  function dayOf(date) { var cw = weekFor(date); if (!cw) return null; return cw.w.days[(date.getDay() + 6) % 7] || { jour: "", nuit: "" }; }
  function hhmm(n) { return pad(n) + ":00"; }
  function nowSlot() {
    var d = new Date(), h = d.getHours(), y = addD(d, -1), dd;
    if (h >= DAY_START && h < DAY_END) { dd = dayOf(d); return { kind: "day", who: names(dd && dd.jour), label: "Day duty", until: hhmm(DAY_END), next: "Night on-call: " + names(dd && dd.nuit).map(fullName).join(" + ") }; }
    if (h >= DAY_END) { dd = dayOf(d); var tm = dayOf(addD(d, 1)); return { kind: "night", who: names(dd && dd.nuit), label: "Night on-call", until: hhmm(DAY_START) + " tomorrow", next: "Tomorrow night: " + (tm ? names(tm.nuit).map(fullName).join(" + ") || "not assigned" : "not planned") }; }
    dd = dayOf(y); return { kind: "night", who: names(dd && dd.nuit), label: "Night on-call", until: hhmm(DAY_START), next: "" };
  }
  function renderNow() {
    var el = $("astr-now"); if (!el) return;
    var cw = currentWeek(), h = '<div class="nowhead"><h2>Astreinte this week</h2>';
    if (!cw) {
      el.innerHTML = h + '</div><p class="note" style="margin:0">No astreinte planning has been published for this week yet.</p>';
      return;
    }
    var w = cw.w, todayIdx = (new Date().getDay() + 6) % 7, sl = nowSlot(), weekday = todayIdx < 5;
    h += '<span class="note">' + esc(longRange(w.start)) + '</span><button class="btn ghost" data-go="' + cw.key + '" type="button">Open planning</button></div>';
    h += '<p class="tonight"><span class="note">On call now (' + esc(sl.label) + ', until ' + esc(sl.until) + '):</span> <b>' +
      (sl.who.length ? esc(sl.who.map(fullName).join(" + ")) : "not assigned") + "</b></p>";
    if (sl.next) h += '<p class="note" style="margin:0 0 8px">' + esc(sl.next) + "</p>";
    h += '<p class="note" style="margin:0 0 8px">Hours: day duty ' + hhmm(DAY_START) + '-' + hhmm(DAY_END) + ', night on-call ' + hhmm(DAY_END) + '-' + hhmm(DAY_START) + '.</p>';
    h += '<div class="tablewrap"><div class="strip">';
    for (var j = 0; j < 7; j++) {
      var dd = w.days[j] || { jour: "", nuit: "" }, nn = names(dd.nuit), jj = names(dd.jour);
      h += '<div class="dcell' + (j === todayIdx ? " today" : "") + (j >= 5 ? " we" : "") + '"><span class="dh">' + DAYS[j].slice(0, 3) + " " + shortDate(addD(parseIso(w.start), j)) + "</span>" +
        '<span class="lb">Jour</span><span class="nm">' + esc(jj.map(function (n) { return n.split(" ")[0]; }).join(", ") || "-") + "</span>" +
        '<span class="lb">Nuit</span><span class="nm">' + esc(nn.join(", ") || "-") + "</span></div>";
    }
    h += "</div></div>";
    el.innerHTML = h;
  }
  setInterval(function () { if (!document.hidden) renderNow(); }, 60000);
  if ($("astr-now")) $("astr-now").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-go]") : null; if (!b) return;
    cur = b.dataset.go; sub = "plan"; setTab("astreinte"); renderAll();
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) renderNow(); });

  // ---------- Import / export ----------
  function parseSheet(ws) {
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
    var weeks = [], w = null;
    rows.forEach(function (r) {
      var di = -1, idx = -1;
      for (var c = 0; c < r.length && c < 4; c++) {
        var v = String(r[c]).trim().toLowerCase();
        var j = DAYS.map(function (x) { return x.toLowerCase(); }).indexOf(v);
        if (j >= 0) { di = j; idx = c; break; }
      }
      if (di < 0) return;
      if (di === 0 || !w) { w = { days: [] }; for (var k = 0; k < 7; k++) w.days.push({ jour: "", nuit: "" }); weeks.push(w); }
      w.days[di] = { jour: names(r[idx + 1]).join(", "), nuit: names(r[idx + 2]).join(", ") };
    });
    return weeks;
  }
  function importFile(file) {
    if (typeof XLSX === "undefined") { msg("The Excel reader did not load. Reload the page and try again."); return; }
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var wb = XLSX.read(fr.result, { type: "array" }), weeks = [], i;
        for (i = 0; i < wb.SheetNames.length && !weeks.length; i++) weeks = parseSheet(wb.Sheets[wb.SheetNames[i]]);
        if (!weeks.length) { msg("No planning found. The sheet needs rows with a day name (Lundi...Dimanche), the day team and the night astreinte."); return; }
        if (docs[cur] && (docs[cur].weeks || []).length && !confirm("Replace the current " + keyLabel(cur) + " planning with the " + weeks.length + " weeks from this file?")) return;
        var s0 = firstStart(cur), d = ensureDoc(cur);
        d.weeks = weeks.map(function (w, n) {
          var st = iso(addD(s0, 7 * n));
          return { start: st, payMonth: natMonth(st), absent: [], days: w.days };
        });
        save(cur); msg("Imported " + weeks.length + " weeks into " + keyLabel(cur) + "."); renderAll();
      } catch (e) { msg("Could not read this file. Use an .xlsx planning like your monthly Excel."); }
    };
    fr.readAsArrayBuffer(file);
  }
  function exportPlan() {
    var d = docs[cur]; if (!d || typeof XLSX === "undefined") return;
    var aoa = [["Planning d'astreinte - " + keyLabel(cur)], [], ["Semaine", "Jour_semaine", "Jour", "Astreinte_nuit"]];
    d.weeks.forEach(function (w, i) { for (var j = 0; j < 7; j++) aoa.push([j === 0 ? "S" + (i + 1) : "", DAYS[j], w.days[j].jour, w.days[j].nuit]); });
    var ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 46 }, { wch: 18 }];
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Planning");
    XLSX.writeFile(wb, "planning_astreinte_" + keyLabel(cur).replace(" ", "_") + ".xlsx");
  }
  function exportPayXlsx() {
    if (typeof XLSX === "undefined") return;
    var rep = payReport(cur), aoa = [["Rémunération astreinte - " + keyLabel(cur)], ["DSI"], [],
      ["Période", "", "Shift semaine (nuit)", "Samedi jour", "Samedi nuit", "Dimanche jour"],
      ["Du", "Au", rep.rates.week, rep.rates.weekend + " (/3)", "", ""]];
    rep.weeks.forEach(function (r) {
      aoa.push([iso2fr(r.start), iso2fr(r.end), weekdayLabel(r), slotLabel(r.slots[0]), slotLabel(r.slots[1]), slotLabel(r.slots[2])]);
    });
    aoa.push([], ["Détail par personne (" + CUR + ")"], ["Nom", "Astreinte semaine", "Week-end", "Détail", "Total"]);
    rep.people.forEach(function (p) {
      aoa.push([fullName(p.name), nightsTxt(p.t.nights), slotsTxt(p.t.slots), p.t.det.join(" · "), Math.round(p.total * 100) / 100]);
    });
    aoa.push(["Total", "", "", "", Math.round(rep.sum * 100) / 100]);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 30 }, { wch: 40 }, { wch: 22 }, { wch: 22 }];
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, keyLabel(cur));
    XLSX.writeFile(wb, "remuneration_astreinte_" + keyLabel(cur).replace(" ", "_") + ".xlsx");
  }
  function iso2fr(s) { var d = parseIso(s); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); }
  function ascii(s) { return String(s).replace(/[–—]/g, "-"); }
  function exportPayPdf() {
    var J = window.jspdf && window.jspdf.jsPDF; if (!J) { msg("The PDF tool did not load. Reload the page and try again."); return; }
    var rep = payReport(cur), doc = new J({ unit: "mm", format: "a4", orientation: "landscape" }), W = 297, M = 16, y = M;
    function txt(t, x, size, bold, col) { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor.apply(doc, col || [14, 26, 63]); doc.text(ascii(t), x, y); }
    function need(h) { if (y + h > 195) { doc.addPage(); y = M; } }
    try { var lg = document.querySelector(".brand .logo"); if (lg) doc.addImage(lg.src, "PNG", W - M - 20, 9, 20, 18); } catch (e) {}
    txt("Remuneration astreinte - " + keyLabel(cur), M, 18, true); y += 7;
    txt("Vantage Payment Systems  |  DSI  |  Generated " + iso2fr(iso(new Date())), M, 10, false, [90, 102, 144]); y += 4;
    doc.setDrawColor(34, 77, 233); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 8;
    var cx = [M, M + 36, M + 36 + 66, M + 36 + 66 + 56, M + 36 + 66 + 56 + 56];
    ["Periode", "Shift semaine (nuit)", "Samedi jour", "Samedi nuit", "Dimanche jour"].forEach(function (h, i) { txt(h, cx[i], 9, true, [90, 102, 144]); });
    y += 4;
    txt("", M, 9); txt(fmt(rep.rates.week) + " " + CUR, cx[1], 9, true, [34, 77, 233]);
    [2, 3, 4].forEach(function (i) { txt(fmt(rep.rates.weekend / 3) + " " + CUR, cx[i], 9, true, [34, 77, 233]); });
    y += 3; doc.setDrawColor(200, 208, 230); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 5;
    rep.weeks.forEach(function (r) {
      need(8);
      txt(shortDate(parseIso(r.start)) + " - " + shortDate(parseIso(r.end)), cx[0], 10);
      txt(weekdayLabel(r).slice(0, 34), cx[1], 10); txt(slotLabel(r.slots[0]).slice(0, 28), cx[2], 10);
      txt(slotLabel(r.slots[1]).slice(0, 28), cx[3], 10); txt(slotLabel(r.slots[2]).slice(0, 28), cx[4], 10); y += 7;
    });
    y += 6; need(20);
    txt("DETAIL PAR PERSONNE", M, 9, true, [90, 102, 144]); y += 5;
    var px = [M, M + 52, M + 88, M + 112, M + 232];
    ["Nom", "Astreinte semaine", "Week-end", "Detail", "Total " + CUR].forEach(function (h, i) { txt(h, px[i], 9, true, [90, 102, 144]); });
    y += 3; doc.line(M, y, W - M, y); y += 5;
    rep.people.forEach(function (p) {
      need(8);
      txt(fullName(p.name), px[0], 10); txt(nightsTxt(p.t.nights), px[1], 10); txt(slotsTxt(p.t.slots), px[2], 10);
      txt(p.t.det.join(" - ").slice(0, 78), px[3], 8, false, [90, 102, 144]); txt(fmt(p.total), px[4], 10, true); y += 7;
    });
    doc.line(M, y - 3, W - M, y - 3);
    txt("Total", px[0], 10, true); txt(fmt(rep.sum) + " " + CUR, px[4], 11, true, [34, 77, 233]); y += 16;
    need(24); txt("Etabli par : ______________________", M, 10); txt("Valide par : ______________________", M + 120, 10);
    doc.save("remuneration_astreinte_" + keyLabel(cur).replace(" ", "_") + ".pdf");
  }

  // ---------- Events ----------
  $("a-prev").addEventListener("click", function () { cur = shiftKey(cur, -1); renderAll(); });
  $("a-next").addEventListener("click", function () { cur = shiftKey(cur, 1); renderAll(); });
  $("a-tab-plan").addEventListener("click", function () { sub = "plan"; renderAll(); });
  $("a-tab-pay").addEventListener("click", function () { sub = "pay"; renderAll(); });

  $("view-astreinte").addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-act]") : null; if (!t) return;
    var a = t.dataset.act, d = docs[cur], i = +t.dataset.w;
    if (!isAdmin) return;
    if (a === "import") { var f = $("a-file"); if (f) f.click(); }
    else if (a === "export") exportPlan();
    else if (a === "xlsx") exportPayXlsx();
    else if (a === "pdf") exportPayPdf();
    else if (a === "create") {
      d = ensureDoc(cur); d.weeks = weekStartsFor(cur).map(function (s) { return newWeek(s, cur); }); save(cur); renderAll();
    } else if (a === "addwk" && d) {
      var last = d.weeks.length ? iso(addD(parseIso(d.weeks[d.weeks.length - 1].start), 7)) : iso(firstStart(cur));
      d.weeks.push(newWeek(last, cur)); save(cur); renderAll();
    } else if (a === "absent" && d && d.weeks[i]) {
      var wk = d.weeks[i], nm = t.dataset.n, ab = (wk.absent || []).map(canon), at = ab.indexOf(nm);
      if (at >= 0) ab.splice(at, 1); else ab.push(nm);
      wk.absent = ab; refillDays(wk); save(cur); renderAll();
    } else if (a === "delwk" && d) {
      if (confirm("Remove this week from the planning?")) { d.weeks.splice(i, 1); save(cur); renderAll(); }
    }
  });
  $("view-astreinte").addEventListener("change", function (e) {
    var t = e.target, a = t.dataset && t.dataset.act;
    if (t.id === "a-file") { if (!isAdmin) return; if (t.files && t.files[0]) importFile(t.files[0]); t.value = ""; return; }
    if (!a || !isAdmin) return;
    var i = +t.dataset.w, j = +t.dataset.d, d = docs[cur];
    if (a === "rate") {
      var cr = ratesFor(cur), nr = { week: cr.week, weekend: cr.weekend }, v = parseFloat(t.value);
      if (!(v >= 0)) { renderAll(); return; }
      nr[t.dataset.r] = v; saveAdmin(cur, nr); renderAll(); return;
    }
    if (!d || !d.weeks[i]) return;
    if (a === "jour" || a === "nuit") {
      var val = names(t.value).join(", "); d.weeks[i].days[j][a] = val; t.value = val;
      if (a === "nuit" && j < 5) refillDays(d.weeks[i], j);
      save(cur); renderAll();
    } else if (a === "bulk") {
      if (t.value) { for (var k = 0; k < 5; k++) d.weeks[i].days[k].nuit = t.value; refillDays(d.weeks[i]); save(cur); }
      renderAll();
    } else if (a === "pay") {
      d.weeks[i].payMonth = t.value; save(cur); renderAll();
    }
  });

  // ---------- Live data ----------
  auth.onAuthStateChanged(function (u) {
    if (unsub) { unsub(); unsub = null; }
    if (unsubA) { unsubA(); unsubA = null; }
    docs = {}; adminDocs = {};
    isAdmin = !!(u && u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    if (!u) return;
    unsub = fs.collection("astreinte").onSnapshot(function (snap) {
      var nd = {};
      snap.docs.forEach(function (x) { nd[x.id] = x.data(); });
      if (stable(nd) === stable(docs)) return;
      docs = nd; renderAll();
    }, function () { msg("Cannot read the astreinte data. Publish the updated Firestore rules (see README) and reload."); });
    if (isAdmin) unsubA = fs.collection("astreinte_admin").onSnapshot(function (snap) {
      var nd = {};
      snap.docs.forEach(function (x) { nd[x.id] = x.data(); });
      if (stable(nd) === stable(adminDocs)) return;
      adminDocs = nd; renderAll();
    }, function () { msg("Cannot read the admin data. Publish the updated Firestore rules (see README) and reload."); });
    renderAll();
  });
})();

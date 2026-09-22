// HR: leave / sick days log and incident reports for the Team Task Log.
// Data lives in Firestore: collection "leaves" (one doc per absence) and
// collection "incidents" (one doc per incident, modelled on the "Fiche
// Incident sécurité" form).
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };

  var TEAM = ["Abdelmajid JIYADI", "Anas SAFOUH", "Houssam JIHAZ", "Innocent KOFFI", "Mouad ABOUSSIBER", "Soulaymane BOURAS"];

  if (!$("view-hr")) return; // markup not present in this build
  if (!window.firebase || !firebase.apps || !firebase.apps.length) {
    var m = $("hr-msg"); if (m) m.textContent = "HR data is not available (Firebase not initialised).";
    var inow = $("inc-now"); if (inow) inow.innerHTML = "<h2>Incidents</h2><p class=\"note\">Incident data is not available (Firebase not initialised).</p>";
    return;
  }
  var fs = firebase.firestore(), auth = firebase.auth();

  // ---------- Dates ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseIso(s) { var p = String(s || "").split("-"); return new Date(+p[0] || 2000, (+p[1] || 1) - 1, +p[2] || 1); }
  function addD(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function fmtDay(s) { return s ? parseIso(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : ""; }
  function daysBetween(a, b) { return Math.max(1, Math.round((parseIso(b) - parseIso(a)) / 86400000) + 1); }
  function today0() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  function monthKey(s) { return String(s || "").slice(0, 7); }

  $("hr-owners").innerHTML = TEAM.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");

  var leaves = {}, incidents = {}, unsubL = null, unsubI = null;

  function stable(o) { try { return JSON.stringify(o); } catch (e) { return String(Math.random()); } }
  function msg(t) { var el = $("hr-msg"); if (el) el.textContent = t || ""; }
  function incMsg(t) { var el = $("inc-msg-top"); if (el) el.textContent = t || ""; }

  // ---------- Leave & sick days ----------
  function renderLeaves() {
    var mk = monthKey(iso(today0()));
    var all = Object.keys(leaves).map(function (id) { var v = leaves[id]; return Object.assign({ id: id }, v); });
    var thisMonth = all.filter(function (l) { return monthKey(l.start) === mk || monthKey(l.end) === mk; });
    var daysThisMonth = thisMonth.reduce(function (a, l) { return a + (l.days || daysBetween(l.start, l.end)); }, 0);
    var t = iso(today0());
    var away = all.filter(function (l) { return l.start <= t && t <= l.end; });
    $("hr-lv-kpis").innerHTML =
      '<div class="kpi"><b>' + away.length + '</b><span>Away right now</span></div>' +
      '<div class="kpi"><b>' + thisMonth.length + '</b><span>Leave/sick entries this month</span></div>' +
      '<div class="kpi"><b>' + daysThisMonth + '</b><span>Days off this month</span></div>' +
      '<div class="kpi"><b>' + all.filter(function (l) { return l.status !== "Validé"; }).length + '</b><span>Pending validation</span></div>';

    var nowEl = $("hr-lv-now");
    if (away.length) {
      nowEl.innerHTML = '<h2>Currently away</h2><div class="absent">' + away.map(function (l) {
        return '<span class="pick" aria-pressed="true">' + esc(l.name) + ' &middot; ' + esc(l.type) + ' (until ' + fmtDay(l.end) + ')</span>';
      }).join("") + "</div>";
    } else {
      nowEl.innerHTML = '<h2>Currently away</h2><p class="note" style="margin:0">Nobody is on leave or sick today.</p>';
    }

    var fp = $("lv-fp"), curP = fp.value, names = Array.from(new Set(TEAM.concat(all.map(function (l) { return l.name; })))).sort();
    fp.innerHTML = '<option value="">Everyone</option>' + names.map(function (n) { return "<option>" + esc(n) + "</option>"; }).join("");
    fp.value = names.indexOf(curP) >= 0 ? curP : "";
    var ft = $("lv-ft").value;
    var rows = all.filter(function (l) { return (!fp.value || l.name === fp.value) && (!ft || l.type === ft); })
      .sort(function (a, b) { return b.start < a.start ? -1 : b.start > a.start ? 1 : 0; });
    $("lv-rows").innerHTML = rows.length ? rows.map(function (l) {
      var isAdmin = window.HR_IS_ADMIN;
      return "<tr><td>" + esc(l.name) + "</td><td><span class=\"chip cat\">" + esc(l.type) + "</span></td><td class=\"date\">" + fmtDay(l.start) + "</td><td class=\"date\">" + fmtDay(l.end) + "</td>" +
        '<td class="num">' + (l.days || daysBetween(l.start, l.end)) + "</td><td>" +
        '<span class="chip ' + (l.status === "Validé" ? "Low" : "Medium") + '">' + esc(l.status || "En attente") + "</span></td>" +
        '<td class="note">' + esc(l.note || "") + "</td><td>" +
        (l.status !== "Validé" ? '<button class="btn ghost" data-lv-validate="' + l.id + '">Validate</button>' : "") +
        ' <button class="btn ghost" data-lv-del="' + l.id + '" aria-label="Delete">Delete</button></td></tr>';
    }).join("") : '<tr><td colspan="8" class="empty">No leave or sick days logged.</td></tr>';
  }

  $("lv-f").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("lv-name").value.trim(), start = $("lv-start").value, end = $("lv-end").value || start;
    if (!name || !start) return;
    if (end < start) end = start;
    var rec = { name: name, type: $("lv-type").value, start: start, end: end, days: daysBetween(start, end), note: $("lv-note").value.trim(), status: "En attente", created: Date.now() };
    $("lv-go").disabled = true;
    fs.collection("leaves").add(rec).then(function () {
      $("lv-go").disabled = false; $("lv-msg").textContent = "Saved."; $("lv-name").value = ""; $("lv-note").value = "";
    }, function (err) {
      $("lv-go").disabled = false;
      $("lv-msg").textContent = (err && err.code === "permission-denied") ? "You don't have permission to add this." : "Could not save. Try again.";
    });
  });

  $("hr-leaves").addEventListener("click", function (e) {
    var v = e.target.getAttribute && e.target.getAttribute("data-lv-del");
    if (v) { if (confirm("Delete this entry?")) fs.collection("leaves").doc(v).delete(); return; }
    var w = e.target.getAttribute && e.target.getAttribute("data-lv-validate");
    if (w) fs.collection("leaves").doc(w).update({ status: "Validé" });
  });

  // ---------- Incidents ----------
  function sevClass(s) { return s === "Majeur" ? "High" : s === "Modéré" ? "Medium" : "Low"; }

  function renderIncidents() {
    var mk = monthKey(iso(today0()));
    var all = Object.keys(incidents).map(function (id) { var v = incidents[id]; return Object.assign({ id: id }, v); });
    var thisMonth = all.filter(function (i) { return monthKey(i.declDate) === mk; });
    var open = all.filter(function (i) { return i.status !== "Clôturé"; });
    var hours = all.reduce(function (a, i) { return a + (parseFloat(i.hours) || 0); }, 0);
    var major = all.filter(function (i) { return i.severity === "Majeur"; }).length;
    window.OPEN_INCIDENTS_COUNT = open.length;
    if (window.renderTasksKPIs) window.renderTasksKPIs();
    $("inc-kpis").innerHTML =
      '<div class="kpi"><b>' + thisMonth.length + '</b><span>Incidents this month</span></div>' +
      '<div class="kpi"><b>' + open.length + '</b><span>Open incidents</span></div>' +
      '<div class="kpi"><b>' + major + '</b><span>Major severity (all time)</span></div>' +
      '<div class="kpi"><b>' + (Math.round(hours * 10) / 10) + '</b><span>Total downtime (hours)</span></div>';

    var fsev = $("inc-fsev").value, fstatus = $("inc-fstatus").value;
    var rows = all.filter(function (i) { return (!fsev || i.severity === fsev) && (!fstatus || i.status === fstatus); })
      .sort(function (a, b) { return (b.declDate || "") < (a.declDate || "") ? -1 : 1; });
    $("inc-rows").innerHTML = rows.length ? rows.map(function (i) {
      return "<tr><td class=\"date\">" + fmtDay(i.declDate) + "</td><td><span class=\"chip cat\">" + esc(i.category) + "</span></td>" +
        '<td><span class="chip ' + sevClass(i.severity) + '">' + esc(i.severity) + "</span></td>" +
        '<td class="note" style="max-width:280px">' + esc((i.details || "").slice(0, 140)) + "</td>" +
        '<td class="num">' + (i.hours || 0) + " h</td><td>" +
        '<span class="chip ' + (i.status === "Clôturé" ? "Low" : "Medium") + '">' + esc(i.status || "Ouvert") + "</span></td><td>" +
        (i.status !== "Clôturé" ? '<button class="btn ghost" data-inc-close="' + i.id + '">Close</button>' : "") +
        ' <button class="btn ghost" data-inc-pdf="' + i.id + '">PDF</button>' +
        ' <button class="btn ghost" data-inc-del="' + i.id + '" aria-label="Delete">Delete</button></td></tr>';
    }).join("") : '<tr><td colspan="7" class="empty">No incidents logged.</td></tr>';
  }

  $("inc-f").addEventListener("submit", function (e) {
    e.preventDefault();
    var rec = {
      declDate: $("inc-decl").value, occDate: $("inc-occ").value || $("inc-decl").value,
      category: $("inc-cat").value, severity: $("inc-sev").value, declarant: $("inc-declarant").value.trim(),
      external: $("inc-ext").value, hours: parseFloat($("inc-hours").value) || 0, status: $("inc-status").value,
      details: $("inc-details").value.trim(), causes: $("inc-causes").value.trim(), impact: $("inc-impact").value.trim(),
      solProv: $("inc-prov").value.trim(), solDef: $("inc-def").value.trim(),
      respName: $("inc-resp").value.trim(), respTitle: $("inc-resptitle").value.trim(), actionDate: $("inc-actiondate").value,
      followName: $("inc-followname").value.trim(), followTitle: $("inc-followtitle").value.trim(), followNotes: $("inc-follownotes").value.trim(),
      closedBy: $("inc-closedby").value.trim(), closedByTitle: $("inc-closedbytitle").value.trim(), closedDate: $("inc-closeddate").value,
      created: Date.now()
    };
    if (!rec.declDate) return;
    $("inc-go").disabled = true;
    fs.collection("incidents").add(rec).then(function () {
      $("inc-go").disabled = false; $("inc-msg").textContent = "Incident saved.";
      $("inc-f").reset(); $("inc-decl").value = iso(today0()); $("inc-occ").value = iso(today0());
    }, function (err) {
      $("inc-go").disabled = false;
      $("inc-msg").textContent = (err && err.code === "permission-denied") ? "You don't have permission to add this." : "Could not save. Try again.";
    });
  });

  // Builds a one-page PDF laid out like the "Annexe 3 : Fiche Incident sécurité"
  // form (bordered table, shaded section headers, checkbox-style options).
  function exportIncidentPdf(i) {
    if (!window.jspdf) { alert("PDF export is unavailable right now."); return; }
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    var pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    var x = 40, w = pageW - 80, y = 40;

    function checkPage(need) {
      if (y + need > pageH - 40) { doc.addPage(); y = 40; }
    }
    function box(h) { doc.setDrawColor(120); doc.setLineWidth(0.75); doc.rect(x, y, w, h); }
    function sectionHeader(text, h) {
      h = h || 20;
      checkPage(h);
      doc.setFillColor(222, 227, 245);
      doc.rect(x, y, w, h, "F");
      box(h);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20, 25, 60);
      doc.text(text, x + w / 2, y + h / 1.5, { align: "center" });
      y += h;
    }
    function pairRow(labelA, valA, labelB, valB) {
      var half = w / 2, h = 20;
      checkPage(h);
      doc.setDrawColor(150); doc.setLineWidth(0.5);
      doc.rect(x, y, half, h); doc.rect(x + half, y, half, h);
      doc.setFontSize(9); doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "bold"); doc.text(labelA + " :", x + 8, y + 13);
      doc.setFont("helvetica", "normal"); doc.text(String(valA || "-"), x + 8 + doc.getTextWidth(labelA + " :  "), y + 13);
      doc.setFont("helvetica", "bold"); doc.text(labelB + " :", x + half + 8, y + 13);
      doc.setFont("helvetica", "normal"); doc.text(String(valB || "-"), x + half + 8 + doc.getTextWidth(labelB + " :  "), y + 13);
      y += h;
    }
    function checkRow(options, selected) {
      var h = 20;
      checkPage(h);
      box(h);
      doc.setFontSize(9); doc.setTextColor(0, 0, 0);
      var cx = x + 10, cy = y + 13, sq = 8;
      options.forEach(function (opt) {
        var on = opt === selected;
        doc.setDrawColor(0); doc.setLineWidth(0.75);
        doc.rect(cx, cy - sq + 1, sq, sq);
        if (on) { doc.setFillColor(0, 0, 0); doc.rect(cx + 1.3, cy - sq + 2.3, sq - 2.6, sq - 2.6, "F"); }
        doc.setFont("helvetica", on ? "bold" : "normal");
        doc.text(opt, cx + sq + 4, cy);
        cx += sq + 8 + doc.getTextWidth(opt) + 16;
      });
      y += h;
    }
    function textBlock(text, opts) {
      opts = opts || {};
      doc.setFont("helvetica", opts.bold ? "bold" : "normal"); doc.setFontSize(9);
      var lines = doc.splitTextToSize(String(text || "-"), w - 16);
      var h = Math.max(20, lines.length * 12 + 8);
      checkPage(h);
      box(h);
      doc.setTextColor(0, 0, 0);
      doc.text(lines, x + 8, y + 13);
      y += h;
    }
    function labelledBlock(label, text) {
      doc.setFontSize(9);
      var full = doc.splitTextToSize(String(text || "-"), w - 16);
      var h = Math.max(20, 14 + full.length * 12 + 6);
      checkPage(h);
      box(h);
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "bold"); doc.text(label + " :", x + 8, y + 13);
      doc.setFont("helvetica", "normal"); doc.text(full, x + 8, y + 13 + 14);
      y += h;
    }

    // Header: logo + title
    var logo = document.querySelector(".brand .logo");
    try { if (logo && logo.src) doc.addImage(logo.src, "PNG", x, y, 34, 34); } catch (e) {}
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(20, 25, 60);
    doc.text("Annexe 3 : Fiche Incident sécurité", x + 44, y + 22);
    y += 44;

    pairRow("Date de déclaration", fmtDay(i.declDate), "Date de survenue", fmtDay(i.occDate));

    sectionHeader("Catégorisation");
    checkRow(["Système et réseau", "Sécurité des données", "Ressources humaines", "Éthique", "Opérationnel"], i.category);

    sectionHeader("Classification");
    checkRow(["Mineur", "Modéré", "Majeur"], i.severity);

    sectionHeader("Déclarant");
    textBlock(i.declarant);

    sectionHeader("Détails Incident");
    textBlock(i.details);
    labelledBlock("Causes de l'incident", i.causes);
    labelledBlock("Analyse d'impact", i.impact);
    labelledBlock("Solution provisoire", i.solProv);
    labelledBlock("Solution définitive", i.solDef);

    sectionHeader("Implication de ressources externes pour la résolution");
    checkRow(["Oui", "Non"], i.external);

    sectionHeader("Mise en œuvre de l'action");
    pairRow("Nom et prénom", i.respName, "Titre / Qualité", i.respTitle);
    textBlock("Date de mise en œuvre : " + (i.actionDate ? fmtDay(i.actionDate) : "-"));

    sectionHeader("Suivi de l'action");
    pairRow("Nom et prénom", i.followName, "Poste", i.followTitle);
    textBlock("Dates de suivi et commentaires : " + (i.followNotes || "-"));

    sectionHeader("Coût de l'incident");
    textBlock("Temps : " + (i.hours || 0) + " heure(s)");

    sectionHeader("Clôturé par");
    pairRow("Nom et prénom", i.closedBy, "Poste", i.closedByTitle);
    textBlock("Date de clôture : " + (i.status === "Clôturé" ? fmtDay(i.closedDate) : "-"));

    doc.save("Incident_" + (i.declDate || "date") + ".pdf");
  }

  $("hr-inc").addEventListener("click", function (e) {
    var d = e.target.getAttribute && e.target.getAttribute("data-inc-del");
    if (d) { if (confirm("Delete this incident?")) fs.collection("incidents").doc(d).delete(); return; }
    var c = e.target.getAttribute && e.target.getAttribute("data-inc-close");
    if (c) fs.collection("incidents").doc(c).update({ status: "Clôturé", closedDate: iso(today0()) });
    var p = e.target.getAttribute && e.target.getAttribute("data-inc-pdf");
    if (p) { var i = incidents[p]; if (i) exportIncidentPdf(Object.assign({ id: p }, i)); }
  });

  // ---------- Incidents summary card on the Tasks dashboard ----------
  function renderIncNow() {
    var el = $("inc-now"); if (!el) return;
    var all = Object.keys(incidents).map(function (id) { var v = incidents[id]; return Object.assign({ id: id }, v); });
    var open = all.filter(function (i) { return i.status !== "Clôturé"; }).sort(function (a, b) { return (b.declDate || "") < (a.declDate || "") ? -1 : 1; });
    var h = '<div class="nowhead"><h2>Incidents</h2><button class="btn ghost" type="button" id="inc-now-go">Open incidents</button></div>';
    if (!open.length) {
      h += '<p class="note" style="margin:0">No open incident right now.</p>';
    } else {
      h += '<div class="absent">' + open.slice(0, 4).map(function (i) {
        return '<span class="pick" aria-pressed="true"><span class="chip ' + sevClass(i.severity) + '" style="margin-right:6px">' + esc(i.severity) + '</span>' + esc(i.category) + ' &middot; ' + fmtDay(i.declDate) + '</span>';
      }).join("") + "</div>";
      if (open.length > 4) h += '<p class="note" style="margin:6px 0 0">+' + (open.length - 4) + " more open.</p>";
    }
    el.innerHTML = h;
    var b = $("inc-now-go");
    if (b) b.addEventListener("click", function () {
      if (window.APP_SET_TAB) window.APP_SET_TAB("incidents");
    });
  }

  // ---------- Render + live data ----------
  window.renderHR = function () { renderLeaves(); renderIncidents(); renderIncNow(); };
  $("lv-fp").addEventListener("change", renderLeaves);
  $("lv-ft").addEventListener("change", renderLeaves);
  $("inc-fsev").addEventListener("change", renderIncidents);
  $("inc-fstatus").addEventListener("change", renderIncidents);
  $("inc-decl").value = iso(today0()); $("inc-occ").value = iso(today0());

  auth.onAuthStateChanged(function (u) {
    if (unsubL) { unsubL(); unsubL = null; }
    if (unsubI) { unsubI(); unsubI = null; }
    leaves = {}; incidents = {};
    window.HR_IS_ADMIN = !!(u && u.email && u.email.toLowerCase() === "mouad.aboussiber@vpscorp.ma");
    if (!u) return;
    unsubL = fs.collection("leaves").onSnapshot(function (snap) {
      var nd = {}; snap.docs.forEach(function (x) { nd[x.id] = x.data(); });
      if (stable(nd) === stable(leaves)) return;
      leaves = nd; window.renderHR();
    }, function () { msg("Cannot read leave data. Publish the updated Firestore rules (see README) and reload."); });
    unsubI = fs.collection("incidents").onSnapshot(function (snap) {
      var nd = {}; snap.docs.forEach(function (x) { nd[x.id] = x.data(); });
      if (stable(nd) === stable(incidents)) return;
      incidents = nd; window.renderHR();
    }, function () { incMsg("Cannot read incident data. Publish the updated Firestore rules (see README) and reload."); });
    window.renderHR();
  });
})();

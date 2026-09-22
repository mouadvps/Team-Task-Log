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

  // ---------- Sub-tabs ----------
  var sub = "leaves";
  function setSub(v) {
    sub = v;
    $("hr-leaves").hidden = v !== "leaves";
    $("hr-inc").hidden = v !== "incidents";
    $("hr-tab-leaves").setAttribute("aria-pressed", v === "leaves" ? "true" : "false");
    $("hr-tab-inc").setAttribute("aria-pressed", v === "incidents" ? "true" : "false");
  }
  $("hr-tab-leaves").addEventListener("click", function () { setSub("leaves"); });
  $("hr-tab-inc").addEventListener("click", function () { setSub("incidents"); });

  $("hr-owners").innerHTML = TEAM.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");

  var leaves = {}, incidents = {}, unsubL = null, unsubI = null;

  function stable(o) { try { return JSON.stringify(o); } catch (e) { return String(Math.random()); } }
  function msg(t) { var el = $("hr-msg"); if (el) el.textContent = t || ""; }

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
      respName: $("inc-resp").value.trim(), respTitle: $("inc-resptitle").value.trim(),
      closedBy: $("inc-closedby").value.trim(), closedDate: $("inc-closeddate").value,
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

  function exportIncidentPdf(i) {
    if (!window.jspdf) { alert("PDF export is unavailable right now."); return; }
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    var W = doc.internal.pageSize.getWidth(), x = 40, y = 50;
    var logo = document.querySelector(".brand .logo");
    try { if (logo && logo.src) doc.addImage(logo.src, "PNG", x, y - 25, 40, 40); } catch (e) {}
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("Fiche Incident sécurité", x + 50, y);
    y += 26;
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    function line(label, value) {
      doc.setFont("helvetica", "bold"); doc.text(label + ":", x, y);
      doc.setFont("helvetica", "normal");
      var split = doc.splitTextToSize(String(value || "-"), W - x - 160);
      doc.text(split, x + 150, y);
      y += Math.max(14, split.length * 12);
    }
    line("Date de déclaration", fmtDay(i.declDate));
    line("Date de survenue", fmtDay(i.occDate));
    line("Catégorie", i.category);
    line("Classification", i.severity);
    line("Déclarant", i.declarant);
    y += 4; line("Détails", i.details);
    line("Causes", i.causes);
    line("Analyse d'impact", i.impact);
    line("Solution provisoire", i.solProv);
    line("Solution définitive", i.solDef);
    line("Ressources externes", i.external);
    line("Responsable", (i.respName || "-") + (i.respTitle ? " (" + i.respTitle + ")" : ""));
    line("Temps (downtime)", (i.hours || 0) + " heure(s)");
    line("Statut", i.status);
    if (i.status === "Clôturé") { line("Clôturé par", i.closedBy); line("Date de clôture", fmtDay(i.closedDate)); }
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

  // ---------- Render + live data ----------
  window.renderHR = function () { renderLeaves(); renderIncidents(); };
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
    }, function () { msg("Cannot read incident data. Publish the updated Firestore rules (see README) and reload."); });
    window.renderHR();
  });
})();

/* SS Holdings Command Centre - app.js (Phase 1) */
(function () {
  "use strict";

  var KEY = "ssCommand.v1";
  var BACKUP_KEY = "ssCommand.lastBackup";
  var state = { transactions: [], goals: [] };
  var saveWarned = false;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function btn(text, cls, fn) {
    var b = el("button", "btn small " + (cls || ""), text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  /* ---------- Validation and money ---------- */
  function validDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split("-"), y = +p[0], m = +p[1], d = +p[2];
    if (y < 2000 || y > 2100) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  // Text to whole cents. Returns null if invalid. Accepts 1250.50 or 1250,50.
  function parseRand(text) {
    var s = String(text).replace(/\s/g, "").replace(/^R/i, "");
    if (!/^\d{1,9}([.,]\d{1,2})?$/.test(s)) return null;
    var parts = s.replace(",", ".").split(".");
    var cents = parseInt(parts[0], 10) * 100 + parseInt(((parts[1] || "") + "00").slice(0, 2), 10);
    return cents > 0 ? cents : null;
  }
  function rand(cents) {
    var a = Math.abs(cents);
    var whole = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (cents < 0 ? "-" : "") + "R" + whole + "." + pad(a % 100);
  }
  function plainAmount(cents) { return Math.floor(cents / 100) + "." + pad(cents % 100); }

  function cleanTx(t) {
    if (!t || typeof t !== "object") return null;
    if (t.account !== "personal" && t.account !== "business") return null;
    if (t.type !== "income" && t.type !== "expense") return null;
    if (typeof t.cents !== "number" || t.cents % 1 !== 0 || t.cents < 1 || t.cents > 99999999999) return null;
    if (!validDate(t.date)) return null;
    return {
      id: (typeof t.id === "string" && t.id) ? t.id.slice(0, 40) : newId(),
      account: t.account, type: t.type, cents: t.cents, date: t.date,
      category: String(t.category || "Uncategorised").slice(0, 40),
      note: String(t.note || "").slice(0, 100)
    };
  }
  function cleanGoal(g) {
    if (!g || typeof g !== "object") return null;
    var title = String(g.title || "").trim().slice(0, 80);
    if (!title) return null;
    var due = g.due ? String(g.due) : "";
    if (due && !validDate(due)) return null;
    return {
      id: (typeof g.id === "string" && g.id) ? g.id.slice(0, 40) : newId(),
      title: title, kind: g.kind === "goal" ? "goal" : "task", due: due, done: g.done === true
    };
  }
  function cleanData(obj) {
    if (!obj || !Array.isArray(obj.transactions) || !Array.isArray(obj.goals)) {
      return { error: "This does not look like a backup from this app. Nothing was changed." };
    }
    var tx = [], gl = [], i, c;
    for (i = 0; i < obj.transactions.length; i++) {
      c = cleanTx(obj.transactions[i]);
      if (!c) return { error: "Record number " + (i + 1) + " in the backup is invalid, so nothing was restored." };
      tx.push(c);
    }
    for (i = 0; i < obj.goals.length; i++) {
      c = cleanGoal(obj.goals[i]);
      if (!c) return { error: "Task/goal number " + (i + 1) + " in the backup is invalid, so nothing was restored." };
      gl.push(c);
    }
    return { transactions: tx, goals: gl };
  }

  /* ---------- Saving and loading (browser storage on this phone) ---------- */
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var r = cleanData(JSON.parse(raw));
      if (r.error) throw new Error(r.error);
      state = r;
    } catch (e) {
      try { localStorage.setItem(KEY + ".corrupt", raw); } catch (e2) {}
      alert("Your saved data could not be read, so the app started empty. A copy of the unreadable data was kept in the browser. Please do not add records until you have asked for help.");
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) {
      if (!saveWarned) {
        saveWarned = true;
        alert("WARNING: this change could NOT be saved. Safari may be blocking storage (for example in Private mode). Do not rely on this data.");
      }
      return false;
    }
  }

  /* ---------- Screens ---------- */
  function show(name) {
    ["dashboard", "add", "history", "goals", "backup"].forEach(function (v) {
      $("view-" + v).classList.toggle("active", v === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.classList.toggle("active", t.getAttribute("data-view") === name);
    });
    window.scrollTo(0, 0);
  }

  function setNet(node, c) {
    node.textContent = rand(c);
    node.className = c > 0 ? "pos" : (c < 0 ? "neg" : "");
  }

  function renderDashboard() {
    var month = $("dash-period").value === "month" ? todayISO().slice(0, 7) : null;
    var s = { personal: { income: 0, expense: 0 }, business: { income: 0, expense: 0 } };
    state.transactions.forEach(function (t) {
      if (month && t.date.slice(0, 7) !== month) return;
      s[t.account][t.type] += t.cents;
    });
    ["personal", "business"].forEach(function (a) {
      $(a + "-in").textContent = rand(s[a].income);
      $(a + "-out").textContent = rand(s[a].expense);
      setNet($(a + "-net"), s[a].income - s[a].expense);
    });
    setNet($("total-net"),
      (s.personal.income + s.business.income) - (s.personal.expense + s.business.expense));
    var done = state.goals.filter(function (g) { return g.done; }).length;
    $("done-tasks").textContent = done;
    $("open-tasks").textContent = state.goals.length - done;
  }

  function renderBackupInfo() {
    var last = null;
    try { last = localStorage.getItem(BACKUP_KEY); } catch (e) {}
    var msg = "";
    if (last) {
      $("last-backup").textContent = "Last backup started: " + last.slice(0, 10) + ". This only shows a backup was started. Check the file is really saved.";
    } else {
      $("last-backup").textContent = "No backup downloaded yet.";
    }
    if (state.transactions.length || state.goals.length) {
      if (!last) {
        msg = "You have records but have never made a backup. Go to the Backup tab.";
      } else {
        var days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
        if (days >= 7) msg = "Your last backup was " + days + " days ago. Please make a new one.";
      }
    }
    $("backup-reminder").textContent = msg;
  }

  function renderHistory() {
    var fa = $("filter-account").value, ft = $("filter-type").value;
    var list = state.transactions.filter(function (t) {
      return (fa === "all" || t.account === fa) && (ft === "all" || t.type === ft);
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    var inc = 0, exp = 0;
    list.forEach(function (t) { if (t.type === "income") inc += t.cents; else exp += t.cents; });
    $("history-summary").textContent = list.length
      ? list.length + " record(s). In " + rand(inc) + ", out " + rand(exp) + ", net " + rand(inc - exp) + "."
      : "";
    var ul = $("tx-list");
    ul.innerHTML = "";
    list.forEach(function (t) {
      var li = el("li", "item");
      var main = el("div", "item-main");
      main.appendChild(el("div", "item-title", t.category));
      main.appendChild(el("div", "item-sub",
        t.date + " - " + (t.account === "personal" ? "Personal" : "Business") + (t.note ? " - " + t.note : "")));
      var actions = el("div");
      actions.appendChild(btn("Edit", "", function () { startEdit(t.id); }));
      actions.appendChild(btn("Delete", "danger", function () { deleteTx(t.id); }));
      main.appendChild(actions);
      var side = el("div", "item-side");
      side.appendChild(el("div", "amount " + t.type, (t.type === "income" ? "+" : "-") + rand(t.cents)));
      li.appendChild(main);
      li.appendChild(side);
      ul.appendChild(li);
    });
    var empty = $("tx-empty");
    empty.hidden = list.length > 0;
    empty.textContent = state.transactions.length
      ? "No records match this filter."
      : "No records yet. Use the Add tab to create your first one.";
  }

  function renderGoals() {
    var list = state.goals.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.due !== b.due) {
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due < b.due ? -1 : 1;
      }
      return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0);
    });
    var ul = $("goal-list");
    ul.innerHTML = "";
    list.forEach(function (g) {
      var li = el("li", "item" + (g.done ? " done" : ""));
      var main = el("div", "item-main");
      main.appendChild(el("div", "item-title", g.title));
      main.appendChild(el("div", "item-sub",
        (g.kind === "goal" ? "Goal" : "Task") + (g.due ? " - due " + g.due : "") + (g.done ? " - done" : "")));
      var actions = el("div");
      actions.appendChild(btn(g.done ? "Reopen" : "Mark done", "", function () { g.done = !g.done; save(); renderAll(); }));
      actions.appendChild(btn("Delete", "danger", function () {
        if (!confirm("Delete this item?")) return;
        state.goals = state.goals.filter(function (x) { return x.id !== g.id; });
        save(); renderAll();
      }));
      main.appendChild(actions);
      li.appendChild(main);
      ul.appendChild(li);
    });
    $("goal-empty").hidden = list.length > 0;
  }

  function renderAll() {
    renderDashboard();
    renderHistory();
    renderGoals();
    renderBackupInfo();
  }

  /* ---------- Records: add, edit, delete ---------- */
  function resetForm() {
    $("tx-form").reset();
    $("tx-id").value = "";
    $("tx-date").value = todayISO();
    $("form-title").textContent = "Add a record";
    $("tx-save").textContent = "Save record";
    $("tx-cancel").hidden = true;
    $("tx-error").textContent = "";
  }
  function startEdit(id) {
    var t = state.transactions.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    $("tx-id").value = t.id;
    $("tx-account").value = t.account;
    $("tx-type").value = t.type;
    $("tx-amount").value = plainAmount(t.cents);
    $("tx-date").value = t.date;
    $("tx-category").value = t.category;
    $("tx-note").value = t.note;
    $("form-title").textContent = "Edit record";
    $("tx-save").textContent = "Save changes";
    $("tx-cancel").hidden = false;
    $("tx-error").textContent = "";
    show("add");
  }
  function deleteTx(id) {
    if (!confirm("Delete this record? This cannot be undone.")) return;
    state.transactions = state.transactions.filter(function (x) { return x.id !== id; });
    save();
    renderAll();
  }

  $("tx-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var err = $("tx-error");
    var cents = parseRand($("tx-amount").value);
    if (cents === null) { err.textContent = "Enter an amount above zero, like 1250.50 (numbers only, up to 2 decimals)."; return; }
    var date = $("tx-date").value;
    if (!validDate(date)) { err.textContent = "Choose a valid date."; return; }
    var id = $("tx-id").value;
    var rec = cleanTx({
      id: id || newId(),
      account: $("tx-account").value,
      type: $("tx-type").value,
      cents: cents,
      date: date,
      category: $("tx-category").value.trim() || "Uncategorised",
      note: $("tx-note").value.trim()
    });
    if (!rec) { err.textContent = "Something is wrong with the details. Please check them."; return; }
    var idx = -1;
    state.transactions.forEach(function (x, i) { if (x.id === rec.id) idx = i; });
    if (idx >= 0) state.transactions[idx] = rec; else state.transactions.push(rec);
    save();
    resetForm();
    renderAll();
    show("history");
  });
  $("tx-cancel").addEventListener("click", function () { resetForm(); show("history"); });

  /* ---------- Tasks and goals ---------- */
  $("goal-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var err = $("goal-error");
    var g = cleanGoal({
      title: $("goal-title").value,
      kind: $("goal-kind").value,
      due: $("goal-due").value,
      done: false
    });
    if (!g) { err.textContent = "Type what needs doing, and use a valid due date or leave it empty."; return; }
    err.textContent = "";
    state.goals.push(g);
    save();
    $("goal-form").reset();
    renderAll();
  });

  /* ---------- Backup and restore ---------- */
  function setStatus(msg, isError) {
    var s = $("backup-status");
    s.textContent = msg;
    s.style.color = isError ? "var(--red)" : "var(--green)";
  }
  function backupObject() {
    return {
      app: "SS Holdings Command Centre",
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      goals: state.goals
    };
  }
  function markBackup() {
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (e) {}
    renderBackupInfo();
  }
  function hasData() { return state.transactions.length > 0 || state.goals.length > 0; }
  function download(filename, mime, text) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  $("btn-export-json").addEventListener("click", function () {
    if (!hasData()) { setStatus("Nothing to back up yet. Add a record first.", true); return; }
    download("ss-command-backup-" + todayISO() + ".json", "application/json",
      JSON.stringify(backupObject(), null, 2));
    markBackup();
    setStatus("Backup download started. Now check the Files app, Downloads, and confirm the file is there.", false);
  });

  function csvCell(v) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops spreadsheet formula tricks
    return '"' + s.replace(/"/g, '""') + '"';
  }
  $("btn-export-csv").addEventListener("click", function () {
    if (!state.transactions.length) { setStatus("No transactions to export yet.", true); return; }
    var rows = [["Date", "Account", "Type", "Amount (Rand)", "Category", "Note"].join(",")];
    state.transactions.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    }).forEach(function (t) {
      rows.push([csvCell(t.date), csvCell(t.account), csvCell(t.type), plainAmount(t.cents),
        csvCell(t.category), csvCell(t.note)].join(","));
    });
    download("ss-command-transactions-" + todayISO() + ".csv", "text/csv",
      "\uFEFF" + rows.join("\r\n"));
    setStatus("CSV download started. It does not include tasks and goals and cannot be used to restore.", false);
  });

  function restoreFromText(text) {
    if (!String(text).trim()) { setStatus("There is no backup text to restore.", true); return; }
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { setStatus("That is not a valid backup (it could not be read). Nothing was changed.", true); return; }
    var r = cleanData(obj);
    if (r.error) { setStatus(r.error, true); return; }
    if (!confirm("Restoring will REPLACE everything in the app with " + r.transactions.length +
        " record(s) and " + r.goals.length + " task(s)/goal(s) from the backup. Continue?")) {
      setStatus("Restore cancelled. Nothing was changed.", false);
      return;
    }
    state = r;
    var ok = save();
    resetForm();
    renderAll();
    setStatus(ok ? "Restored " + r.transactions.length + " record(s) and " + r.goals.length +
      " task(s)/goal(s). Please check the History tab." :
      "Restored on screen but NOT saved. Do not rely on it.", !ok);
  }

  $("import-file").addEventListener("change", function () {
    var input = $("import-file");
    var f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 5000000) { setStatus("That file is too large to be a backup from this app.", true); input.value = ""; return; }
    var rd = new FileReader();
    rd.onload = function () { restoreFromText(String(rd.result)); input.value = ""; };
    rd.onerror = function () { setStatus("The file could not be read.", true); input.value = ""; };
    rd.readAsText(f);
  });

  $("btn-show-text").addEventListener("click", function () {
    if (!hasData()) { setStatus("Nothing to back up yet.", true); return; }
    $("backup-text").value = JSON.stringify(backupObject(), null, 2);
    setStatus("Backup text is shown below. Copy it into Notes or an email to yourself.", false);
  });
  $("btn-copy-text").addEventListener("click", function () {
    if (!hasData()) { setStatus("Nothing to back up yet.", true); return; }
    var ta = $("backup-text");
    ta.value = JSON.stringify(backupObject(), null, 2);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    function finished(ok) {
      if (ok) { markBackup(); setStatus("Copied. Paste it into Notes or an email to yourself, then check it is there.", false); }
      else { setStatus("Could not copy automatically. The text is selected: press and hold on it, then tap Copy.", true); }
    }
    function legacy() { try { return document.execCommand("copy"); } catch (e) { return false; } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(function () { finished(true); }, function () { finished(legacy()); });
    } else {
      finished(legacy());
    }
  });
  $("btn-restore-text").addEventListener("click", function () { restoreFromText($("backup-text").value); });

  $("btn-reset").addEventListener("click", function () {
    if (!confirm("Erase ALL records, tasks and goals on this device? This cannot be undone. Have you made and tested a backup?")) return;
    if (!confirm("Last check: really erase everything?")) return;
    state = { transactions: [], goals: [] };
    save();
    resetForm();
    renderAll();
    setStatus("All data was erased from this device.", false);
  });

  /* ---------- Start up ---------- */
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.addEventListener("click", function () { show(t.getAttribute("data-view")); });
  });
  $("dash-period").addEventListener("change", renderDashboard);
  $("filter-account").addEventListener("change", renderHistory);
  $("filter-type").addEventListener("change", renderHistory);

  load();
  resetForm();
  renderAll();
  show("dashboard");
})();

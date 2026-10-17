/* SS Holdings Command Centre - app.js (Phase 2, Stage A) */
(function () {
  "use strict";

  var KEY1 = "ssCommand.v1";            // Phase 1 data: kept as a safety copy, not changed by upgrading
  var KEY2 = "ssCommand.v2";            // Phase 2 data
  var BACKUP_KEY = "ssCommand.lastBackup";
  var MIGRATED_KEY = "ssCommand.v2.migratedAt";
  var UNASSIGNED = "b_unassigned";
  var state = { businesses: [], transactions: [], goals: [] };
  var saveWarned = false;
  var editingTxBiz = "";

  var PERSONAL_TYPES = [["income", "Money in (income)"], ["expense", "Money out (expense)"]];
  var BUSINESS_TYPES = [
    ["income", "Revenue (money in from sales)"],
    ["expense", "Expense (money out)"],
    ["owner_in", "Owner put money in (not revenue)"],
    ["owner_out", "Owner took money out (not an expense)"]
  ];

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
  function addOpt(sel, value, text) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
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

  /* ---------- Cleaning data (used for saved data and for backups) ---------- */
  function unassignedBiz() {
    return { id: UNASSIGNED, name: "Unassigned", desc: "Business records not yet linked to a business. Edit each one to choose its business.", archived: false };
  }
  function isSystem(b) { return b.id === UNASSIGNED; }

  function cleanBusiness(b) {
    if (!b || typeof b !== "object") return null;
    var id = (typeof b.id === "string" && b.id) ? b.id.slice(0, 40) : "";
    if (!id) return null;
    if (id === UNASSIGNED) return unassignedBiz();
    var name = String(b.name || "").trim().slice(0, 60);
    if (!name) return null;
    return { id: id, name: name, desc: String(b.desc || "").slice(0, 120), archived: b.archived === true };
  }
  function cleanTx(t) {
    if (!t || typeof t !== "object") return null;
    if (t.account !== "personal" && t.account !== "business") return null;
    var okTypes = t.account === "business" ? ["income", "expense", "owner_in", "owner_out"] : ["income", "expense"];
    if (okTypes.indexOf(t.type) < 0) return null;
    if (typeof t.cents !== "number" || t.cents % 1 !== 0 || t.cents < 1 || t.cents > 99999999999) return null;
    if (!validDate(t.date)) return null;
    return {
      id: (typeof t.id === "string" && t.id) ? t.id.slice(0, 40) : newId(),
      account: t.account,
      businessId: (t.account === "business" && typeof t.businessId === "string") ? t.businessId.slice(0, 40) : "",
      type: t.type, cents: t.cents, date: t.date,
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
      title: title, kind: g.kind === "goal" ? "goal" : "task", due: due, done: g.done === true,
      businessId: typeof g.businessId === "string" ? g.businessId.slice(0, 40) : ""
    };
  }
  // Accepts a Phase 2 backup/saved data (has "businesses") or a Phase 1 one (does not).
  function cleanData(obj) {
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.transactions) || !Array.isArray(obj.goals)) {
      return { error: "This does not look like a backup from this app. Nothing was changed." };
    }
    var fromV1 = !Array.isArray(obj.businesses);
    var biz = [], isBiz = Object.create(null), seen = Object.create(null), i, c;
    if (!fromV1) {
      for (i = 0; i < obj.businesses.length; i++) {
        c = cleanBusiness(obj.businesses[i]);
        if (!c) return { error: "Business number " + (i + 1) + " in the backup is invalid, so nothing was restored." };
        if (isBiz[c.id]) return { error: "The backup lists the same business twice, so nothing was restored." };
        isBiz[c.id] = true;
        biz.push(c);
      }
    }
    var tx = [], moved = 0, needUnassigned = false;
    for (i = 0; i < obj.transactions.length; i++) {
      c = cleanTx(obj.transactions[i]);
      if (!c) return { error: "Record number " + (i + 1) + " in the backup is invalid, so nothing was restored." };
      if (seen[c.id]) c.id = newId();
      seen[c.id] = true;
      if (c.account === "business") {
        if (c.businessId !== UNASSIGNED && !isBiz[c.businessId]) { c.businessId = UNASSIGNED; moved++; }
        if (c.businessId === UNASSIGNED) needUnassigned = true;
      }
      tx.push(c);
    }
    if (needUnassigned && !isBiz[UNASSIGNED]) { biz.unshift(unassignedBiz()); isBiz[UNASSIGNED] = true; }
    var gl = [];
    for (i = 0; i < obj.goals.length; i++) {
      c = cleanGoal(obj.goals[i]);
      if (!c) return { error: "Task/goal number " + (i + 1) + " in the backup is invalid, so nothing was restored." };
      if (seen[c.id]) c.id = newId();
      seen[c.id] = true;
      if (c.businessId && !isBiz[c.businessId]) c.businessId = "";
      gl.push(c);
    }
    return { businesses: biz, transactions: tx, goals: gl, moved: moved, fromV1: fromV1 };
  }
  function toState(r) { return { businesses: r.businesses, transactions: r.transactions, goals: r.goals }; }
  function readState(raw) {
    try { var r = cleanData(JSON.parse(raw)); return r.error ? null : r; }
    catch (e) { return null; }
  }

  /* ---------- Saving, loading and upgrading (browser storage on this phone) ---------- */
  function put(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function save() {
    try {
      localStorage.setItem(KEY2, JSON.stringify({
        version: 2, businesses: state.businesses, transactions: state.transactions, goals: state.goals
      }));
      return true;
    } catch (e) {
      if (!saveWarned) {
        saveWarned = true;
        alert("WARNING: this change could NOT be saved. Safari may be blocking storage (for example in Private mode). Do not rely on this data.");
      }
      return false;
    }
  }
  function load() {
    var raw2, raw1;
    try { raw2 = localStorage.getItem(KEY2); raw1 = localStorage.getItem(KEY1); } catch (e) { return; }
    var r, msg = "";
    if (raw2) {
      r = readState(raw2);
      if (r) { state = toState(r); return; }   // normal start: never upgrades twice
      put(KEY2 + ".corrupt." + Date.now(), raw2);
      msg = "Your saved data could not be read. A copy of it was kept in the browser. ";
    }
    if (raw1) {
      r = readState(raw1);
      if (r) {
        state = toState(r);
        var saved = save();
        if (saved) put(MIGRATED_KEY, new Date().toISOString());
        if (state.transactions.length || state.goals.length) {
          alert(msg + "Your Phase 1 records were copied into the new Phase 2 format. Your original Phase 1 copy was left untouched." +
            (r.moved ? " " + r.moved + " business record(s) were placed in 'Unassigned'. Open the History tab and tap Edit on each one to choose its business." : ""));
        }
        return;
      }
      msg += "Your old Phase 1 data could not be read either (it was left untouched). ";
    }
    if (msg) alert(msg + "The app started empty. Please do not add records until you have asked for help.");
  }

  /* ---------- Business helpers and calculations ---------- */
  function bizById(id) {
    for (var i = 0; i < state.businesses.length; i++) if (state.businesses[i].id === id) return state.businesses[i];
    return null;
  }
  function bizName(id) { var b = bizById(id); return b ? b.name : "Unknown business"; }
  function usedCount(id) {
    var n = 0;
    state.transactions.forEach(function (t) { if (t.account === "business" && t.businessId === id) n++; });
    state.goals.forEach(function (g) { if (g.businessId === id) n++; });
    return n;
  }
  function byName(a, b) {
    var x = a.name.toLowerCase(), y = b.name.toLowerCase();
    return x < y ? -1 : (x > y ? 1 : 0);
  }
  function activeBusinesses() {
    return state.businesses.filter(function (b) { return !isSystem(b) && !b.archived; }).sort(byName);
  }
  function visibleBusinesses() {
    var list = state.businesses.filter(function (b) { return !isSystem(b) || usedCount(b.id) > 0; });
    return list.sort(function (a, b) {
      if (isSystem(a) !== isSystem(b)) return isSystem(a) ? -1 : 1;
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return byName(a, b);
    });
  }
  // Revenue, expenses, profit. Only business records are counted. Owner funding is kept separate.
  function bizTotals(bid, month) {
    var s = { revenue: 0, expenses: 0, ownerIn: 0, ownerOut: 0, count: 0 };
    state.transactions.forEach(function (t) {
      if (t.account !== "business") return;
      if (bid && t.businessId !== bid) return;
      if (month && t.date.slice(0, 7) !== month) return;
      s.count++;
      if (t.type === "income") s.revenue += t.cents;
      else if (t.type === "expense") s.expenses += t.cents;
      else if (t.type === "owner_in") s.ownerIn += t.cents;
      else if (t.type === "owner_out") s.ownerOut += t.cents;
    });
    s.net = s.revenue - s.expenses;
    s.ownerNet = s.ownerIn - s.ownerOut;
    return s;
  }
  function typeLabel(t) {
    if (t.type === "owner_in") return "Owner put money in";
    if (t.type === "owner_out") return "Owner took money out";
    if (t.account === "business") return t.type === "income" ? "Revenue" : "Expense";
    return t.type === "income" ? "Money in" : "Money out";
  }
  function isMoneyIn(type) { return type === "income" || type === "owner_in"; }

  /* ---------- Screens ---------- */
  var VIEWS = ["dashboard", "add", "history", "goals", "businesses", "backup"];
  function show(name) {
    VIEWS.forEach(function (v) { $("view-" + v).classList.toggle("active", v === name); });
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
    var p = { income: 0, expense: 0 };
    state.transactions.forEach(function (t) {
      if (t.account !== "personal") return;
      if (month && t.date.slice(0, 7) !== month) return;
      p[t.type] += t.cents;
    });
    var b = bizTotals(null, month);
    $("personal-in").textContent = rand(p.income);
    $("personal-out").textContent = rand(p.expense);
    setNet($("personal-net"), p.income - p.expense);
    $("business-in").textContent = rand(b.revenue);
    $("business-out").textContent = rand(b.expenses);
    setNet($("business-net"), b.net);
    $("business-owner").textContent = rand(b.ownerNet);
    setNet($("total-net"), (p.income - p.expense) + b.net);
    var done = state.goals.filter(function (g) { return g.done; }).length;
    $("done-tasks").textContent = done;
    $("open-tasks").textContent = state.goals.length - done;
  }

  function hasData() {
    return state.businesses.length > 0 || state.transactions.length > 0 || state.goals.length > 0;
  }
  function renderBackupInfo() {
    var last = null, mig = null;
    try { last = localStorage.getItem(BACKUP_KEY); mig = localStorage.getItem(MIGRATED_KEY); } catch (e) {}
    var msg = "";
    $("last-backup").textContent = last
      ? "Last backup started: " + last.slice(0, 10) + ". This only shows a backup was started. Check the file is really saved."
      : "No backup downloaded yet.";
    if (hasData()) {
      if (!last) {
        msg = "You have records but have never made a backup. Go to the Backup tab.";
      } else if (mig && last < mig) {
        msg = "The app was upgraded to Phase 2. Please make a new backup in the new format (Backup tab).";
      } else {
        var days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
        if (days >= 7) msg = "Your last backup was " + days + " days ago. Please make a new one.";
      }
    }
    $("backup-reminder").textContent = msg;
  }

  function refreshFilterBusiness() {
    var sel = $("filter-business"), prev = sel.value || "all";
    sel.innerHTML = "";
    addOpt(sel, "all", "All businesses");
    visibleBusinesses().forEach(function (b) { addOpt(sel, b.id, b.name + (b.archived ? " (archived)" : "")); });
    sel.value = prev;
    if (!sel.value) sel.value = "all";
    $("filter-business-wrap").hidden = $("filter-account").value !== "business";
  }

  function renderHistory() {
    var fa = $("filter-account").value, ft = $("filter-type").value, fb = $("filter-business").value || "all";
    var list = state.transactions.filter(function (t) {
      if (fa !== "all" && t.account !== fa) return false;
      if (fa === "business" && fb !== "all" && t.businessId !== fb) return false;
      return ft === "all" || t.type === ft;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    var inc = 0, exp = 0, oin = 0, oout = 0;
    list.forEach(function (t) {
      if (t.type === "income") inc += t.cents;
      else if (t.type === "expense") exp += t.cents;
      else if (t.type === "owner_in") oin += t.cents;
      else oout += t.cents;
    });
    $("history-summary").textContent = list.length
      ? list.length + " record(s). In " + rand(inc) + ", out " + rand(exp) + ", net " + rand(inc - exp) +
        ((oin || oout) ? ". Owner funding: in " + rand(oin) + ", out " + rand(oout) + " (not part of net)" : "") + "."
      : "";
    var ul = $("tx-list");
    ul.innerHTML = "";
    list.forEach(function (t) {
      var li = el("li", "item");
      var main = el("div", "item-main");
      main.appendChild(el("div", "item-title", t.category));
      main.appendChild(el("div", "item-sub",
        t.date + " - " + (t.account === "personal" ? "Personal" : "Business: " + bizName(t.businessId)) +
        " - " + typeLabel(t) + (t.note ? " - " + t.note : "")));
      var actions = el("div");
      actions.appendChild(btn("Edit", "", function () { startEdit(t.id); }));
      actions.appendChild(btn("Delete", "danger", function () { deleteTx(t.id); }));
      main.appendChild(actions);
      var side = el("div", "item-side");
      side.appendChild(el("div", "amount " + (isMoneyIn(t.type) ? "income" : "expense"),
        (isMoneyIn(t.type) ? "+" : "-") + rand(t.cents)));
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

  function renderBusinesses() {
    var g = bizTotals(null, null);
    $("grp-revenue").textContent = rand(g.revenue);
    $("grp-expenses").textContent = rand(g.expenses);
    setNet($("grp-net"), g.net);
    $("grp-owner").textContent = rand(g.ownerNet);
    var list = visibleBusinesses(), ul = $("biz-list");
    ul.innerHTML = "";
    list.forEach(function (b) {
      var s = bizTotals(b.id, null);
      var li = el("li", "item");
      var main = el("div", "item-main");
      var title = el("div", "item-title");
      if (isSystem(b)) title.appendChild(el("span", "tag alert", "Needs assigning"));
      else if (b.archived) title.appendChild(el("span", "tag", "Archived"));
      title.appendChild(el("span", "", b.name));
      main.appendChild(title);
      if (b.desc) main.appendChild(el("div", "item-sub", b.desc));
      main.appendChild(el("div", "item-sub", "Revenue " + rand(s.revenue) + " - Expenses " + rand(s.expenses)));
      main.appendChild(el("div", "item-sub", "Owner funding, net " + rand(s.ownerNet) + " (not profit)"));
      var actions = el("div");
      if (!isSystem(b)) actions.appendChild(btn("Edit", "", function () { startBizEdit(b.id); }));
      actions.appendChild(btn("View records", "", function () { viewBizRecords(b.id); }));
      main.appendChild(actions);
      var side = el("div", "item-side");
      side.appendChild(el("div", "amount " + (s.net >= 0 ? "income" : "expense"), rand(s.net)));
      side.appendChild(el("div", "item-sub", "Net profit/loss"));
      li.appendChild(main);
      li.appendChild(side);
      ul.appendChild(li);
    });
    $("biz-empty").hidden = list.length > 0;
  }

  function renderAll() {
    fillTxBusiness($("tx-business").value, editingTxBiz);
    refreshFilterBusiness();
    renderDashboard();
    renderHistory();
    renderGoals();
    renderBusinesses();
    renderBackupInfo();
  }

  /* ---------- Records: add, edit, delete ---------- */
  function fillTxBusiness(selected, extraId) {
    var sel = $("tx-business"), list = activeBusinesses().slice();
    var extra = extraId ? bizById(extraId) : null;
    if (extra && list.indexOf(extra) < 0) list.unshift(extra);
    sel.innerHTML = "";
    if (!list.length) { addOpt(sel, "", "No businesses yet - create one in the Business tab"); return; }
    list.forEach(function (b) {
      addOpt(sel, b.id, b.name + (isSystem(b) ? " - choose the right business" : (b.archived ? " (archived)" : "")));
    });
    sel.value = selected || "";
    if (!sel.value) sel.value = list[0].id;
  }
  function applyAccountUI(keepType, bizId) {
    var acct = $("tx-account").value;
    var types = acct === "business" ? BUSINESS_TYPES : PERSONAL_TYPES;
    var sel = $("tx-type");
    sel.innerHTML = "";
    types.forEach(function (p) { addOpt(sel, p[0], p[1]); });
    sel.value = keepType || "";
    if (!sel.value) sel.value = types[0][0];
    $("tx-business-wrap").hidden = acct !== "business";
    if (acct === "business") fillTxBusiness(bizId, editingTxBiz);
  }
  function resetForm() {
    editingTxBiz = "";
    $("tx-form").reset();
    $("tx-id").value = "";
    $("tx-date").value = todayISO();
    applyAccountUI("", "");
    $("form-title").textContent = "Add a record";
    $("tx-save").textContent = "Save record";
    $("tx-cancel").hidden = true;
    $("tx-error").textContent = "";
  }
  function startEdit(id) {
    var t = state.transactions.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    editingTxBiz = t.account === "business" ? t.businessId : "";
    $("tx-id").value = t.id;
    $("tx-account").value = t.account;
    applyAccountUI(t.type, t.businessId);
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

  $("tx-account").addEventListener("change", function () {
    applyAccountUI($("tx-type").value, $("tx-business").value);
  });

  $("tx-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var err = $("tx-error");
    var cents = parseRand($("tx-amount").value);
    if (cents === null) { err.textContent = "Enter an amount above zero, like 1250.50 (numbers only, up to 2 decimals)."; return; }
    var date = $("tx-date").value;
    if (!validDate(date)) { err.textContent = "Choose a valid date."; return; }
    var account = $("tx-account").value, bizId = "";
    if (account === "business") {
      bizId = $("tx-business").value;
      if (!bizId || !bizById(bizId)) {
        err.textContent = "Choose a business. If none are listed, create one in the Business tab first.";
        return;
      }
    }
    var id = $("tx-id").value;
    var rec = cleanTx({
      id: id || newId(),
      account: account,
      businessId: bizId,
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
  $("tx-cancel").addEventListener("click", function () { resetForm(); renderAll(); show("history"); });

  /* ---------- Businesses ---------- */
  function resetBizForm() {
    $("biz-form").reset();
    $("biz-id").value = "";
    $("biz-form-title").textContent = "Add a business";
    $("biz-save").textContent = "Add business";
    $("biz-cancel").hidden = true;
    $("biz-archive").hidden = true;
    $("biz-delete").hidden = true;
    $("biz-error").textContent = "";
  }
  function startBizEdit(id) {
    var b = bizById(id);
    if (!b || isSystem(b)) return;
    $("biz-id").value = b.id;
    $("biz-name").value = b.name;
    $("biz-desc").value = b.desc;
    $("biz-form-title").textContent = "Edit business";
    $("biz-save").textContent = "Save changes";
    $("biz-archive").textContent = b.archived ? "Restore this business" : "Archive this business";
    $("biz-cancel").hidden = false;
    $("biz-archive").hidden = false;
    $("biz-delete").hidden = false;
    $("biz-error").textContent = "";
    $("biz-form").scrollIntoView();
  }
  function viewBizRecords(id) {
    $("filter-account").value = "business";
    refreshFilterBusiness();
    $("filter-business").value = id;
    $("filter-type").value = "all";
    renderHistory();
    show("history");
  }

  $("biz-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var err = $("biz-error"), id = $("biz-id").value;
    var name = $("biz-name").value.trim().replace(/\s+/g, " ").slice(0, 60);
    var desc = $("biz-desc").value.trim().slice(0, 120);
    if (!name) { err.textContent = "Type a business name."; return; }
    if (name.toLowerCase() === "unassigned") { err.textContent = "The name \"Unassigned\" is reserved. Choose another name."; return; }
    var clash = state.businesses.some(function (b) { return b.id !== id && b.name.toLowerCase() === name.toLowerCase(); });
    if (clash) { err.textContent = "You already have a business with that name."; return; }
    if (id) {
      var b = bizById(id);
      if (!b || isSystem(b)) { err.textContent = "That business cannot be edited."; return; }
      b.name = name;
      b.desc = desc;
    } else {
      state.businesses.push({ id: newId(), name: name, desc: desc, archived: false });
    }
    save();
    resetBizForm();
    renderAll();
  });
  $("biz-cancel").addEventListener("click", resetBizForm);
  $("biz-archive").addEventListener("click", function () {
    var b = bizById($("biz-id").value);
    if (!b || isSystem(b)) return;
    if (!b.archived && !confirm("Archive " + b.name + "? It will no longer be offered when adding records, but all its records are kept and still count in group totals.")) return;
    b.archived = !b.archived;
    save();
    resetBizForm();
    renderAll();
  });
  $("biz-delete").addEventListener("click", function () {
    var b = bizById($("biz-id").value);
    if (!b || isSystem(b)) return;
    var n = usedCount(b.id);
    if (n > 0) {
      alert(b.name + " has " + n + " record(s) or goal(s) linked to it, so it cannot be deleted. Use Archive instead, or edit or delete those records first.");
      return;
    }
    if (!confirm("Delete " + b.name + "? It has no records. This cannot be undone.")) return;
    state.businesses = state.businesses.filter(function (x) { return x.id !== b.id; });
    save();
    resetBizForm();
    renderAll();
  });

  /* ---------- Tasks and goals ---------- */
  $("goal-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var err = $("goal-error");
    var g = cleanGoal({
      title: $("goal-title").value,
      kind: $("goal-kind").value,
      due: $("goal-due").value,
      done: false,
      businessId: ""
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
      version: 2,
      exportedAt: new Date().toISOString(),
      businesses: state.businesses,
      transactions: state.transactions,
      goals: state.goals
    };
  }
  function markBackup() {
    put(BACKUP_KEY, new Date().toISOString());
    renderBackupInfo();
  }
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
    var rows = [["Date", "Account", "Business", "Type", "Amount (Rand)", "Category", "Note"].join(",")];
    state.transactions.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    }).forEach(function (t) {
      rows.push([csvCell(t.date), csvCell(t.account), csvCell(t.account === "business" ? bizName(t.businessId) : ""),
        csvCell(t.type), plainAmount(t.cents), csvCell(t.category), csvCell(t.note)].join(","));
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
    var msg = "Restoring will REPLACE everything in the app with " + r.businesses.length + " business(es), " +
      r.transactions.length + " record(s) and " + r.goals.length + " task(s)/goal(s) from the backup.";
    if (r.fromV1) msg += " This is a Phase 1 backup, so any business records in it will go into 'Unassigned'.";
    else if (r.moved) msg += " " + r.moved + " record(s) pointed to a missing business and will go into 'Unassigned'.";
    msg += " A safety copy of what is in the app now is kept. Continue?";
    if (!confirm(msg)) { setStatus("Restore cancelled. Nothing was changed.", false); return; }
    try {
      var current = localStorage.getItem(KEY2);
      if (current) localStorage.setItem(KEY2 + ".beforeRestore", current);
    } catch (e) {}
    state = toState(r);
    var ok = save();
    resetForm();
    resetBizForm();
    renderAll();
    setStatus(ok ? "Restored " + r.businesses.length + " business(es), " + r.transactions.length + " record(s) and " +
      r.goals.length + " task(s)/goal(s). Please check the History and Business tabs." :
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
    if (!confirm("Erase ALL businesses, records, tasks and goals on this device? This also removes the old Phase 1 copy and the safety copies kept by the app. This cannot be undone. Have you made and tested a backup?")) return;
    if (!confirm("Last check: really erase everything?")) return;
    var keys = [], i;
    try {
      for (i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("ssCommand.") === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    state = { businesses: [], transactions: [], goals: [] };
    resetForm();
    resetBizForm();
    renderAll();
    setStatus("All data was erased from this device.", false);
  });

  /* ---------- Start up ---------- */
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.disabled = false;
    t.addEventListener("click", function () { show(t.getAttribute("data-view")); });
  });
  $("dash-period").addEventListener("change", renderDashboard);
  $("filter-account").addEventListener("change", function () { refreshFilterBusiness(); renderHistory(); });
  $("filter-business").addEventListener("change", renderHistory);
  $("filter-type").addEventListener("change", renderHistory);

  load();
  resetForm();
  resetBizForm();
  renderAll();
  show("dashboard");
})();

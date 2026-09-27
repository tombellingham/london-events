/* Talks & lectures in London — all filtering happens here, on the full event blob that is
   inlined into the page at build time. No framework, no build step. */

(function () {
  "use strict";

  var DATA = JSON.parse(document.getElementById("events-data").textContent);
  var EVENTS = DATA.events || [];
  var SOURCES = DATA.sources || [];
  var SOURCE_BY_ID = {};
  SOURCES.forEach(function (s) {
    SOURCE_BY_ID[s.id] = s;
  });

  // Day ranges relative to today (London). "date" (one day picked with the
  // dd/mm button) is also a `when`, but deliberately never saved: not in the
  // URL, where it would get bookmarked by accident, nor in this browser.
  var WINDOWS = { today: [0, 1], tomorrow: [1, 2], week: [0, 7], month: [0, 30] };
  var WINDOW_LABELS = { today: "today", tomorrow: "tomorrow", week: "in the next 7 days", month: "in the next 30 days" };
  var DEFAULTS = { when: "week", price: "any", q: "", off: [] };
  var PAGE_SIZE = 250;
  var STORAGE_KEY = "london-talks:filters:v1";

  // ---------------------------------------------------------------------------
  // London time helpers (the viewer may be anywhere; events are London-local)

  var partsFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  function londonNow() {
    var p = {};
    partsFmt.formatToParts(new Date()).forEach(function (x) {
      p[x.type] = x.value;
    });
    return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute };
  }

  function addDays(date, n) {
    var d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n));
    return d.toISOString().slice(0, 10);
  }

  var dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  function dayLabel(date) {
    return dayFmt.format(new Date(date + "T12:00:00Z"));
  }

  // ---------------------------------------------------------------------------
  // State: URL first (shareable), then this browser's last choice, then defaults

  function readState() {
    var params = new URLSearchParams(location.search);
    var hasUrlState = ["when", "price", "q", "off"].some(function (k) {
      return params.has(k);
    });
    var stored = {};
    if (!hasUrlState) {
      try {
        stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
      } catch (e) {
        stored = {};
      }
    }
    function pick(key, allowed) {
      var v = params.get(key);
      if (v == null) v = stored[key];
      return allowed.indexOf(v) >= 0 ? v : DEFAULTS[key];
    }
    var off = params.has("off") ? params.get("off").split(",") : stored.off || [];
    return {
      when: pick("when", Object.keys(WINDOWS)),
      price: pick("price", ["any", "free", "paid"]),
      q: params.get("q") || "",
      off: off.filter(function (id) {
        return SOURCE_BY_ID[id];
      }),
    };
  }

  function writeState(state) {
    var params = new URLSearchParams();
    var when = state.when === "date" ? lastWindow : state.when;
    if (when !== DEFAULTS.when) params.set("when", when);
    if (state.price !== DEFAULTS.price) params.set("price", state.price);
    if (state.q) params.set("q", state.q);
    if (state.off.length) params.set("off", state.off.join(","));
    var qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ when: when, price: state.price, off: state.off }));
    } catch (e) {
      /* private mode etc. */
    }
  }

  var state = readState();
  // The day range to save while a single date is picked.
  var lastWindow = state.when;

  // ---------------------------------------------------------------------------
  // Search

  function fold(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  // Events per source with no filters at all, and the last day with events.
  var TOTALS = {};
  EVENTS.forEach(function (e) {
    TOTALS[e.source] = (TOTALS[e.source] || 0) + 1;
  });
  var LAST_DATE = EVENTS.length ? EVENTS[EVENTS.length - 1].date : null;

  var HAYSTACK = EVENTS.map(function (e) {
    var src = SOURCE_BY_ID[e.source];
    return fold([e.title, (e.speakers || []).join(" "), e.location, e.description, src ? src.name : e.source].join(" \u0001 "));
  });

  function terms(q) {
    return fold(q)
      .split(/\s+/)
      .filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Filtering

  /** [first day, day after the last] for the current `when`. */
  function dayRange(st, today) {
    if (st.when === "date") return [st.date, addDays(st.date, 1)];
    var range = WINDOWS[st.when];
    return [addDays(today, range[0]), addDays(today, range[1])];
  }

  function matchesFacets(e, st) {
    if (st.price === "free" && e.free !== true) return false;
    if (st.price === "paid" && e.free !== false) return false;
    return true;
  }

  function filter(st) {
    var days = dayRange(st, londonNow().date);
    var qs = terms(st.q);
    var off = {};
    st.off.forEach(function (id) {
      off[id] = true;
    });
    var perSource = {};
    var out = [];
    for (var i = 0; i < EVENTS.length; i++) {
      var e = EVENTS[i];
      if (e.date < days[0] || e.date >= days[1] || !matchesFacets(e, st)) continue;
      var hay = HAYSTACK[i];
      var ok = true;
      for (var t = 0; t < qs.length; t++) {
        if (hay.indexOf(qs[t]) < 0) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      perSource[e.source] = (perSource[e.source] || 0) + 1;
      if (!off[e.source]) out.push(e);
    }
    return { events: out, perSource: perSource };
  }

  // ---------------------------------------------------------------------------
  // Rendering

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Wraps matches of the (folded) search terms in <mark>, accent-insensitively:
  // "elan" highlights "Élan". Matching runs on a folded copy of the text with
  // an index map back to the original characters, which are escaped as usual.
  function highlight(text, qs) {
    text = String(text == null ? "" : text);
    if (!qs.length) return esc(text);
    var folded = "";
    var map = [];
    for (var i = 0; i < text.length; i++) {
      var f = fold(text[i]);
      for (var k = 0; k < f.length; k++) {
        folded += f[k];
        map.push(i);
      }
    }
    var marks = [];
    qs.forEach(function (q) {
      if (q.length < 2) return;
      for (var at = folded.indexOf(q); at >= 0; at = folded.indexOf(q, at + q.length)) {
        marks.push([map[at], map[at + q.length - 1] + 1]);
      }
    });
    if (!marks.length) return esc(text);
    marks.sort(function (a, b) {
      return a[0] - b[0];
    });
    var out = "";
    var pos = 0;
    marks.forEach(function (m) {
      if (m[1] <= pos) return;
      var start = Math.max(m[0], pos);
      out += esc(text.slice(pos, start)) + "<mark>" + esc(text.slice(start, m[1])) + "</mark>";
      pos = m[1];
    });
    return out + esc(text.slice(pos));
  }

  function sortWithinDay(a, b) {
    if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : a.title.localeCompare(b.title);
    if (a.time) return -1;
    if (b.time) return 1;
    return a.title.localeCompare(b.title);
  }

  function eventHtml(e, qs, now) {
    var src = SOURCE_BY_ID[e.source];
    // The price leads the line, as a tag: free, the price, or just "Paid" (nothing when unknown).
    var tag =
      e.free === true ? '<span class="tag tag--free">Free</span>' :
      e.price ? '<span class="tag tag--paid">' + esc(shortPrice(e.price)) + "</span>" :
      e.free === false ? '<span class="tag tag--paid">Paid</span>' : "";
    var meta = ['<span class="event__source">' + esc(src ? src.name : e.source) + "</span>"];
    if (e.location) meta.push("<span>" + highlight(e.location, qs) + "</span>");
    var past = e.date === now.date && e.time && e.time < now.time;
    var html =
      '<article class="event' + (past ? " event--past" : "") + '">' +
      '<div class="event__time' + (e.time ? "" : " event__time--none") + '">' + (e.time ? esc(e.time) : "—") + "</div>" +
      '<div class="event__body">' +
      '<h3 class="event__title"><a href="' + esc(e.url) + '" rel="noopener">' + highlight(e.title, qs) + "</a></h3>" +
      '<p class="event__meta">' + tag + meta.join('<span class="sep">·</span>') + "</p>";
    if (e.speakers && e.speakers.length) {
      html += '<p class="event__speakers"><span class="label-inline">With </span>' + highlight(e.speakers.join(", "), qs) + "</p>";
    }
    if (e.description) html += '<p class="event__desc" title="Click to expand">' + highlight(e.description, qs) + "</p>";
    if (e.alsoAt && e.alsoAt.length) {
      html +=
        '<p class="event__also">Also listed by ' +
        e.alsoAt
          .map(function (a) {
            var s = SOURCE_BY_ID[a.source];
            return '<a href="' + esc(a.url) + '" rel="noopener">' + esc(s ? s.name : a.source) + "</a>";
          })
          .join(", ") +
        "</p>";
    }
    return html + "</div></article>";
  }

  function shortPrice(p) {
    var m = String(p).match(/£\s?\d+(?:\.\d{2})?/);
    if (!m) return "Paid";
    return (/\bfrom\b/i.test(p) ? "from " : "") + m[0].replace(/\s/g, "");
  }

  var visibleLimit = PAGE_SIZE;
  var dateButton = document.getElementById("pick-date");
  var dateInput = document.getElementById("date-input");
  var eventsEl = document.getElementById("events");
  var countEl = document.getElementById("result-count");

  function render() {
    var now = londonNow();
    var result = filter(state);
    var list = result.events;
    var qs = terms(state.q);

    // Group by day (input is sorted by start; untimed events go to the end of their day).
    var days = [];
    var byDate = {};
    list.forEach(function (e) {
      if (!byDate[e.date]) {
        byDate[e.date] = [];
        days.push(e.date);
      }
      byDate[e.date].push(e);
    });

    var html = "";
    var shown = 0;
    for (var d = 0; d < days.length && shown < visibleLimit; d++) {
      var date = days[d];
      var items = byDate[date].slice().sort(sortWithinDay);
      var rel = date === now.date ? "Today" : date === addDays(now.date, 1) ? "Tomorrow" : "";
      html += '<section class="day" aria-label="' + esc(dayLabel(date)) + '"><h2 class="day__title"><span>' + esc(dayLabel(date)) + "</span>" + (rel ? '<span class="day__rel">' + rel + "</span>" : "") + "</h2>";
      for (var i = 0; i < items.length && shown < visibleLimit; i++, shown++) html += eventHtml(items[i], qs, now);
      html += "</section>";
    }
    if (list.length > shown) {
      html += '<button type="button" class="more" id="show-more">Show ' + Math.min(PAGE_SIZE, list.length - shown) + " more of " + (list.length - shown) + " remaining</button>";
    }
    if (!list.length) {
      html = '<p class="empty">No events match these filters' + (state.off.length || state.q || state.price !== "any" ? '. <button type="button" id="reset-filters">Reset filters</button>' : ".") + "</p>";
    }
    eventsEl.innerHTML = html;
    var whenLabel = state.when === "date" ? "on " + dayLabel(state.date) : WINDOW_LABELS[state.when];
    countEl.textContent = list.length.toLocaleString("en-GB") + (list.length === 1 ? " event " : " events ") + whenLabel + (state.off.length ? " · " + (SOURCES.length - state.off.length) + " of " + SOURCES.length + " sources" : "");

    renderSourceCounts(result.perSource);
    syncControls();
  }

  // Each source shows how many events it has under the current filters
  // (whether or not it's switched on); one with none is faded and locked.
  function renderSourceCounts(perSource) {
    var active = SOURCES.length - state.off.length;
    document.getElementById("sources-count").textContent = active + " of " + SOURCES.length;
    document.querySelectorAll("#source-list .source").forEach(function (label) {
      var input = label.querySelector("input");
      var counter = label.querySelector(".source__count");
      if (!counter) {
        counter = document.createElement("span");
        counter.className = "source__count";
        label.appendChild(counter);
      }
      var n = perSource[input.value] || 0;
      counter.textContent = String(n);
      label.classList.toggle("source--none", n === 0);
      input.disabled = n === 0;
      if (n) label.removeAttribute("title");
      else label.title = TOTALS[input.value] ? "No events match the current filters" : "No upcoming events";
    });
  }

  function syncControls() {
    document.querySelectorAll(".choices").forEach(function (group) {
      var key = group.getAttribute("data-filter");
      group.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === state[key]));
      });
    });
    document.querySelectorAll("#source-list input").forEach(function (input) {
      input.checked = state.off.indexOf(input.value) < 0;
    });
    var picked = state.when === "date";
    dateButton.textContent = picked ? state.date.slice(8, 10) + "/" + state.date.slice(5, 7) : "dd/mm";
    dateButton.setAttribute("aria-label", picked ? "Showing " + dayLabel(state.date) + ". Pick another date" : "Pick a date");
    syncDateInput();
    var search = document.getElementById("search");
    if (document.activeElement !== search) search.value = state.q;
  }

  function update(patch) {
    for (var k in patch) state[k] = patch[k];
    if (patch.when && patch.when !== "date") lastWindow = patch.when;
    visibleLimit = PAGE_SIZE;
    writeState(state);
    render();
  }

  // ---------------------------------------------------------------------------
  // Controls

  document.querySelectorAll(".choices").forEach(function (group) {
    group.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-value]");
      if (!btn) return;
      if (btn === dateButton) {
        openDatePicker();
        return;
      }
      var patch = {};
      patch[group.getAttribute("data-filter")] = btn.getAttribute("data-value");
      update(patch);
    });
  });

  // dd/mm: the browser's own date picker, from an invisible date input over the
  // button. With a mouse or keyboard the button opens it with showPicker(). On
  // touch screens the input takes the tap itself (see style.css), as iOS, where
  // every browser is Safari underneath, won't open a picker from script.
  function syncDateInput() {
    var today = londonNow().date;
    dateInput.min = today;
    dateInput.max = LAST_DATE && LAST_DATE > today ? LAST_DATE : today;
    dateInput.value = state.when === "date" ? state.date : "";
  }

  function openDatePicker() {
    syncDateInput();
    try {
      dateInput.showPicker();
    } catch (e) {
      // No showPicker() (older browsers): show the input itself instead.
      dateInput.classList.add("date-input--shown");
      dateInput.removeAttribute("aria-hidden");
      dateInput.focus();
    }
  }

  dateInput.addEventListener("pointerdown", syncDateInput);

  dateInput.addEventListener("change", function () {
    dateInput.classList.remove("date-input--shown");
    dateInput.setAttribute("aria-hidden", "true");
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) update({ when: "date", date: dateInput.value });
    else if (state.when === "date") update({ when: lastWindow });
  });

  var searchTimer;
  document.getElementById("search").addEventListener("input", function (ev) {
    clearTimeout(searchTimer);
    var value = ev.target.value;
    searchTimer = setTimeout(function () {
      update({ q: value.trim() });
    }, 120);
  });

  document.getElementById("source-list").addEventListener("change", function (ev) {
    var input = ev.target;
    if (!input.matches("input[type=checkbox]")) return;
    var off = state.off.filter(function (id) {
      return id !== input.value;
    });
    if (!input.checked) off.push(input.value);
    update({ off: off });
  });

  document.querySelector(".source-actions").addEventListener("click", function (ev) {
    var btn = ev.target.closest("button[data-sources]");
    if (!btn) return;
    update({
      off:
        btn.getAttribute("data-sources") === "none"
          ? SOURCES.map(function (s) {
              return s.id;
            })
          : [],
    });
  });

  // The title goes home: every filter back to its default, including the ones
  // this browser remembers (a plain link to ./ would bring those back).
  document.getElementById("home").addEventListener("click", function (ev) {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    update({ when: DEFAULTS.when, price: DEFAULTS.price, q: DEFAULTS.q, off: [] });
    history.replaceState(null, "", location.pathname);
  });

  eventsEl.addEventListener("click", function (ev) {
    if (ev.target.id === "show-more") {
      visibleLimit += PAGE_SIZE;
      render();
      return;
    }
    if (ev.target.id === "reset-filters") {
      update({ price: "any", q: "", off: [] });
      return;
    }
    var desc = ev.target.closest(".event__desc");
    if (desc) desc.classList.toggle("is-open");
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "/" && document.activeElement && !/input|textarea/i.test(document.activeElement.tagName)) {
      ev.preventDefault();
      document.getElementById("search").focus();
    }
  });

  // Phones: start with the source list folded unless some sources are switched off.
  var picker = document.getElementById("source-picker");
  if (picker && window.matchMedia("(max-width: 560px)").matches && !state.off.length) picker.removeAttribute("open");

  render();
})();

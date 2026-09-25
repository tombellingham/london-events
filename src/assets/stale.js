/* London Talks — shared by both pages: a daily scrape that has stopped
   deploying should be obvious, not silent. Adds "Data is N days old" to the
   line carrying the build time (data-generated-at). */

(function () {
  "use strict";

  var line = document.querySelector("[data-generated-at]");
  if (!line) return;
  var age = Date.now() - Date.parse(line.getAttribute("data-generated-at"));
  if (!(age > 36 * 3600 * 1000)) return;
  var days = Math.floor(age / (24 * 3600 * 1000));
  var flag = document.createElement("span");
  flag.className = "health-stale";
  flag.textContent = "Data is " + (days === 1 ? "a day" : days + " days") + " old";
  var sep = document.createElement("span");
  sep.className = "sep";
  sep.textContent = "·";
  line.insertBefore(sep, line.firstChild);
  line.insertBefore(flag, line.firstChild);
})();
